"use server";

import { withGuestMarks } from "@/lib/local/guests";
import { assignmentCoversMatch } from "@/lib/draws/partFilter";
import { audit } from "@/lib/audit";
import { db } from "@/db";
import {
  categoryAssignments,
  categoryAttendance,
  categories,
  matches,
  matchSlots,
  rings,
  athletes,
  draws,
  tournaments,
  kataScores,
} from "@/db/schema";
import { normalizeClock } from "@/lib/matchClock";
import { commitBoutResult } from "@/lib/bouts/results";
import {
  describePrincipal,
  getRingModerator,
  getTournamentStaff,
  requireMatchModerator,
  requireRingModerator,
  requireTournamentAdmin,
} from "@/lib/auth/guards";
import { scopeForMatch, type MatchScope } from "@/lib/auth/scope";
import type { Principal } from "@/lib/auth/principal";
import { and, eq, inArray, type InferSelectModel } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import type { RingClock } from "@/lib/matchClock";

type RingRow = InferSelectModel<typeof rings>;
type TournamentRow = InferSelectModel<typeof tournaments>;
type CategoryRow = InferSelectModel<typeof categories>;
type CategoryAssignmentRow = InferSelectModel<typeof categoryAssignments>;
type MatchRow = InferSelectModel<typeof matches>;
type MatchSlotRow = InferSelectModel<typeof matchSlots>;
type AthleteRow = InferSelectModel<typeof athletes>;

type Athlete = { id: string | null; name: string; school: string; chestNumber: string | null; isSolo?: boolean };
type EnrichedMatch = MatchRow & {
  isSolo: boolean;
  aka: Athlete;
  ao: Athlete;
  isReady: boolean;
  isFinished: boolean;
  kataScores?: unknown[];
};

type TournamentSelection = Partial<TournamentRow> & { id: string; name: string };
type PublicRing = Omit<RingRow, "accessCode" | "judgePin" | "judgePairingKey">;

type RingActiveBoutResult = {
  tournament: TournamentSelection | null;
  ring: PublicRing;
  assignment: CategoryAssignmentRow | null;
  category: CategoryRow;
  hasDraw: boolean;
  currentMatch: EnrichedMatch | null;
  nextBout: EnrichedMatch | null;
  matches: EnrichedMatch[];
  clock: RingClock;
  serverNow: number;
};

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
  ring: PublicRing;
  tournament: TournamentSelection | null;
  assignment: CategoryAssignmentRow | null;
  category: CategoryRow;
  hasDraw: boolean;
  allMatches: MatchRow[];
  allSlots: MatchSlotRow[];
  athleteMap: Map<string, AthleteRow>;
  targetMatchId?: string | null;
}): RingActiveBoutResult {
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

    const isFinished = m.status === "CONFIRMED" || m.status === "COMPLETED" || m.status === "BYE";
    const isSolo = Boolean(
      (m.bracketType === "POOL" || category.eventType?.toLowerCase()?.includes("kata") || category.name?.toLowerCase()?.includes("kata")) &&
      akaAth &&
      !aoAth &&
      (!aoSlot?.athleteId || m.roundName?.includes("Solo") || m.roundName?.includes("Bye"))
    );

    const isReady =
      (Boolean(akaAth && aoAth) || (isSolo && Boolean(akaAth))) &&
      !isFinished;

    return {
      ...m,
      isSolo,
      aka: akaAth
        ? { id: akaAth.id, name: akaAth.name, school: akaAth.school || akaAth.dojo || "", chestNumber: akaAth.chestNumber }
        : { id: null, name: "TBD", school: "", chestNumber: null },
      ao: aoAth
        ? { id: aoAth.id, name: aoAth.name, school: aoAth.school || aoAth.dojo || "", chestNumber: aoAth.chestNumber, isSolo: false }
        : isSolo
        ? { id: null, name: "Solo Performance", school: "", chestNumber: null, isSolo: true }
        : { id: null, name: "TBD", school: "", chestNumber: null, isSolo: false },
      isReady,
      isFinished,
    };
  });

  // Identify fighters who recently competed to ensure rest time
  const recentFighterIds = new Set<string>();
  const lastFinishedMatch = enrichedMatches
    .filter((m) => m.isFinished)
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

/** Ring row without its credentials (tatami access code, judge PIN). */
function publicRing<T extends { accessCode?: unknown; judgePin?: unknown; judgePairingKey?: unknown }>(ring: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accessCode, judgePin, judgePairingKey, ...rest } = ring;
  return rest;
}

