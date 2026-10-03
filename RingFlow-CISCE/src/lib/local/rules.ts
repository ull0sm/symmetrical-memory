/**
 * Pure rules for Local tournaments: how divisions are named and matched, how an
 * event's athletes split into starting groups, and what a group is expected to
 * cost in bouts. No database and no request context, so they are unit tested
 * and shared by the cores, the actions and the screens.
 *
 * Naming: a division is what the Local UI calls a "Category" (an age, belt and
 * sex block). A group is an ordinary `categories` row of one division event.
 */
import { createRng, shuffle } from "@/engine/draw-engine/seeding";
import type { DivisionEventType, DivisionSex } from "@/lib/statuses";

export interface DivisionShape {
  sex: DivisionSex | string;
  ageMin: number | null;
  ageMax: number | null;
  belts: readonly string[];
}

const SEX_LABEL: Record<string, string> = { M: "M", F: "F", any: "Mixed" };

/** "Blue · 9 · M", "White + Yellow · 6–7 · F", "Any belt · 12+ · Mixed". */
export function divisionName(d: DivisionShape): string {
  const belts = d.belts.length === 0 ? "Any belt" : d.belts.join(" + ");
  let ages: string;
  if (d.ageMin !== null && d.ageMax !== null) ages = d.ageMin === d.ageMax ? `${d.ageMin}` : `${d.ageMin}–${d.ageMax}`;
  else if (d.ageMin !== null) ages = `${d.ageMin}+`;
  else if (d.ageMax !== null) ages = `${d.ageMax} and under`;
  else ages = "All ages";
  return `${belts} · ${ages} · ${SEX_LABEL[d.sex] ?? "Mixed"}`;
}

/** A group's display name: the division, the event, the group number. */
export function groupName(division: string, eventType: DivisionEventType, groupNo: number): string {
  return `${division} · ${eventType === "kata" ? "Kata" : "Kumite"} · Group ${groupNo}`;
}

/** M, F or unknown, from what a roster sheet or a form says. */
export function normalizeSex(value: unknown): "M" | "F" | null {
  const s = String(value ?? "").trim().toLowerCase();
  if (["m", "male", "boy", "boys", "b"].includes(s)) return "M";
  if (["f", "female", "girl", "girls", "g"].includes(s)) return "F";
  return null;
}

