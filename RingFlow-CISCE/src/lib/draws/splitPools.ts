import { db } from "@/db";
import { categories, categoryAssignments, draws, drawVersions, matches, rings } from "@/db/schema";
import { computeDrawParts, poolNumber } from "@/engine/draw-engine/parts";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { readBoutStats, type DbExecutor } from "@/lib/draws/generateDraws";
import { and, eq, inArray, like, sql } from "drizzle-orm";

/** Where each pool of a category runs, and where its semi-finals, finals and medal bouts run. */
export interface PoolSplitPlan {
  /** Tatami (ring id) for pool 1, 2, ... in bracket order. */
  poolRingIds: readonly string[];
  finalsRingId: string;
}

export type SplitOutcome =
  | { error: string }
  | { poolCount: number; assignmentIds: string[]; before: { ringId: string; queueOrder: number } | null };

/** A category's draw as a graph, from its latest stored version. */
async function latestGraph(executor: DbExecutor, categoryId: string): Promise<DrawGraph | null> {
  const [draw] = await executor.select().from(draws).where(eq(draws.categoryId, categoryId));
  if (!draw) return null;
  const [latest] = await executor
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);
  return (latest?.graph as unknown as DrawGraph | undefined) ?? null;
}

/** How many pools the category's current draw has, or null when it cannot be split. */
export async function poolCountOf(categoryId: string): Promise<number | null> {
  const graph = await latestGraph(db, categoryId);
  return graph ? (computeDrawParts(graph)?.poolCount ?? null) : null;
}

/**
 * Splits a category across tatamis: each pool on the tatami the plan names, and the bouts after
 * the pools (semi-finals, final, repechage, bronze, the kata medal flight) on the finals tatami,
 * which waits for every pool to finish. Request-free: the admin action guards and audits it.
 *
 * Refused unless the draw exists and has at least two pools, no bout has been fought, and the
 * category is not on a mat. Every tatami must belong to the category's tournament.
 */
