"use server";

import { db } from "@/db";
import {
  rings,
  categories,
  matches,
  matchSlots,
  athletes,
  kataScores,
  categoryAssignments,
  judgeRequests,
} from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { randomInt } from "node:crypto";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { serializeMatch, serializeKataScore } from "@/lib/serializers";
import { calculateKataScoreDeducing } from "@/lib/kata/scoringEngine";
import { finalizeKataMatch, recomputeKataTallies } from "@/lib/kata/finalize";
import {
  describePrincipal,
  getRingModerator,
  getTournamentStaff,
  requireMatchModerator,
  requireRingOperator,
} from "@/lib/auth/guards";
import { scopeForMatch, tournamentIdForRing } from "@/lib/auth/scope";

/** Judge rows as the browser sees them: never the judge's device token. */
function publicScore(score: typeof kataScores.$inferSelect) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { judgeDeviceToken, ...rest } = score;
  return rest;
}

function revalidateRing(ringId: string | null | undefined) {
  if (!ringId) return;
  try {
    revalidatePath(`/moderator/ring/${ringId}/current`);
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {
    // Outside a revalidatable context.
  }
}

function broadcastKataChange(
  matchId: string,
  ringId: string | null,
  tournamentId: string,
  op: "UPDATE" | "DELETE" = "UPDATE"
) {
  broadcastLiveEvent({ table: "kata_scores", op, id: matchId, matchId, ringId: ringId ?? undefined, tournamentId });
  broadcastLiveEvent({ table: "matches", op: "UPDATE", id: matchId, matchId, ringId: ringId ?? undefined, tournamentId });
}

/** All judge marks for a bout: the tatami's moderator or event staff. */
export async function getMatchKataScores(matchId: string) {
  const scope = await scopeForMatch(matchId);
  const allowed =
    (scope.ringId && (await getRingModerator(scope.ringId))) ||
    (await getTournamentStaff(scope.tournamentId));
  if (!allowed) return { success: false, error: "Not authorized", scores: [] };

  const scores = await db
    .select()
    .from(kataScores)
    .where(eq(kataScores.matchId, matchId))
    .orderBy(asc(kataScores.judgeSeat));
  return { success: true, scores: scores.map(publicScore) };
}

/**
 * Current kata bout on a tatami, for the judge phones and the moderator pad.
 * Holds no credentials: the tatami PIN and device tokens are never returned.
 */
export async function getRingKataState(ringId: string, specificMatchId?: string) {
  try {
    const [ring] = await db
      .select({ id: rings.id, name: rings.name, currentMatchId: rings.currentMatchId })
      .from(rings)
      .where(eq(rings.id, ringId))
      .limit(1);

    if (!ring) return { success: false, error: "Ring not found" };

    const [assignment] = await db
      .select()
      .from(categoryAssignments)
      .where(and(eq(categoryAssignments.ringId, ringId), eq(categoryAssignments.status, "running")))
      .limit(1);

    if (!assignment) {
      return { success: true, ringId, ringName: ring.name, activeCategory: null, activeMatch: null, scores: [] };
    }

    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, assignment.categoryId))
      .limit(1);

    const matchId = specificMatchId || ring.currentMatchId;
    let currentMatch: typeof matches.$inferSelect | undefined;

    if (matchId) {
      const [m] = await db
        .select()
        .from(matches)
        .where(and(eq(matches.id, matchId), eq(matches.categoryId, assignment.categoryId)))
        .limit(1);
      currentMatch = m;
    }

    if (!currentMatch) {
      const [m] = await db
        .select()
        .from(matches)
        .where(and(eq(matches.categoryId, assignment.categoryId), inArray(matches.status, ["READY", "LIVE"])))
        .orderBy(asc(matches.matchNo))
        .limit(1);
      currentMatch = m;
    }

    if (!currentMatch) {
      return { success: true, ringId, ringName: ring.name, activeCategory: category, activeMatch: null, scores: [] };
    }

    const slots = await db
      .select()
      .from(matchSlots)
      .where(eq(matchSlots.matchId, currentMatch.id))
      .orderBy(asc(matchSlots.position));

    const athleteIds = slots.map((s) => s.athleteId).filter(Boolean) as string[];
    const athleteMap = new Map<string, typeof athletes.$inferSelect>();
    if (athleteIds.length > 0) {
      const athleteRows = await db.select().from(athletes).where(inArray(athletes.id, athleteIds));
      athleteRows.forEach((a) => athleteMap.set(a.id, a));
    }

    const akaSlot = slots.find((s) => s.position === 1);
    const aoSlot = slots.find((s) => s.position === 2);

    const scores = await db
      .select()
      .from(kataScores)
      .where(eq(kataScores.matchId, currentMatch.id))
      .orderBy(asc(kataScores.judgeSeat));

    return {
      success: true,
      ringId,
      ringName: ring.name,
      activeCategory: category,
      activeMatch: serializeMatch({
        ...currentMatch,
        akaAthlete: akaSlot?.athleteId ? athleteMap.get(akaSlot.athleteId) : null,
        aoAthlete: aoSlot?.athleteId ? athleteMap.get(aoSlot.athleteId) : null,
      }),
      scores: scores.map(publicScore).map(serializeKataScore),
    };
  } catch (err) {
    console.error("Error in getRingKataState:", err);
    return { success: false, error: "Failed to fetch Kata state" };
  }
}

