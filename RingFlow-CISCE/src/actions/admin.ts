"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import {
  rings,
  categoryAssignments,
  categories,
  eventLog,
  moderatorRequests,
} from "@/db/schema";
import { eq, and, inArray, desc, asc } from "drizzle-orm";
import { elapsedMs as elapsedFor, normalizeClock } from "@/lib/matchClock";
import { persistRingClock, readRingClockRow } from "@/lib/ringClockStore";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import { tournamentIdForRing } from "@/lib/auth/scope";
import { tournamentCounts } from "@/lib/tournamentCounts";
import {
  serializeRing,
  serializeCategory,
  serializeCategoryAssignment,
  serializeEventLog,
  serializeModRequest,
} from "@/lib/serializers";

/** Pause a running clock in place; used when the floor is halted. */
async function haltRingClock(ringId: string) {
  const row = await readRingClockRow(ringId);
  if (!row) return;
  const clock = normalizeClock(row);
  if (clock.status !== "running") return;
  await persistRingClock(ringId, {
    status: "paused",
    durationMs: clock.durationMs,
    accumulatedMs: elapsedFor(clock, Date.now()),
    startedAt: null,
  });
}

/**
 * Admin pause/resume of one tatami. Pausing halts the running category and
 * its bout clock; resuming only releases the category. The bout clock is
 * restarted by the moderator when the bout actually resumes.
 */
export async function adminSetRingStatus(ringId: string, isPaused: boolean) {
  const tournamentId = await tournamentIdForRing(ringId);
  const admin = await requireTournamentAdmin(tournamentId);

  if (isPaused) await haltRingClock(ringId);

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.ringId, ringId),
        inArray(categoryAssignments.status, isPaused ? ["running"] : ["paused"])
      )
    )
    .limit(1);

  if (!assignment) return { success: true };

  await db
    .update(categoryAssignments)
    .set({ status: isPaused ? "paused" : "running" })
    .where(eq(categoryAssignments.id, assignment.id));

  await db.insert(eventLog).values({
    tournamentId,
    ringId,
    categoryId: assignment.categoryId,
    action: isPaused ? "PAUSE_RING" : "RESUME_RING",
    metadata: { by: "admin" },
  });

  await audit({
    tournamentId,
    ringId,
    categoryId: assignment.categoryId,
    actor: admin,
    action: "ADMIN_RING_STATUS",
    targetType: "category_assignment",
    targetId: assignment.id,
    before: { status: assignment.status },
    after: { status: isPaused ? "paused" : "running" },
  });

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: assignment.id,
    ringId,
    tournamentId,
    status: isPaused ? "paused" : "running",
  });

  return { success: true };
}

export async function adminSetAllRingsStatus(tournamentId: string, isPaused: boolean) {
  const admin = await requireTournamentAdmin(tournamentId);
  await audit({ tournamentId, actor: admin, action: "ADMIN_PAUSE_ALL", after: { paused: Boolean(isPaused) } });

  const ringList = await db
    .select({ id: rings.id })
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId));

  const ringIds = ringList.map((r) => r.id);
  if (ringIds.length === 0) return { success: true };

  if (isPaused) {
    for (const id of ringIds) await haltRingClock(id);
  }

  const assignments = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        inArray(categoryAssignments.ringId, ringIds),
        inArray(categoryAssignments.status, isPaused ? ["running"] : ["paused"])
      )
    );

  for (const assignment of assignments) {
    await db
      .update(categoryAssignments)
      .set({ status: isPaused ? "paused" : "running" })
      .where(eq(categoryAssignments.id, assignment.id));

    await db.insert(eventLog).values({
      tournamentId,
      ringId: assignment.ringId,
      categoryId: assignment.categoryId,
      action: isPaused ? "PAUSE_RING" : "RESUME_RING",
      metadata: { by: "admin", scope: "all" },
    });

    broadcastLiveEvent({
      table: "category_assignments",
      op: "UPDATE",
      id: assignment.id,
      ringId: assignment.ringId,
      tournamentId,
      status: isPaused ? "paused" : "running",
    });
  }

  return { success: true };
}

