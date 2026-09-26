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
  draws,
} from "@/db/schema";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { serializeMatch, serializeKataScore } from "@/lib/serializers";
import { revalidatePath } from "next/cache";

/**
 * Direct fetch of all kata scores for a given match.
 */
export async function getMatchKataScores(matchId: string) {
  try {
    const scores = await db
      .select()
      .from(kataScores)
      .where(eq(kataScores.matchId, matchId))
      .orderBy(asc(kataScores.judgeSeat));
    return { success: true, scores };
  } catch (err: any) {
    console.error("Error in getMatchKataScores:", err);
    return { success: false, error: err.message, scores: [] };
  }
}

/**
 * Resolves the ring ID associated with a match to ensure SSE events
 * are routed to scoped listeners (moderator & scoreboard screens).
 */
async function resolveRingIdForMatch(matchId: string, providedRingId?: string): Promise<string | undefined> {
  if (providedRingId) return providedRingId;
  try {
    const [ringMatch] = await db
      .select({ id: rings.id })
      .from(rings)
      .where(eq(rings.currentMatchId, matchId))
      .limit(1);
    if (ringMatch) return ringMatch.id;

    const [matchRow] = await db
      .select({ categoryId: matches.categoryId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    if (matchRow?.categoryId) {
      const [assign] = await db
        .select({ ringId: categoryAssignments.ringId })
        .from(categoryAssignments)
        .where(eq(categoryAssignments.categoryId, matchRow.categoryId))
        .limit(1);
      if (assign?.ringId) return assign.ringId;
    }
  } catch (err) {
    console.error("resolveRingIdForMatch error:", err);
  }
  return undefined;
}

/**
 * Returns the current active Kata state on a specific ring.
 * Used by both the Tatami Moderator Pad and the Mobile Judge Web App.
 */
export async function getRingKataState(ringId: string, specificMatchId?: string) {
  try {
    // 1. Fetch Ring info
    const [ring] = await db
      .select()
      .from(rings)
      .where(eq(rings.id, ringId))
      .limit(1);

    if (!ring) {
      return { success: false, error: "Ring not found" };
    }

    // 2. Fetch active category assignment
    const [assignment] = await db
      .select()
      .from(categoryAssignments)
      .where(
        and(
          eq(categoryAssignments.ringId, ringId),
          eq(categoryAssignments.status, "running")
        )
      )
      .limit(1);

    if (!assignment) {
      return {
        success: true,
        ringId,
        ringName: ring.name,
        judgePin: ring.judgePin,
        activeCategory: null,
        activeMatch: null,
        scores: [],
      };
    }

    // 3. Fetch Category details
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, assignment.categoryId))
      .limit(1);

    // 4. Determine current match
    let matchId = specificMatchId || ring.currentMatchId;
    let currentMatch: any = null;

    if (matchId) {
      const [m] = await db
        .select()
        .from(matches)
        .where(eq(matches.id, matchId))
        .limit(1);
      currentMatch = m;
    }

    // Fallback: pick first READY or LIVE match for this category
    if (!currentMatch && assignment.categoryId) {
      const [m] = await db
        .select()
        .from(matches)
        .where(
          and(
            eq(matches.categoryId, assignment.categoryId),
            inArray(matches.status, ["READY", "LIVE"])
          )
        )
        .orderBy(asc(matches.matchNo))
        .limit(1);
      currentMatch = m;
    }

    if (!currentMatch) {
      return {
        success: true,
        ringId,
        ringName: ring.name,
        judgePin: ring.judgePin,
        activeCategory: category,
        activeMatch: null,
        scores: [],
      };
    }

    // 5. Fetch slots and athletes for this match
    const slots = await db
      .select()
      .from(matchSlots)
      .where(eq(matchSlots.matchId, currentMatch.id))
      .orderBy(asc(matchSlots.position));

    const athleteIds = slots.map((s) => s.athleteId).filter(Boolean) as string[];
    const athleteMap = new Map<string, any>();

    if (athleteIds.length > 0) {
      const athleteRows = await db
        .select()
        .from(athletes)
        .where(inArray(athletes.id, athleteIds));
      athleteRows.forEach((a) => athleteMap.set(a.id, a));
    }

    const akaSlot = slots.find((s) => s.position === 1);
    const aoSlot = slots.find((s) => s.position === 2);

    const akaAthlete = akaSlot?.athleteId ? athleteMap.get(akaSlot.athleteId) : null;
    const aoAthlete = aoSlot?.athleteId ? athleteMap.get(aoSlot.athleteId) : null;

    // 6. Fetch existing Kata scores for this match
    const scores = await db
      .select()
      .from(kataScores)
      .where(eq(kataScores.matchId, currentMatch.id))
      .orderBy(asc(kataScores.judgeSeat));

    return {
      success: true,
      ringId,
      ringName: ring.name,
      judgePin: ring.judgePin,
      activeCategory: category,
      activeMatch: serializeMatch({
        ...currentMatch,
        akaAthlete,
        aoAthlete,
      }),
      scores: scores.map(serializeKataScore),
    };
  } catch (err: any) {
    console.error("Error in getRingKataState:", err);
    return { success: false, error: err.message || "Failed to fetch Kata state" };
  }
}

