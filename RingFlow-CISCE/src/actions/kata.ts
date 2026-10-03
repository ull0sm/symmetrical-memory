"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import { categories, matches, kataScores, rings } from "@/db/schema";
import { eq, and, asc, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { finalizeKataMatch } from "@/lib/kata/finalize";
import { confirmRankedBout, findMedalTie, isRankedGroup, loadRankedStandings, saveTieDecision } from "@/lib/kata/rankedGroup";
import { KATA_TIE_METHODS } from "@/lib/statuses";
import { computeKataTally, recomputeKataTallies, MAX_JUDGE_SEATS, type KataTally } from "@/lib/kata/tally";
import { isKataCategory } from "@/lib/categories/eventType";
import { JUDGE_PANEL_SEATS } from "@/lib/constants";
import { parseInput } from "@/lib/validation";
import {
  describePrincipal,
  getRingModerator,
  getTournamentStaff,
  requireMatchModerator,
  requireTournamentStaff,
} from "@/lib/auth/guards";
import type { ModeratorPrincipal } from "@/lib/auth/principal";
import { scopeForMatch, tournamentIdForCategory, type MatchScope } from "@/lib/auth/scope";

/**
 * Kata scoring at the moderator desk: voting control for the judge phones,
 * void / override of a judge's vote, desk-entered marks, and finalizing.
 * The judge phone side lives in `actions/judge.ts`, the panel (pairing,
 * approve, kick) in `actions/judgePanel.ts`.
 *
 * Totals and winners always come from the server (`lib/kata/tally.ts`).
 */

/** Judge rows as the desk sees them: never a device token. */
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

function broadcastKataChange(scope: MatchScope, op: "UPDATE" | "DELETE" = "UPDATE") {
  const base = { id: scope.matchId, matchId: scope.matchId, ringId: scope.ringId ?? undefined, tournamentId: scope.tournamentId };
  broadcastLiveEvent({ table: "kata_scores", op, ...base });
  broadcastLiveEvent({ table: "matches", op: "UPDATE", ...base });
}

const DESK_NAME = "Desk";
const seatSchema = z.number().int().min(1).max(JUDGE_PANEL_SEATS);
/** Desk marks: 0.1–10.0 (lenient; the desk may copy a paper sheet). */
const deskMark = z.number().gt(0).max(10);
/** A bout total typed from a paper sheet: the sum of up to three kept marks. */
const deskTotal = z.number().gt(0).max(30);

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
  const [match] = await db.select({ kataVoting: matches.kataVoting }).from(matches).where(eq(matches.id, matchId));
  return { success: true, scores: scores.map(publicScore), voting: match?.kataVoting ?? "idle" };
}