/** Judge marks without the judge's device token. */
function publicKataScore(score: typeof kataScores.$inferSelect) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { judgeDeviceToken, ...rest } = score;
  return rest;
}

/**
 * The category on the mat: running or paused first, otherwise the next
 * pending one in queue order.
 */
async function activeAssignmentForRing(ringId: string) {
  const candidates = await db
    .select()
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.ringId, ringId),
        inArray(categoryAssignments.status, ["running", "paused", "pending"])
      )
    )
    .orderBy(categoryAssignments.queueOrder);
  return (
    candidates.find((a) => a.status === "running" || a.status === "paused") ?? candidates[0] ?? null
  );
}

/**
 * Current bout on a tatami. Readable by the tatami's moderator, staff of the
 * event, and — when the admin switched the public TV screen on — anyone.
 */
export async function getRingActiveBout(ringId: string, matchId?: string) {
  const [ring] = await db.select().from(rings).where(eq(rings.id, ringId));
  if (!ring) return null;

  const [tournament] = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      showPublicDraws: tournaments.showPublicDraws,
      showPublicScoreboard: tournaments.showPublicScoreboard,
      tunnelUrl: tournaments.tunnelUrl,
    })
    .from(tournaments)
    .where(eq(tournaments.id, ring.tournamentId));

  const moderator = await getRingModerator(ringId);
  const staff = moderator ?? (await getTournamentStaff(ring.tournamentId));
  if (!staff && !tournament?.showPublicScoreboard) return null;

  // The judge PIN and QR key are served only by getJudgePanel.
  const ringView = publicRing(ring);

  const assignment = await activeAssignmentForRing(ringId);
  if (!assignment) return null;

  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, assignment.categoryId));

  if (!cat) return null;

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, cat.id));

  if (!draw) {
    return assembleRingActiveBout({
      ring: ringView,
      tournament,
      assignment,
      category: cat,
      hasDraw: false,
      allMatches: [],
      allSlots: [],
      athleteMap: new Map(),
    });
  }

  // A split category's tatami sees only its own part (a pool, or the finals).
  const allMatches = (
    await db.select().from(matches).where(eq(matches.categoryId, cat.id)).orderBy(matches.matchNo)
  ).filter((m) => assignmentCoversMatch(assignment.part, m.part));

  const allSlots =
    allMatches.length > 0
      ? await db
          .select()
          .from(matchSlots)
          .where(inArray(matchSlots.matchId, allMatches.map((m) => m.id)))
      : [];

  const relevantAthleteIds = Array.from(
    new Set(allSlots.map((s) => s.athleteId).filter((id): id is string => Boolean(id)))
  );

  const relevantAthletes = await withGuestMarks(
    relevantAthleteIds.length > 0 ? await db.select().from(athletes).where(inArray(athletes.id, relevantAthleteIds)) : [],
    [cat.id]
  );

  const athleteMap = new Map(relevantAthletes.map((a) => [a.id, a]));

  const boutResult = assembleRingActiveBout({
    ring: ringView,
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
    const scores = (
      await db.select().from(kataScores).where(eq(kataScores.matchId, boutResult.currentMatch.id))
    ).map(publicKataScore);
    boutResult.currentMatch.kataScores = scores;
    (boutResult as Record<string, unknown>).kataScores = scores;
  }

  // Call-area hints for the desk (absent / withdrawn), staff only.
  if (staff) {
    const marks = await db
      .select({ athleteId: categoryAttendance.athleteId, status: categoryAttendance.status, setBy: categoryAttendance.setBy, setAt: categoryAttendance.setAt })
      .from(categoryAttendance)
      .where(and(eq(categoryAttendance.categoryId, cat.id), inArray(categoryAttendance.status, ["absent", "withdrawn"])));
    (boutResult as Record<string, unknown>).attendance = Object.fromEntries(
      marks.map((m) => [m.athleteId, { status: m.status, setBy: m.setBy, setAt: m.setAt.toISOString() }])
    );
  }

  return boutResult;
}

/**
 * Put a bout on the mat. Only this tatami's moderator, and only a bout from
 * the category currently running here.
 */
