import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, divisions } from "@/db/schema";

/**
 * Whether a tournament's type (Official or Local) may still change. It may only
 * while nothing has been set up: no categories (an Official category or a Local
 * group) and no Local divisions. After that the two models would mix, so the
 * type is fixed. No authorization here: the settings action and page guard it.
 */
export async function tournamentTypeLock(tournamentId: string): Promise<{ canChange: boolean; reason: string | null }> {
  const [[cats], [divs]] = await Promise.all([
    db.select({ n: count() }).from(categories).where(eq(categories.tournamentId, tournamentId)),
    db.select({ n: count() }).from(divisions).where(eq(divisions.tournamentId, tournamentId)),
  ]);
  const categoryCount = Number(cats?.n ?? 0);
  const divisionCount = Number(divs?.n ?? 0);
  if (categoryCount === 0 && divisionCount === 0) return { canChange: true, reason: null };
  return {
    canChange: false,
    reason: "The type is fixed once the tournament has categories. Create a new tournament to use the other type.",
  };
}