async function requireOpenKataBout(matchId: string) {
  const { moderator, scope } = await requireMatchModerator(matchId);
  const [match] = await db
    .select({ status: matches.status, voting: matches.kataVoting, categoryName: categories.name, eventType: categories.eventType })
    .from(matches)
    .innerJoin(categories, eq(categories.id, matches.categoryId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!match) return { error: "Bout not found" as const };
  if (!isKataCategory({ name: match.categoryName, eventType: match.eventType })) {
    return { error: "Judge voting is for kata bouts only." as const };
  }
  if (match.status === "CONFIRMED") return { error: "This bout is already confirmed." as const };
  return { moderator, scope, match };
}

/**
 * Open voting on a kata bout. It becomes the tatami's current bout, any other
 * open bout in the category is closed, and judge phones can vote.
 */
export async function openKataVoting(matchId: string) {
  const res = await requireOpenKataBout(matchId);
  if ("error" in res) return { success: false as const, error: res.error };
  const { moderator, scope } = res;

  await db
    .update(matches)
    .set({ kataVoting: "closed" })
    .where(and(eq(matches.categoryId, scope.categoryId), eq(matches.kataVoting, "open"), ne(matches.id, matchId)));
  await db.update(matches).set({ kataVoting: "open", status: "LIVE" }).where(eq(matches.id, matchId));
  await db.update(rings).set({ currentMatchId: matchId }).where(eq(rings.id, scope.ringId!));

  await audit({
    tournamentId: scope.tournamentId,
    ringId: scope.ringId,
    categoryId: scope.categoryId,
    matchId,
    actor: moderator,
    action: "KATA_VOTING_OPENED",
    targetType: "match",
    targetId: matchId,
  });
  broadcastLiveEvent({ table: "rings", op: "UPDATE", id: scope.ringId!, ringId: scope.ringId!, tournamentId: scope.tournamentId, matchId });
  broadcastKataChange(scope);
  revalidateRing(scope.ringId);
  return { success: true as const };
}

/** Close voting: judge votes are locked from here on. */
export async function closeKataVoting(matchId: string) {
  const res = await requireOpenKataBout(matchId);
  if ("error" in res) return { success: false as const, error: res.error };
  const { moderator, scope } = res;

  await db.update(matches).set({ kataVoting: "closed" }).where(eq(matches.id, matchId));
  const tally = await recomputeKataTallies(matchId);
  await audit({
    tournamentId: scope.tournamentId,
    ringId: scope.ringId,
    categoryId: scope.categoryId,
    matchId,
    actor: moderator,
    action: "KATA_VOTING_CLOSED",
    targetType: "match",
    targetId: matchId,
    after: tally ? summarizeTally(tally) : null,
  });
  broadcastKataChange(scope);
  revalidateRing(scope.ringId);
  return { success: true as const };
}

function summarizeTally(t: KataTally) {
  return t.mode === "FLAG"
    ? { mode: t.mode, akaFlags: t.akaFlags, aoFlags: t.aoFlags, winner: t.winner }
    : { mode: t.mode, akaTotal: t.akaTotal, aoTotal: t.aoTotal, winner: t.winner };
}

async function seatRows(matchId: string, seat: number) {
  return db
    .select()
    .from(kataScores)
    .where(and(eq(kataScores.matchId, matchId), eq(kataScores.judgeSeat, seat)));
}

const voidSchema = z.object({ matchId: z.string().min(1).max(100), judgeSeat: seatSchema });

/** Clear one seat's vote so that judge can vote again (or the desk can enter it). */
export async function voidJudgeVote(input: z.input<typeof voidSchema>) {
  const params = parseInput(voidSchema, input, "void");
  const res = await requireOpenKataBout(params.matchId);
  if ("error" in res) return { success: false as const, error: res.error };
  const { moderator, scope } = res;

  const before = await seatRows(params.matchId, params.judgeSeat);
  if (before.length === 0) return { success: true as const };
  await db
    .delete(kataScores)
    .where(and(eq(kataScores.matchId, params.matchId), eq(kataScores.judgeSeat, params.judgeSeat)));

  // A side whose last mark was voided has no total any more.
  const tally = await recomputeKataTallies(params.matchId);
  if (tally) {
    const clear: Partial<typeof matches.$inferInsert> = {};
    if (tally.akaMarks.every((m) => m === null) && before.some((r) => r.targetSide === "AKA" && r.numericScore)) clear.akaScoreTotal = null;
    if (tally.aoMarks.every((m) => m === null) && before.some((r) => r.targetSide === "AO" && r.numericScore)) clear.aoScoreTotal = null;
    if (Object.keys(clear).length) await db.update(matches).set(clear).where(eq(matches.id, params.matchId));
  }

  await audit({
    tournamentId: scope.tournamentId,
    ringId: scope.ringId,
    categoryId: scope.categoryId,
    matchId: params.matchId,
    actor: moderator,
    action: "KATA_VOTE_VOIDED",
    targetType: "match",
    targetId: params.matchId,
    before: before.map((r) => ({ seat: r.judgeSeat, side: r.targetSide, flag: r.flagVote, score: r.numericScore, judge: r.judgeName })),
  });
  broadcastKataChange(scope, "DELETE");
  return { success: true as const };
}

/** Write a desk-entered vote for one seat, replacing what the seat had for those sides. */
async function writeDeskVote(matchId: string, seat: number, vote: { flag?: "AKA" | "AO" | null; aka?: number | null; ao?: number | null }) {
  const upsert = async (side: "AKA" | "AO" | "BOTH", values: { flagVote: string | null; numericScore: string | null; scoreType: string }) => {
    await db
      .insert(kataScores)
      .values({
        matchId,
        judgeSeat: seat,
        targetSide: side,
        judgeDeviceToken: "MODERATOR_MANUAL",
        judgeSessionId: null,
        judgeName: DESK_NAME,
        isOverridden: true,
        ...values,
      })
      .onConflictDoUpdate({
        target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
        set: { ...values, judgeSessionId: null, judgeName: DESK_NAME, isOverridden: true },
      });
  };
  const seatFilter = (side: "AKA" | "AO" | "BOTH") =>
    and(eq(kataScores.matchId, matchId), eq(kataScores.judgeSeat, seat), eq(kataScores.targetSide, side));

  if (vote.flag !== undefined) {
    // One flag row per seat; older rows put flags on the AKA/AO rows.
    await db.update(kataScores).set({ flagVote: null }).where(and(eq(kataScores.matchId, matchId), eq(kataScores.judgeSeat, seat), ne(kataScores.targetSide, "BOTH")));
    if (vote.flag === null) await db.delete(kataScores).where(seatFilter("BOTH"));
    else await upsert("BOTH", { flagVote: vote.flag, numericScore: null, scoreType: "FLAG" });
  }
  for (const side of ["AKA", "AO"] as const) {
    const mark = side === "AKA" ? vote.aka : vote.ao;
    if (mark === undefined) continue;
    if (mark === null) await db.delete(kataScores).where(seatFilter(side));
    else await upsert(side, { flagVote: null, numericScore: mark.toFixed(2), scoreType: "POINT" });
  }
}

/**
 * Finish a kata bout with the winner the marks/flags give. The desk names the
 * winner only when they don't decide it (a tie, or no judge marks at all).
 */
async function finalizeFromTally(
  matchId: string,
  moderator: ModeratorPrincipal,
  scope: MatchScope,
  requested: "AKA" | "AO" | undefined
) {
  const tally = await recomputeKataTallies(matchId);
  if (!tally) return { success: false as const, error: "Bout not found" };

  let winner: "AKA" | "AO" | undefined;
  let method: string;
  if (tally.winner === "AKA" || tally.winner === "AO") {
    if (requested && requested !== tally.winner) {
      return { success: false as const, error: `The ${tally.mode === "FLAG" ? "flags" : "marks"} give the bout to ${tally.winner}. Void or correct a vote first.` };
    }
    winner = tally.winner;
    method = tally.solo ? "SOLO" : tally.mode === "FLAG" ? "FLAGS" : "POINTS";
  } else {
    // No decision from the votes: compare desk-typed totals, else the desk decides.
    const [m] = await db.select({ aka: matches.akaScoreTotal, ao: matches.aoScoreTotal }).from(matches).where(eq(matches.id, matchId));
    const akaTotal = m?.aka === null || m?.aka === undefined ? null : Number(m.aka);
    const aoTotal = m?.ao === null || m?.ao === undefined ? null : Number(m.ao);
    const byTotals = akaTotal !== null && aoTotal !== null && akaTotal !== aoTotal ? (akaTotal > aoTotal ? "AKA" : "AO") : undefined;
    if (tally.winner === null && byTotals) {
      if (requested && requested !== byTotals) {
        return { success: false as const, error: `The entered totals give the bout to ${byTotals}.` };
      }
      winner = byTotals;
      method = "POINTS";
    } else {
      winner = requested;
      method = "DESK_DECISION";
    }
  }
  if (!winner) {
    return { success: false as const, error: "Scores are tied or incomplete; choose the winner before finalizing." };
  }

  await db.update(matches).set({ kataVoting: "closed" }).where(eq(matches.id, matchId));
  const res = await finalizeKataMatch({ matchId, winnerSide: winner, decisionMethod: method, actor: describePrincipal(moderator) });
  if (!res.success) return res;

  await audit({
    tournamentId: scope.tournamentId,
    ringId: scope.ringId,
    categoryId: scope.categoryId,
    matchId,
    actor: moderator,
    action: "BOUT_CONFIRMED",
    targetType: "match",
    targetId: matchId,
    after: { winnerSide: winner, winnerId: res.winnerId, discipline: "kata", method, ...summarizeTally(tally) },
  });
  broadcastKataChange(scope);
  revalidateRing(scope.ringId);
  return { success: true as const, winnerSide: winner };
}

/**
 * One seat the desk edited. A key that is present is an edit (null clears it);
 * a missing key leaves that side alone, so a judge's vote that arrived after
 * the desk last refreshed is never overwritten by a stale blank.
 */
const seatEdit = z.object({
  seat: z.number().int().min(1).max(MAX_JUDGE_SEATS),
  aka: deskMark.nullable().optional(),
  ao: deskMark.nullable().optional(),
  flag: z.enum(["AKA", "AO"]).nullable().optional(),
});
const manualSchema = z.object({
  matchId: z.string().min(1).max(100),
  akaKataNumber: z.number().int().positive().max(999).optional(),
  akaKataName: z.string().trim().max(80).optional(),
  aoKataNumber: z.number().int().positive().max(999).optional(),
  aoKataName: z.string().trim().max(80).optional(),
  /** Only the seats the desk edited. */
  seats: z.array(seatEdit).max(MAX_JUDGE_SEATS * 2).optional(),
  /** A total typed from a paper sheet, used only for a side with no per-judge marks. */
  akaScore: deskTotal.optional(),
  aoScore: deskTotal.optional(),
  winnerSide: z.enum(["AKA", "AO"]).optional(),
  finalize: z.boolean().optional(),
  /** A ranked kata bout: sides whose athlete didn't perform (no total, ranked last). */
  notPerformed: z.array(z.enum(["AKA", "AO"])).max(2).optional(),
});

/**
 * The desk enters kata names, marks or flags (small events without judge
 * phones, or to correct a seat), and optionally finalizes. Seats whose value
 * did not change keep their judge's attribution; changed seats are recorded
 * as desk entries and audited.
 */
export async function submitModeratorManualKataMarks(input: z.input<typeof manualSchema>) {
  const params = parseInput(manualSchema, input, "kata marks");
  const { moderator, scope } = await requireMatchModerator(params.matchId);
  const { matchId } = params;

  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!match) return { success: false as const, error: "Match not found" };
  if (match.status === "CONFIRMED") return { success: false as const, error: "This bout is already confirmed." };

  const kataLabel = (num?: number, name?: string) => {
    const cleanName = (name || "").trim();
    if (num) return `#${num} ${cleanName}`.trim();
    return cleanName || undefined;
  };
  const update: Partial<typeof matches.$inferInsert> = {};
  const akaLabel = kataLabel(params.akaKataNumber, params.akaKataName);
  const aoLabel = kataLabel(params.aoKataNumber, params.aoKataName);
  if (akaLabel && akaLabel !== match.akaKataName) update.akaKataName = akaLabel;
  if (aoLabel && aoLabel !== match.aoKataName) update.aoKataName = aoLabel;

  // Seat-by-seat diff against what is stored.
  const existing = await db.select().from(kataScores).where(eq(kataScores.matchId, matchId));
  const stored = (seat: number, side: "AKA" | "AO") => {
    const r = existing.find((e) => e.judgeSeat === seat && e.targetSide === side && e.numericScore !== null);
    return r ? Number(r.numericScore) : null;
  };
  const storedFlag = (seat: number) =>
    (existing.find((e) => e.judgeSeat === seat && (e.flagVote === "AKA" || e.flagVote === "AO"))?.flagVote as "AKA" | "AO" | undefined) ?? null;

  const changes: { seat: number; side: string; before: unknown; after: unknown }[] = [];
  for (const edit of params.seats ?? []) {
    const seat = edit.seat;
    const vote: { flag?: "AKA" | "AO" | null; aka?: number | null; ao?: number | null } = {};
    for (const side of ["AKA", "AO"] as const) {
      const value = side === "AKA" ? edit.aka : edit.ao;
      if (value === undefined) continue;
      const next = value === null ? null : Number(value.toFixed(2));
      const prev = stored(seat, side);
      if (next !== prev) {
        vote[side === "AKA" ? "aka" : "ao"] = next;
        changes.push({ seat, side, before: prev, after: next });
      }
    }
    if (edit.flag !== undefined) {
      const next = edit.flag;
      const prev = storedFlag(seat);
      if (next !== prev) {
        vote.flag = next;
        changes.push({ seat, side: "FLAG", before: prev, after: next });
      }
    }
    if (Object.keys(vote).length) {
      const phoneRows = existing.filter((e) => e.judgeSeat === seat && e.judgeSessionId && !e.isOverridden);
      await writeDeskVote(matchId, seat, vote);
      // Replacing a judge phone's vote is an override: record whose vote it was.
      if (phoneRows.length) {
        await audit({
          tournamentId: scope.tournamentId,
          ringId: scope.ringId,
          categoryId: scope.categoryId,
          matchId,
          actor: moderator,
          action: "KATA_VOTE_OVERRIDDEN",
          targetType: "match",
          targetId: matchId,
          before: phoneRows.map((r) => ({ seat, side: r.targetSide, flag: r.flagVote, score: r.numericScore, judge: r.judgeName })),
          after: { seat, ...vote },
        });
      }
    }
  }

  const tally = await recomputeKataTallies(matchId);
  // Paper-sheet totals, only for a side without per-judge marks.
  if (tally && params.akaScore !== undefined && tally.akaMarks.every((m) => m === null)) update.akaScoreTotal = params.akaScore.toFixed(2);
  if (tally && params.aoScore !== undefined && tally.aoMarks.every((m) => m === null)) update.aoScoreTotal = params.aoScore.toFixed(2);
  if (Object.keys(update).length) await db.update(matches).set(update).where(eq(matches.id, matchId));

  if (changes.length || update.akaScoreTotal !== undefined || update.aoScoreTotal !== undefined) {
    await audit({
      tournamentId: scope.tournamentId,
      ringId: scope.ringId,
      categoryId: scope.categoryId,
      matchId,
      actor: moderator,
      action: "KATA_MARKS_SAVED",
      targetType: "match",
      targetId: matchId,
      before: { akaTotal: match.akaScoreTotal, aoTotal: match.aoScoreTotal },
      after: {
        changes,
        akaTotal: update.akaScoreTotal ?? tally?.akaTotal ?? null,
        aoTotal: update.aoScoreTotal ?? tally?.aoTotal ?? null,
        kata: { aka: akaLabel ?? null, ao: aoLabel ?? null },
      },
    });
  }

  if (params.finalize) {
    if (await isRankedGroup(scope.categoryId)) return finalizeRanked(matchId, moderator, scope, params.notPerformed ?? []);
    return finalizeFromTally(matchId, moderator, scope, params.winnerSide);
  }

  broadcastKataChange(scope);
  revalidateRing(scope.ringId);
  return { success: true as const, winnerSide: tally?.winner === "AKA" || tally?.winner === "AO" ? tally.winner : undefined };
}

