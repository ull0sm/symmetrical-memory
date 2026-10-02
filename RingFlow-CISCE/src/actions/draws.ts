"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import { assembleCategoryDraw, type BracketMatchView } from "@/lib/draws/assembleDraw";
import {
  athletes,
  categories,
  draws,
  drawVersions,
  matches,
  matchSlots,
  matchEvents,
  kataScores,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { tournaments } from "@/db/schema";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import {
  performCategoryDraw,
  performGenerateAllTournamentDraws,
  performGetTournamentDrawPreflight,
} from "@/lib/draws/generateDraws";
import { getTournamentStaff } from "@/lib/auth/guards";
import { tournamentIdForCategory } from "@/lib/auth/scope";
import { isValidUuid } from "@/lib/utils";

/**
 * Staff of this category's event may always open a full bracket. The public
 * may only open one when the admin enabled public draws — or when they reached
 * it through their own athlete's search result, which is scoped to a single
 * name they already know.
 */
async function isStaffViewer(categoryId: string): Promise<boolean> {
  try {
    return Boolean(await getTournamentStaff(await tournamentIdForCategory(categoryId)));
  } catch {
    return false;
  }
}

async function publicDrawsEnabledForCategory(categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ showPublicDraws: tournaments.showPublicDraws })
    .from(categories)
    .innerJoin(tournaments, eq(tournaments.id, categories.tournamentId))
    .where(eq(categories.id, categoryId));

  return row?.showPublicDraws !== false;
}



/**
 * Regenerates one category's bracket. Admin only: this deletes and rebuilds
 * the category's matches, and resolving the tournament from the category is
 * the only way to check ownership.
 */
export async function generateCategoryDraw(
  categoryId: string,
  options?: { bronzeMedals?: 0 | 1 | 2 | 3; separateByClub?: boolean }
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };

  const admin = await requireTournamentAdmin(cat.tournamentId);
  const result = await performCategoryDraw(categoryId, options);
  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_GENERATED",
    targetType: "category",
    targetId: categoryId,
    after: {
      options: options ?? null,
      success: result.success,
      ...("version" in result ? { version: result.version } : { refused: result.error }),
    },
  });
  return result;
}
export async function setCategoryDrawOption(
  categoryId: string,
  bronzeMedals: 0 | 1 | 2 | 3 | null
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };

  const admin = await requireTournamentAdmin(cat.tournamentId);

  if (bronzeMedals !== null && ![0, 1, 2, 3].includes(bronzeMedals)) {
    return { success: false, error: "Bronze medals must be 0, 1, 2, 3 or null" };
  }

  await db.update(categories).set({ bronzeMedals }).where(eq(categories.id, categoryId));

  // The setting only shapes a draw when it is generated, so say so when the
  // existing bracket was built with something else.
  const [existing] = await db
    .select({ bronzeMedals: draws.bronzeMedals })
    .from(draws)
    .where(eq(draws.categoryId, categoryId));
  const [tournament] = await db
    .select({ defaultBronzeMedals: tournaments.defaultBronzeMedals })
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));
  const effective = bronzeMedals ?? tournament?.defaultBronzeMedals ?? 2;
  const drawOutdated = existing !== undefined && existing.bronzeMedals !== effective;

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_OPTION_CHANGED",
    targetType: "category",
    targetId: categoryId,
    after: { bronzeMedals, drawOutdated },
  });

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  return { success: true, drawOutdated, drawBronzeMedals: existing?.bronzeMedals ?? null };
}

/**
 * Bulk generate draws for every category in a tournament. Admin only.
 */
export async function generateAllTournamentDraws(
  tournamentId: string,
  options?: { bronzeMedals?: 0 | 1 | 2 | 3; separateByClub?: boolean }
) {
  const admin = await requireTournamentAdmin(tournamentId);
  const result = await performGenerateAllTournamentDraws(tournamentId, options);
  await audit({ tournamentId, actor: admin, action: "DRAWS_GENERATED", after: { options: options ?? null } });
  return result;
}

/**
 * Pre-flight preview report of what "Generate All Draws" will do. Admin only.
 */
export async function getTournamentDrawPreflight(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  return performGetTournamentDrawPreflight(tournamentId);
}

/**
 * Fetches and resolves the full digital draw tree for a category with live match states and athlete names
 */
export async function getCategoryDraw(
  categoryId: string,
  options?: { athleteId?: string | null }
) {
  if (!categoryId || !isValidUuid(categoryId)) return null;

  const staff = await isStaffViewer(categoryId);
  if (!staff) {
    const allowed = options?.athleteId ? true : await publicDrawsEnabledForCategory(categoryId);
    if (!allowed) {
      return {
        locked: true,
        draw: null,
        categoryName: null,
        matches: [] as BracketMatchView[],
        podium: [],
        highlightAthleteId: null as string | null,
      };
    }
  }

  // The draw itself is request-free; the gate above is the only
  // thing this action adds, so the same assembly serves the export.
  return assembleCategoryDraw(categoryId, options);
}

