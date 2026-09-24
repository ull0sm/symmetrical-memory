"use server";

import { db } from "@/db";
import { categories, tournaments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ensureAdminOwnsTournament } from "./admin";
import { CategoryInput } from "./tournament";
import { syncTournamentCategoryCounts } from "@/lib/categories/syncCounts";

export async function addCategory(tournamentId: string, input: CategoryInput) {
  await ensureAdminOwnsTournament(tournamentId);

  const name = (input.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Category name is required");

  const athletesCount = Math.max(
    0,
    Math.min(10000, Math.floor(Number(input.athletes_count) || 0))
  );
  const expectedMatches = Math.max(0, athletesCount - 1);

  const [newCat] = await db
    .insert(categories)
    .values({
      tournamentId,
      name,
      ageBracket: (input.age_bracket || "").trim().slice(0, 100) || null,
      weightClass: (input.weight_class || "").trim().slice(0, 100) || null,
      athletesCount,
      expectedMatches,
      hasFullRoster: false,
    })
    .returning();

  await syncTournamentCategoryCounts(tournamentId);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return newCat;
}

export async function bulkAddCategories(tournamentId: string, inputCategories: any[]) {
  await ensureAdminOwnsTournament(tournamentId);

  const toInsert = (Array.isArray(inputCategories) ? inputCategories : []).map(
    (cat) => {
      const athletesCount = Math.max(
        0,
        Math.min(10000, Math.floor(Number(cat.athletes_count) || 0))
      );
      return {
        tournamentId,
        name: (cat.name || "").trim().slice(0, 200),
        ageBracket: (cat.age_bracket || "").trim().slice(0, 100) || null,
        weightClass: (cat.weight_class || "").trim().slice(0, 100) || null,
        athletesCount,
        expectedMatches: Math.max(0, athletesCount - 1),
        hasFullRoster: false,
        belt: cat.belt ? String(cat.belt).trim().slice(0, 50) : null,
        ageMin: typeof cat.age_min === "number" ? cat.age_min : null,
        ageMax: typeof cat.age_max === "number" ? cat.age_max : null,
        sex: cat.sex ? String(cat.sex).trim().slice(0, 20) : null,
        day: cat.day ? String(cat.day).trim().slice(0, 50) : null,
      };
    }
  );

  if (toInsert.length > 0) {
    await db.insert(categories).values(toInsert);
    await syncTournamentCategoryCounts(tournamentId);
  }

  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return { success: true, count: toInsert.length };
}

export async function updateCategory(
  categoryId: string,
  tournamentId: string,
  updates: Partial<CategoryInput> & { expected_matches?: number }
) {
  await ensureAdminOwnsTournament(tournamentId);

  const patch: Record<string, any> = {};
  if (updates.name !== undefined) patch.name = updates.name.trim().slice(0, 200);
  if (updates.age_bracket !== undefined)
    patch.ageBracket = updates.age_bracket.trim().slice(0, 100);
  if (updates.weight_class !== undefined)
    patch.weightClass = updates.weight_class.trim().slice(0, 100);
  if (updates.athletes_count !== undefined) {
    const count = Math.max(0, Math.floor(Number(updates.athletes_count) || 0));
    patch.athletesCount = count;
    patch.expectedMatches = Math.max(0, count - 1);
  }
  if (updates.expected_matches !== undefined) {
    patch.expectedMatches = updates.expected_matches;
  }

  await db
    .update(categories)
    .set(patch)
    .where(
      and(eq(categories.id, categoryId), eq(categories.tournamentId, tournamentId))
    );

  revalidatePath(`/admin/event/${tournamentId}/categories`);
}

export async function deleteCategory(categoryId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db
    .delete(categories)
    .where(
      and(eq(categories.id, categoryId), eq(categories.tournamentId, tournamentId))
    );

  revalidatePath(`/admin/event/${tournamentId}/categories`);
}

export async function updateCategoryKataSettings(
  categoryId: string,
  tournamentId: string,
  settings: {
    kataFormat?: string; // 'BRACKET' | 'GROUP_POOLS' | 'ROUND_ROBIN'
    kataScoringMode?: string; // 'FLAG' | 'POINTS'
    poolSize?: number;
    advancePerPool?: number;
  }
) {
  await ensureAdminOwnsTournament(tournamentId);

  const patch: Record<string, any> = {};
  if (settings.kataFormat !== undefined) patch.kataFormat = settings.kataFormat;
  if (settings.kataScoringMode !== undefined) patch.kataScoringMode = settings.kataScoringMode;
  if (settings.poolSize !== undefined) {
    patch.poolSize = Math.max(2, Math.min(64, Math.floor(Number(settings.poolSize) || 8)));
  }
  if (settings.advancePerPool !== undefined) {
    patch.advancePerPool = Math.max(1, Math.min(16, Math.floor(Number(settings.advancePerPool) || 2)));
  }

  await db
    .update(categories)
    .set(patch)
    .where(
      and(eq(categories.id, categoryId), eq(categories.tournamentId, tournamentId))
    );

  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return { success: true };
}