export async function performSplitCategory(categoryId: string, plan: PoolSplitPlan): Promise<SplitOutcome> {
  return db.transaction(async (tx) => {
    const [cat] = await tx
      .select({ id: categories.id, name: categories.name, tournamentId: categories.tournamentId })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .for("update");
    if (!cat) return { error: "Category not found" };

    const graph = await latestGraph(tx, categoryId);
    if (!graph) return { error: "Draw this category first; its pools come from the draw." };
    const parts = computeDrawParts(graph);
    if (!parts) return { error: "This draw has fewer than two pools, so there is nothing to split." };

    if (plan.poolRingIds.length !== parts.poolCount) {
      return { error: `Choose a tatami for each of the ${parts.poolCount} pools.` };
    }

    const wanted = [...new Set([...plan.poolRingIds, plan.finalsRingId])];
    const owned = await tx
      .select({ id: rings.id })
      .from(rings)
      .where(and(inArray(rings.id, wanted), eq(rings.tournamentId, cat.tournamentId)));
    if (owned.length !== wanted.length) return { error: "A chosen tatami does not belong to this tournament." };

    const stats = (await readBoutStats(tx, [categoryId])).get(categoryId);
    if ((stats?.confirmed ?? 0) + (stats?.live ?? 0) > 0) {
      return { error: `"${cat.name}" already has fought bouts, so it can no longer be split across tatamis.` };
    }

    const existing = await tx.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, categoryId));
    if (existing.some((a) => a.part !== "ALL")) return { error: `"${cat.name}" is already split. Unsplit it first.` };
    const whole = existing[0];
    if (whole && whole.status !== "pending") {
      return { error: `"${cat.name}" is ${whole.status === "completed" ? "completed" : "on a tatami"}; return it to the queue first.` };
    }

    // New cards join the end of their tatami's queue, so nothing already queued moves. The whole
    // category's own card is reused as the finals card when that tatami stays the same.
    const tailOf = new Map<string, number>();
    const nextOrder = async (ringId: string) => {
      if (!tailOf.has(ringId)) {
        const [row] = await tx
          .select({ tail: sql<number>`coalesce(max(${categoryAssignments.queueOrder}), -1)` })
          .from(categoryAssignments)
          .where(eq(categoryAssignments.ringId, ringId));
        tailOf.set(ringId, Number(row?.tail ?? -1));
      }
      const next = (tailOf.get(ringId) ?? -1) + 1;
      tailOf.set(ringId, next);
      return next;
    };

    const reuse = whole && whole.ringId === plan.finalsRingId ? whole : null;
    if (whole && !reuse) await tx.delete(categoryAssignments).where(eq(categoryAssignments.id, whole.id));

    const assignmentIds: string[] = [];
    for (let i = 0; i < plan.poolRingIds.length; i += 1) {
      const [row] = await tx
        .insert(categoryAssignments)
        .values({
          ringId: plan.poolRingIds[i],
          categoryId,
          part: `POOL:${i + 1}`,
          queueOrder: await nextOrder(plan.poolRingIds[i]),
        })
        .returning({ id: categoryAssignments.id });
      assignmentIds.push(row.id);
    }

    if (reuse) {
      await tx.update(categoryAssignments).set({ part: "FINALS" }).where(eq(categoryAssignments.id, reuse.id));
      assignmentIds.push(reuse.id);
    } else {
      const [row] = await tx
        .insert(categoryAssignments)
        .values({
          ringId: plan.finalsRingId,
          categoryId,
          part: "FINALS",
          queueOrder: await nextOrder(plan.finalsRingId),
        })
        .returning({ id: categoryAssignments.id });
      assignmentIds.push(row.id);
    }

    // Label every bout with its part (the draw's own match ids are the stored match ids).
    const byPart = new Map<string, string[]>();
    for (const [matchId, part] of parts.byMatch) byPart.set(part, [...(byPart.get(part) ?? []), matchId]);
    for (const [part, ids] of byPart) {
      await tx.update(matches).set({ part }).where(and(eq(matches.categoryId, categoryId), inArray(matches.id, ids)));
    }

    return {
      poolCount: parts.poolCount,
      assignmentIds,
      before: whole ? { ringId: whole.ringId, queueOrder: whole.queueOrder } : null,
    };
  });
}

/**
 * Puts a split category back together on one tatami (the finals tatami). Refused once any bout
 * is fought or any part has started.
 */
export async function performUnsplitCategory(categoryId: string): Promise<{ error: string } | { ringId: string }> {
  return db.transaction(async (tx) => {
    const [cat] = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .for("update");
    if (!cat) return { error: "Category not found" };

    const cards = await tx.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, categoryId));
    const finals = cards.find((a) => a.part === "FINALS");
    if (!finals) return { error: `"${cat.name}" is not split.` };

    const stats = (await readBoutStats(tx, [categoryId])).get(categoryId);
    if ((stats?.confirmed ?? 0) + (stats?.live ?? 0) > 0) {
      return { error: `"${cat.name}" already has fought bouts, so it can no longer be put back together.` };
    }
    if (cards.some((a) => a.status !== "pending")) {
      return { error: `A part of "${cat.name}" has started. Return it to the queue first.` };
    }

    await tx
      .delete(categoryAssignments)
      .where(and(eq(categoryAssignments.categoryId, categoryId), like(categoryAssignments.part, "POOL:%")));
    await tx.update(categoryAssignments).set({ part: "ALL" }).where(eq(categoryAssignments.id, finals.id));
    await tx.update(matches).set({ part: null }).where(eq(matches.categoryId, categoryId));

    return { ringId: finals.ringId };
  });
}

/** The pool numbers a category's finals still wait for (empty = the finals may start). */
export async function poolsFinalsWaitFor(categoryId: string): Promise<number[]> {
  const cards = await db
    .select({ part: categoryAssignments.part, status: categoryAssignments.status })
    .from(categoryAssignments)
    .where(eq(categoryAssignments.categoryId, categoryId));
  return cards
    .filter((c) => c.status !== "completed")
    .map((c) => poolNumber(c.part))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}
