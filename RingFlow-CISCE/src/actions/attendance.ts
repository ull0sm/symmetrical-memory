"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { categoryAssignments, categoryAttendance } from "@/db/schema";
import { audit } from "@/lib/audit";
import { describePrincipal, requireTournamentStaff, tournamentIdForCategory } from "@/lib/auth";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { isAthleteInCategory, listCategoryAthletes } from "@/lib/roster/categoryAthletes";
import { parseInput } from "@/lib/validation";

/**
 * Optional call-area attendance. A
 * helper, never a gate: nothing in the app waits on it. Stagers and the
 * event's admin mark athletes; moderators of the event read it (the desk
 * hint); organisers and the public never see it.
 */

export type AttendanceStatus = "present" | "absent" | "withdrawn";

/** Athletes of a category with their call-area status ("unknown" until marked). */
export async function getCategoryAttendance(categoryId: string) {
  const tournamentId = await tournamentIdForCategory(categoryId);
  // Role matrix: admin and stager mark it, the moderator reads it; organisers don't see it.
  await requireTournamentStaff(tournamentId, ["admin", "stager", "moderator"]);

  const [people, marks] = await Promise.all([
    listCategoryAthletes(categoryId),
    db.select().from(categoryAttendance).where(eq(categoryAttendance.categoryId, categoryId)),
  ]);
  const byAthlete = new Map(marks.map((m) => [m.athleteId, m]));
  return people.map((p) => {
    const m = byAthlete.get(p.athleteId);
    return {
      ...p,
      status: (m?.status ?? "unknown") as AttendanceStatus | "unknown",
      setBy: m?.setBy ?? null,
      setAt: m?.setAt?.toISOString() ?? null,
    };
  });
}

const setSchema = z.object({
  categoryId: z.string().uuid(),
  athleteId: z.string().uuid(),
  status: z.enum(["unknown", "present", "absent", "withdrawn"]),
});

/** Mark one athlete. "unknown" clears the mark. */
export async function setAthleteAttendance(input: z.input<typeof setSchema>) {
  const params = parseInput(setSchema, input, "attendance");
  const tournamentId = await tournamentIdForCategory(params.categoryId);
  const actor = await requireTournamentStaff(tournamentId, ["admin", "stager"]);
  if (!(await isAthleteInCategory(params.categoryId, params.athleteId))) {
    return { success: false as const, error: "That athlete is not in this category." };
  }

  const where = and(eq(categoryAttendance.categoryId, params.categoryId), eq(categoryAttendance.athleteId, params.athleteId));
  const [before] = await db.select({ status: categoryAttendance.status }).from(categoryAttendance).where(where);
  if ((before?.status ?? "unknown") === params.status) return { success: true as const };

  const who = describePrincipal(actor);
  if (params.status === "unknown") {
    await db.delete(categoryAttendance).where(where);
  } else {
    const values = { status: params.status, setBy: `${who.role}:${who.name}`, setAt: new Date() };
    await db
      .insert(categoryAttendance)
      .values({ categoryId: params.categoryId, athleteId: params.athleteId, ...values })
      .onConflictDoUpdate({ target: [categoryAttendance.categoryId, categoryAttendance.athleteId], set: values });
  }

  await audit({
    tournamentId,
    categoryId: params.categoryId,
    actor,
    action: "ATTENDANCE_SET",
    targetType: "athlete",
    targetId: params.athleteId,
    before: { status: before?.status ?? "unknown" },
    after: { status: params.status },
  });

  const [assignment] = await db
    .select({ ringId: categoryAssignments.ringId })
    .from(categoryAssignments)
    .where(eq(categoryAssignments.categoryId, params.categoryId))
    .limit(1);
  // Staff feed only: category_attendance is not a public table.
  broadcastLiveEvent({
    table: "category_attendance",
    op: "UPDATE",
    id: params.athleteId,
    categoryId: params.categoryId,
    tournamentId,
    ringId: assignment?.ringId ?? undefined,
    status: params.status,
  });
  return { success: true as const };
}
