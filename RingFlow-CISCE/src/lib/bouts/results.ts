import { db } from "@/db";
import {
  categoryAssignments,
  categories,
  matches,
  matchEvents,
  matchSlots,
  rings,
  draws,
  drawVersions,
  eventLog,
} from "@/db/schema";
import { resolveDraw } from "@/engine/draw-engine";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { and, eq, inArray, sql } from "drizzle-orm";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { advanceKataPoolFinalists } from "@/lib/kata/poolAdvancement";

/**
 * Commit a bout result and advance the draw. No authorization here: callers
 * (the moderator action, seed scripts) are responsible for that.
 *
 * Shared by kumite and bracket-format kata so both progress the same way.
 */
export async function commitBoutResult(
  matchId: string,
  winnerId: string,
  details?: {
    side?: "AKA" | "AO";
    akaPoints?: number;
    aoPoints?: number;
    akaPenalties?: number;
    aoPenalties?: number;
    senshu?: "AKA" | "AO" | null;
    method?: string;
    allowRollback?: boolean;
    /** Who confirmed it; recorded on the match event and the event log. */
    actor?: { role: string; id: string; name: string };
    /** Why a confirmed result is being changed (required by the actions for corrections). */
    reason?: string;
  }
): Promise<
  | { success: true }
  | { success: false; error: string; requiresRollbackConfirmation?: boolean; conflictMatches?: unknown[] }
