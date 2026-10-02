"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, categoryAssignments, rings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import { loadCategoryPools } from "@/lib/draws/poolRosters";
import { performSplitCategory, performUnsplitCategory, poolCountOf } from "@/lib/draws/splitPools";
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
 * What the split dialog needs: how many pools the category's draw has (null = cannot be split),
 * and where each part runs now. Any staff of the event may read it.
 */
export async function getCategorySplitInfo(categoryId: string) {
  const cat = await tournamentOfCategory(categoryId);
  if (!cat) return { success: false as const, error: "Category not found" };
  await requireTournamentStaff(cat.tournamentId);

  const [poolCount, cards] = await Promise.all([
    poolCountOf(categoryId),
    db
      .select({
        part: categoryAssignments.part,
        ringId: categoryAssignments.ringId,
        ringName: rings.name,
        status: categoryAssignments.status,
      })
      .from(categoryAssignments)
      .innerJoin(rings, eq(rings.id, categoryAssignments.ringId))
      .where(eq(categoryAssignments.categoryId, categoryId)),
  ]);

  return {
    success: true as const,
    poolCount,
    isSplit: cards.some((c) => c.part !== "ALL"),
    cards,
    /** Who is drawn into each pool, so the admin can decide where each one runs. */
    pools: poolCount ? await loadCategoryPools(categoryId) : null,
  };
}

/**
 * Runs a category's pools on different tatamis: `poolRingIds[0]` is pool 1's tatami, and so on,
 * and `finalsRingId` runs everything after the pools once they have all finished. Admin only.
 */
export async function splitCategoryPools(categoryId: string, plan: { poolRingIds: string[]; finalsRingId: string }) {
  const cat = await tournamentOfCategory(categoryId);
  if (!cat) return { success: false as const, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  const ids = [...(Array.isArray(plan?.poolRingIds) ? plan.poolRingIds : []), plan?.finalsRingId];
  if (ids.length < 3 || ids.length > 33 || !ids.every((id) => typeof id === "string" && isValidUuid(id))) {
    return { success: false as const, error: "Choose a tatami for every pool and for the finals." };
  }

  const outcome = await performSplitCategory(categoryId, plan);
  if ("error" in outcome) return { success: false as const, error: outcome.error };

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "CATEGORY_SPLIT",
    targetType: "category",
    targetId: categoryId,
    before: outcome.before,
    after: { pools: plan.poolRingIds, finals: plan.finalsRingId },
  });

  announceQueues(cat.tournamentId, [...plan.poolRingIds, plan.finalsRingId, ...(outcome.before ? [outcome.before.ringId] : [])], categoryId);
  return { success: true as const, poolCount: outcome.poolCount };
}

/** Puts a split category back together on its finals tatami. Admin only. */
export async function unsplitCategoryPools(categoryId: string) {
  const cat = await tournamentOfCategory(categoryId);
  if (!cat) return { success: false as const, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  const before = await db.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, categoryId));
  const outcome = await performUnsplitCategory(categoryId);
  if ("error" in outcome) return { success: false as const, error: outcome.error };

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "CATEGORY_UNSPLIT",
    targetType: "category",
    targetId: categoryId,
    before: before.map((c) => ({ part: c.part, ringId: c.ringId })),
    after: { ringId: outcome.ringId },
  });

  announceQueues(cat.tournamentId, [...before.map((c) => c.ringId), outcome.ringId], categoryId);
  return { success: true as const };
}