/**
 * A judge phone casts or changes its vote. The device must be an approved
 * judge on the tatami the bout is running on, voting from its own seat.
 */
export async function submitJudgeVote(params: {
  matchId: string;
  ringId?: string;
  judgeSeat: number;
  targetSide?: "AKA" | "AO" | "BOTH";
  flagVote?: "AKA" | "AO";
  numericScore?: number;
  judgeDeviceToken?: string;
}) {
  try {
    const { matchId, judgeSeat, flagVote, numericScore, judgeDeviceToken } = params;
    const targetSide = params.targetSide === "AO" || params.targetSide === "BOTH" ? params.targetSide : "AKA";

    if (!Number.isInteger(judgeSeat) || judgeSeat < 1 || judgeSeat > 7) {
      return { success: false, error: "Judge seat must be between 1 and 7" };
    }
    if (!judgeDeviceToken || judgeDeviceToken.length > 200) {
      return { success: false, error: "This device is not registered as a judge." };
    }
    if (flagVote !== undefined && flagVote !== "AKA" && flagVote !== "AO") {
      return { success: false, error: "Invalid flag vote" };
    }
    if (numericScore !== undefined && !(numericScore > 0 && numericScore <= 10)) {
      return { success: false, error: "Score must be between 0.1 and 10.0" };
    }

    const scope = await scopeForMatch(matchId);
    if (!scope.ringId || scope.assignmentStatus !== "running") {
      return { success: false, error: "This bout is not open for judging." };
    }

    const [judge] = await db
      .select({ id: judgeRequests.id })
      .from(judgeRequests)
      .where(
        and(
          eq(judgeRequests.ringId, scope.ringId),
          eq(judgeRequests.deviceToken, judgeDeviceToken),
          eq(judgeRequests.seatNumber, judgeSeat),
          eq(judgeRequests.status, "approved")
        )
      )
      .limit(1);
    if (!judge) {
      return { success: false, error: "This device is not an approved judge for that seat." };
    }

    const [match] = await db.select({ status: matches.status }).from(matches).where(eq(matches.id, matchId));
    if (match?.status === "CONFIRMED") {
      return { success: false, error: "Voting for this bout is closed." };
    }

    const scoreType = numericScore !== undefined ? "POINT" : "FLAG";
    const numeric = numericScore !== undefined ? numericScore.toFixed(2) : null;

    await db
      .insert(kataScores)
      .values({
        matchId,
        judgeSeat,
        targetSide,
        scoreType,
        flagVote: flagVote || null,
        numericScore: numeric,
        judgeDeviceToken,
        isOverridden: false,
      })
      .onConflictDoUpdate({
        target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
        set: { scoreType, flagVote: flagVote || null, numericScore: numeric, judgeDeviceToken, isOverridden: false },
      });

    await recomputeKataTallies(matchId);
    broadcastKataChange(matchId, scope.ringId, scope.tournamentId);
    return { success: true };
  } catch (err) {
    console.error("Error in submitJudgeVote:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to record vote" };
  }
}

/** Moderator clears a misclicked vote for one judge seat. */
export async function voidJudgeVote(params: {
  matchId: string;
  judgeSeat: number;
  targetSide?: "AKA" | "AO" | "BOTH";
}) {
  const { scope } = await requireMatchModerator(params.matchId);
  const targetSide = params.targetSide === "AO" || params.targetSide === "BOTH" ? params.targetSide : "AKA";

  await db
    .delete(kataScores)
    .where(
      and(
        eq(kataScores.matchId, params.matchId),
        eq(kataScores.judgeSeat, params.judgeSeat),
        eq(kataScores.targetSide, targetSide)
      )
    );

  await recomputeKataTallies(params.matchId);
  broadcastKataChange(params.matchId, scope.ringId, scope.tournamentId, "DELETE");
  return { success: true };
}