/**
 * The draw as one athlete's family sees it: the same bracket, with that
 * athlete highlighted and everyone else dimmed. Available to the public even
 * when general draw viewing is switched off, because it only reveals a name
 * the searcher already typed.
 */
export async function getAthleteDraw(athleteId: string) {
  if (!athleteId) return null;

  const [athlete] = await db
    .select({ id: athletes.id, name: athletes.name, categoryId: athletes.categoryId })
    .from(athletes)
    .where(eq(athletes.id, athleteId));

  if (!athlete?.categoryId) return null;

  const draw = await getCategoryDraw(athlete.categoryId, { athleteId });
  if (!draw) return null;

  return { ...draw, athleteName: athlete.name, highlightAthleteId: athleteId };
}

export async function lockCategoryDraw(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  await db
    .update(draws)
    .set({ state: "LOCKED", lockedAt: new Date() })
    .where(eq(draws.categoryId, categoryId));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_LOCKED",
    targetType: "category",
    targetId: categoryId,
  });

  return { success: true };
}

export async function unlockCategoryDraw(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  await db
    .update(draws)
    .set({ state: "DRAFT", lockedAt: null })
    .where(eq(draws.categoryId, categoryId));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_UNLOCKED",
    targetType: "category",
    targetId: categoryId,
  });

  return { success: true };
}

export async function toggleCategoryDrawLock(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) return { success: false, error: "No draw generated yet for this category" };

  const isLocked = draw.state === "LOCKED";
  const nextState = isLocked ? "DRAFT" : "LOCKED";
  const lockedAt = isLocked ? null : new Date();

  await db
    .update(draws)
    .set({ state: nextState, lockedAt })
    .where(eq(draws.id, draw.id));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: isLocked ? "DRAW_UNLOCKED" : "DRAW_LOCKED",
    targetType: "category",
    targetId: categoryId,
  });

  return { success: true, isLocked: !isLocked, state: nextState };
}

/** The word an admin must type to flush a category's draw. */
export const FLUSH_CONFIRMATION = "FLUSH";
const MIN_FLUSH_REASON_LENGTH = 5;

/**
 * Completely flushes and purges all draws, matches, slots, and scores for a specific category.
 * Strictly isolated: operates only on the specified categoryId with zero impact on other categories.
 *
 * This is the only way to discard fought bouts. It needs the typed confirmation,
 * and a reason once results exist; the reason, the counts and the draw
 * checksum it destroyed go into the audit log.
 */
export async function flushCategoryDraw(
  categoryId: string,
  confirmation?: { confirm: string; reason?: string }
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  if (confirmation?.confirm?.trim() !== FLUSH_CONFIRMATION) {
    return { success: false, error: `Type ${FLUSH_CONFIRMATION} to confirm.` };
  }

  const reason = confirmation.reason?.trim() ?? "";

  const before = await db.transaction(async (tx) => {
    // 1. Serialise against concurrent scoring/generation, then look at what is about to go.
    await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).for("update");

    const catMatches = await tx
      .select({ id: matches.id, status: matches.status })
      .from(matches)
      .where(eq(matches.categoryId, categoryId));
    const matchIds = catMatches.map((m) => m.id);
    const fought = catMatches.filter((m) => m.status === "CONFIRMED" || m.status === "LIVE").length;

    const [draw] = await tx
      .select({ id: draws.id, version: draws.version, checksum: draws.checksum, state: draws.state })
      .from(draws)
      .where(eq(draws.categoryId, categoryId));

    if (fought > 0 && reason.length < MIN_FLUSH_REASON_LENGTH) {
      return { refused: `This category has ${fought} fought bout(s). Give a reason (at least ${MIN_FLUSH_REASON_LENGTH} characters) to flush it.` };
    }

    // 2. Delete kata_scores, matchEvents, slots, and matches for this category in clean FK order
    if (matchIds.length > 0) {
      await tx.delete(kataScores).where(inArray(kataScores.matchId, matchIds));
      await tx.delete(matchEvents).where(inArray(matchEvents.matchId, matchIds));
      await tx.delete(matchSlots).where(inArray(matchSlots.matchId, matchIds));
      await tx.delete(matches).where(eq(matches.categoryId, categoryId));
    }

    // 3. Delete draw record & version history
    if (draw) {
      await tx.delete(drawVersions).where(eq(drawVersions.drawId, draw.id));
      await tx.delete(draws).where(eq(draws.id, draw.id));
    }

    // 4. Reset expected matches on category
    await tx.update(categories).set({ expectedMatches: 0 }).where(eq(categories.id, categoryId));

    return { matches: matchIds.length, fought, draw: draw ?? null };
  });

  if ("refused" in before) return { success: false, error: before.refused };

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_FLUSHED",
    targetType: "category",
    targetId: categoryId,
    before: { categoryName: cat.name, ...before },
    reason: reason || null,
  });

  return { success: true };
}
