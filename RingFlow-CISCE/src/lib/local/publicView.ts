/**
 * What the public may see of a Local tournament's groups. A group is "being prepared" until
 * the stager locks it: its name may show, but its members, count and draw may not.
 * No authorization here: callers decide who counts as public.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { categories, draws } from "@/db/schema";

/** The groups of a tournament whose draw is not locked (none yet, or an unlocked draft). */
export async function draftGroupIds(tournamentId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: categories.id, state: draws.state })
    .from(categories)
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(and(eq(categories.tournamentId, tournamentId), isNotNull(categories.groupNo)));
  return new Set(rows.filter((r) => r.state !== "LOCKED").map((r) => r.id));
}

/** True for a Local group that the stager hasn't locked. Official categories are never "being prepared". */
export async function isDraftGroup(categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ groupNo: categories.groupNo, state: draws.state })
    .from(categories)
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(eq(categories.id, categoryId));
  return Boolean(row && row.groupNo !== null && row.state !== "LOCKED");
}

/** A category as the public page sees it while the group is being prepared: no counts, no draw. */
export function redactDraftGroup<T extends Record<string, unknown>>(category: T) {
  return {
    ...category,
    athletes_count: 0,
    athletesCount: 0,
    expected_matches: 0,
    expectedMatches: 0,
    doc_url: null,
    docUrl: null,
    has_draw: false,
    being_prepared: true,
  };
}
