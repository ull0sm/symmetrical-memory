/**
 * Where a Local division's groups run. Every group is an ordinary tatami card
 * (`category_assignments`), so this only decides which tatami and in what
 * order; the balancing board moves single groups like any category.
 * No authorization here: the admin actions guard it.
 */
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import { categories, categoryAssignments, divisionEvents, divisions, rings } from "@/db/schema";
import type { DbExecutor } from "@/lib/draws/generateDraws";
import { readLocalSettings, LocalSetupError } from "./divisions";

const cardKey = (categoryId: string, part: string) => `${categoryId}|${part}`;

/**
 * Rewrites a tatami's queue to exactly this order (card keys `categoryId|part`), numbered from 0.
 * (ring_id, queue_order) is unique, so every card is parked on a negative slot first.
 */
export async function rewriteRingQueue(tx: DbExecutor, ringId: string, orderedKeys: readonly string[]) {
  const cards = await tx.select().from(categoryAssignments).where(eq(categoryAssignments.ringId, ringId));
  const byKey = new Map(cards.map((c) => [cardKey(c.categoryId, c.part), c]));
  let parking = -1;
  for (const key of orderedKeys) {
    const card = byKey.get(key);
    if (!card) continue;
    await tx.update(categoryAssignments).set({ queueOrder: parking-- }).where(eq(categoryAssignments.id, card.id));
  }
  let position = 0;
  for (const key of orderedKeys) {
    const card = byKey.get(key);
    if (!card) continue;
    await tx.update(categoryAssignments).set({ queueOrder: position++ }).where(eq(categoryAssignments.id, card.id));
  }
}

/**
 * Puts new group cards on a tatami at a point in its queue: before every card whose position is
 * `atQueueOrder` or later, keeping every other card's order. The card on the mat always stays first.
 */
export async function insertGroupCards(tx: DbExecutor, ringId: string, groupIds: readonly string[], atQueueOrder: number) {
  if (groupIds.length === 0) return;
  const cards = await tx
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.ringId, ringId))
    .orderBy(asc(categoryAssignments.queueOrder));
  const [top] = await tx.select({ m: max(categoryAssignments.queueOrder) }).from(categoryAssignments).where(eq(categoryAssignments.ringId, ringId));
  let parkAt = (top?.m ?? 0) + 1000;
  await tx.insert(categoryAssignments).values(
    groupIds.map((categoryId) => ({ ringId, categoryId, part: "ALL", queueOrder: parkAt++, status: "pending" }))
  );

  const onMat = cards.filter((c) => c.status === "running" || c.status === "paused");
  const rest = cards.filter((c) => c.status !== "running" && c.status !== "paused");
  const before = rest.filter((c) => c.queueOrder < atQueueOrder);
  const after = rest.filter((c) => c.queueOrder >= atQueueOrder);
  const order = [
    ...onMat.map((c) => cardKey(c.categoryId, c.part)),
    ...before.map((c) => cardKey(c.categoryId, c.part)),
    ...groupIds.map((id) => cardKey(id, "ALL")),
    ...after.map((c) => cardKey(c.categoryId, c.part)),
  ];
  await rewriteRingQueue(tx, ringId, order);
}

/**
 * Puts a whole division on a tatami (or takes it off with `ringId` null): its groups join the end
 * of the queue, kumite then kata (or the tournament's order), group by group. Groups already on a
 * mat or finished stay where they are. Returns how many cards moved and how many stayed.
 */
export async function assignDivisionCore(divisionId: string, ringId: string | null) {
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));
  if (!division) throw new LocalSetupError("Category not found.");
  if (ringId !== null) {
    const [ring] = await db.select({ t: rings.tournamentId }).from(rings).where(eq(rings.id, ringId));
    if (!ring || ring.t !== division.tournamentId) throw new LocalSetupError("That tatami is not in this tournament.");
  }
  const { localEventOrder } = await readLocalSettings(division.tournamentId);
  const eventRank = (type: string) => ((type === "kata") === (localEventOrder === "KATA_FIRST") ? 0 : 1);

  const groups = await db
    .select({ id: categories.id, groupNo: categories.groupNo, eventType: divisionEvents.eventType })
    .from(categories)
    .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
    .where(eq(divisionEvents.divisionId, divisionId));
  groups.sort((a, b) => eventRank(a.eventType) - eventRank(b.eventType) || (a.groupNo ?? 0) - (b.groupNo ?? 0));
  if (groups.length === 0) return { moved: 0, stayed: 0 };

  const cards = await db.select().from(categoryAssignments).where(inArray(categoryAssignments.categoryId, groups.map((g) => g.id)));
  const cardOf = new Map(cards.map((c) => [c.categoryId, c]));
  const movable = groups.filter((g) => {
    const card = cardOf.get(g.id);
    return !card || card.status === "pending";
  });
  const stayed = groups.length - movable.length;

  await db.transaction(async (tx) => {
    const movableIds = movable.map((g) => g.id);
    if (movableIds.length > 0) {
      await tx
        .delete(categoryAssignments)
        .where(and(inArray(categoryAssignments.categoryId, movableIds), eq(categoryAssignments.part, "ALL")));
    }
    if (ringId === null || movableIds.length === 0) return;
    const [top] = await tx.select({ m: max(categoryAssignments.queueOrder) }).from(categoryAssignments).where(eq(categoryAssignments.ringId, ringId));
    let next = (top?.m ?? -1) + 1;
    await tx.insert(categoryAssignments).values(
      movableIds.map((categoryId) => ({ ringId, categoryId, part: "ALL", queueOrder: next++, status: "pending" }))
    );
  });
  return { moved: movable.length, stayed };
}