/** Live floor state for the admin dashboard and the organiser overview. */
export async function getAdminDashboardData(tournamentId: string) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);

  const [ringRows, logRows] = await Promise.all([
    db
      .select()
      .from(rings)
      .where(eq(rings.tournamentId, tournamentId))
      .orderBy(asc(rings.ringOrder)),
    db
      .select()
      .from(eventLog)
      .where(eq(eventLog.tournamentId, tournamentId))
      .orderBy(desc(eventLog.createdAt))
      .limit(50),
  ]);

  const ringIds = ringRows.map((r) => r.id);
  let assignments: ReturnType<typeof serializeCategoryAssignment>[] = [];

  if (ringIds.length > 0) {
    const rawAssignments = await db
      .select()
      .from(categoryAssignments)
      .where(inArray(categoryAssignments.ringId, ringIds))
      .orderBy(asc(categoryAssignments.queueOrder));

    const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId).filter(Boolean)));
    const catMap = new Map<string, typeof categories.$inferSelect>();
    if (categoryIds.length > 0) {
      const cats = await db.select().from(categories).where(inArray(categories.id, categoryIds));
      cats.forEach((c) => catMap.set(c.id, c));
    }

    assignments = rawAssignments.map((a) => serializeCategoryAssignment(a, catMap.get(a.categoryId)));
  }

  return {
    rings: ringRows.map((row) => serializeRing(row)),
    assignments,
    logs: logRows.map((row) => serializeEventLog(row)),
  };
}

export async function getLiveLogs(tournamentId: string) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);

  const logRows = await db
    .select()
    .from(eventLog)
    .where(eq(eventLog.tournamentId, tournamentId))
    .orderBy(desc(eventLog.createdAt))
    .limit(200);
  return logRows.map((row) => serializeEventLog(row));
}

export async function getPendingModeratorRequests(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);

  const ringRows = await db
    .select({ id: rings.id, name: rings.name })
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId));

  const ringMap = new Map(ringRows.map((r) => [r.id, r]));
  const ringIds = ringRows.map((r) => r.id);

  if (ringIds.length === 0) return [];

  const rawReqs = await db
    .select()
    .from(moderatorRequests)
    .where(inArray(moderatorRequests.ringId, ringIds))
    .orderBy(desc(moderatorRequests.createdAt))
    .limit(25);

  return rawReqs.map((mr) => serializeModRequest(mr, ringMap.get(mr.ringId)));
}

/** Category / tatami index for the staff header search. */
export async function getTournamentSearchMeta(tournamentId: string) {
  await requireTournamentStaff(tournamentId);

  const [cats, ringList] = await Promise.all([
    db.select().from(categories).where(eq(categories.tournamentId, tournamentId)),
    db.select().from(rings).where(eq(rings.tournamentId, tournamentId)),
  ]);

  const ringIds = ringList.map((r) => r.id);
  const assigns =
    ringIds.length > 0
      ? await db
          .select({
            categoryId: categoryAssignments.categoryId,
            ringId: categoryAssignments.ringId,
            status: categoryAssignments.status,
            queueOrder: categoryAssignments.queueOrder,
          })
          .from(categoryAssignments)
          .where(inArray(categoryAssignments.ringId, ringIds))
      : [];

  return {
    categories: cats.map((row) => serializeCategory(row)),
    rings: ringList.map((row) => serializeRing(row)),
    assignments: assigns.map((a) => ({
      category_id: a.categoryId,
      ring_id: a.ringId,
      status: a.status,
      queue_order: a.queueOrder,
    })),
  };
}

export async function getSidebarTournamentCounts(tournamentId: string) {
  if (!tournamentId) return null;
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  return tournamentCounts(tournamentId);
}
