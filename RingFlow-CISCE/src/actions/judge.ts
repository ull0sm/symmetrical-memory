"use server";

import { withGuestMarks } from "@/lib/local/guests";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  athletes,
  categories,
  categoryAssignments,
  judgeSessions,
  kataScores,
  matches,
  matchSlots,
  rings,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { clearCookies, currentClaimHash, getJudgePrincipal, issueClaim, requireJudge, scopeForMatch, setSessionCookie, SESSION_COOKIES } from "@/lib/auth";
import { hashToken, newSessionToken } from "@/lib/auth/tokens";
import { isKataCategory } from "@/lib/categories/eventType";
import {
  JUDGE_PANEL_SEATS,
  KATA_MARK_MAX,
  KATA_MARK_MIN,
  MAX_PENDING_JUDGE_REQUESTS,
} from "@/lib/constants";
import { kataBoutContext, recomputeKataTallies } from "@/lib/kata/tally";
import { RATE_LIMITS, TOO_MANY_ATTEMPTS, clientAddress, isBlocked, recordFailure } from "@/lib/rateLimit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { isValidUuid } from "@/lib/utils";
import { parseInput } from "@/lib/validation";

/**
 * The judge's phone (docs/roles/judge.md). Everything here is reachable from
 * the public judge page, so each action checks the caller itself: pairing
 * needs the tatami's QR key or PIN, everything after approval needs the
 * httpOnly judge session cookie for that tatami.
 *
 * Judges never see the PIN, other judges' votes, tokens, or admin data.
 */

export type JudgeStatus = {
  status: "none" | "pending" | "approved" | "rejected" | "ended";
  ringName: string | null;
  seat?: number;
  judgeName?: string;
  endReason?: string | null;
};

const secretsMatch = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function broadcastJudgeSession(id: string, ringId: string, status: string) {
  broadcastLiveEvent({ table: "judge_sessions", op: "UPDATE", id, ringId, status });
}

/** Where this browser stands on a tatami: paired, waiting, refused or nothing. */
export async function getJudgeStatus(ringId: string): Promise<JudgeStatus> {
  if (!isValidUuid(ringId)) return { status: "none", ringName: null };
  const [ring] = await db.select({ name: rings.name }).from(rings).where(eq(rings.id, ringId)).limit(1);
  if (!ring) return { status: "none", ringName: null };

  const judge = await getJudgePrincipal();
  if (judge && judge.ringId === ringId) {
    return { status: "approved", ringName: ring.name, seat: judge.seat, judgeName: judge.name };
  }

  // A session cookie whose session was ended (kicked, replaced, panel closed).
  const token = (await cookies()).get(SESSION_COOKIES.judge)?.value;
  if (token && token.length <= 128) {
    const [ended] = await db
      .select({ seat: judgeSessions.seat, name: judgeSessions.judgeName, reason: judgeSessions.endReason, expiresAt: judgeSessions.expiresAt })
      .from(judgeSessions)
      .where(and(eq(judgeSessions.ringId, ringId), eq(judgeSessions.tokenHash, hashToken(token))))
      .limit(1);
    if (ended) {
      return {
        status: "ended",
        ringName: ring.name,
        seat: ended.seat,
        judgeName: ended.name,
        endReason: ended.reason ?? (ended.expiresAt && ended.expiresAt <= new Date() ? "expired" : null),
      };
    }
  }

  const claim = await currentClaimHash("judge");
  if (!claim) return { status: "none", ringName: ring.name };

  const [row] = await db
    .select()
    .from(judgeSessions)
    .where(and(eq(judgeSessions.ringId, ringId), eq(judgeSessions.claimHash, claim)))
    .orderBy(desc(judgeSessions.createdAt))
    .limit(1);
  if (!row) return { status: "none", ringName: ring.name };

  const base = { ringName: ring.name, seat: row.seat, judgeName: row.judgeName, endReason: row.endReason };
  if (row.status !== "approved") {
    return { ...base, status: row.status as JudgeStatus["status"] };
  }
  if (!row.expiresAt || row.expiresAt <= new Date()) {
    return { ...base, status: "ended", endReason: "expired" };
  }

  // Approved and this browser holds the claim: collect the session, once.
  const token2 = newSessionToken();
  const [minted] = await db
    .update(judgeSessions)
    .set({ tokenHash: hashToken(token2), claimHash: null })
    .where(and(eq(judgeSessions.id, row.id), isNull(judgeSessions.tokenHash)))
    .returning({ id: judgeSessions.id });
  if (!minted) return { status: "none", ringName: ring.name };
  const maxAge = Math.max(60, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000));
  await setSessionCookie(SESSION_COOKIES.judge, token2, maxAge);
  return { ...base, status: "approved" };
}

