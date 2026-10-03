import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  categoryAssignments,
  draws,
  eventLog,
  matches,
  matchSlots,
  rings,
} from "@/db/schema";
import { assignmentPartOfMatch } from "@/lib/draws/partFilter";
import { commitBoutResult } from "@/lib/bouts/results";
import { advanceKataPoolFinalists } from "@/lib/kata/poolAdvancement";
import { broadcastLiveEvent } from "@/lib/realtime/bus";

export type KataActor = { role: string; id: string; name: string };

/**
 * Finish a kata bout. Pool-flight bouts rank athletes inside their pool and
 * then feed the medal flight; bracket-format bouts advance through the draw
 * exactly like kumite. Either way the bout ends CONFIRMED, which is what the
 * results export and progress counters read.
 */
export async function finalizeKataMatch(params: {
  matchId: string;
  winnerSide: "AKA" | "AO";
  decisionMethod: string;
  actor?: KataActor;
}): Promise<
  { success: true; winnerId: string | null } | { success: false; error: string }
> {
  const { matchId, winnerSide, decisionMethod, actor } = params;

  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!match) return { success: false, error: "Match not found" };

  const slots = await db
    .select()
    .from(matchSlots)
    .where(eq(matchSlots.matchId, matchId));
  const akaId = slots.find((s) => s.position === 1)?.athleteId ?? null;
  const aoId = slots.find((s) => s.position === 2)?.athleteId ?? null;
  const winnerId = winnerSide === "AKA" ? akaId : aoId;

  if (!winnerId) {
    return {
      success: false,
      error: `There is no ${winnerSide} athlete in this bout.`,
    };
  }

  const [draw] = await db
    .select({ format: draws.format })
    .from(draws)
    .where(eq(draws.categoryId, match.categoryId))
    .limit(1);

  const isPoolFlight =
    draw?.format === "KATA_GROUP_POOLS" || match.bracketType === "POOL";

  if (!isPoolFlight) {
    const res = await commitBoutResult(matchId, winnerId, {
      side: winnerSide,
      method: decisionMethod,
      actor,
      allowRollback: false,
    });
    if (!res.success) return { success: false, error: res.error };
    return { success: true, winnerId };
  }

  await db
    .update(matches)
    .set({ status: "CONFIRMED", winnerSide, winnerId, decisionMethod })
    .where(eq(matches.id, matchId));

  const assignment = await countPoolBout(match);
  await advanceKataPoolFinalists(match.categoryId);
  if (assignment) await announcePoolBout(assignment, match, { winnerId, winnerSide }, actor);

  return { success: true, winnerId };
}

type MatchRow = typeof matches.$inferSelect;
export type PoolAssignment = { id: string; ringId: string; tournamentId: string };

/** Counts a pool-style bout as done on its tatami card. Returns the card it runs on, if any. */
export async function countPoolBout(match: MatchRow): Promise<PoolAssignment | null> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches)
    .where(
      and(
        eq(matches.categoryId, match.categoryId),
        eq(matches.status, "CONFIRMED"),
        // A split category counts per part: each tatami counts its own bouts.
        match.part ? eq(matches.part, match.part) : undefined,
      ),
    );

  const [assignment] = await db
    .select({
      id: categoryAssignments.id,
      ringId: categoryAssignments.ringId,
      tournamentId: rings.tournamentId,
    })
    .from(categoryAssignments)
    .innerJoin(rings, eq(rings.id, categoryAssignments.ringId))
    .where(
      and(
        eq(categoryAssignments.categoryId, match.categoryId),
        eq(categoryAssignments.part, assignmentPartOfMatch(match.part)),
      ),
    )
    .limit(1);

  if (!assignment) return null;
  await db
    .update(categoryAssignments)
    .set({ matchesCompleted: Number(count) || 0 })
    .where(eq(categoryAssignments.id, assignment.id));
  return assignment;
}

/** The event log entry and the live-feed change for a confirmed pool-style bout. */
export async function announcePoolBout(
  assignment: PoolAssignment,
  match: MatchRow,
  result: { winnerId: string | null; winnerSide: "AKA" | "AO" | null },
  actor?: KataActor,
) {
  await db.insert(eventLog).values({
    tournamentId: assignment.tournamentId,
    ringId: assignment.ringId,
    categoryId: match.categoryId,
    action: "BOUT_RESULT_CONFIRMED",
    metadata: {
      matchId: match.id,
      matchNo: match.matchNo,
      roundName: match.roundName,
      winnerId: result.winnerId,
      winningSide: result.winnerSide,
      discipline: "kata",
      confirmedBy: actor ?? null,
    },
  });
  broadcastLiveEvent({
    table: "matches",
    op: "UPDATE",
    id: match.id,
    matchId: match.id,
    ringId: assignment.ringId,
    tournamentId: assignment.tournamentId,
    categoryId: match.categoryId,
    status: "CONFIRMED",
  });
}
