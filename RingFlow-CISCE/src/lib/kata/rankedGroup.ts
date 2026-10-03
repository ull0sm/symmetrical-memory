/**
 * A Local ranked kata group on the mat: its standings, read from the bouts and
 * the judges' marks; confirming a pair's performances (a ranked bout has no
 * winner); and the desk's decisions on ties that decide a medal.
 * No authorization here: the kata and moderator actions check the caller.
 */
import { and, asc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { athletes, categories, kataScores, kataTieDecisions, matches, matchSlots, rings } from "@/db/schema";
import type { KataTieMethod } from "@/lib/statuses";
import { announcePoolBout, countPoolBout, type KataActor } from "./finalize";
import { rankPerformances, tieKeyOf, type MedalTie, type Performance, type Ranking } from "./ranking";
import { calculateKataScoreDeducing } from "./scoringEngine";

export interface RankedPerformer extends Performance {
  name: string;
  club: string | null;
  chestNumber: string | null;
  matchId: string;
  matchNo: number;
  side: "AKA" | "AO";
}

export interface RankedStandings extends Ranking {
  categoryId: string;
  name: string;
  bronzeMedals: 1 | 2;
  /** In performance order. */
  performers: RankedPerformer[];
  decisions: { athleteIds: string[]; method: string; note: string; decidedBy: string | null; decidedAt: string }[];
}

/** Whether a category is a Local ranked kata group. */
export async function isRankedGroup(categoryId: string): Promise<boolean> {
  const [row] = await db.select({ format: categories.kataFormat }).from(categories).where(eq(categories.id, categoryId));
  return row?.format === "RANKED";
}

/** The group's standings, or null if it isn't a ranked kata group. */
export async function loadRankedStandings(categoryId: string): Promise<RankedStandings | null> {
  const [cat] = await db
    .select({ id: categories.id, name: categories.name, format: categories.kataFormat, bronze: categories.bronzeMedals })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!cat || cat.format !== "RANKED") return null;

  const bouts = await db.select().from(matches).where(eq(matches.categoryId, categoryId)).orderBy(asc(matches.matchNo));
  const boutIds = bouts.map((b) => b.id);
  const [slots, marks, decisionRows] = await Promise.all([
    boutIds.length ? db.select().from(matchSlots).where(inArray(matchSlots.matchId, boutIds)) : [],
    boutIds.length
      ? db
          .select({ matchId: kataScores.matchId, side: kataScores.targetSide, score: kataScores.numericScore })
          .from(kataScores)
          .where(and(inArray(kataScores.matchId, boutIds), isNotNull(kataScores.numericScore)))
      : [],
    db.select().from(kataTieDecisions).where(eq(kataTieDecisions.categoryId, categoryId)),
  ]);
  const athleteIds = [...new Set(slots.map((s) => s.athleteId).filter((id): id is string => Boolean(id)))];
  const people = athleteIds.length
    ? await db
        .select({ id: athletes.id, name: athletes.name, school: athletes.school, dojo: athletes.dojo, chestNumber: athletes.chestNumber })
        .from(athletes)
        .where(inArray(athletes.id, athleteIds))
    : [];
  const person = new Map(people.map((p) => [p.id, p]));

  const performers: RankedPerformer[] = [];
  for (const bout of bouts) {
    for (const [position, side] of [[1, "AKA"], [2, "AO"]] as const) {
      const athleteId = slots.find((s) => s.matchId === bout.id && s.position === position)?.athleteId;
      if (!athleteId) continue;
      const judged = marks
        .filter((m) => m.matchId === bout.id && m.side === side)
        .map((m) => Number(m.score))
        .filter((m) => Number.isFinite(m) && m > 0);
      // Judge marks decide the total; without them, a total the desk typed from a paper sheet.
      const tally = calculateKataScoreDeducing(judged);
      const typedTotal = side === "AKA" ? bout.akaScoreTotal : bout.aoScoreTotal;
      const total = tally.hasSufficientMarks ? tally.total : typedTotal === null ? null : Number(typedTotal);
      const p = person.get(athleteId);
      performers.push({
        athleteId,
        marks: judged,
        total,
        done: bout.status === "CONFIRMED",
        name: p?.name ?? "Athlete",
        club: p?.school ?? p?.dojo ?? null,
        chestNumber: p?.chestNumber ?? null,
        matchId: bout.id,
        matchNo: bout.matchNo,
        side,
      });
    }
  }

  const bronzeMedals = cat.bronze === 1 ? 1 : 2;
  const decisions = decisionRows.map((d) => ({
    athleteIds: d.athleteIds,
    method: d.method,
    note: d.note,
    decidedBy: d.decidedBy,
    decidedAt: d.decidedAt.toISOString(),
  }));
  return {
    categoryId,
    name: cat.name,
    bronzeMedals,
    performers,
    decisions,
    ...rankPerformances(performers, { bronzeMedals, decisions }),
  };
}

/**
 * Confirms a ranked bout: each athlete's performance stands on its own, so there
 * is no winner. The next pair comes up on the tatami.
 */
export async function confirmRankedBout(matchId: string, actor?: KataActor) {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { success: false as const, error: "Bout not found" };
  await db
    .update(matches)
    .set({ status: "CONFIRMED", winnerSide: null, winnerId: null, decisionMethod: "RANKED", kataVoting: "closed" })
    .where(eq(matches.id, matchId));

  const assignment = await countPoolBout(match);
  if (assignment) {
    await announcePoolBout(assignment, match, { winnerId: null, winnerSide: null }, actor);
    const [next] = await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.categoryId, match.categoryId), notInArray(matches.status, ["CONFIRMED", "COMPLETED", "BYE"])))
      .orderBy(asc(matches.matchNo))
      .limit(1);
    await db.update(rings).set({ currentMatchId: next?.id ?? null }).where(eq(rings.id, assignment.ringId));
  }
  return { success: true as const };
}

/** The medal tie these athletes form in the group's standings, decided or not. */
export function findMedalTie(standings: RankedStandings, athleteIds: readonly string[]): MedalTie | null {
  const key = tieKeyOf(athleteIds);
  return standings.medalTies.find((t) => tieKeyOf(t.athleteIds) === key) ?? null;
}

/** Records (or replaces) the desk's order for a medal tie. Returns the order it replaced, if any. */
export async function saveTieDecision(
  categoryId: string,
  decision: { athleteIds: string[]; method: KataTieMethod; note: string; decidedBy: string }
): Promise<string[] | null> {
  const tieKey = tieKeyOf(decision.athleteIds);
  const [before] = await db
    .select({ athleteIds: kataTieDecisions.athleteIds })
    .from(kataTieDecisions)
    .where(and(eq(kataTieDecisions.categoryId, categoryId), eq(kataTieDecisions.tieKey, tieKey)));
  const values = { athleteIds: decision.athleteIds, method: decision.method, note: decision.note, decidedBy: decision.decidedBy, decidedAt: new Date() };
  await db
    .insert(kataTieDecisions)
    .values({ categoryId, tieKey, ...values })
    .onConflictDoUpdate({ target: [kataTieDecisions.categoryId, kataTieDecisions.tieKey], set: values });
  return before?.athleteIds ?? null;
}