const seatRequestSchema = z
  .object({
    ringId: z.string().uuid(),
    key: z.string().trim().max(200).optional(),
    pin: z.string().trim().max(12).optional(),
    name: z.string().trim().min(1, "Enter your name").max(60),
    seat: z.coerce.number().int().min(1).max(JUDGE_PANEL_SEATS),
  })
  .refine((v) => Boolean(v.key || v.pin), { message: "Scan the tatami QR code or enter its PIN" });

/** A phone asks for a seat. The QR key or the tatami PIN proves it is at the tatami. */
export async function requestJudgeSeat(input: z.input<typeof seatRequestSchema>) {
  let params: z.output<typeof seatRequestSchema>;
  try {
    params = parseInput(seatRequestSchema, input, "judge request");
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : "Invalid request" };
  }

  const limits = [
    { key: `judge-pin:ring:${params.ringId}`, ...RATE_LIMITS.judgePinPerRing },
    { key: `judge-pin:addr:${await clientAddress()}`, ...RATE_LIMITS.judgePinPerAddress },
  ];
  if (isBlocked(limits)) return { success: false as const, error: TOO_MANY_ATTEMPTS };

  const [ring] = await db
    .select({ id: rings.id, name: rings.name, pin: rings.judgePin, key: rings.judgePairingKey, tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, params.ringId))
    .limit(1);
  const valid =
    Boolean(ring) &&
    (params.key ? secretsMatch(params.key, ring!.key) : secretsMatch(params.pin ?? "", ring!.pin.trim()));
  if (!ring || !valid) {
    recordFailure(limits);
    return {
      success: false as const,
      error: params.key ? "This QR code is no longer valid. Ask the desk for the current one." : "Wrong tatami PIN.",
    };
  }

  const judge = await getJudgePrincipal();
  if (judge && judge.ringId === ring.id) {
    return { success: true as const, status: "approved" as const, seat: judge.seat, ringName: ring.name };
  }

  const [{ pending }] = await db
    .select({ pending: count() })
    .from(judgeSessions)
    .where(and(eq(judgeSessions.ringId, ring.id), eq(judgeSessions.status, "pending")));
  if (pending >= MAX_PENDING_JUDGE_REQUESTS) {
    return { success: false as const, error: "Too many phones are waiting on this tatami. Ask the desk to clear them." };
  }

  // A browser has at most one open request per tatami: withdraw the old one.
  const previousClaim = await currentClaimHash("judge");
  if (previousClaim) {
    await db
      .update(judgeSessions)
      .set({ status: "ended", endReason: "withdrawn", endedAt: new Date(), claimHash: null })
      .where(
        and(
          eq(judgeSessions.ringId, ring.id),
          eq(judgeSessions.claimHash, previousClaim),
          eq(judgeSessions.status, "pending")
        )
      );
  }

  const claimHash = await issueClaim("judge");
  const [row] = await db
    .insert(judgeSessions)
    .values({ ringId: ring.id, seat: params.seat, judgeName: params.name, claimHash, status: "pending" })
    .returning({ id: judgeSessions.id });

  broadcastLiveEvent({ table: "judge_sessions", op: "INSERT", id: row.id, ringId: ring.id, status: "pending" });
  return { success: true as const, status: "pending" as const, seat: params.seat, ringName: ring.name };
}

