"use server";

import { db } from "@/db";
import {
  categoryAssignments,
  categories,
  matches,
  matchEvents,
  matchSlots,
  rings,
  athletes,
  draws,
  drawVersions,
  tournaments,
  eventLog,
  kataScores,
} from "@/db/schema";
import { resolveDraw } from "@/engine/draw-engine";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { normalizeClock } from "@/lib/matchClock";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { broadcastLiveEvent } from "@/lib/realtime/bus";

function assembleRingActiveBout({
  ring,
  tournament,
  assignment,
  category,
  hasDraw,
  allMatches,
  allSlots,
  athleteMap,
  targetMatchId,
}: {
  ring: any;
  tournament: any;
  assignment: any;
  category: any;
  hasDraw: boolean;
  allMatches: any[];
  allSlots: any[];
  athleteMap: Map<string, any>;
  targetMatchId?: string | null;
}) {
  if (!hasDraw) {
    return {
      tournament: tournament || null,
      ring,
      assignment,
      category,
      hasDraw: false,
      currentMatch: null,
      nextBout: null,
      matches: [],
      clock: normalizeClock(ring),
      serverNow: Date.now(),
    };
  }

  const enrichedMatches = allMatches.map((m) => {
    const slots = allSlots.filter((s) => s.matchId === m.id);
    const akaSlot = slots.find((s) => s.position === 1);
    const aoSlot = slots.find((s) => s.position === 2);
    const akaAth = akaSlot?.athleteId ? athleteMap.get(akaSlot.athleteId) : null;
    const aoAth = aoSlot?.athleteId ? athleteMap.get(aoSlot.athleteId) : null;

    const isReady =
      Boolean(akaAth && aoAth) &&
      m.status !== "CONFIRMED" &&
      m.status !== "BYE";
    const isFinished = m.status === "CONFIRMED" || m.status === "BYE";

    return {
      ...m,
      aka: akaAth
        ? { id: akaAth.id, name: akaAth.name, school: akaAth.school || akaAth.dojo || "", chestNumber: akaAth.chestNumber }
        : { id: null, name: "TBD", school: "", chestNumber: null },
      ao: aoAth
        ? { id: aoAth.id, name: aoAth.name, school: aoAth.school || aoAth.dojo || "", chestNumber: aoAth.chestNumber }
        : { id: null, name: "TBD", school: "", chestNumber: null },
      isReady,
      isFinished,
    };
  });

  // Identify fighters who recently competed to ensure rest time
  const recentFighterIds = new Set<string>();
  const lastFinishedMatch = enrichedMatches
    .filter((m) => m.status === "CONFIRMED")
    .sort((a, b) => (b.matchNo ?? 0) - (a.matchNo ?? 0))[0];
  if (lastFinishedMatch) {
    if (lastFinishedMatch.aka?.id) recentFighterIds.add(lastFinishedMatch.aka.id);
    if (lastFinishedMatch.ao?.id) recentFighterIds.add(lastFinishedMatch.ao.id);
  }

  // Sort candidate ready bouts:
  // 1. Neither fighter has just fought (fresh / rested fighters first)
  // 2. Bout match number order
  const sortReadyBouts = (bouts: typeof enrichedMatches) => {
    return [...bouts].sort((a, b) => {
      const aHasRecent = (a.aka?.id && recentFighterIds.has(a.aka.id)) || (a.ao?.id && recentFighterIds.has(a.ao.id));
      const bHasRecent = (b.aka?.id && recentFighterIds.has(b.aka.id)) || (b.ao?.id && recentFighterIds.has(b.ao.id));
      if (!aHasRecent && bHasRecent) return -1;
      if (aHasRecent && !bHasRecent) return 1;
      return a.matchNo - b.matchNo;
    });
  };

  let targetMatch = null;
  if (targetMatchId) {
    targetMatch = enrichedMatches.find((m) => m.id === targetMatchId) || null;
  }
  if (!targetMatch && ring?.currentMatchId) {
    targetMatch = enrichedMatches.find((m) => m.id === ring.currentMatchId) || null;
  }
  if (!targetMatch) {
    const readyBouts = sortReadyBouts(enrichedMatches.filter((m) => m.isReady));
    targetMatch =
      enrichedMatches.find((m) => m.status === "LIVE") ||
      readyBouts[0] ||
      enrichedMatches.find((m) => !m.isFinished) ||
      enrichedMatches[0] ||
      null;
  }

  // Add currently active fighters to recent fighters for nextBout consideration
  if (targetMatch) {
    if (targetMatch.aka?.id) recentFighterIds.add(targetMatch.aka.id);
    if (targetMatch.ao?.id) recentFighterIds.add(targetMatch.ao.id);
  }

  const candidateNextBouts = sortReadyBouts(
    enrichedMatches.filter((m) => m.isReady && m.id !== targetMatch?.id)
  );
  const nextBout = candidateNextBouts[0] || null;

  return {
    tournament: tournament || null,
    ring,
    assignment,
    category,
    hasDraw: true,
    currentMatch: targetMatch,
    nextBout,
    matches: enrichedMatches,
    clock: normalizeClock(ring),
    serverNow: Date.now(),
  };
}