/**
 * Validates a Tatami PIN for a judge joining from a mobile device.
 */
export async function verifyJudgePin(ringId: string, pin: string) {
  try {
    const [ring] = await db
      .select({ judgePin: rings.judgePin })
      .from(rings)
      .where(eq(rings.id, ringId))
      .limit(1);

    if (!ring) return { valid: false, error: "Ring not found" };
    return { valid: ring.judgePin.trim() === pin.trim() };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

/**
 * Submits or updates a judge's vote (Flag or Numeric) from mobile or moderator console.
 */
export async function submitJudgeVote(params: {
  matchId: string;
  ringId?: string;
  judgeSeat: number;
  targetSide?: "AKA" | "AO" | "BOTH";
  flagVote?: "AKA" | "AO";
  numericScore?: number;
  judgeDeviceToken?: string;
  isOverridden?: boolean;
}) {
  try {
    const {
      matchId,
      ringId,
      judgeSeat,
      targetSide = "AKA",
      flagVote,
      numericScore,
      judgeDeviceToken,
      isOverridden = false,
    } = params;

    if (judgeSeat < 1 || judgeSeat > 7) {
      return { success: false, error: "Judge seat must be between 1 and 7" };
    }

    const scoreType = numericScore !== undefined ? "POINT" : "FLAG";

    // Upsert vote in kata_scores
    await db
      .insert(kataScores)
      .values({
        matchId,
        judgeSeat,
        targetSide,
        scoreType,
        flagVote: flagVote || null,
        numericScore: numericScore !== undefined ? String(numericScore) : null,
        judgeDeviceToken: judgeDeviceToken || null,
        isOverridden,
      })
      .onConflictDoUpdate({
        target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
        set: {
          scoreType,
          flagVote: flagVote || null,
          numericScore: numericScore !== undefined ? String(numericScore) : null,
          judgeDeviceToken: judgeDeviceToken || null,
          isOverridden,
        },
      });

    // Recompute match tallies
    const allScores = await db
      .select()
      .from(kataScores)
      .where(eq(kataScores.matchId, matchId));

    if (scoreType === "FLAG") {
      let akaFlags = 0;
      let aoFlags = 0;
      for (const s of allScores) {
        if (s.flagVote === "AKA") akaFlags++;
        if (s.flagVote === "AO") aoFlags++;
      }
      await db
        .update(matches)
        .set({ akaFlags, aoFlags })
        .where(eq(matches.id, matchId));
    } else {
      // Points mode: calculate sum
      let sum = 0;
      for (const s of allScores) {
        if (s.numericScore) sum += Number(s.numericScore);
      }
      await db
        .update(matches)
        .set({ akaScoreTotal: String(sum.toFixed(2)) })
        .where(eq(matches.id, matchId));
    }

    // Resolve Ring ID for targeted SSE broadcasting
    const broadcastRingId = await resolveRingIdForMatch(matchId, ringId);

    // Broadcast SSE live events with ringId so subscribers (moderator/scoreboard) receive it immediately
    broadcastLiveEvent({
      table: "kata_scores",
      op: "UPDATE",
      id: matchId,
      matchId,
      ringId: broadcastRingId,
    });

    broadcastLiveEvent({
      table: "matches",
      op: "UPDATE",
      id: matchId,
      matchId,
      ringId: broadcastRingId,
    });

    return { success: true };
  } catch (err: any) {
    console.error("Error in submitJudgeVote:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Moderator action to void a misclicked vote for a specific judge seat.
 */
export async function voidJudgeVote(params: {
  matchId: string;
  judgeSeat: number;
  targetSide?: "AKA" | "AO" | "BOTH";
}) {
  try {
    const { matchId, judgeSeat, targetSide = "AKA" } = params;

    await db
      .delete(kataScores)
      .where(
        and(
          eq(kataScores.matchId, matchId),
          eq(kataScores.judgeSeat, judgeSeat),
          eq(kataScores.targetSide, targetSide)
        )
      );

    // Recompute match tallies
    const allScores = await db
      .select()
      .from(kataScores)
      .where(eq(kataScores.matchId, matchId));

    let akaFlags = 0;
    let aoFlags = 0;
    for (const s of allScores) {
      if (s.flagVote === "AKA") akaFlags++;
      if (s.flagVote === "AO") aoFlags++;
    }

    await db
      .update(matches)
      .set({ akaFlags, aoFlags })
      .where(eq(matches.id, matchId));

    const broadcastRingId = await resolveRingIdForMatch(matchId);

    broadcastLiveEvent({
      table: "kata_scores",
      op: "DELETE",
      id: matchId,
      matchId,
      ringId: broadcastRingId,
    });

    broadcastLiveEvent({
      table: "matches",
      op: "UPDATE",
      id: matchId,
      matchId,
      ringId: broadcastRingId,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Finalizes a Kata match, declares the winner, updates category progress,
 * and advances the bracket or pool leaderboard.
 */
export async function finalizeKataBout(params: {
  matchId: string;
  winnerSide?: "AKA" | "AO";
  winnerAthleteId?: string;
  decisionMethod?: string;
}) {
  try {
    const { matchId, winnerSide, winnerAthleteId, decisionMethod = "FLAGS" } = params;

    const [match] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) return { success: false, error: "Match not found" };

    // Resolve winner ID if winnerSide was provided
    let finalWinnerId = winnerAthleteId || match.winnerId;
    if (winnerSide && !finalWinnerId) {
      const position = winnerSide === "AKA" ? 1 : 2;
      const [slot] = await db
        .select()
        .from(matchSlots)
        .where(
          and(
            eq(matchSlots.matchId, matchId),
            eq(matchSlots.position, position)
          )
        )
        .limit(1);
      finalWinnerId = slot?.athleteId || null;
    }

    // Update match to COMPLETED
    await db
      .update(matches)
      .set({
        status: "COMPLETED",
        winnerSide: winnerSide || match.winnerSide,
        winnerId: finalWinnerId,
        decisionMethod,
      })
      .where(eq(matches.id, matchId));

    // Update category completed matches count
    const [completedMatchesCount] = await db
      .select({ count: db.$count(matches, and(eq(matches.categoryId, match.categoryId), eq(matches.status, "COMPLETED"))) })
      .from(matches)
      .where(and(eq(matches.categoryId, match.categoryId), eq(matches.status, "COMPLETED")));

    await db
      .update(categoryAssignments)
      .set({ matchesCompleted: completedMatchesCount?.count || 1 })
      .where(eq(categoryAssignments.categoryId, match.categoryId));

    const broadcastRingId = await resolveRingIdForMatch(matchId);

    // Broadcast SSE update
    broadcastLiveEvent({
      table: "matches",
      op: "UPDATE",
      id: matchId,
      matchId,
      ringId: broadcastRingId,
    });

    revalidatePath(`/moderator/ring/[ringId]/current`, "page");
    revalidatePath(`/scoreboard/[ringId]`, "page");

    return { success: true, winnerId: finalWinnerId };
  } catch (err: any) {
    console.error("Error in finalizeKataBout:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Allows the moderator to regenerate or set the Tatami PIN.
 */
export async function updateRingJudgePin(ringId: string, newPin: string) {
  try {
    const cleanPin = newPin.trim();
    if (cleanPin.length < 4) {
      return { success: false, error: "PIN must be at least 4 digits" };
    }

    await db
      .update(rings)
      .set({ judgePin: cleanPin })
      .where(eq(rings.id, ringId));

    broadcastLiveEvent({
      table: "rings",
      op: "UPDATE",
      id: ringId,
    });

    return { success: true, pin: cleanPin };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Generates a fresh random 4-digit PIN for the Tatami and updates the ring.
 */
export async function regenerateRingJudgePin(ringId: string) {
  const newPin = String(Math.floor(1000 + Math.random() * 9000));
  return updateRingJudgePin(ringId, newPin);
}

/**
 * Direct moderator entry for Kata marks, declared katas, and bout finalization.
 * Supports small-event direct scoring or manual replacement when a judge is missing.
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
  try {
    const {
      matchId,
      akaKataNumber,
      akaKataName,
      aoKataNumber,
      aoKataName,
      akaScore,
      aoScore,
      akaJudgeMarks,
      aoJudgeMarks,
      judgeScores,
      winnerSide,
      finalize = false,
    } = params;

    const [match] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) return { success: false, error: "Match not found" };

    const updatePayload: Record<string, any> = {};

    if (akaKataName || akaKataNumber) {
      updatePayload.akaKataName = akaKataNumber ? `#${akaKataNumber} ${akaKataName || ""}`.trim() : akaKataName;
    }
    if (aoKataName || aoKataNumber) {
      updatePayload.aoKataName = aoKataNumber ? `#${aoKataNumber} ${aoKataName || ""}`.trim() : aoKataName;
    }

    let calculatedAkaFlags = 0;
    let calculatedAoFlags = 0;
    let finalAkaScore = akaScore;
    let finalAoScore = aoScore;

    // 1. Process akaJudgeMarks if provided
    if (akaJudgeMarks && akaJudgeMarks.length > 0) {
      const { calculateKataScoreDeducing } = await import("@/lib/kata/scoringEngine");
      const deducing = calculateKataScoreDeducing(akaJudgeMarks);
      finalAkaScore = deducing.total;

      for (let i = 0; i < akaJudgeMarks.length; i++) {
        const mark = akaJudgeMarks[i];
        if (typeof mark === "number" && !isNaN(mark)) {
          const isDropped = deducing.droppedIndices.includes(i);
          await db
            .insert(kataScores)
            .values({
              matchId,
              judgeSeat: i + 1,
              judgeDeviceToken: "MODERATOR_MANUAL",
              targetSide: "AKA",
              scoreType: "POINT",
              numericScore: String(mark.toFixed(2)),
              isDropped,
              isOverridden: true,
            })
            .onConflictDoUpdate({
              target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
              set: {
                numericScore: String(mark.toFixed(2)),
                scoreType: "POINT",
                isDropped,
                isOverridden: true,
              },
            });
        }
      }
    }

    // 2. Process aoJudgeMarks if provided
    if (aoJudgeMarks && aoJudgeMarks.length > 0) {
      const { calculateKataScoreDeducing } = await import("@/lib/kata/scoringEngine");
      const deducing = calculateKataScoreDeducing(aoJudgeMarks);
      finalAoScore = deducing.total;

      for (let i = 0; i < aoJudgeMarks.length; i++) {
        const mark = aoJudgeMarks[i];
        if (typeof mark === "number" && !isNaN(mark)) {
          const isDropped = deducing.droppedIndices.includes(i);
          await db
            .insert(kataScores)
            .values({
              matchId,
              judgeSeat: i + 1,
              judgeDeviceToken: "MODERATOR_MANUAL",
              targetSide: "AO",
              scoreType: "POINT",
              numericScore: String(mark.toFixed(2)),
              isDropped,
              isOverridden: true,
            })
            .onConflictDoUpdate({
              target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
              set: {
                numericScore: String(mark.toFixed(2)),
                scoreType: "POINT",
                isDropped,
                isOverridden: true,
              },
            });
        }
      }
    }

    // 3. If per-judge paired scores provided and not already processed via explicit marks
    const hasExplicitMarks = (akaJudgeMarks && akaJudgeMarks.length > 0) || (aoJudgeMarks && aoJudgeMarks.length > 0);
    if (!hasExplicitMarks && judgeScores && judgeScores.length > 0) {
      for (const js of judgeScores) {
        const flagVote = js.akaScore > js.aoScore ? "AKA" : js.aoScore > js.akaScore ? "AO" : null;
        if (flagVote === "AKA") calculatedAkaFlags++;
        if (flagVote === "AO") calculatedAoFlags++;

        await db
          .insert(kataScores)
          .values({
            matchId,
            judgeSeat: js.seat,
            judgeDeviceToken: "MODERATOR_OVERRIDE",
            targetSide: "AKA",
            numericScore: String(js.akaScore.toFixed(2)),
            flagVote,
            isOverridden: true,
          })
          .onConflictDoUpdate({
            target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
            set: {
              numericScore: String(js.akaScore.toFixed(2)),
              flagVote,
              isOverridden: true,
            },
          });

        await db
          .insert(kataScores)
          .values({
            matchId,
            judgeSeat: js.seat,
            judgeDeviceToken: "MODERATOR_OVERRIDE",
            targetSide: "AO",
            numericScore: String(js.aoScore.toFixed(2)),
            flagVote,
            isOverridden: true,
          })
          .onConflictDoUpdate({
            target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
            set: {
              numericScore: String(js.aoScore.toFixed(2)),
              flagVote,
              isOverridden: true,
            },
          });
      }

      updatePayload.akaFlags = calculatedAkaFlags;
      updatePayload.aoFlags = calculatedAoFlags;
    }

    if (finalAkaScore !== undefined && finalAkaScore > 0) {
      updatePayload.akaScoreTotal = String(finalAkaScore.toFixed(2));
    }
    if (finalAoScore !== undefined && finalAoScore > 0) {
      updatePayload.aoScoreTotal = String(finalAoScore.toFixed(2));
    }

    // Determine derived winner if not explicitly passed
    let resolvedWinnerSide: "AKA" | "AO" | undefined = winnerSide;
    if (!resolvedWinnerSide) {
      if (calculatedAkaFlags > calculatedAoFlags) resolvedWinnerSide = "AKA";
      else if (calculatedAoFlags > calculatedAkaFlags) resolvedWinnerSide = "AO";
      else if (akaScore !== undefined && aoScore !== undefined) {
        if (akaScore > aoScore) resolvedWinnerSide = "AKA";
        else if (aoScore > akaScore) resolvedWinnerSide = "AO";
      }
    }

    if (resolvedWinnerSide) {
      updatePayload.winnerSide = resolvedWinnerSide;
      // Get athlete id
      const position = resolvedWinnerSide === "AKA" ? 1 : 2;
      const [slot] = await db
        .select()
        .from(matchSlots)
        .where(
          and(
            eq(matchSlots.matchId, matchId),
            eq(matchSlots.position, position)
          )
        )
        .limit(1);
      if (slot?.athleteId) {
        updatePayload.winnerId = slot.athleteId;
      }
    }

    if (finalize) {
      updatePayload.status = "COMPLETED";
      updatePayload.decisionMethod = judgeScores && judgeScores.length > 0 ? "FLAGS" : "POINTS";
    }

    await db.update(matches).set(updatePayload).where(eq(matches.id, matchId));

    if (finalize) {
      const [completedMatchesCount] = await db
        .select({ count: db.$count(matches, and(eq(matches.categoryId, match.categoryId), eq(matches.status, "COMPLETED"))) })
        .from(matches)
        .where(and(eq(matches.categoryId, match.categoryId), eq(matches.status, "COMPLETED")));

      await db
        .update(categoryAssignments)
        .set({ matchesCompleted: completedMatchesCount?.count || 1 })
        .where(eq(categoryAssignments.categoryId, match.categoryId));
    }

    const broadcastRingId = await resolveRingIdForMatch(matchId);

    broadcastLiveEvent({
      table: "kata_scores",
      op: "UPDATE",
      id: matchId,
      matchId,
      ringId: broadcastRingId,
    });

    broadcastLiveEvent({
      table: "matches",
      op: "UPDATE",
      id: matchId,
      matchId,
      ringId: broadcastRingId,
    });

    if (broadcastRingId) {
      try {
        revalidatePath(`/moderator/ring/${broadcastRingId}/current`);
        revalidatePath(`/scoreboard/${broadcastRingId}`);
      } catch {}
    }

    return { success: true, winnerSide: resolvedWinnerSide, finalized: finalize };
  } catch (err: any) {
    console.error("Error in submitModeratorManualKataMarks:", err);
    return { success: false, error: err.message };
  }
}
