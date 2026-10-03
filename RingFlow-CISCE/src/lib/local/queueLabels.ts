/**
 * How a Local group's card reads in a tatami queue: waiting for a stager, being
 * prepared by someone, or ready (locked). Only a ready group can start; the
 * moderator still orders the cards, drafts included.
 * No authorization here: the moderator's queue page checks the moderator.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories, divisionEvents, divisionHolds, draws } from "@/db/schema";

export type LocalCardStage = "waiting" | "preparing" | "ready";

/** The stage of each Local group among `categoryIds`; Official categories are left out. */
export async function localCardStages(categoryIds: readonly string[]) {
  const out = new Map<string, { stage: LocalCardStage; holderName: string | null }>();
  if (categoryIds.length === 0) return out;
  const rows = await db
    .select({ id: categories.id, drawState: draws.state, holderName: divisionHolds.holderName })
    .from(categories)
    .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
    .leftJoin(divisionHolds, eq(divisionHolds.divisionId, divisionEvents.divisionId))
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(inArray(categories.id, [...categoryIds]));
  for (const r of rows) {
    const stage: LocalCardStage = r.drawState === "LOCKED" ? "ready" : r.holderName ? "preparing" : "waiting";
    out.set(r.id, { stage, holderName: stage === "preparing" ? r.holderName : null });
  }
  return out;
}
