import { db } from "@/db";
import { categories, categoryAssignments, matches, rings } from "@/db/schema";
import { computeDrawParts, poolNumber, rosterByPart, type DrawParts, type DrawPart } from "@/engine/draw-engine/parts";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { foughtBoutCount, foughtBoutCountByPart } from "@/lib/draws/boutCount";
import type { DbExecutor } from "@/lib/draws/generateDraws";
import { latestGraph } from "@/lib/draws/latestGraph";
import {
  planRouting,
  returnsToQueue,
  statusForNewPart,
  type RouteAction,
  type RouteCard,
  type Routing,
} from "@/lib/draws/routingPlan";
import { and, eq, inArray, like, sql } from "drizzle-orm";

export type { Routing } from "@/lib/draws/routingPlan";

/** How many pools the category's current draw has, or null when it cannot be split. */
export async function poolCountOf(categoryId: string): Promise<number | null> {
  const graph = await latestGraph(db, categoryId);
  return graph ? (computeDrawParts(graph)?.poolCount ?? null) : null;
}

/** A card of the category with its id, for the routing screen and for applying changes. */
export type RoutedCard = RouteCard & { id: string; queueOrder: number };

/**
 * The category's cards and what has happened in each part's bouts: how many are live (and which), how many
 * were fought, how many the part runs. The graph's own parts are used for a whole category, so the numbers
 * for each future pool are known before it is split.
 */
export async function readRoutingState(executor: DbExecutor, categoryId: string) {
  const graph = await latestGraph(executor, categoryId);
  const parts: DrawParts | null = graph ? computeDrawParts(graph) : null;

  const cards = await executor.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, categoryId));
  const rows = await executor
    .select({ id: matches.id, matchNo: matches.matchNo, status: matches.status, part: matches.part })
    .from(matches)
    .where(eq(matches.categoryId, categoryId));

  const wholeTotal = graph ? foughtBoutCount(graph) : 0;
  const totals = graph && parts ? foughtBoutCountByPart(graph, parts.byMatch) : new Map<string, number>();
  const isFought = (status: string) => status === "CONFIRMED" || status === "COMPLETED";

  const routed: RoutedCard[] = cards.map((card) => {
    const mine = rows.filter((row) => (row.part ?? "ALL") === card.part);
    const live = mine.filter((row) => row.status === "LIVE");
    return {
      id: card.id,
      queueOrder: card.queueOrder,
      part: card.part,
      ringId: card.ringId,
      status: card.status,
      live: live.length,
      liveBoutNos: live.map((row) => row.matchNo).sort((a, b) => a - b),
      fought: mine.filter((row) => isFought(row.status)).length,
      total: card.part === "ALL" ? wholeTotal : (card.partMatches ?? totals.get(card.part) ?? 0),
    };
  });

  // What each future part would start with if a whole category were split now.
  const futureFought = new Map<string, number>();
  if (parts) {
    for (const row of rows) {
      const part = parts.byMatch.get(row.id);
      if (part !== undefined && isFought(row.status)) futureFought.set(part, (futureFought.get(part) ?? 0) + 1);
    }
  }

  return { graph, parts, cards: routed, rows, futureFought, totals };
}

/** Next free queue position on a tatami. */
async function tailOf(tx: DbExecutor, ringId: string): Promise<number> {
  const [row] = await tx
    .select({ tail: sql<number>`coalesce(max(${categoryAssignments.queueOrder}), -1)` })
    .from(categoryAssignments)
    .where(eq(categoryAssignments.ringId, ringId));
  return Number(row?.tail ?? -1) + 1;
}

/** A tatami's "current bout" pointer must not point into a card that has just left it. */
async function clearCurrentBout(tx: DbExecutor, ringId: string, categoryId: string) {
  const own = tx.select({ id: matches.id }).from(matches).where(eq(matches.categoryId, categoryId));
  await tx.update(rings).set({ currentMatchId: null }).where(and(eq(rings.id, ringId), inArray(rings.currentMatchId, own)));
}

export type RoutingOutcome =
  | { error: string }
  | {
      actions: RouteAction[];
      poolCount: number | null;
      before: { part: string; ringId: string; status: string }[];
      after: { part: string; ringId: string; status: string }[];
    };

