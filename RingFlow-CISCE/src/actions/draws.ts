"use server";

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
import { resolveDraw } from "@/engine/draw-engine";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { tournaments } from "@/db/schema";
import { ensureAdminOwnsTournament } from "./admin";
import {
  performCategoryDraw,
  performGenerateAllTournamentDraws,
  performGetTournamentDrawPreflight,
} from "@/lib/draws/generateDraws";
import { isAnyStaff } from "@/lib/staffAccess";

/**
 * Staff (moderator, organiser, admin) may always open a full bracket. The
 * public may only open one when the admin enabled public draws — or when they
 * reached it through their own athlete's search result, which is scoped to a
 * single name they already know.
 */
async function isStaffViewer(): Promise<boolean> {
  return isAnyStaff();
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
  options?: { bronzeMedals?: 0 | 1 | 2 | 3; separateByClub?: boolean; forceRegenerate?: boolean }
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };

  await ensureAdminOwnsTournament(cat.tournamentId);
  return performCategoryDraw(categoryId, options);
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

  await ensureAdminOwnsTournament(cat.tournamentId);

  if (bronzeMedals !== null && ![0, 1, 2, 3].includes(bronzeMedals)) {
    return { success: false, error: "Bronze medals must be 0, 1, 2, 3 or null" };
  }

  await db.update(categories).set({ bronzeMedals }).where(eq(categories.id, categoryId));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  return { success: true };
}

/**
 * Bulk generate draws for every category in a tournament. Admin only.
 */
export async function generateAllTournamentDraws(
  tournamentId: string,
  options?: { bronzeMedals?: 0 | 1 | 2 | 3; separateByClub?: boolean }
) {
  await ensureAdminOwnsTournament(tournamentId);
  return performGenerateAllTournamentDraws(tournamentId, options);
}

/**
 * Pre-flight preview report of what "Generate All Draws" will do. Admin only.
 */
export async function getTournamentDrawPreflight(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);
  return performGetTournamentDrawPreflight(tournamentId);
}

/**
 * Fetches and resolves the full digital draw tree for a category with live match states and athlete names
 */
export async function getCategoryDraw(
  categoryId: string,
  options?: { athleteId?: string | null }
) {
  if (!categoryId) return null;

  const staff = await isStaffViewer();
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
  await ensureAdminOwnsTournament(cat.tournamentId);

  await db
    .update(draws)
    .set({ state: "LOCKED", lockedAt: new Date() })
    .where(eq(draws.categoryId, categoryId));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  return { success: true };
}

export async function unlockCategoryDraw(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  await ensureAdminOwnsTournament(cat.tournamentId);

  await db
    .update(draws)
    .set({ state: "DRAFT", lockedAt: null })
    .where(eq(draws.categoryId, categoryId));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  return { success: true };
}

export async function toggleCategoryDrawLock(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  await ensureAdminOwnsTournament(cat.tournamentId);

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

  return { success: true, isLocked: !isLocked, state: nextState };
}

/**
 * Completely flushes and purges all draws, matches, slots, and scores for a specific category.
 * Strictly isolated: operates only on the specified categoryId with zero impact on other categories.
 */
export async function flushCategoryDraw(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  await ensureAdminOwnsTournament(cat.tournamentId);

  await db.transaction(async (tx) => {
    // 1. Find all matches for this category
    const catMatches = await tx
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.categoryId, categoryId));
    const matchIds = catMatches.map((m) => m.id);

    // 2. Delete kata_scores, matchEvents, slots, and matches for this category in clean FK order
    if (matchIds.length > 0) {
      await tx.delete(kataScores).where(inArray(kataScores.matchId, matchIds));
      await tx.delete(matchEvents).where(inArray(matchEvents.matchId, matchIds));
      await tx.delete(matchSlots).where(inArray(matchSlots.matchId, matchIds));
      await tx.delete(matches).where(eq(matches.categoryId, categoryId));
    }

    // 3. Find and delete draw record & version history
    const [draw] = await tx
      .select({ id: draws.id })
      .from(draws)
      .where(eq(draws.categoryId, categoryId));

    if (draw) {
      await tx.delete(drawVersions).where(eq(drawVersions.drawId, draw.id));
      await tx.delete(draws).where(eq(draws.id, draw.id));
    }

    // 4. Reset expected matches on category
    await tx
      .update(categories)
      .set({ expectedMatches: 0 })
      .where(eq(categories.id, categoryId));
  });

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  return { success: true };
}