/**
 * Confirm a ranked kata bout: every athlete on it has a total, or the desk says
 * they didn't perform. Each performance stands on its own, so there is no winner.
 */
async function finalizeRanked(matchId: string, moderator: ModeratorPrincipal, scope: MatchScope, notPerformed: ("AKA" | "AO")[]) {
  const tally = await recomputeKataTallies(matchId);
  if (!tally) return { success: false as const, error: "Bout not found" };
  const [m] = await db.select({ aka: matches.akaScoreTotal, ao: matches.aoScoreTotal }).from(matches).where(eq(matches.id, matchId));
  const sides: ("AKA" | "AO")[] = tally.solo ? ["AKA"] : ["AKA", "AO"];
  const totals: Record<"AKA" | "AO", number | null> = {
    AKA: tally.akaTotal ?? (m?.aka === null || m?.aka === undefined ? null : Number(m.aka)),
    AO: tally.aoTotal ?? (m?.ao === null || m?.ao === undefined ? null : Number(m.ao)),
  };
  for (const side of sides) {
    const label = side === "AKA" ? "Red" : "Blue";
    if (totals[side] === null && !notPerformed.includes(side)) {
      return { success: false as const, error: `${label} has no total yet. Enter the marks, or mark ${label} as not performed.` };
    }
    if (totals[side] !== null && notPerformed.includes(side)) {
      return { success: false as const, error: `${label} has marks. Clear them before marking ${label} as not performed.` };
    }
  }

  const res = await confirmRankedBout(matchId, describePrincipal(moderator));
  if (!res.success) return res;
  await audit({
    tournamentId: scope.tournamentId,
    ringId: scope.ringId,
    categoryId: scope.categoryId,
    matchId,
    actor: moderator,
    action: "BOUT_CONFIRMED",
    targetType: "match",
    targetId: matchId,
    after: { discipline: "kata", method: "RANKED", akaTotal: totals.AKA, aoTotal: tally.solo ? null : totals.AO, notPerformed },
  });
  broadcastKataChange(scope);
  broadcastLiveEvent({ table: "rings", op: "UPDATE", id: scope.ringId!, ringId: scope.ringId!, tournamentId: scope.tournamentId });
  revalidateRing(scope.ringId);
  return { success: true as const, winnerSide: undefined };
}