/**
 * Makes the category's routing what the admin wants: the whole category on one tatami, or its pools each on
 * a tatami with the finals on another. One operation covers splitting, moving a pool to another tatami,
 * moving the finals, and putting the category back together, so each is as easy as the others.
 *
 * Fought bouts never get in the way, since their results live on the bouts. Only a bout that is live right
 * now blocks a change to its part (see `planRouting`). Request-free: the admin action guards and audits it.
 */
export async function performSetRouting(categoryId: string, wanted: Routing): Promise<RoutingOutcome> {
  return db.transaction(async (tx) => {
    const [cat] = await tx
      .select({ id: categories.id, name: categories.name, tournamentId: categories.tournamentId })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .for("update");
    if (!cat) return { error: "Category not found" };

    const state = await readRoutingState(tx, categoryId);
    if (wanted.kind === "SPLIT" && !state.graph) return { error: "Draw this category first; its pools come from the draw." };

    const plan = planRouting(state.cards, wanted, state.parts?.poolCount ?? null);
    if (!plan.ok) return { error: plan.error };

    const wantedRings = wanted.kind === "WHOLE" ? [wanted.ringId] : [...new Set([...wanted.poolRingIds, wanted.finalsRingId])];
    const owned = await tx
      .select({ id: rings.id })
      .from(rings)
      .where(and(inArray(rings.id, wantedRings), eq(rings.tournamentId, cat.tournamentId)));
    if (owned.length !== wantedRings.length) return { error: "A chosen tatami does not belong to this tournament." };

    const before = state.cards.map((c) => ({ part: c.part, ringId: c.ringId, status: c.status }));

    for (const action of plan.actions) {
      switch (action.type) {
        case "ASSIGN": {
          await tx.insert(categoryAssignments).values({
            ringId: action.ringId,
            categoryId,
            part: "ALL",
            queueOrder: await tailOf(tx, action.ringId),
          });
          break;
        }

        case "MOVE": {
          const card = state.cards.find((c) => c.part === action.part)!;
          await tx
            .update(categoryAssignments)
            .set({
              ringId: action.toRingId,
              queueOrder: await tailOf(tx, action.toRingId),
              // A card that was on a mat waits in its new tatami's queue.
              ...(returnsToQueue(card) ? { status: "pending", startedAt: null, pausedAt: null } : {}),
            })
            .where(eq(categoryAssignments.id, card.id));
          await clearCurrentBout(tx, card.ringId, categoryId);
          break;
        }

        case "SPLIT": {
          const parts = state.parts!;
          const whole = state.cards.find((c) => c.part === "ALL") ?? null;
          const roster = rosterByPart(state.graph as DrawGraph, parts);
          const sizeOf = (part: string) => ({
            partAthletes: part === "FINALS" ? parts.poolCount : (roster.get(part as DrawPart)?.length ?? 0),
            partMatches: state.totals.get(part) ?? 0,
          });
          // A category split part-way keeps what was fought: each part starts with its own progress.
          const startOf = (part: string) => {
            const fought = state.futureFought.get(part) ?? 0;
            const status = statusForNewPart({ fought, total: state.totals.get(part) ?? 0 });
            return {
              status,
              matchesCompleted: fought,
              completedAt: status === "completed" ? new Date() : null,
            };
          };

          // The whole card is reused as the finals card when the finals stay on its tatami.
          const reuse = whole && whole.ringId === action.finalsRingId ? whole : null;
          if (whole && !reuse) {
            await tx.delete(categoryAssignments).where(eq(categoryAssignments.id, whole.id));
          }
          if (whole) await clearCurrentBout(tx, whole.ringId, categoryId);

          const nextOrder = new Map<string, number>();
          const takeOrder = async (ringId: string) => {
            const next = nextOrder.get(ringId) ?? (await tailOf(tx, ringId));
            nextOrder.set(ringId, next + 1);
            return next;
          };

          for (let i = 0; i < action.poolRingIds.length; i += 1) {
            const part = `POOL:${i + 1}`;
            await tx.insert(categoryAssignments).values({
              ringId: action.poolRingIds[i],
              categoryId,
              part,
              ...sizeOf(part),
              ...startOf(part),
              queueOrder: await takeOrder(action.poolRingIds[i]),
            });
          }

          if (reuse) {
            await tx
              .update(categoryAssignments)
              .set({ part: "FINALS", ...sizeOf("FINALS"), ...startOf("FINALS"), startedAt: null, pausedAt: null })
              .where(eq(categoryAssignments.id, reuse.id));
          } else {
            await tx.insert(categoryAssignments).values({
              ringId: action.finalsRingId,
              categoryId,
              part: "FINALS",
              ...sizeOf("FINALS"),
              ...startOf("FINALS"),
              queueOrder: await takeOrder(action.finalsRingId),
            });
          }

          // Label every bout with its part (the draw's own match ids are the stored match ids).
          const byPart = new Map<string, string[]>();
          for (const [matchId, part] of parts.byMatch) byPart.set(part, [...(byPart.get(part) ?? []), matchId]);
          for (const [part, ids] of byPart) {
            await tx.update(matches).set({ part }).where(and(eq(matches.categoryId, categoryId), inArray(matches.id, ids)));
          }
          break;
        }

        case "MERGE": {
          const finals = state.cards.find((c) => c.part === "FINALS")!;
          const allDone = state.cards.every((c) => c.status === "completed");
          const fought = state.cards.reduce((sum, c) => sum + c.fought, 0);

          for (const card of state.cards) await clearCurrentBout(tx, card.ringId, categoryId);
          await tx
            .delete(categoryAssignments)
            .where(and(eq(categoryAssignments.categoryId, categoryId), like(categoryAssignments.part, "POOL:%")));
          await tx
            .update(categoryAssignments)
            .set({
              part: "ALL",
              ringId: action.ringId,
              ...(action.ringId !== finals.ringId ? { queueOrder: await tailOf(tx, action.ringId) } : {}),
              status: allDone ? "completed" : "pending",
              completedAt: allDone ? new Date() : null,
              startedAt: null,
              pausedAt: null,
              matchesCompleted: fought,
              partAthletes: null,
              partMatches: null,
            })
            .where(eq(categoryAssignments.id, finals.id));
          await tx.update(matches).set({ part: null }).where(eq(matches.categoryId, categoryId));
          break;
        }
      }
    }

    const after = (await tx.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, categoryId))).map((c) => ({
      part: c.part,
      ringId: c.ringId,
      status: c.status,
    }));
    return { actions: plan.actions, poolCount: state.parts?.poolCount ?? null, before, after };
  });
}

