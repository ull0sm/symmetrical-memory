"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, rings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import { performSetRouting, readRoutingState, type Routing } from "@/lib/draws/partRouting";
import { describePart } from "@/lib/draws/partFilter";
import { loadCategoryPools } from "@/lib/draws/poolRosters";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { isValidUuid } from "@/lib/utils";

async function tournamentOfCategory(categoryId: string) {
  if (!isValidUuid(categoryId)) return null;
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId));
  return cat ?? null;
}

/** Tell every screen of the tournament, and each tatami's desk, that the queues changed. */
function announceQueues(tournamentId: string, ringIds: readonly string[], categoryId: string) {
  broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId, categoryId });
  for (const ringId of new Set(ringIds)) {
    broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId, ringId, categoryId });
    try {
      revalidatePath(`/moderator/ring/${ringId}/queue`);
      revalidatePath(`/moderator/ring/${ringId}/current`);
    } catch {
      // Not inside a request that can revalidate (a script); the live broadcast still went out.
    }
  }
  try {
    revalidatePath(`/admin/event/${tournamentId}/rings/balance`);
  } catch {
    // As above.
  }
}

/**
 * Where a category runs now and what could change, for the routing dialog: how many pools its draw has (null =
 * it cannot be split), each card with its tatami, status and bout progress, and why a card cannot be moved
 * (a live bout, or already finished). Any staff of the event may read it.
 */
export async function getCategoryRouting(categoryId: string) {
  const cat = await tournamentOfCategory(categoryId);
  if (!cat) return { success: false as const, error: "Category not found" };
  await requireTournamentStaff(cat.tournamentId);

  const state = await readRoutingState(db, categoryId);
  const ringRows = await db.select({ id: rings.id, name: rings.name }).from(rings).where(eq(rings.tournamentId, cat.tournamentId));
  const ringName = new Map(ringRows.map((r) => [r.id, r.name]));

  const cards = state.cards.map((card) => ({
    part: card.part,
    label: describePart(card.part),
    ringId: card.ringId,
    ringName: ringName.get(card.ringId) ?? "Tatami",
    status: card.status,
    live: card.live,
    liveBoutNos: card.liveBoutNos,
    fought: card.fought,
    total: card.total,
    lockReason:
      card.live > 0
        ? `Bout #${card.liveBoutNos.join(", #")} is live`
        : card.status === "completed"
          ? "Finished"
          : null,
  }));

  return {
    success: true as const,
    poolCount: state.parts?.poolCount ?? null,
    isSplit: cards.some((c) => c.part !== "ALL"),
    cards,
    /** Who is drawn into each pool, so the admin can decide where each one runs. */
    pools: state.parts ? await loadCategoryPools(categoryId) : null,
  };
}

/**
 * Sets where a category runs: the whole category on one tatami, or each pool on a tatami with the finals on
 * another. One call covers splitting, moving a pool or the finals, and putting the category back together.
 * Fought bouts never block it (results are stored on the bouts); only a bout that is live right now does.
 * Admin only.
 */
export async function setCategoryRouting(categoryId: string, wanted: Routing) {
  const cat = await tournamentOfCategory(categoryId);
  if (!cat) return { success: false as const, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  const ringIds =
    wanted?.kind === "WHOLE"
      ? [wanted.ringId]
      : wanted?.kind === "SPLIT" && Array.isArray(wanted.poolRingIds)
        ? [...wanted.poolRingIds, wanted.finalsRingId]
        : [];
  if (ringIds.length === 0 || ringIds.length > 33 || !ringIds.every((id) => typeof id === "string" && isValidUuid(id))) {
    return { success: false as const, error: "Choose a tatami for every part." };
  }

  const outcome = await performSetRouting(categoryId, wanted);
  if ("error" in outcome) return { success: false as const, error: outcome.error };

  if (outcome.actions.length > 0) {
    await audit({
      tournamentId: cat.tournamentId,
      categoryId,
      actor: admin,
      action: "CATEGORY_ROUTED",
      targetType: "category",
      targetId: categoryId,
      before: outcome.before,
      after: outcome.after,
    });
    announceQueues(cat.tournamentId, [...ringIds, ...outcome.before.map((c) => c.ringId)], categoryId);
  }
  return { success: true as const, changed: outcome.actions.length, poolCount: outcome.poolCount };
}
