"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import {
  rings as ringsTable,
  categories as categoriesTable,
  categoryAssignments as categoryAssignmentsTable,
} from "@/db/schema";
import { eq, inArray, and, type InferSelectModel } from "drizzle-orm";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import { isValidUuid } from "@/lib/utils";
import { isDrawPart } from "@/engine/draw-engine/parts";

type CategoryAssignmentRow = InferSelectModel<typeof categoryAssignmentsTable>;

export type AssignmentInput = {
  category_id: string;
  /** Which part of the category this card is: 'ALL' (default), or 'POOL:n' / 'FINALS' once it is split. */
  part?: string;
  ring_id: string | null; // null means unassigned
  queue_order: number;
  status?: string;
  completed_at?: string | null;
};

export type SaveAssignmentsResult = {
  success: boolean;
  error?: string;
};

export async function saveAssignments(
  tournamentId: string,
  assignments: AssignmentInput[]
): Promise<SaveAssignmentsResult> {
  try {
    // Only the event's admin assigns categories to tatamis.
    let admin;
    try {
      admin = await requireTournamentAdmin(tournamentId);
    } catch {
      return { success: false, error: "Unauthorized: Only administrators can assign categories to Tatamis." };
    }

    if (!Array.isArray(assignments) || assignments.length > 5000) {
      return { success: false, error: "Invalid assignment list" };
    }

    // 1. Deduplicate payload by category and part (latest entry wins)
    const partOf = (a: { part?: string }) => a.part ?? "ALL";
    const keyOf = (categoryId: string, part: string) => `${categoryId}|${part}`;
    for (const a of assignments) {
      if (!(partOf(a) === "ALL" || partOf(a) === "FINALS" || isDrawPart(partOf(a)))) {
        return { success: false, error: "Invalid assignment part" };
      }
    }
    const dedupedMap = new Map<string, AssignmentInput>();
    for (const a of assignments) {
      dedupedMap.set(keyOf(a.category_id, partOf(a)), a);
    }
    const cleanAssignments = Array.from(dedupedMap.values());
    const validAssignments = cleanAssignments.filter((a) => a.ring_id !== null);

    // 2. Fetch all ring IDs and valid categories for this tournament
    const [rings, tournamentCategories] = await Promise.all([
      db.select({ id: ringsTable.id }).from(ringsTable).where(eq(ringsTable.tournamentId, tournamentId)),
      db.select({ id: categoriesTable.id }).from(categoriesTable).where(eq(categoriesTable.tournamentId, tournamentId)),
    ]);

    const validCatIds = new Set(tournamentCategories.map((c) => c.id));
    for (const a of validAssignments) {
      if (!validCatIds.has(a.category_id)) {
        return { success: false, error: `Category ${a.category_id} does not belong to this tournament` };
      }
    }

    const ringIds = rings.map((r) => r.id);
    const validRingIds = new Set(ringIds);
    for (const a of validAssignments) {
      if (!validRingIds.has(a.ring_id!)) {
        return { success: false, error: `Tatami ${a.ring_id} does not belong to this tournament` };
      }
      if (!Number.isInteger(a.queue_order) || a.queue_order < 0 || a.queue_order > 100000) {
        return { success: false, error: "Invalid queue order" };
      }
    }

    // 3. Fetch current live assignments to preserve matches_completed and guard running categories
    let currentAssignments: CategoryAssignmentRow[] = [];
    if (ringIds.length > 0) {
      currentAssignments = await db
        .select()
        .from(categoryAssignmentsTable)
        .where(inArray(categoryAssignmentsTable.ringId, ringIds));
    }

    const currentMap = new Map<string, { status: string; matchesCompleted: number; completedAt: Date | null }>();
    currentAssignments.forEach((a) => {
      currentMap.set(keyOf(a.categoryId, a.part), {
        status: a.status,
        matchesCompleted: a.matchesCompleted ?? 0,
        completedAt: a.completedAt,
      });
    });

    // A split category is changed only by splitting or unsplitting it: cards for its parts can
    // move between tatamis and reorder, but none can appear, vanish or merge here.
    const splitCategoryIds = new Set(currentAssignments.filter((a) => a.part !== "ALL").map((a) => a.categoryId));
    const incomingKeys = new Set(validAssignments.map((a) => keyOf(a.category_id, partOf(a))));
    for (const a of validAssignments) {
      const key = keyOf(a.category_id, partOf(a));
      const isSplitCard = partOf(a) !== "ALL";
      if (isSplitCard !== splitCategoryIds.has(a.category_id) || (isSplitCard && !currentMap.has(key))) {
        return { success: false, error: `SPLIT_CATEGORY_CHANGED:${a.category_id}` };
      }
    }
    for (const a of currentAssignments) {
      if (splitCategoryIds.has(a.categoryId) && cleanAssignments.some((c) => c.category_id === a.categoryId) && !incomingKeys.has(keyOf(a.categoryId, a.part))) {
        return { success: false, error: `SPLIT_CATEGORY_CHANGED:${a.categoryId}` };
      }
    }

    // 4. Guard: reject if a running/paused category is displaced from queue_order 0
    for (const a of validAssignments) {
      const live = currentMap.get(keyOf(a.category_id, partOf(a)));
      if (live && (live.status === "running" || live.status === "paused")) {
        if (a.queue_order !== 0) {
          return { success: false, error: `RUNNING_CATEGORY_DISPLACED:${a.category_id}` };
        }
      }
    }

    // 5. Atomic database transaction
    await db.transaction(async (tx) => {
      // Remove categories that were moved out of all rings (now unassigned)
      const incomingCategoryIds = new Set(validAssignments.map((a) => a.category_id));
      // A split category is never dropped by a save; unsplit it first.
      const toDelete = Array.from(new Set(currentAssignments.map((a) => a.categoryId))).filter(
        (catId) => !incomingCategoryIds.has(catId) && !splitCategoryIds.has(catId)
      );

      if (toDelete.length > 0) {
        await tx
          .delete(categoryAssignmentsTable)
          .where(
            and(
              inArray(categoryAssignmentsTable.categoryId, toDelete),
              ringIds.length > 0 ? inArray(categoryAssignmentsTable.ringId, ringIds) : undefined
            )
          );
      }

      if (validAssignments.length > 0) {
        const rows = validAssignments.map((a) => {
          const live = currentMap.get(keyOf(a.category_id, partOf(a)));
          const isExplicitRevert = a.status === "pending" && live?.status === "completed";
          return {
            ringId: a.ring_id!,
            categoryId: a.category_id,
            part: partOf(a),
            queueOrder: a.queue_order,
            status:
              isExplicitRevert || a.status === "pending"
                ? "pending"
                : live?.status === "running" || live?.status === "paused"
                ? live.status
                : a.status === "completed"
                ? "completed"
                : "pending",
            matchesCompleted: isExplicitRevert ? 0 : (live?.matchesCompleted ?? 0),
            completedAt:
              isExplicitRevert || a.status === "pending"
                ? null
                : a.status === "completed"
                ? live?.completedAt || (a.completed_at ? new Date(a.completed_at) : new Date())
                : null,
          };
        });

        const existingRows = rows.filter((r) => currentMap.has(keyOf(r.categoryId, r.part)));
        const newRows = rows.filter((r) => !currentMap.has(keyOf(r.categoryId, r.part)));
        const sameCard = (r: { categoryId: string; part: string }) =>
          and(eq(categoryAssignmentsTable.categoryId, r.categoryId), eq(categoryAssignmentsTable.part, r.part));

        // (ring_id, queue_order) is unique, so park every row being moved on a
        // temporary negative slot first; otherwise swapping two categories'
        // positions collides halfway through.
        let parking = -1;
        for (const r of existingRows) {
          await tx
            .update(categoryAssignmentsTable)
            .set({ queueOrder: parking-- })
            .where(sameCard(r));
        }

        // Update existing rows in place
        for (const r of existingRows) {
          await tx
            .update(categoryAssignmentsTable)
            .set({
              ringId: r.ringId,
              queueOrder: r.queueOrder,
              status: r.status,
              matchesCompleted: r.matchesCompleted,
              completedAt: r.completedAt,
            })
            .where(sameCard(r));
        }

        // Insert new rows
        if (newRows.length > 0) {
          await tx.insert(categoryAssignmentsTable).values(newRows);
        }
      }
    });

    await audit({
      tournamentId,
      actor: admin,
      action: "ASSIGNMENTS_SAVED",
      before: currentAssignments.map((a) => ({ categoryId: a.categoryId, part: a.part, ringId: a.ringId, queueOrder: a.queueOrder, status: a.status })),
      after: validAssignments.map((a) => ({ categoryId: a.category_id, part: partOf(a), ringId: a.ring_id, queueOrder: a.queue_order })),
    });

    // Broadcast immediately so Mod, Organiser, Stager receive updates with zero latency
    broadcastLiveEvent({
      table: "category_assignments",
      op: "UPDATE",
      tournamentId,
    });
    for (const rId of ringIds) {
      broadcastLiveEvent({
        table: "category_assignments",
        op: "UPDATE",
        ringId: rId,
        tournamentId,
      });
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unexpected error while saving assignments";
    console.error("Unexpected error in saveAssignments:", err);
    return { success: false, error: errorMessage };
  }
}

/** Queue state for the given tatamis. All must belong to one tournament the caller staffs. */
export async function getBalancingAssignments(ringIds: string[]) {
  const ids = (Array.isArray(ringIds) ? ringIds : []).filter(isValidUuid).slice(0, 200);
  if (ids.length === 0) return [];

  const owners = await db
    .select({ tournamentId: ringsTable.tournamentId })
    .from(ringsTable)
    .where(inArray(ringsTable.id, ids));
  const tournamentIds = new Set(owners.map((o) => o.tournamentId));
  if (tournamentIds.size !== 1) return [];
  await requireTournamentStaff([...tournamentIds][0]);

  try {
    const rows = await db
      .select()
      .from(categoryAssignmentsTable)
      .where(inArray(categoryAssignmentsTable.ringId, ids));

    return rows.map((row) => ({
      category_id: row.categoryId,
      part: row.part,
      ring_id: row.ringId,
      matches_completed: row.matchesCompleted || 0,
      status: row.status || "pending",
      queue_order: row.queueOrder ?? 0,
      stager_status: row.stagerStatus ?? null,
      stager_name: row.stagerName ?? null,
    }));
  } catch (err) {
    console.error("Failed to fetch balancing assignments:", err);
    return [];
  }
}