/** Moderator declares the winner of a kata bout. */
export async function finalizeKataBout(params: {
  matchId: string;
  winnerSide?: "AKA" | "AO";
  decisionMethod?: string;
}) {
  const { moderator, scope } = await requireMatchModerator(params.matchId);
  if (params.winnerSide !== "AKA" && params.winnerSide !== "AO") {
    return { success: false, error: "Choose the winning side." };
  }

  const res = await finalizeKataMatch({
    matchId: params.matchId,
    winnerSide: params.winnerSide,
    decisionMethod: (params.decisionMethod || "FLAGS").slice(0, 40),
    actor: describePrincipal(moderator),
  });

  revalidateRing(scope.ringId);
  return res;
}

/** Set the tatami's judge PIN: its moderator or the event's admin. */
export async function updateRingJudgePin(ringId: string, newPin: string) {
  await requireRingOperator(ringId);

  const cleanPin = (newPin || "").trim();
  if (!/^\d{4,8}$/.test(cleanPin)) {
    return { success: false, error: "PIN must be 4 to 8 digits" };
  }

  await db.update(rings).set({ judgePin: cleanPin }).where(eq(rings.id, ringId));

  broadcastLiveEvent({
    table: "rings",
    op: "UPDATE",
    id: ringId,
    ringId,
    tournamentId: await tournamentIdForRing(ringId),
  });

  return { success: true, pin: cleanPin };
}

/** Fresh random 4-digit PIN for the tatami. */
export async function regenerateRingJudgePin(ringId: string) {
  return updateRingJudgePin(ringId, String(randomInt(1000, 10000)));
}

const MAX_JUDGES = 7;

/** A judge mark is 0.1–10.0; anything else (blank, 0, NaN) means "not entered". */
function validMark(mark: unknown): number | null {
  return typeof mark === "number" && Number.isFinite(mark) && mark > 0 && mark <= 10
    ? Number(mark.toFixed(2))
    : null;
}

/**
 * Moderator enters kata marks / flags at the desk (small events, or a judge
 * phone that died), and optionally finalizes the bout.
 */