/** The bout this judge may vote on right now, and their own vote. Nothing else. */
export async function getJudgeBout(ringId: string) {
  const judge = await requireJudge(ringId);

  const [ring] = await db
    .select({ name: rings.name, currentMatchId: rings.currentMatchId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  const base = { success: true as const, ringName: ring?.name ?? "Tatami", seat: judge.seat, judgeName: judge.name };

  const [assignment] = await db
    .select({ categoryId: categoryAssignments.categoryId })
    .from(categoryAssignments)
    .where(and(eq(categoryAssignments.ringId, ringId), inArray(categoryAssignments.status, ["running", "paused"])))
    .limit(1);
  if (!assignment || !ring?.currentMatchId) return { ...base, category: null, bout: null, myVote: null };

  const [category] = await db
    .select({ name: categories.name, eventType: categories.eventType })
    .from(categories)
    .where(eq(categories.id, assignment.categoryId))
    .limit(1);
  if (!category || !isKataCategory(category)) {
    return { ...base, category: category?.name ?? null, bout: null, myVote: null };
  }

  const [match] = await db
    .select({
      id: matches.id,
      matchNo: matches.matchNo,
      roundName: matches.roundName,
      poolGroup: matches.poolGroup,
      status: matches.status,
      kataVoting: matches.kataVoting,
      akaKataName: matches.akaKataName,
      aoKataName: matches.aoKataName,
    })
    .from(matches)
    .where(and(eq(matches.id, ring.currentMatchId), eq(matches.categoryId, assignment.categoryId)))
    .limit(1);
  if (!match) return { ...base, category: category.name, bout: null, myVote: null };

  const ctx = await kataBoutContext(match.id);
  const slots = await db
    .select({ position: matchSlots.position, athleteId: matchSlots.athleteId })
    .from(matchSlots)
    .where(eq(matchSlots.matchId, match.id))
    .orderBy(asc(matchSlots.position));
  const ids = slots.map((s) => s.athleteId).filter((id): id is string => Boolean(id));
  const people = await withGuestMarks(
    ids.length
      ? await db
          .select({ id: athletes.id, name: athletes.name, school: athletes.school, dojo: athletes.dojo })
          .from(athletes)
          .where(inArray(athletes.id, ids))
      : [],
    [assignment.categoryId]
  );
  const person = (position: number) => {
    const id = slots.find((s) => s.position === position)?.athleteId;
    const a = people.find((p) => p.id === id);
    return a ? { name: a.name, school: a.school || a.dojo || null } : null;
  };

  const mine = await db
    .select({
      side: kataScores.targetSide,
      flag: kataScores.flagVote,
      score: kataScores.numericScore,
      overridden: kataScores.isOverridden,
    })
    .from(kataScores)
    .where(and(eq(kataScores.matchId, match.id), eq(kataScores.judgeSeat, judge.seat)));
  const mark = (side: "AKA" | "AO") => {
    const r = mine.find((m) => m.side === side && m.score !== null);
    return r ? Number(r.score) : null;
  };

  return {
    ...base,
    category: category.name,
    bout: {
      matchId: match.id,
      matchNo: match.matchNo,
      roundName: match.roundName,
      poolGroup: match.poolGroup,
      mode: ctx?.mode ?? "FLAG",
      solo: ctx?.solo ?? false,
      aka: { ...(person(1) ?? { name: "AKA", school: null }), kata: match.akaKataName },
      ao: ctx?.solo ? null : { ...(person(2) ?? { name: "AO", school: null }), kata: match.aoKataName },
      voting: match.status === "CONFIRMED" ? ("closed" as const) : (match.kataVoting as "idle" | "open" | "closed"),
      finished: match.status === "CONFIRMED",
    },
    myVote: {
      flag: (mine.find((m) => m.flag === "AKA" || m.flag === "AO")?.flag as "AKA" | "AO" | undefined) ?? null,
      aka: mark("AKA"),
      ao: mark("AO"),
      enteredByDesk: mine.some((m) => m.overridden),
    },
  };
}

const markSchema = z
  .number()
  .min(KATA_MARK_MIN)
  .max(KATA_MARK_MAX)
  .refine((n) => Math.abs(Math.round(n * 10) - n * 10) < 1e-6, "Marks go in steps of 0.1");

const voteSchema = z.object({
  matchId: z.string().min(1).max(100),
  flag: z.enum(["AKA", "AO"]).optional(),
  aka: markSchema.optional(),
  ao: markSchema.optional(),
});

/**
 * A judge casts or changes their vote on the open bout, for their own seat.
 * FLAG bouts take a flag; POINTS bouts take a mark per side.
 */
export async function submitJudgeVote(input: z.input<typeof voteSchema>) {
  let params: z.output<typeof voteSchema>;
  try {
    params = parseInput(voteSchema, input, "vote");
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : "Invalid vote" };
  }

  const scope = await scopeForMatch(params.matchId);
  if (!scope.ringId) return { success: false as const, error: "This bout is not on a tatami." };
  const judge = await requireJudge(scope.ringId);

  const [match] = await db
    .select({ status: matches.status, voting: matches.kataVoting, currentMatchId: rings.currentMatchId })
    .from(matches)
    .innerJoin(rings, eq(rings.id, judge.ringId))
    .where(eq(matches.id, params.matchId))
    .limit(1);
  if (!match || match.currentMatchId !== params.matchId || scope.assignmentStatus !== "running") {
    return { success: false as const, error: "This is not the bout on the mat." };
  }
  if (match.status === "CONFIRMED" || match.voting !== "open") {
    return { success: false as const, error: "Voting is closed for this bout." };
  }

  const ctx = await kataBoutContext(params.matchId);
  if (!ctx) return { success: false as const, error: "Bout not found" };
  if (ctx.mode === "FLAG" && !params.flag) return { success: false as const, error: "Choose AKA or AO." };
  if (ctx.mode === "POINTS" && params.aka === undefined && params.ao === undefined) {
    return { success: false as const, error: "Enter a mark." };
  }
  if (ctx.mode === "POINTS" && ctx.solo && params.ao !== undefined) {
    return { success: false as const, error: "This is a solo performance; there is no AO mark." };
  }

  const seatRows = await db
    .select()
    .from(kataScores)
    .where(and(eq(kataScores.matchId, params.matchId), eq(kataScores.judgeSeat, judge.seat)));
  if (seatRows.some((r) => r.isOverridden)) {
    return {
      success: false as const,
      error: "The desk entered the mark for your seat. Ask the moderator to void it if you need to vote.",
    };
  }
  const before = seatRows.map((r) => ({ side: r.targetSide, flag: r.flagVote, score: r.numericScore }));

  const write = async (side: "AKA" | "AO" | "BOTH", values: { flagVote: string | null; numericScore: string | null; scoreType: string }) => {
    await db
      .insert(kataScores)
      .values({
        matchId: params.matchId,
        judgeSeat: judge.seat,
        targetSide: side,
        judgeSessionId: judge.sessionId,
        judgeName: judge.name,
        isOverridden: false,
        ...values,
      })
      .onConflictDoUpdate({
        target: [kataScores.matchId, kataScores.judgeSeat, kataScores.targetSide],
        set: { ...values, judgeSessionId: judge.sessionId, judgeName: judge.name, isOverridden: false },
      });
  };

  if (ctx.mode === "FLAG") {
    await write("BOTH", { flagVote: params.flag!, numericScore: null, scoreType: "FLAG" });
  } else {
    if (params.aka !== undefined) await write("AKA", { flagVote: null, numericScore: params.aka.toFixed(2), scoreType: "POINT" });
    if (params.ao !== undefined) await write("AO", { flagVote: null, numericScore: params.ao.toFixed(2), scoreType: "POINT" });
  }

  await recomputeKataTallies(params.matchId);
  await audit({
    tournamentId: scope.tournamentId,
    ringId: scope.ringId,
    categoryId: scope.categoryId,
    matchId: params.matchId,
    actor: { role: "judge", id: judge.sessionId, name: `${judge.name} (seat ${judge.seat})` },
    action: "KATA_VOTE",
    targetType: "match",
    targetId: params.matchId,
    before: before.length ? before : null,
    after: { seat: judge.seat, flag: params.flag ?? null, aka: params.aka ?? null, ao: params.ao ?? null },
  });
  broadcastLiveEvent({ table: "kata_scores", op: "UPDATE", id: params.matchId, matchId: params.matchId, ringId: scope.ringId, tournamentId: scope.tournamentId });
  broadcastLiveEvent({ table: "matches", op: "UPDATE", id: params.matchId, matchId: params.matchId, ringId: scope.ringId, tournamentId: scope.tournamentId });
  return { success: true as const };
}

/** The judge leaves the panel from their own phone. */
export async function leaveJudgePanel(ringId: string) {
  const judge = await getJudgePrincipal();
  await clearCookies(SESSION_COOKIES.judge);
  if (!judge || judge.ringId !== ringId) return { success: true as const };

  await db
    .update(judgeSessions)
    .set({ status: "ended", endReason: "left", endedAt: new Date() })
    .where(eq(judgeSessions.id, judge.sessionId));
  await audit({
    tournamentId: judge.tournamentId,
    ringId,
    actor: { role: "judge", id: judge.sessionId, name: `${judge.name} (seat ${judge.seat})` },
    action: "JUDGE_LEFT",
    targetType: "judge_session",
    targetId: judge.sessionId,
  });
  broadcastJudgeSession(judge.sessionId, ringId, "ended");
  return { success: true as const };
}