/** A ranked kata group's standings, for the staff of its tournament. Null for any other category. */
export async function getRankedStandings(categoryId: string) {
  await requireTournamentStaff(await tournamentIdForCategory(categoryId));
  return loadRankedStandings(categoryId);
}

const tieSchema = z.object({
  /** Any bout of the group: the moderator must be running it. */
  matchId: z.string().min(1).max(100),
  /** The tied athletes, best first. */
  athleteIds: z.array(z.string().uuid()).min(2).max(32),
  method: z.enum(KATA_TIE_METHODS),
  note: z.string().trim().min(3, "Add a short note").max(500),
});

/**
 * The desk's decision on a ranked kata tie that decides a medal, after the tied
 * athletes performed again or a flag vote between them. Only once everyone has
 * performed; recording the same tie again replaces the order. Audited.
 */
export async function resolveKataTie(input: z.input<typeof tieSchema>) {
  const parsed = tieSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the decision." };
  const { moderator, scope } = await requireMatchModerator(parsed.data.matchId);
  const { athleteIds, method, note } = parsed.data;

  const standings = await loadRankedStandings(scope.categoryId);
  if (!standings) return { success: false as const, error: "Only a ranked kata group has ties to decide here." };
  if (!standings.complete) return { success: false as const, error: "Score every performance first (or mark who didn't perform)." };
  if (new Set(athleteIds).size !== athleteIds.length) return { success: false as const, error: "Each athlete once, please." };
  const tie = findMedalTie(standings, athleteIds);
  if (!tie) return { success: false as const, error: "Those athletes aren't tied for a medal." };

  const before = await saveTieDecision(scope.categoryId, { athleteIds, method, note, decidedBy: describePrincipal(moderator).name });
  const names = new Map(standings.performers.map((p) => [p.athleteId, p.name]));
  await audit({
    tournamentId: scope.tournamentId,
    ringId: scope.ringId,
    categoryId: scope.categoryId,
    actor: moderator,
    action: "KATA_TIE_DECIDED",
    targetType: "category",
    targetId: scope.categoryId,
    before: before ? { order: before.map((id) => names.get(id) ?? id) } : null,
    after: { order: athleteIds.map((id) => names.get(id) ?? id), athleteIds, method, position: tie.position },
    reason: note,
  });
  broadcastLiveEvent({ table: "kata_tie_decisions", op: "UPDATE", categoryId: scope.categoryId, ringId: scope.ringId ?? undefined, tournamentId: scope.tournamentId });
  revalidateRing(scope.ringId);
  return { success: true as const, standings: await loadRankedStandings(scope.categoryId) };
}

/** Server tally for the desk's live display (totals, flags, dropped marks, verdict). */
export async function getKataTally(matchId: string) {
  const scope = await scopeForMatch(matchId);
  const allowed =
    (scope.ringId && (await getRingModerator(scope.ringId))) ||
    (await getTournamentStaff(scope.tournamentId));
  if (!allowed) return null;
  return computeKataTally(matchId);
}