export async function submitModeratorManualKataMarks(params: {
  matchId: string;
  akaKataNumber?: number;
  akaKataName?: string;
  aoKataNumber?: number;
  aoKataName?: string;
  akaScore?: number;
  aoScore?: number;
  akaJudgeMarks?: number[];
  aoJudgeMarks?: number[];
  judgeScores?: Array<{ seat: number; akaScore: number; aoScore: number }>;
  winnerSide?: "AKA" | "AO";
  finalize?: boolean;
}) {
  const { moderator, scope } = await requireMatchModerator(params.matchId);
  const { matchId, finalize = false } = params;

  try {
    const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    if (!match) return { success: false, error: "Match not found" };
    if (match.status === "CONFIRMED") {
      return { success: false, error: "This bout is already confirmed." };
    }

    const updatePayload: Partial<typeof matches.$inferInsert> = {};

    const kataLabel = (num?: number, name?: string) => {
      const cleanName = (name || "").trim().slice(0, 80);
      if (Number.isInteger(num) && (num as number) > 0) return `#${num} ${cleanName}`.trim();
      return cleanName || undefined;
    };
    const akaLabel = kataLabel(params.akaKataNumber, params.akaKataName);
    const aoLabel = kataLabel(params.aoKataNumber, params.aoKataName);
    if (akaLabel) updatePayload.akaKataName = akaLabel;
    if (aoLabel) updatePayload.aoKataName = aoLabel;

    const writeSideMarks = async (side: "AKA" | "AO", marks: number[]) => {
      const cleaned = marks.slice(0, MAX_JUDGES).map(validMark);
      const deducing = calculateKataScoreDeducing(cleaned);
      for (let i = 0; i < cleaned.length; i++) {
        const mark = cleaned[i];
        const seatFilter = and(
          eq(kataScores.matchId, matchId),
          eq(kataScores.judgeSeat, i + 1),
          eq(kataScores.targetSide, side)
        );
        if (mark === null) {
          // Blank seat: remove any stale mark rather than storing a zero.
          await db.delete(kataScores).where(seatFilter);
          continue;
        }
        const isDropped = deducing.droppedIndices.includes(i);
        await db
          .insert(kataScores)
          .values({
            matchId,
            judgeSeat: i + 1,
            judgeDeviceToken: "MODERATOR_MANUAL",
            targetSide: side,
            scoreType: "POINT",
            numericScore: mark.toFixed(2),
            isDropped,
            isOverridden: true,
          })
          .onConflictDoUpdate({
            target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
            set: { numericScore: mark.toFixed(2), scoreType: "POINT", isDropped, isOverridden: true },
          });
      }
      return deducing;
    };

    let finalAkaScore = validMark(params.akaScore);
    let finalAoScore = validMark(params.aoScore);

    if (params.akaJudgeMarks && params.akaJudgeMarks.length > 0) {
      const d = await writeSideMarks("AKA", params.akaJudgeMarks);
      finalAkaScore = d.hasSufficientMarks ? d.total : null;
    }
    if (params.aoJudgeMarks && params.aoJudgeMarks.length > 0) {
      const d = await writeSideMarks("AO", params.aoJudgeMarks);
      finalAoScore = d.hasSufficientMarks ? d.total : null;
    }

    let flagWinner: "AKA" | "AO" | undefined;
    const hasExplicitMarks = Boolean(params.akaJudgeMarks?.length || params.aoJudgeMarks?.length);
    if (!hasExplicitMarks && params.judgeScores && params.judgeScores.length > 0) {
      let akaFlags = 0;
      let aoFlags = 0;
      for (const js of params.judgeScores.slice(0, MAX_JUDGES)) {
        if (!Number.isInteger(js.seat) || js.seat < 1 || js.seat > MAX_JUDGES) continue;
        const aka = Number(js.akaScore) || 0;
        const ao = Number(js.aoScore) || 0;
        const flagVote = aka > ao ? "AKA" : ao > aka ? "AO" : null;
        if (flagVote === "AKA") akaFlags++;
        if (flagVote === "AO") aoFlags++;

        for (const side of ["AKA", "AO"] as const) {
          const value = side === "AKA" ? aka : ao;
          await db
            .insert(kataScores)
            .values({
              matchId,
              judgeSeat: js.seat,
              judgeDeviceToken: "MODERATOR_OVERRIDE",
              targetSide: side,
              numericScore: value.toFixed(2),
              flagVote,
              isOverridden: true,
            })
            .onConflictDoUpdate({
              target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
              set: { numericScore: value.toFixed(2), flagVote, isOverridden: true },
            });
        }
      }
      updatePayload.akaFlags = akaFlags;
      updatePayload.aoFlags = aoFlags;
      if (akaFlags > aoFlags) flagWinner = "AKA";
      else if (aoFlags > akaFlags) flagWinner = "AO";
    }

    if (finalAkaScore !== null) updatePayload.akaScoreTotal = finalAkaScore.toFixed(2);
    if (finalAoScore !== null) updatePayload.aoScoreTotal = finalAoScore.toFixed(2);

    if (Object.keys(updatePayload).length > 0) {
      await db.update(matches).set(updatePayload).where(eq(matches.id, matchId));
    }

    let resolvedWinnerSide: "AKA" | "AO" | undefined =
      params.winnerSide === "AKA" || params.winnerSide === "AO" ? params.winnerSide : flagWinner;
    if (!resolvedWinnerSide && finalAkaScore !== null && finalAoScore !== null && finalAkaScore !== finalAoScore) {
      resolvedWinnerSide = finalAkaScore > finalAoScore ? "AKA" : "AO";
    }

    if (finalize) {
      if (!resolvedWinnerSide) {
        return { success: false, error: "Scores are tied or incomplete; choose the winner before finalizing." };
      }
      const res = await finalizeKataMatch({
        matchId,
        winnerSide: resolvedWinnerSide,
        decisionMethod: params.judgeScores?.length ? "FLAGS" : "POINTS",
        actor: describePrincipal(moderator),
      });
      if (!res.success) return res;
    }

    broadcastKataChange(matchId, scope.ringId, scope.tournamentId);
    revalidateRing(scope.ringId);

    return { success: true, winnerSide: resolvedWinnerSide, finalized: finalize };
  } catch (err) {
    console.error("Error in submitModeratorManualKataMarks:", err);
    return { success: false, error: err instanceof Error ? err.message : "Failed to save marks" };
  }
}
