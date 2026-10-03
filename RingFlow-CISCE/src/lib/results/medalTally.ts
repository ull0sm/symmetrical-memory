/**
 * The club medal tally: one row per club, from the medals of finished podiums.
 * Pure; the podiums come from `podium.ts`.
 */
import type { Medal } from "@/lib/kata/ranking";

export interface MedalWinner {
  athleteId: string;
  name: string;
  club: string | null;
  medal: Medal;
}

export interface TallyRow {
  /** Ties share a rank (1, 2, 2, 4). */
  rank: number;
  /** The club, or the athlete's name when they have no club. */
  label: string;
  independent: boolean;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

/** A club's key: its trimmed name, compared without case; athletes with no club each stand alone. */
function keyOf(w: MedalWinner): { key: string; label: string; independent: boolean } {
  const club = (w.club ?? "").trim();
  return club === ""
    ? { key: `independent:${w.athleteId}`, label: w.name, independent: true }
    : { key: `club:${club.toLowerCase()}`, label: club, independent: false };
}

/** Sorted by gold, then silver, then bronze; equal medals share a rank, then sort by name. */
export function buildMedalTally(winners: readonly MedalWinner[]): TallyRow[] {
  const rows = new Map<string, Omit<TallyRow, "rank">>();
  for (const w of winners) {
    const { key, label, independent } = keyOf(w);
    const row = rows.get(key) ?? { label, independent, gold: 0, silver: 0, bronze: 0, total: 0 };
    row[w.medal] += 1;
    row.total += 1;
    rows.set(key, row);
  }
  const sorted = [...rows.values()].sort(
    (a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.label.localeCompare(b.label)
  );
  let rank = 0;
  return sorted.map((row, i) => {
    const prev = sorted[i - 1];
    const same = prev && prev.gold === row.gold && prev.silver === row.silver && prev.bronze === row.bronze;
    if (!same) rank = i + 1;
    return { rank, ...row };
  });
}
