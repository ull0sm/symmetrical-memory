import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, kataScores, matches, matchSlots } from "@/db/schema";
import { calculateKataScoreDeducing } from "./scoringEngine";

/**
 * Server-side kata result for one bout, computed from its `kata_scores` rows.
 * Clients never send totals: judge phones send their own mark, the desk sends
 * marks or flags, and everything shown as a total comes from here.
 */

export type KataMode = "FLAG" | "POINTS";
export type KataWinner = "AKA" | "AO" | "TIE" | null;

export const MAX_JUDGE_SEATS = 7;
/** A flag decision needs at least this many flags raised. */
const MIN_FLAGS_FOR_DECISION = 3;

export type KataTally = {
  mode: KataMode;
  /** Pool performance with no AO athlete. */
  solo: boolean;
  akaFlags: number;
  aoFlags: number;
  /** Marks by seat (index 0 = seat 1). */
  akaMarks: (number | null)[];
  aoMarks: (number | null)[];
  akaTotal: number | null;
  aoTotal: number | null;
  akaDropped: number[];
  aoDropped: number[];
  /** Decided by the marks/flags; TIE or null means the desk must decide. */
  winner: KataWinner;
};

type ScoreRow = Pick<
  typeof kataScores.$inferSelect,
  "judgeSeat" | "targetSide" | "flagVote" | "numericScore"
>;

export function tallyKataScores(rows: ScoreRow[], mode: KataMode, solo: boolean): KataTally {
  const akaMarks: (number | null)[] = Array(MAX_JUDGE_SEATS).fill(null);
  const aoMarks: (number | null)[] = Array(MAX_JUDGE_SEATS).fill(null);
  const flagBySeat = new Map<number, "AKA" | "AO">();

  for (const r of rows) {
    const seat = r.judgeSeat;
    if (!Number.isInteger(seat) || seat < 1 || seat > MAX_JUDGE_SEATS) continue;
    // One flag per seat, whichever row carries it (older desk entries wrote
    // the same flag on both an AKA and an AO row).
    if (r.flagVote === "AKA" || r.flagVote === "AO") flagBySeat.set(seat, r.flagVote);
    const mark = r.numericScore === null ? NaN : Number(r.numericScore);
    if (Number.isFinite(mark) && mark > 0) {
      if (r.targetSide === "AKA") akaMarks[seat - 1] = mark;
      if (r.targetSide === "AO") aoMarks[seat - 1] = mark;
    }
  }

  let akaFlags = 0;
  let aoFlags = 0;
  for (const f of flagBySeat.values()) {
    if (f === "AKA") akaFlags++;
    else aoFlags++;
  }

  const aka = calculateKataScoreDeducing(akaMarks);
  const ao = calculateKataScoreDeducing(aoMarks);
  const akaTotal = aka.hasSufficientMarks ? aka.total : null;
  const aoTotal = ao.hasSufficientMarks ? ao.total : null;

  let winner: KataWinner = null;
  if (mode === "POINTS") {
    if (solo) winner = akaTotal !== null ? "AKA" : null;
    else if (akaTotal !== null && aoTotal !== null) {
      winner = akaTotal > aoTotal ? "AKA" : aoTotal > akaTotal ? "AO" : "TIE";
    }
  } else if (solo) {
    winner = "AKA";
  } else if (akaFlags + aoFlags >= MIN_FLAGS_FOR_DECISION) {
    winner = akaFlags > aoFlags ? "AKA" : aoFlags > akaFlags ? "AO" : "TIE";
  }

  return {
    mode,
    solo,
    akaFlags,
    aoFlags,
    akaMarks,
    aoMarks,
    akaTotal,
    aoTotal,
    akaDropped: aka.droppedIndices.map((i) => i + 1),
    aoDropped: ao.droppedIndices.map((i) => i + 1),
    winner,
  };
}

/** How a kata bout is scored and whether it has an opponent. */
export async function kataBoutContext(matchId: string): Promise<{ mode: KataMode; solo: boolean } | null> {
  const [row] = await db
    .select({ matchMode: matches.kataScoringMode, categoryMode: categories.kataScoringMode })
    .from(matches)
    .innerJoin(categories, eq(categories.id, matches.categoryId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) return null;
  const [aoSlot] = await db
    .select({ athleteId: matchSlots.athleteId })
    .from(matchSlots)
    .where(and(eq(matchSlots.matchId, matchId), eq(matchSlots.position, 2)))
    .limit(1);
  // Same rule the desk has always used: POINTS if either the bout or its category says so.
  const mode: KataMode = row.matchMode === "POINTS" || row.categoryMode === "POINTS" ? "POINTS" : "FLAG";
  return { mode, solo: !aoSlot?.athleteId };
}

export async function computeKataTally(matchId: string): Promise<KataTally | null> {
  const ctx = await kataBoutContext(matchId);
  if (!ctx) return null;
  const rows = await db
    .select({
      judgeSeat: kataScores.judgeSeat,
      targetSide: kataScores.targetSide,
      flagVote: kataScores.flagVote,
      numericScore: kataScores.numericScore,
    })
    .from(kataScores)
    .where(eq(kataScores.matchId, matchId));
  return tallyKataScores(rows, ctx.mode, ctx.solo);
}

/**
 * Re-total a bout from its judge rows and store the result on the match:
 * flag counts, point totals, and which marks were dropped (min/max).
 */
export async function recomputeKataTallies(matchId: string): Promise<KataTally | null> {
  const tally = await computeKataTally(matchId);
  if (!tally) return null;

  // A side with no judge marks keeps whatever total the desk typed in from a
  // paper sheet (pool score sheet); marks, once present, always win.
  const hasMarks = (marks: (number | null)[]) => marks.some((m) => m !== null);
  const set: Partial<typeof matches.$inferInsert> = { akaFlags: tally.akaFlags, aoFlags: tally.aoFlags };
  if (hasMarks(tally.akaMarks)) set.akaScoreTotal = tally.akaTotal === null ? null : tally.akaTotal.toFixed(2);
  if (hasMarks(tally.aoMarks)) set.aoScoreTotal = tally.aoTotal === null ? null : tally.aoTotal.toFixed(2);
  await db.update(matches).set(set).where(eq(matches.id, matchId));

  if (tally.mode === "POINTS") {
    await db.update(kataScores).set({ isDropped: false }).where(eq(kataScores.matchId, matchId));
    for (const [side, seats] of [
      ["AKA", tally.akaDropped],
      ["AO", tally.aoDropped],
    ] as const) {
      for (const seat of seats) {
        await db
          .update(kataScores)
          .set({ isDropped: true })
          .where(
            and(eq(kataScores.matchId, matchId), eq(kataScores.judgeSeat, seat), eq(kataScores.targetSide, side))
          );
      }
    }
  }
  return tally;
}
