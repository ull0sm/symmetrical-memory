/**
 * The ranking of a Local ranked kata group: everyone performs once, and the
 * marks decide the order and the medals. Pure: `rankedGroup.ts` reads the rows.
 *
 * Order: higher total; then, when 5 or 7 judges marked, the higher of the
 * lowest dropped marks; then the higher of the highest dropped marks. A tie
 * still standing after that is shared ("5="), unless it decides a medal: then
 * the moderator records a desk decision (after a re-performance or a flag vote),
 * and until they do the podium is not final. An athlete with no total once
 * their bout is confirmed didn't perform: they rank last, with no medal.
 */

export type Medal = "gold" | "silver" | "bronze";
export type TieBreak = "lowest dropped mark" | "highest dropped mark" | "desk decision";

export interface Performance {
  athleteId: string;
  /** Every mark the judges gave, kept and dropped. Empty when the desk typed only a total. */
  marks: number[];
  /** The performance's total, or null when there is none (yet, or the athlete didn't perform). */
  total: number | null;
  /** The bout is confirmed: a null total then means the athlete didn't perform. */
  done: boolean;
}

export interface TieDecision {
  /** The tied athletes, best first. */
  athleteIds: string[];
}

export interface Standing {
  athleteId: string;
  total: number | null;
  /** Shared by a tie (1, 2, 2, 4); null until the athlete has a total, or if they didn't perform. */
  position: number | null;
  /** "1", "5=", "DNP" (did not perform), or "" while waiting to perform. */
  label: string;
  medal: Medal | null;
  status: "ranked" | "waiting" | "did-not-perform";
  /** How this athlete was told apart from someone on the same total. */
  separatedBy: TieBreak | null;
}

export interface MedalTie {
  /** The tied athletes, in the order they were performed or decided. */
  athleteIds: string[];
  /** The position they tie for (2 = tied for second). */
  position: number;
  /** The medals at stake, one per tied position. */
  medals: (Medal | null)[];
  /** The desk has decided it. */
  decided: boolean;
}

export interface Ranking {
  standings: Standing[];
  /** Ties that decide a medal, decided or not. */
  medalTies: MedalTie[];
  /** Every bout is confirmed. */
  complete: boolean;
  /** Complete, and every tie that decides a medal is decided: the podium stands. */
  final: boolean;
}

/** The medals of a group by finishing position: the event's bronze setting decides ranks 3 and 4. */
export function medalsByPosition(groupSize: number, bronzeMedals: 1 | 2): Medal[] {
  const medals: Medal[] = ["gold", "silver", "bronze"];
  if (groupSize >= 4 && bronzeMedals === 2) medals.push("bronze");
  return medals.slice(0, Math.max(0, Math.min(groupSize, medals.length)));
}

/** The key of a set of tied athletes: their ids, sorted. */
export function tieKeyOf(athleteIds: readonly string[]): string {
  return [...athleteIds].sort().join(",");
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The dropped marks, as the tally drops them: one each side for 5 or 6 marks, two for 7. */
function droppedMarks(marks: readonly number[]): { low: number[]; high: number[] } | null {
  const valid = marks.filter((m) => Number.isFinite(m) && m > 0).map(round2);
  const drop = valid.length >= 7 ? 2 : valid.length >= 5 ? 1 : 0;
  if (drop === 0) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  return { low: sorted.slice(0, drop), high: sorted.slice(sorted.length - drop).reverse() };
}

/** Higher first: compares element by element, the first difference decides. */
function compareDesc(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return (b[i] as number) - (a[i] as number);
  }
  return 0;
}

interface Keyed {
  p: Performance;
  total: number;
  dropped: { low: number[]; high: number[] } | null;
}