export async function setActiveBout(ringId: string, matchId: string) {
  await requireRingModerator(ringId);
  const { moderator, scope } = await requireMatchModerator(matchId);
  if (scope.ringId !== ringId) {
    throw new Error("That bout belongs to a different tatami.");
  }

  await db.update(rings).set({ currentMatchId: matchId }).where(eq(rings.id, ringId));

  const [match] = await db.select({ status: matches.status }).from(matches).where(eq(matches.id, matchId));
  if (match && match.status !== "CONFIRMED" && match.status !== "BYE" && match.status !== "WALKOVER") {
    await db.update(matches).set({ status: "LIVE" }).where(eq(matches.id, matchId));
  }

  await audit({
    tournamentId: scope.tournamentId,
    ringId,
    categoryId: scope.categoryId,
    matchId,
    actor: moderator,
    action: "BOUT_STARTED",
    targetType: "match",
    targetId: matchId,
  });

  try {
    revalidatePath(`/moderator/ring/${ringId}/current`);
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {
    // Outside a revalidatable context.
  }

  broadcastLiveEvent({
    table: "rings",
    op: "UPDATE",
    id: ringId,
    ringId,
    tournamentId: scope.tournamentId,
    matchId,
    data: { currentMatchId: matchId },
  });

  return { success: true };
}

const clampScore = (v: unknown) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 999 ? n : 0;
};

/** Live score / penalty / senshu updates from the scoring pad. */
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
  const { moderator, scope } = await requireMatchModerator(matchId);
  if (scope.ringId !== ringId) {
    throw new Error("That bout belongs to a different tatami.");
  }

  const [current] = await db
    .select({
      status: matches.status,
      akaScore: matches.akaScore,
      aoScore: matches.aoScore,
      akaPenalties: matches.akaPenalties,
      aoPenalties: matches.aoPenalties,
      senshu: matches.senshu,
    })
    .from(matches)
    .where(eq(matches.id, matchId));
  if (current?.status === "CONFIRMED") {
    return { success: false, error: "This bout is already confirmed. Use Correct Result to change it." };
  }

  const next = {
    akaScore: clampScore(state.akaScore),
    aoScore: clampScore(state.aoScore),
    akaPenalties: clampScore(state.akaPenalties),
    aoPenalties: clampScore(state.aoPenalties),
    senshu: state.senshu === "AKA" || state.senshu === "AO" ? state.senshu : null,
  };

  await db
    .update(matches)
    .set({ ...next, status: "LIVE" })
    .where(eq(matches.id, matchId));

  if (current) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { status: _status, ...before } = current;
    await audit({
      tournamentId: scope.tournamentId,
      ringId,
      categoryId: scope.categoryId,
      matchId,
      actor: moderator,
      action: "BOUT_SCORE",
      targetType: "match",
      targetId: matchId,
      before,
      after: next,
    });
  }

  try {
    revalidatePath(`/scoreboard/${ringId}`);
  } catch {
    // Outside a revalidatable context.
  }

  broadcastLiveEvent({
    table: "matches",
    op: "UPDATE",
    id: matchId,
    matchId,
    ringId,
    tournamentId: scope.tournamentId,
    categoryId: scope.categoryId,
    ...next,
    status: "LIVE",
  });

  return { success: true };
}

/**
 * Confirm (or correct) a bout result and advance the draw. Only the moderator
 * of the tatami the category is running on.
 */
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
    /** Required when changing an already confirmed result. */
    reason?: string;
  }
) {
  const { moderator, scope } = await requireMatchModerator(matchId);
  return recordResult({ matchId, winnerId, details, actor: moderator, scope, isAdminCorrection: false });
}

/**
 * Admin correction of a confirmed result, e.g. after the category has left
 * the mat or on appeal. A reason is mandatory and the change is audited;
 * bouts already fought downstream need explicit `allowRollback`.
 */
export async function correctBoutResult(
  matchId: string,
  winnerId: string,
  reason: string,
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
  const scope = await scopeForMatch(matchId);
  const admin = await requireTournamentAdmin(scope.tournamentId);
  return recordResult({ matchId, winnerId, details: { ...details, reason }, actor: admin, scope, isAdminCorrection: true });
}

const MIN_REASON_LENGTH = 5;

