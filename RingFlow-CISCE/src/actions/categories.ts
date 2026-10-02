"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import { CategoryInput } from "./tournament";
import { syncTournamentCategoryCounts } from "@/lib/categories/syncCounts";
import { inferEventType, isEventType } from "@/lib/categories/eventType";
import { categoryInputSchema, parseInput } from "@/lib/validation";

export async function addCategory(tournamentId: string, rawInput: CategoryInput) {
  const admin = await requireTournamentAdmin(tournamentId);
  const input = parseInput(categoryInputSchema, rawInput, "category");

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
      eventType: inferEventType(name),
      ageBracket: (input.age_bracket || "").trim().slice(0, 100) || null,
      weightClass: (input.weight_class || "").trim().slice(0, 100) || null,
      athletesCount,
      expectedMatches,
      hasFullRoster: false,
    })
    .returning();

  await audit({ tournamentId, categoryId: newCat.id, actor: admin, action: "CATEGORY_ADDED", targetType: "category", targetId: newCat.id, after: { name } });
  await syncTournamentCategoryCounts(tournamentId);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return newCat;
}

export async function bulkAddCategories(tournamentId: string, inputCategories: Record<string, unknown>[]) {
  const admin = await requireTournamentAdmin(tournamentId);
  if (!Array.isArray(inputCategories) || inputCategories.length > 2000) {
    throw new Error("Provide at most 2000 categories");
  }

  const toInsert = (Array.isArray(inputCategories) ? inputCategories : []).map(
    (cat) => {
      const athletesCount = Math.max(
        0,
        Math.min(10000, Math.floor(Number(cat.athletes_count) || 0))
      );
      const catName = String(cat.name || "").trim().slice(0, 200);
      return {
        tournamentId,
        name: catName,
        eventType: isEventType(cat.event_type) ? cat.event_type : inferEventType(catName),
        ageBracket: String(cat.age_bracket ?? "").trim().slice(0, 100) || null,
        weightClass: String(cat.weight_class ?? "").trim().slice(0, 100) || null,
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

  const named = toInsert.filter((c) => c.name.length > 0);
  if (named.length > 0) {
    await db.insert(categories).values(named);
    await audit({ tournamentId, actor: admin, action: "CATEGORIES_BULK_ADDED", after: { count: named.length, names: named.map((c) => c.name).slice(0, 200) } });
    await syncTournamentCategoryCounts(tournamentId);
  }

  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return { success: true, count: named.length };
}

export async function updateCategory(
  categoryId: string,
  tournamentId: string,
  updates: Partial<CategoryInput> & { expected_matches?: number }
) {
  const admin = await requireTournamentAdmin(tournamentId);

  const patch: Record<string, any> = {};
  if (updates.name !== undefined) {
    const nextName = updates.name.trim().slice(0, 200);
    if (!nextName) throw new Error("Category name is required");
    patch.name = nextName;
  }
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
    patch.expectedMatches = Math.max(0, Math.min(10000, Math.floor(Number(updates.expected_matches) || 0)));
  }
  if (Object.keys(patch).length === 0) return;
  const [beforeCat] = await db
    .select({ name: categories.name, ageBracket: categories.ageBracket, weightClass: categories.weightClass, athletesCount: categories.athletesCount, expectedMatches: categories.expectedMatches })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.tournamentId, tournamentId)));
  if (!beforeCat) throw new Error("Category not found in this tournament");
  await audit({ tournamentId, categoryId, actor: admin, action: "CATEGORY_UPDATED", targetType: "category", targetId: categoryId, before: beforeCat, after: patch });

  await db
    .update(categories)
    .set(patch)
    .where(
      and(eq(categories.id, categoryId), eq(categories.tournamentId, tournamentId))
    );

  revalidatePath(`/admin/event/${tournamentId}/categories`);
}

export async function deleteCategory(categoryId: string, tournamentId: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  const [beforeCat] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.tournamentId, tournamentId)));
  if (!beforeCat) throw new Error("Category not found in this tournament");
  await audit({ tournamentId, actor: admin, action: "CATEGORY_DELETED", targetType: "category", targetId: categoryId, before: beforeCat });

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
  const admin = await requireTournamentAdmin(tournamentId);

  const patch: Record<string, any> = {};
  if (settings.kataFormat !== undefined) {
    if (settings.kataFormat !== "BRACKET" && settings.kataFormat !== "GROUP_POOLS") {
      throw new Error("Kata format must be BRACKET or GROUP_POOLS");
    }
    patch.kataFormat = settings.kataFormat;
  }
  if (settings.kataScoringMode !== undefined) {
    if (settings.kataScoringMode !== "FLAG" && settings.kataScoringMode !== "POINTS") {
      throw new Error("Kata scoring mode must be FLAG or POINTS");
    }
    patch.kataScoringMode = settings.kataScoringMode;
  }
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

  await audit({ tournamentId, categoryId, actor: admin, action: "CATEGORY_KATA_SETTINGS", targetType: "category", targetId: categoryId, after: patch });
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return { success: true };
}