/** Negative when `a` ranks above `b`, with what decided it. */
function compare(a: Keyed, b: Keyed): { order: number; by: TieBreak | "total" | null } {
  if (a.total !== b.total) return { order: b.total - a.total, by: "total" };
  if (a.dropped && b.dropped) {
    const low = compareDesc(a.dropped.low, b.dropped.low);
    if (low !== 0) return { order: low, by: "lowest dropped mark" };
    const high = compareDesc(a.dropped.high, b.dropped.high);
    if (high !== 0) return { order: high, by: "highest dropped mark" };
  }
  return { order: 0, by: null };
}

export function rankPerformances(
  performances: readonly Performance[],
  options: { bronzeMedals: 1 | 2; decisions?: readonly TieDecision[] }
): Ranking {
  const medals = medalsByPosition(performances.length, options.bronzeMedals);
  const medalAt = (position: number): Medal | null => medals[position - 1] ?? null;
  const decisionFor = new Map((options.decisions ?? []).map((d) => [tieKeyOf(d.athleteIds), d]));

  const keyed: Keyed[] = performances
    .filter((p) => p.total !== null)
    .map((p) => ({ p, total: round2(p.total as number), dropped: droppedMarks(p.marks) }));
  // Stable: athletes still level keep the order they were given in.
  keyed.sort((a, b) => compare(a, b).order);

  const standings: Standing[] = [];
  const medalTies: MedalTie[] = [];
  const separatedBy = new Map<string, TieBreak>();
  // Who was told apart from a neighbour on the same total, and how.
  for (let i = 1; i < keyed.length; i += 1) {
    const { by } = compare(keyed[i - 1] as Keyed, keyed[i] as Keyed);
    if (by === "lowest dropped mark" || by === "highest dropped mark") {
      for (const k of [keyed[i - 1] as Keyed, keyed[i] as Keyed]) if (!separatedBy.has(k.p.athleteId)) separatedBy.set(k.p.athleteId, by);
    }
  }

  let i = 0;
  while (i < keyed.length) {
    let j = i + 1;
    while (j < keyed.length && compare(keyed[i] as Keyed, keyed[j] as Keyed).order === 0) j += 1;
    const tied = keyed.slice(i, j);
    const position = i + 1;
    const at = tied.map((_, k) => medalAt(position + k));
    const decidesMedal = tied.length > 1 && at.some((m) => m !== at[0]);

    if (!decidesMedal) {
      const label = tied.length > 1 ? `${position}=` : String(position);
      for (const k of tied) {
        standings.push({ athleteId: k.p.athleteId, total: k.total, position, label, medal: at[0] ?? null, status: "ranked", separatedBy: separatedBy.get(k.p.athleteId) ?? null });
      }
    } else {
      const ids = tied.map((k) => k.p.athleteId);
      const decision = decisionFor.get(tieKeyOf(ids));
      if (decision) {
        decision.athleteIds.forEach((id, k) => {
          const total = tied.find((t) => t.p.athleteId === id)?.total ?? null;
          standings.push({ athleteId: id, total, position: position + k, label: String(position + k), medal: medalAt(position + k), status: "ranked", separatedBy: "desk decision" });
        });
      } else {
        for (const k of tied) {
          standings.push({ athleteId: k.p.athleteId, total: k.total, position, label: `${position}=`, medal: null, status: "ranked", separatedBy: null });
        }
      }
      medalTies.push({ athleteIds: decision ? [...decision.athleteIds] : ids, position, medals: at, decided: Boolean(decision) });
    }
    i = j;
  }

  for (const p of performances) {
    if (p.total !== null) continue;
    standings.push(
      p.done
        ? { athleteId: p.athleteId, total: null, position: null, label: "DNP", medal: null, status: "did-not-perform", separatedBy: null }
        : { athleteId: p.athleteId, total: null, position: null, label: "", medal: null, status: "waiting", separatedBy: null }
    );
  }

  const complete = performances.every((p) => p.done);
  return { standings, medalTies, complete, final: complete && medalTies.every((t) => t.decided) };
}