async function recordResult(params: {
  matchId: string;
  winnerId: string;
  details?: Parameters<typeof commitBoutResult>[2];
  actor: Principal;
  scope: MatchScope;
  isAdminCorrection: boolean;
}) {
  const { matchId, winnerId, details, actor, scope, isAdminCorrection } = params;

  const [before] = await db
    .select({
      status: matches.status,
      winnerId: matches.winnerId,
      winnerSide: matches.winnerSide,
      akaScore: matches.akaScore,
      aoScore: matches.aoScore,
      akaPenalties: matches.akaPenalties,
      aoPenalties: matches.aoPenalties,
      senshu: matches.senshu,
      decisionMethod: matches.decisionMethod,
    })
    .from(matches)
    .where(eq(matches.id, matchId));
  if (!before) return { success: false as const, error: "Match not found" };

  const isCorrection = before.status === "CONFIRMED";
  const reason = (details?.reason || "").trim().slice(0, 1000);
  if (isAdminCorrection && !isCorrection) {
    return { success: false as const, error: "Only confirmed results can be corrected here." };
  }
  if (isCorrection && reason.length < MIN_REASON_LENGTH) {
    return {
      success: false as const,
      requiresReason: true,
      error: "This result is already confirmed. Give a reason for the correction (it goes in the official record).",
    };
  }

  const res = await commitBoutResult(matchId, winnerId, {
    ...details,
    reason: reason || undefined,
    actor: describePrincipal(actor),
  });

  if (res.success) {
    const [after] = await db
      .select({
        winnerId: matches.winnerId,
        winnerSide: matches.winnerSide,
        akaScore: matches.akaScore,
        aoScore: matches.aoScore,
        akaPenalties: matches.akaPenalties,
        aoPenalties: matches.aoPenalties,
        senshu: matches.senshu,
        decisionMethod: matches.decisionMethod,
      })
      .from(matches)
      .where(eq(matches.id, matchId));
    await audit({
      tournamentId: scope.tournamentId,
      ringId: scope.ringId,
      categoryId: scope.categoryId,
      matchId,
      actor,
      action: isCorrection ? "BOUT_CORRECTED" : "BOUT_CONFIRMED",
      targetType: "match",
      targetId: matchId,
      before,
      after: { ...after, rollbackApplied: Boolean(details?.allowRollback) },
      reason: reason || null,
    });
  }
  return res;
}

/**
 * Current bout on every tatami. Public once the event is live (the spectator
 * page shows it); a draft event is visible to its staff only.
 */
export async function getTournamentActiveBouts(tournamentId: string) {
  const [tournamentRows, ringRows] = await Promise.all([
    db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        status: tournaments.status,
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

  const tournament = tournamentRows[0] || null;
  if (!tournament || ringRows.length === 0) return {};
  if (tournament.status === "draft" && !(await getTournamentStaff(tournamentId))) return {};
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

  // The category on each mat: running/paused first, else the next pending one.
  const ringAssignmentMap = new Map<string, (typeof allActiveAssignments)[number]>();
  for (const a of allActiveAssignments) {
    const existing = ringAssignmentMap.get(a.ringId);
    const isOnMat = a.status === "running" || a.status === "paused";
    const existingOnMat = existing && (existing.status === "running" || existing.status === "paused");
    if (!existing || (isOnMat && !existingOnMat)) {
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

  const athleteRows = await withGuestMarks(
    athleteIds.length > 0 ? await db.select().from(athletes).where(inArray(athletes.id, athleteIds)) : [],
    Array.from(catMap.keys())
  );
  const athleteMap = new Map(athleteRows.map((a) => [a.id, a]));

  // Assemble bout map in memory (0 ms overhead)
  const boutMap: Record<string, RingActiveBoutResult> = {};
  for (const ring of ringRows) {
    const assignment = ringAssignmentMap.get(ring.id);
    if (!assignment) continue;
    const cat = catMap.get(assignment.categoryId);
    if (!cat) continue;

    const hasDraw = drawSet.has(cat.id);
    const catMatches = matchRows.filter(
      (m) => m.categoryId === cat.id && assignmentCoversMatch(assignment.part, m.part)
    );
    const catMatchIds = new Set(catMatches.map((m) => m.id));
    const catSlots = slotRows.filter((s) => catMatchIds.has(s.matchId));

    boutMap[ring.id] = assembleRingActiveBout({
      ring: publicRing(ring),
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
    .map((b) => b.currentMatch?.id)
    .filter(Boolean) as string[];

  if (currentMatchIds.length > 0) {
    const allKataScores = await db
      .select()
      .from(kataScores)
      .where(inArray(kataScores.matchId, currentMatchIds));
    for (const b of Object.values(boutMap)) {
      if (b.currentMatch) {
        b.currentMatch.kataScores = allKataScores
          .filter((s) => s.matchId === b.currentMatch!.id)
          .map(publicKataScore);
      }
    }
  }

  return boutMap;
}