export async function getRingActiveBout(ringId: string, matchId?: string) {
  // 1. Fetch ring info
  const [ring] = await db
    .select()
    .from(rings)
    .where(eq(rings.id, ringId));

  if (!ring) return null;

  const [tournament] = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      showPublicDraws: tournaments.showPublicDraws,
      tunnelUrl: tournaments.tunnelUrl,
    })
    .from(tournaments)
    .where(eq(tournaments.id, ring.tournamentId));

  // 2. Find active category assignment on this ring
  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.ringId, ringId),
        inArray(categoryAssignments.status, ["running", "paused", "pending"])
      )
    )
    .orderBy(categoryAssignments.queueOrder)
    .limit(1);

  if (!assignment) return null;

  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, assignment.categoryId));

  if (!cat) return null;

  // 3. Check if category has a draw
  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, cat.id));

  if (!draw) {
    return assembleRingActiveBout({
      ring,
      tournament,
      assignment,
      category: cat,
      hasDraw: false,
      allMatches: [],
      allSlots: [],
      athleteMap: new Map(),
    });
  }

  // 4. Fetch all matches for this category
  const allMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.categoryId, cat.id))
    .orderBy(matches.matchNo);

  const allSlots =
    allMatches.length > 0
      ? await db
          .select()
          .from(matchSlots)
          .where(
            inArray(
              matchSlots.matchId,
              allMatches.map((m) => m.id)
            )
          )
      : [];

  const relevantAthleteIds = Array.from(
    new Set(allSlots.map((s) => s.athleteId).filter((id): id is string => Boolean(id)))
  );

  const relevantAthletes =
    relevantAthleteIds.length > 0
      ? await db
          .select()
          .from(athletes)
          .where(inArray(athletes.id, relevantAthleteIds))
      : [];

  const athleteMap = new Map(relevantAthletes.map((a) => [a.id, a]));

  const boutResult = assembleRingActiveBout({
    ring,
    tournament,
    assignment,
    category: cat,
    hasDraw: true,
    allMatches,
    allSlots,
    athleteMap,
    targetMatchId: matchId,
  });

  if (boutResult.currentMatch?.id) {
    const scores = await db
      .select()
      .from(kataScores)
      .where(eq(kataScores.matchId, boutResult.currentMatch.id));
    boutResult.currentMatch.kataScores = scores;
    (boutResult as any).kataScores = scores;
  }

  return boutResult;
}

export async function setActiveBout(ringId: string, matchId: string) {
  // Update ring's active match pointer
  await db
    .update(rings)
    .set({ currentMatchId: matchId })
    .where(eq(rings.id, ringId));

  // Set match to LIVE if it's not already confirmed
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId));

  if (match && match.status !== "CONFIRMED" && match.status !== "BYE") {
    await db
      .update(matches)
      .set({ status: "LIVE" })
      .where(eq(matches.id, matchId));
  }

  try {
    revalidatePath(`/moderator/ring/${ringId}/current`);
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {}

  // Broadcast instantly so scoreboard and mod desk switch bouts with zero latency
  broadcastLiveEvent({
    table: "rings",
    op: "UPDATE",
    id: ringId,
    ringId,
    matchId,
    data: { currentMatchId: matchId },
  });

  return { success: true };
}

export async function updateLiveMatchState(
  matchId: string,
  ringId: string,
  state: {
    akaScore?: number;
    aoScore?: number;
    akaPenalties?: number;
    aoPenalties?: number;
    senshu?: "AKA" | "AO" | null;
  }
) {
  await db
    .update(matches)
    .set({
      akaScore: state.akaScore ?? 0,
      aoScore: state.aoScore ?? 0,
      akaPenalties: state.akaPenalties ?? 0,
      aoPenalties: state.aoPenalties ?? 0,
      senshu: state.senshu ?? null,
      status: "LIVE",
    })
    .where(eq(matches.id, matchId));

  try {
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {}

  // Immediate zero-latency push directly to scoreboard and moderator SSE streams
  broadcastLiveEvent({
    table: "matches",
    op: "UPDATE",
    id: matchId,
    matchId,
    ringId,
    akaScore: state.akaScore ?? 0,
    aoScore: state.aoScore ?? 0,
    akaPenalties: state.akaPenalties ?? 0,
    aoPenalties: state.aoPenalties ?? 0,
    senshu: state.senshu ?? null,
    status: "LIVE",
  });

  return { success: true };
}

export async function confirmBoutResult(
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
  }
) {
  // 1. Fetch match
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId));

  if (!match) throw new Error("Match not found");

  const categoryId = match.categoryId;

  // 2. Fetch category and draw graph
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) throw new Error("Draw not found");

  const [latestVersion] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);

  if (!latestVersion) throw new Error("Draw version not found");

  const graph = latestVersion.graph as unknown as DrawGraph;

  // Fetch slots for this match to resolve winning side accurately
  const currentSlots = await db
    .select()
    .from(matchSlots)
    .where(eq(matchSlots.matchId, matchId));

  const akaSlot = currentSlots.find((s) => s.position === 1);
  const aoSlot = currentSlots.find((s) => s.position === 2);

  let winningSide: "AKA" | "AO" = details?.side || "AKA";
  if (winnerId === akaSlot?.athleteId) {
    winningSide = "AKA";
  } else if (winnerId === aoSlot?.athleteId) {
    winningSide = "AO";
  }

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
        akaScore: details?.akaPoints ?? 0,
        aoScore: details?.aoPoints ?? 0,
        akaPenalties: details?.akaPenalties ?? 0,
        aoPenalties: details?.aoPenalties ?? 0,
        senshu: details?.senshu ?? null,
        decisionMethod: details?.method || "POINTS",
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
        akaPoints: details?.akaPoints ?? 0,
        aoPoints: details?.aoPoints ?? 0,
        method: details?.method || "POINTS",
        senshu: details?.senshu ?? null,
        isCorrection: isAlreadyConfirmed,
        isReversingWinner,
        previousWinnerId: isAlreadyConfirmed ? match.winnerId : null,
        rollbackApplied: Boolean(details?.allowRollback),
      },
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
        },
      });
    }
  });

  return { success: true };
}

