import { assembleCategoryDraw } from "@/lib/draws/assembleDraw";
import { db } from "@/db";
import { categories, draws } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { CategoryDrawState } from "@/lib/pdf/drawStatePdfGenerator";
import { getBoutOfficials } from "@/lib/results/officials";

/**
 * Every category that has a draw, with its current state — bouts, points and
 * winners as they stand. Shared by the results export; the caller is
 * responsible for the admin guard, which is why this reads the draw directly
 * instead of through the request-scoped action.
 */
export async function buildTournamentDrawStates(tournamentId: string): Promise<CategoryDrawState[]> {
  const drawn = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .innerJoin(draws, eq(draws.categoryId, categories.id))
    .where(eq(categories.tournamentId, tournamentId));

  const ordered = [...drawn].sort((a, b) => a.name.localeCompare(b.name));
  const states: CategoryDrawState[] = [];
  const officials = await getBoutOfficials(tournamentId);

  for (const category of ordered) {
    try {
      const draw = await assembleCategoryDraw(category.id);
      if (!draw || !draw.matches?.length) continue;
      states.push({
        categoryName: draw.categoryName || category.name,
        tournamentSize: draw.draw?.tournamentSize,
        bronzeMedals: draw.bronzeMedals ?? 2,
        matches: draw.matches,
        officials: Object.fromEntries(
          draw.matches.filter((m) => officials.has(m.matchId)).map((m) => [m.matchId, officials.get(m.matchId)!])
        ),
      });
    } catch (err) {
      // One unreadable bracket must not sink the whole document.
      console.error(`[results] could not read the draw for ${category.name}:`, err);
    }
  }

  return states;
}
