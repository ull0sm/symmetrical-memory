import { db } from "@/db";
import { athletes, categories, categoryAssignments, draws, rings } from "@/db/schema";
import { computeDrawParts, rosterByPart } from "@/engine/draw-engine/parts";
import { latestGraph } from "@/lib/draws/latestGraph";
import { describePart } from "@/lib/draws/partFilter";
import { and, eq, gte, inArray, or } from "drizzle-orm";

export interface PoolRoster {
  part: string;
  label: string;
  /** Tatami this pool runs on, when the category has been split. */
  tatami: string | null;
  athletes: { athleteId: string; name: string; club: string | null }[];
}

/**
 * Who is drawn into each pool of a category, in bracket order, and where each pool runs.
 * Null when the category has no draw or its draw has fewer than two pools.
 */
export async function loadCategoryPools(categoryId: string): Promise<PoolRoster[] | null> {
  const graph = await latestGraph(db, categoryId);
  if (!graph) return null;
  const parts = computeDrawParts(graph);
  if (!parts) return null;
  const roster = rosterByPart(graph, parts);

  const ids = [...new Set([...roster.values()].flat())];
  const people = ids.length
    ? await db
        .select({ id: athletes.id, name: athletes.name, school: athletes.school, dojo: athletes.dojo })
        .from(athletes)
        .where(inArray(athletes.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  const cards = await db
    .select({ part: categoryAssignments.part, ringName: rings.name })
    .from(categoryAssignments)
    .innerJoin(rings, eq(rings.id, categoryAssignments.ringId))
    .where(eq(categoryAssignments.categoryId, categoryId));
  const tatamiOf = new Map(cards.map((c) => [c.part, c.ringName]));

  return Array.from({ length: parts.poolCount }, (_, i) => {
    const part = `POOL:${i + 1}` as const;
    return {
      part,
      label: describePart(part) ?? part,
      tatami: tatamiOf.get(part) ?? null,
      athletes: (roster.get(part) ?? []).map((id) => ({
        athleteId: id,
        name: byId.get(id)?.name ?? "Unknown",
        club: byId.get(id)?.school || byId.get(id)?.dojo || null,
      })),
    };
  });
}

/**
 * The pool of every athlete in a tournament whose category draw has pools, for the roster screens:
 * athlete id -> { category, pool label, tatami }. Only draws big enough to have pools are read.
 */
export async function loadAthletePools(tournamentId: string) {
  const result = new Map<string, { categoryId: string; part: string; label: string; tatami: string | null }>();

  const candidates = await db
    .select({ categoryId: draws.categoryId })
    .from(draws)
    .innerJoin(categories, eq(categories.id, draws.categoryId))
    .where(
      and(
        eq(categories.tournamentId, tournamentId),
        or(gte(draws.tournamentSize, 32), eq(draws.format, "KATA_GROUP_POOLS"))
      )
    );

  for (const { categoryId } of candidates) {
    const pools = await loadCategoryPools(categoryId);
    if (!pools) continue;
    for (const pool of pools) {
      for (const athlete of pool.athletes) {
        result.set(athlete.athleteId, { categoryId, part: pool.part, label: pool.label, tatami: pool.tatami });
      }
    }
  }
  return result;
}