export async function getTournamentActiveBouts(tournamentId: string) {
  const [tournamentRows, ringRows] = await Promise.all([
    db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        showPublicDraws: tournaments.showPublicDraws,
      })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(rings)
      .where(eq(rings.tournamentId, tournamentId))
      .orderBy(rings.ringOrder),
  ]);

  if (ringRows.length === 0) return {};
  const tournament = tournamentRows[0] || null;
  const ringIds = ringRows.map((r) => r.id);

  // Fetch all active assignments across all rings in a single query
  const allActiveAssignments = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        inArray(categoryAssignments.ringId, ringIds),
        inArray(categoryAssignments.status, ["running", "paused", "pending"])
      )
    )
    .orderBy(categoryAssignments.queueOrder);

  // Map lowest queue_order active assignment per ring
  const ringAssignmentMap = new Map<string, any>();
  for (const a of allActiveAssignments) {
    if (!ringAssignmentMap.has(a.ringId)) {
      ringAssignmentMap.set(a.ringId, a);
    }
  }

  const categoryIds = Array.from(
    new Set(Array.from(ringAssignmentMap.values()).map((a) => a.categoryId).filter(Boolean))
  );

  if (categoryIds.length === 0) return {};

  // Batch query categories, draws, and matches for all active categories in parallel
  const [catRows, drawRows, matchRows] = await Promise.all([
    db.select().from(categories).where(inArray(categories.id, categoryIds)),
    db.select().from(draws).where(inArray(draws.categoryId, categoryIds)),
    db.select().from(matches).where(inArray(matches.categoryId, categoryIds)).orderBy(matches.matchNo),
  ]);

  const catMap = new Map(catRows.map((c) => [c.id, c]));
  const drawSet = new Set(drawRows.map((d) => d.categoryId));

  const matchIds = matchRows.map((m) => m.id);
  const slotRows =
    matchIds.length > 0
      ? await db.select().from(matchSlots).where(inArray(matchSlots.matchId, matchIds))
      : [];

  const athleteIds = Array.from(
    new Set(slotRows.map((s) => s.athleteId).filter((id): id is string => Boolean(id)))
  );

  const athleteRows =
    athleteIds.length > 0
      ? await db.select().from(athletes).where(inArray(athletes.id, athleteIds))
      : [];
  const athleteMap = new Map(athleteRows.map((a) => [a.id, a]));

  // Assemble bout map in memory (0 ms overhead)
  const boutMap: Record<string, any> = {};
  for (const ring of ringRows) {
    const assignment = ringAssignmentMap.get(ring.id);
    if (!assignment) continue;
    const cat = catMap.get(assignment.categoryId);
    if (!cat) continue;

    const hasDraw = drawSet.has(cat.id);
    const catMatches = matchRows.filter((m) => m.categoryId === cat.id);
    const catMatchIds = new Set(catMatches.map((m) => m.id));
    const catSlots = slotRows.filter((s) => catMatchIds.has(s.matchId));

    boutMap[ring.id] = assembleRingActiveBout({
      ring,
      tournament,
      assignment,
      category: cat,
      hasDraw,
      allMatches: catMatches,
      allSlots: catSlots,
      athleteMap,
    });
  }

  // Populate kataScores for current matches
  const currentMatchIds = Object.values(boutMap)
    .map((b: any) => b.currentMatch?.id)
    .filter(Boolean) as string[];

  if (currentMatchIds.length > 0) {
    const allKataScores = await db
      .select()
      .from(kataScores)
      .where(inArray(kataScores.matchId, currentMatchIds));
    for (const b of Object.values(boutMap) as any[]) {
      if (b.currentMatch?.id) {
        b.currentMatch.kataScores = allKataScores.filter((s) => s.matchId === b.currentMatch.id);
      }
    }
  }

  return boutMap;
}
