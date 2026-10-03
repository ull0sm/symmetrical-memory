import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Synchronizes the category table's `athletes_count` and `expected_matches`
 * with the actual number of active athletes present in `athletes` and `category_entries`.
 *
 * - Categories with active assigned athletes will have `athletes_count` set to their exact count.
 * - If athletes have been registered in the tournament, categories without any assigned athletes are set to 0.
 * - If the tournament has zero registered athletes at all, existing placeholder counts are retained.
 * - Expected bouts are athletes - 1, except for a Local tournament's groups: a ranked kata group
 *   calls its athletes in pairs, and a kumite group with a single bronze bout fights one more
 *   (`expectedBouts` in lib/local/rules.ts; the two must agree).
 */
export async function syncTournamentCategoryCounts(tournamentId: string): Promise<void> {
  try {
    await db.execute(sql`
      WITH tournament_athletes AS (
        SELECT COUNT(*)::int AS total_athletes
        FROM athletes
        WHERE tournament_id = ${tournamentId}
      ),
      active_counts AS (
        SELECT 
          c.id AS category_id,
          COUNT(DISTINCT p.athlete_id)::int AS real_count
        FROM categories c
        LEFT JOIN (
          SELECT id AS athlete_id, category_id 
          FROM athletes 
          WHERE tournament_id = ${tournamentId} AND category_id IS NOT NULL
          UNION
          SELECT ce.athlete_id, ce.category_id 
          FROM category_entries ce
          INNER JOIN categories c2 ON c2.id = ce.category_id
          WHERE c2.tournament_id = ${tournamentId}
        ) p ON p.category_id = c.id
        WHERE c.tournament_id = ${tournamentId}
        GROUP BY c.id
      ),
      sized AS (
        SELECT
          c.id,
          CASE
            WHEN ac.real_count > 0 THEN ac.real_count
            WHEN ta.total_athletes > 0 THEN 0
            ELSE c.athletes_count
          END AS n,
          c.division_event_id IS NOT NULL AS is_group,
          c.kata_format,
          c.bronze_medals
        FROM categories c
        INNER JOIN active_counts ac ON ac.category_id = c.id
        CROSS JOIN tournament_athletes ta
      ),
      targets AS (
        SELECT
          id,
          n,
          CASE
            WHEN is_group AND kata_format = 'RANKED' THEN (n + 1) / 2
            WHEN is_group AND bronze_medals = 1 AND n >= 4 THEN n
            ELSE GREATEST(0, n - 1)
          END AS expected
        FROM sized
      )
      UPDATE categories
      SET athletes_count = t.n, expected_matches = t.expected
      FROM targets t
      WHERE categories.id = t.id
        AND (categories.athletes_count != t.n OR categories.expected_matches != t.expected);
    `);
  } catch (err) {
    console.error(`[syncTournamentCategoryCounts] Error syncing tournament ${tournamentId}:`, err);
  }
}

/**
 * Returns a Map of categoryId -> actual active athlete count in the tournament.
 */
export async function getActiveAthleteCounts(tournamentId: string): Promise<Map<string, number>> {
  const countMap = new Map<string, number>();
  try {
    const rows = await db.execute<{ category_id: string; real_count: number; total_athletes: number }>(sql`
      WITH tournament_athletes AS (
        SELECT COUNT(*)::int AS total_athletes
        FROM athletes
        WHERE tournament_id = ${tournamentId}
      ),
      active_counts AS (
        SELECT 
          c.id AS category_id,
          COUNT(DISTINCT p.athlete_id)::int AS real_count
        FROM categories c
        LEFT JOIN (
          SELECT id AS athlete_id, category_id 
          FROM athletes 
          WHERE tournament_id = ${tournamentId} AND category_id IS NOT NULL
          UNION
          SELECT ce.athlete_id, ce.category_id 
          FROM category_entries ce
          INNER JOIN categories c2 ON c2.id = ce.category_id
          WHERE c2.tournament_id = ${tournamentId}
        ) p ON p.category_id = c.id
        WHERE c.tournament_id = ${tournamentId}
        GROUP BY c.id
      )
      SELECT ac.category_id, ac.real_count, ta.total_athletes
      FROM active_counts ac
      CROSS JOIN tournament_athletes ta
    `);

    for (const r of rows as any[]) {
      const real = Number(r.real_count) || 0;
      const total = Number(r.total_athletes) || 0;
      // If tournament has athletes, 0 assigned means 0 active athletes.
      // If tournament has no athletes yet, real will be 0.
      countMap.set(r.category_id, real);
    }
  } catch (err) {
    console.error(`[getActiveAthleteCounts] Error fetching active counts for tournament ${tournamentId}:`, err);
  }
  return countMap;
}