/** A whole-number age from a sheet cell ("9", "9 yrs", 9.0), or null. */
export function normalizeAge(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 120 ? Math.floor(n) : null;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The belt as written in the tournament's belt list, matched without regard to case; null when it is not in the list. */
export function canonicalBelt(belt: unknown, beltLevels: readonly string[]): string | null {
  const s = String(belt ?? "").trim();
  if (!s) return null;
  return beltLevels.find((b) => sameText(b, s)) ?? null;
}

export interface AthleteShape {
  age: number | null;
  belt: string | null;
  sex: "M" | "F" | null;
}

/** Whether an athlete fits a division: age within its bounds, belt listed (or any), sex matching (or mixed). */
export function fitsDivision(d: DivisionShape, a: AthleteShape): boolean {
  if (d.sex !== "any" && d.sex !== a.sex) return false;
  if (d.ageMin !== null || d.ageMax !== null) {
    if (a.age === null) return false;
    if (d.ageMin !== null && a.age < d.ageMin) return false;
    if (d.ageMax !== null && a.age > d.ageMax) return false;
  }
  if (d.belts.length > 0) {
    if (a.belt === null || !d.belts.some((b) => sameText(b, a.belt as string))) return false;
  }
  return true;
}

/** The first division (in the order given) an athlete fits, and how many fit; the import reports ambiguity. */
export function matchDivision<D extends DivisionShape & { id: string }>(
  divisions: readonly D[],
  athlete: AthleteShape,
): { division: D | null; matches: number } {
  const fitting = divisions.filter((d) => fitsDivision(d, athlete));
  return { division: fitting[0] ?? null, matches: fitting.length };
}

/** Group sizes for `count` athletes and a target size: as few groups as fit, sizes within one of each other, larger first. */
export function planGroupSizes(count: number, groupSize: number): number[] {
  if (count <= 0) return [];
  const size = Math.max(1, Math.floor(groupSize));
  const groups = Math.ceil(count / size);
  const base = Math.floor(count / groups);
  const extra = count % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface GroupMember {
  id: string;
  club: string | null;
}

/**
 * Deals athletes into groups of the given sizes, spreading each club across the
 * groups: the biggest clubs are dealt first, each athlete to the group with the
 * fewest of their club, then the fewest athletes. Athletes with no club are each
 * their own club. Deterministic for a given seed whatever the input order.
 */
export function distributeIntoGroups(members: readonly GroupMember[], sizes: readonly number[], seed: number): string[][] {
  const groups: string[][] = sizes.map(() => []);
  if (sizes.length === 0) return groups;

  const rng = createRng(seed);
  const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shuffled = shuffle(sorted, rng);

  const clubKey = (m: GroupMember) => {
    const c = (m.club ?? "").trim().toLowerCase();
    return c === "" ? `independent:${m.id}` : c;
  };
  const byClub = new Map<string, GroupMember[]>();
  for (const m of shuffled) {
    const list = byClub.get(clubKey(m)) ?? [];
    list.push(m);
    byClub.set(clubKey(m), list);
  }
  const clubs = [...byClub.values()].sort((a, b) => b.length - a.length);

  const clubCount = groups.map(() => new Map<string, number>());
  for (const club of clubs) {
    for (const m of club) {
      const key = clubKey(m);
      let best = -1;
      for (let g = 0; g < groups.length; g += 1) {
        if ((groups[g] as string[]).length >= (sizes[g] as number)) continue;
        if (best === -1) {
          best = g;
          continue;
        }
        const mine = clubCount[g]?.get(key) ?? 0;
        const theirs = clubCount[best]?.get(key) ?? 0;
        if (mine < theirs || (mine === theirs && (groups[g] as string[]).length < (groups[best] as string[]).length)) best = g;
      }
      if (best === -1) continue; // more athletes than places; the sizes are planned from the count, so this never happens
      (groups[best] as string[]).push(m.id);
      clubCount[best]?.set(key, (clubCount[best]?.get(key) ?? 0) + 1);
    }
  }
  return groups;
}

/** Bronzes an event awards: 2 (the Local default) or 1. */
export type LocalBronze = 1 | 2;

/**
 * The bronze option stored on a group and passed to the engine. Kumite: 2
 * bronzes is "both semi-final losers, no bout" (engine 3), 1 is a bronze bout
 * (engine 1). A ranked kata group keeps the count itself (ranks 3 and 4, or 3).
 */
export function engineBronze(eventType: DivisionEventType, bronze: LocalBronze): 1 | 2 | 3 {
  if (eventType === "kata") return bronze;
  return bronze === 2 ? 3 : 1;
}

/** Bouts a group of `n` runs: a knockout fights n - 1 (plus the bronze bout when there is one); a ranked kata group calls its athletes in pairs. */
export function expectedBouts(eventType: DivisionEventType, n: number, bronze: LocalBronze): number {
  if (n <= 0) return 0;
  if (eventType === "kata") return Math.ceil(n / 2);
  return n - 1 + (bronze === 1 && n >= 4 ? 1 : 0);
}

export interface LocalDefaults {
  localBronzeMedals: number;
  localKumiteGroupSize: number;
  localKataGroupSize: number;
  localBoutDurationMs: number | null;
}

export interface EventSettings {
  groupSize: number | null;
  bronzeMedals: number | null;
  boutDurationMs: number | null;
}

/** An event's plan with the tournament's defaults filled in. */
export function effectiveEventSettings(eventType: DivisionEventType, event: EventSettings, t: LocalDefaults) {
  const groupSize = event.groupSize ?? (eventType === "kata" ? t.localKataGroupSize : t.localKumiteGroupSize);
  const bronze: LocalBronze = (event.bronzeMedals ?? t.localBronzeMedals) === 1 ? 1 : 2;
  return { groupSize, bronzeMedals: bronze, boutDurationMs: event.boutDurationMs ?? t.localBoutDurationMs };
}

export interface GenerateSpec {
  /** Age bands, inclusive. */
  ages: ReadonlyArray<{ min: number | null; max: number | null }>;
  /** Belt bands: each is one category's belts (empty = any belt). */
  beltBands: ReadonlyArray<readonly string[]>;
  sexes: ReadonlyArray<DivisionSex>;
}

/** Every age x belt x sex combination the generator would create, in a stable order. */
export function generateDivisionShapes(spec: GenerateSpec): DivisionShape[] {
  const out: DivisionShape[] = [];
  for (const age of spec.ages) {
    for (const belts of spec.beltBands) {
      for (const sex of spec.sexes) {
        out.push({ sex, ageMin: age.min, ageMax: age.max, belts: [...belts] });
      }
    }
  }
  return out;
}