/**
 * After a category that is split has been redrawn (only possible when nothing was fought), keeps its routing
 * when the new draw has the same number of pools, and otherwise puts it back together on its finals tatami.
 * Runs inside the redraw's transaction, once the new bouts exist.
 */
export async function reapplyRoutingAfterRedraw(tx: DbExecutor, categoryId: string, graph: DrawGraph) {
  const cards = await tx.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, categoryId));
  if (!cards.some((c) => c.part !== "ALL")) return;

  const parts = computeDrawParts(graph);
  const poolCards = cards.filter((c) => c.part.startsWith("POOL:"));

  if (parts && parts.poolCount === poolCards.length) {
    const roster = rosterByPart(graph, parts);
    const totals = foughtBoutCountByPart(graph, parts.byMatch);
    for (const card of cards) {
      await tx
        .update(categoryAssignments)
        .set({
          status: "pending",
          matchesCompleted: 0,
          completedAt: null,
          startedAt: null,
          pausedAt: null,
          partAthletes: card.part === "FINALS" ? parts.poolCount : (roster.get(card.part as DrawPart)?.length ?? 0),
          partMatches: totals.get(card.part) ?? 0,
        })
        .where(eq(categoryAssignments.id, card.id));
    }
    const byPart = new Map<string, string[]>();
    for (const [matchId, part] of parts.byMatch) byPart.set(part, [...(byPart.get(part) ?? []), matchId]);
    for (const [part, ids] of byPart) {
      await tx.update(matches).set({ part }).where(and(eq(matches.categoryId, categoryId), inArray(matches.id, ids)));
    }
    return;
  }

  // A different number of pools: the old routing no longer describes anything.
  await tx
    .delete(categoryAssignments)
    .where(and(eq(categoryAssignments.categoryId, categoryId), like(categoryAssignments.part, "POOL:%")));
  await tx
    .update(categoryAssignments)
    .set({ part: "ALL", partAthletes: null, partMatches: null, status: "pending", matchesCompleted: 0, completedAt: null })
    .where(and(eq(categoryAssignments.categoryId, categoryId), eq(categoryAssignments.part, "FINALS")));
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