> {
  // 1. Fetch match
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId));

  if (!match) return { success: false, error: "Match not found" };

  const categoryId = match.categoryId;

  // 2. Fetch category and draw graph
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) return { success: false, error: "Draw not found" };

  const [latestVersion] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);

  if (!latestVersion) return { success: false, error: "Draw version not found" };

  const graph = latestVersion.graph as unknown as DrawGraph;

  // Fetch slots for this match to resolve winning side accurately
  const currentSlots = await db
    .select()
    .from(matchSlots)
    .where(eq(matchSlots.matchId, matchId));

  const akaSlot = currentSlots.find((s) => s.position === 1);
  const aoSlot = currentSlots.find((s) => s.position === 2);

  // The winner must be one of the two athletes actually in this bout.
  let winningSide: "AKA" | "AO";
  if (winnerId && winnerId === akaSlot?.athleteId) {
    winningSide = "AKA";
  } else if (winnerId && winnerId === aoSlot?.athleteId) {
    winningSide = "AO";
  } else {
    return { success: false, error: "The winner must be one of the two athletes in this bout." };
  }

  const nonNegativeInt = (v: unknown) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 999 ? n : 0;
  };
  const scoreDetails = {
    akaPoints: nonNegativeInt(details?.akaPoints),
    aoPoints: nonNegativeInt(details?.aoPoints),
    akaPenalties: nonNegativeInt(details?.akaPenalties),
    aoPenalties: nonNegativeInt(details?.aoPenalties),
    senshu: details?.senshu === "AKA" || details?.senshu === "AO" ? details.senshu : null,
    method: typeof details?.method === "string" && details.method.trim() ? details.method.trim().slice(0, 40) : "POINTS",
  };

  const isAlreadyConfirmed = match.status === "CONFIRMED";
  const isReversingWinner = isAlreadyConfirmed && Boolean(match.winnerId && match.winnerId !== winnerId);

  // Pre-flight check: If winner is being reversed, check for downstream match conflicts
  if (isReversingWinner) {
    const allCategoryMatches = await db
      .select()
      .from(matches)
      .where(eq(matches.categoryId, categoryId));

    const allCategorySlots = await db
      .select()
      .from(matchSlots)
      .where(
        inArray(
          matchSlots.matchId,
          allCategoryMatches.map((m) => m.id)
        )
      );

    const downstreamMatchIds = new Set<string>();
    const queue = [matchId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const slot of allCategorySlots) {
        if (slot.sourceMatchId === curr && !downstreamMatchIds.has(slot.matchId)) {
          downstreamMatchIds.add(slot.matchId);
          queue.push(slot.matchId);
        }
      }
    }

    const completedDownstream = allCategoryMatches.filter(
      (m) => downstreamMatchIds.has(m.id) && (m.status === "CONFIRMED" || m.status === "LIVE")
    );

    if (completedDownstream.length > 0 && !details?.allowRollback) {
      return {
        success: false,
        requiresRollbackConfirmation: true,
        conflictMatches: completedDownstream.map((m) => ({
          matchId: m.id,
          matchNo: m.matchNo,
          roundName: m.roundName,
          status: m.status,
        })),
        error: `Reversing Bout #${match.matchNo} winner affects ${completedDownstream.length} downstream bout(s) that have already been fought or are live. An administrative rollback is required to proceed.`,
      };
    }
  }

  // 3. Commit match confirmation in transaction
  await db.transaction(async (tx) => {
    // Update match status, winner, points and penalties
    await tx
      .update(matches)
      .set({
        status: "CONFIRMED",
        winnerId,
        winnerSide: winningSide,
        akaScore: scoreDetails.akaPoints,
        aoScore: scoreDetails.aoPoints,
        akaPenalties: scoreDetails.akaPenalties,
        aoPenalties: scoreDetails.aoPenalties,
        senshu: scoreDetails.senshu,
        decisionMethod: scoreDetails.method,
      })
      .where(eq(matches.id, matchId));

    // Determine the next event sequence number for this match
    const [lastEvent] = await tx
      .select({ maxSeq: sql<number>`COALESCE(MAX(${matchEvents.seq}), 0)` })
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId));

    const nextSeq = Number(lastEvent?.maxSeq ?? 0) + 1;

    // Record match event with dynamic seq to prevent unique constraint violation
    await tx.insert(matchEvents).values({
      matchId,
      seq: nextSeq,
      type: isAlreadyConfirmed ? "RESULT_CORRECTED" : "RESULT_CONFIRMED",
      payload: {
        winnerId,
        side: winningSide,
        akaPoints: scoreDetails.akaPoints,
        aoPoints: scoreDetails.aoPoints,
        method: scoreDetails.method,
        senshu: scoreDetails.senshu,
        isCorrection: isAlreadyConfirmed,
        isReversingWinner,
        previousWinnerId: isAlreadyConfirmed ? match.winnerId : null,
        rollbackApplied: Boolean(details?.allowRollback),
        reason: details?.reason ?? null,
      },
      actor: details?.actor ? `${details.actor.role}:${details.actor.name}` : null,
      deviceId: details?.actor?.id ?? null,
    });

    // Auto-lock draw on match confirmation to protect bracket from accidental regeneration
    await tx
      .update(draws)
      .set({ state: "LOCKED", lockedAt: new Date() })
      .where(and(eq(draws.categoryId, categoryId), eq(draws.state, "DRAFT")));

    // 4. Bracket advancement: resolve graph with ALL confirmed outcomes
    const allMatches = await tx
      .select()
      .from(matches)
      .where(eq(matches.categoryId, categoryId));

    const allSlots = await tx
      .select()
      .from(matchSlots)
      .where(
        inArray(
          matchSlots.matchId,
          allMatches.map((m) => m.id)
        )
      );

    const outcomes = new Map<string, { kind: "WINNER"; side: "AKA" | "AO" }>();
    for (const m of allMatches) {
      const isCurrent = m.id === matchId;
      const wId = isCurrent ? winnerId : m.winnerId;
      if (wId && (isCurrent || m.status === "CONFIRMED")) {
        let side: "AKA" | "AO" = isCurrent ? winningSide : (m.winnerSide as "AKA" | "AO") || "AKA";
        if (!isCurrent && !m.winnerSide) {
          const slots = allSlots.filter((s) => s.matchId === m.id);
          const aka = slots.find((s) => s.position === 1);
          side = wId === aka?.athleteId ? "AKA" : "AO";
        }
        outcomes.set(m.id, {
          kind: "WINNER",
          side,
        });
      }
    }

    const resolved = resolveDraw(graph, outcomes);

    // Update slots in dependent matches with the advancing athlete
    for (const rm of resolved.matches) {
      if (rm.matchId === matchId) continue;

      const newAkaId = rm.slots[0]?.registrationId ?? null;
      const newAoId = rm.slots[1]?.registrationId ?? null;

      const currentMatchSlots = allSlots.filter((s) => s.matchId === rm.matchId);
      const currentAkaSlot = currentMatchSlots.find((s) => s.position === 1);
      const currentAoSlot = currentMatchSlots.find((s) => s.position === 2);

      const akaChanged = (currentAkaSlot?.athleteId ?? null) !== newAkaId;
      const aoChanged = (currentAoSlot?.athleteId ?? null) !== newAoId;

      if (akaChanged) {
        await tx
          .update(matchSlots)
          .set({ athleteId: newAkaId })
          .where(
            and(
              eq(matchSlots.matchId, rm.matchId),
              eq(matchSlots.position, 1)
            )
          );
      }

      if (aoChanged) {
        await tx
          .update(matchSlots)
          .set({ athleteId: newAoId })
          .where(
            and(
              eq(matchSlots.matchId, rm.matchId),
              eq(matchSlots.position, 2)
            )
          );
      }

      // If competitors changed in this downstream match:
      if (akaChanged || aoChanged) {
        const targetMatch = allMatches.find((m) => m.id === rm.matchId);
        if (targetMatch) {
          if (newAkaId && newAoId) {
            // Both athletes present: match is READY to be fought.
            // If it was previously LIVE or CONFIRMED with the wrong competitor, reset scores and status to READY.
            await tx
              .update(matches)
              .set({
                status: "READY",
                winnerId: null,
                winnerSide: null,
                akaScore: 0,
                aoScore: 0,
                akaPenalties: 0,
                aoPenalties: 0,
                senshu: null,
              })
              .where(eq(matches.id, rm.matchId));
          } else {
            // Not both athletes present: match is PENDING (or WALKOVER if walkover)
            await tx
              .update(matches)
              .set({
                status: rm.status === "WALKOVER" ? "WALKOVER" : "PENDING",
                winnerId: rm.status === "WALKOVER" ? (newAkaId || newAoId) : null,
                winnerSide: null,
                akaScore: 0,
                aoScore: 0,
              })
              .where(eq(matches.id, rm.matchId));
          }

          broadcastLiveEvent({
            table: "matches",
            op: "UPDATE",
            id: rm.matchId,
            matchId: rm.matchId,
            categoryId,
          });
        }
      } else {
        // Competitors did not change: update status if it became READY and was not yet CONFIRMED
        if (rm.status && rm.status !== "PENDING" && rm.status !== "UNRESOLVED") {
          await tx
            .update(matches)
            .set({ status: rm.status })
            .where(and(eq(matches.id, rm.matchId), sql`status != 'CONFIRMED'`));
        }
      }
    }

    // 5. matchesCompleted counts bouts actually fought and confirmed
    const [confirmedCountRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(matches)
      .where(
        and(
          eq(matches.categoryId, categoryId),
          eq(matches.status, "CONFIRMED")
        )
      );

    const totalConfirmed = Number(confirmedCountRow?.count ?? 0);

    const [assignment] = await tx
      .select()
      .from(categoryAssignments)
      .where(eq(categoryAssignments.categoryId, categoryId));

    if (assignment) {
      await tx
        .update(categoryAssignments)
        .set({ matchesCompleted: totalConfirmed })
        .where(eq(categoryAssignments.id, assignment.id));

      // Reset rings.currentMatchId so the next ready bout gets picked automatically
      await tx
        .update(rings)
        .set({ currentMatchId: null })
        .where(eq(rings.id, assignment.ringId));

      broadcastLiveEvent({
        table: "matches",
        op: "UPDATE",
        id: matchId,
        matchId,
        ringId: assignment.ringId,
        categoryId,
        status: "CONFIRMED",
      });
      broadcastLiveEvent({
        table: "category_assignments",
        op: "UPDATE",
        ringId: assignment.ringId,
        categoryId,
      });

      await tx.insert(eventLog).values({
        tournamentId: cat.tournamentId,
        ringId: assignment.ringId,
        categoryId,
        action: isAlreadyConfirmed ? "BOUT_RESULT_CORRECTED" : "BOUT_RESULT_CONFIRMED",
        metadata: {
          matchId,
          matchNo: match.matchNo,
          roundName: match.roundName,
          winnerId,
          winningSide,
          isCorrection: isAlreadyConfirmed,
          isReversingWinner,
          rollbackApplied: Boolean(details?.allowRollback),
          confirmedBy: details?.actor ?? null,
        },
      });
    }
  });

  // Automatically advance finalists if this category is running Kata pools
  try {
    await advanceKataPoolFinalists(categoryId);
  } catch (advErr) {
    console.error("advanceKataPoolFinalists error in confirmBoutResult:", advErr);
  }

  return { success: true };
}
