/**
 * Guests (a Local admin's late placement from another category) are marked wherever a name is
 * shown for a bout: "Name (guest)". The mark is display only and is never stored in the name.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categoryEntries } from "@/db/schema";

/** The rows with "(guest)" added to the name of every athlete who is a guest in one of these categories. */
export async function withGuestMarks<T extends { id: string; name: string }>(
  rows: readonly T[],
  categoryIds: readonly string[]
): Promise<T[]> {
  if (rows.length === 0 || categoryIds.length === 0) return [...rows];
  const guests = await db
    .select({ athleteId: categoryEntries.athleteId })
    .from(categoryEntries)
    .where(
      and(
        inArray(categoryEntries.categoryId, [...categoryIds]),
        inArray(categoryEntries.athleteId, rows.map((r) => r.id)),
        eq(categoryEntries.guest, true)
      )
    );
  if (guests.length === 0) return [...rows];
  const ids = new Set(guests.map((g) => g.athleteId));
  return rows.map((r) => (ids.has(r.id) ? { ...r, name: `${r.name} (guest)` } : r));
}
