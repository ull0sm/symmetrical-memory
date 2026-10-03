import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { athletes, categories, divisions, rings, tournaments } from "@/db/schema";

/**
 * The admin and organiser sidebars' counters. A Local tournament counts its
 * divisions (the "Categories" its staff see), not the groups they split into.
 * No authorization here: the layout and the sidebar action guard it.
 */
export async function tournamentCounts(tournamentId: string) {
  const [t] = await db
    .select({ name: tournaments.name, type: tournaments.tournamentType })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!t) return null;

  const categoryTable = t.type === "LOCAL" ? divisions : categories;
  const count = sql<number>`count(*)::int`;
  const [[ringsRes], [catsRes], [athRes]] = await Promise.all([
    db.select({ count }).from(rings).where(eq(rings.tournamentId, tournamentId)),
    db.select({ count }).from(categoryTable).where(eq(categoryTable.tournamentId, tournamentId)),
    db.select({ count }).from(athletes).where(eq(athletes.tournamentId, tournamentId)),
  ]);
  return {
    name: t.name,
    ringsCount: ringsRes?.count ?? 0,
    categoriesCount: catsRes?.count ?? 0,
    athletesCount: athRes?.count ?? 0,
  };
}
