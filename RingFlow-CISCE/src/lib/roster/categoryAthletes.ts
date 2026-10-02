import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { athletes, categoryEntries } from "@/db/schema";

export type CategoryAthlete = {
  athleteId: string;
  name: string;
  school: string | null;
  chestNumber: string | null;
};

/**
 * Everyone competing in a category. Athletes arrive two ways: official-import
 * entries (`category_entries`) and the athlete's own category (manual add or
 * move). Both count, once each, the same way draws and category counts do.
 */
export async function listCategoryAthletes(categoryId: string): Promise<CategoryAthlete[]> {
  const fields = {
    athleteId: athletes.id,
    name: athletes.name,
    school: athletes.school,
    dojo: athletes.dojo,
    chestNumber: athletes.chestNumber,
  };
  const [viaEntries, direct] = await Promise.all([
    db
      .select(fields)
      .from(categoryEntries)
      .innerJoin(athletes, eq(categoryEntries.athleteId, athletes.id))
      .where(eq(categoryEntries.categoryId, categoryId)),
    db.select(fields).from(athletes).where(eq(athletes.categoryId, categoryId)).orderBy(asc(athletes.name)),
  ]);

  const byId = new Map<string, CategoryAthlete>();
  for (const a of [...viaEntries, ...direct]) {
    if (byId.has(a.athleteId)) continue;
    byId.set(a.athleteId, { athleteId: a.athleteId, name: a.name, school: a.school || a.dojo || null, chestNumber: a.chestNumber });
  }
  return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** True when the athlete competes in the category by either route. */
export async function isAthleteInCategory(categoryId: string, athleteId: string): Promise<boolean> {
  return (await listCategoryAthletes(categoryId)).some((a) => a.athleteId === athleteId);
}
