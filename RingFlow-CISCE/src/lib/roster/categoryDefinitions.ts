/**
 * Category definitions (age/weight/gender rules) and the operational
 * categories created from them. No authorization here: the actions in
 * `actions/categoryDefinitions.ts` and the seed scripts call these.
 */
import { db } from "@/db";
import {
  tournamentCategoryDefinitions,
  categories,
} from "@/db/schema";
import { inferEventType, isEventType } from "@/lib/categories/eventType";
import { eq } from "drizzle-orm";

import { OFFICIAL_PRESETS, type CategoryDefinitionInput } from "@/lib/constants/categoryPresets";

export async function readCategoryDefinitions(tournamentId: string) {
  return await db
    .select()
    .from(tournamentCategoryDefinitions)
    .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));
}

export async function writeCategoryDefinitions(
  tournamentId: string,
  defs: CategoryDefinitionInput[]
) {
  if (!Array.isArray(defs) || defs.length > 500) {
    throw new Error("Provide at most 500 category definitions");
  }
  for (const d of defs) {
    if (!d || typeof d.categoryName !== "string" || !d.categoryName.trim()) {
      throw new Error("Every category definition needs a name");
    }
    if (!isEventType(d.eventType)) throw new Error(`Unknown event type: ${String(d.eventType)}`);
    if (d.gender !== "M" && d.gender !== "F" && d.gender !== "any") {
      throw new Error(`Gender must be M, F or any (got ${String(d.gender)})`);
    }
  }

  // Save or replace definitions
  await db.transaction(async (tx) => {
    // Delete existing definitions
    await tx
      .delete(tournamentCategoryDefinitions)
      .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));

    if (defs.length > 0) {
      await tx.insert(tournamentCategoryDefinitions).values(
        defs.map((d) => ({
          tournamentId,
          categoryName: d.categoryName.trim().slice(0, 200),
          eventType: d.eventType,
          gender: d.gender,
          minAge: d.minAge ?? null,
          maxAge: d.maxAge ?? null,
          minWeight: d.minWeight != null ? String(d.minWeight) : null,
          maxWeight: d.maxWeight != null ? String(d.maxWeight) : null,
          rules: d.rules ?? {},
        }))
      );
    }
  });

  // Automatically ensure operational categories exist in `categories` table
  await syncCategoriesFromDefinitionsCore(tournamentId);

  return { success: true, count: defs.length };
}

export async function writePresetCategoryDefinitions(
  tournamentId: string,
  presetKey: string
) {
  const preset = OFFICIAL_PRESETS[presetKey];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetKey}`);
  }
  return await writeCategoryDefinitions(tournamentId, preset);
}

/**
 * Ensures a matching row in public.categories exists for each category definition
 */
export async function syncCategoriesFromDefinitionsCore(tournamentId: string) {
  const defs = await db
    .select()
    .from(tournamentCategoryDefinitions)
    .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));

  const existingCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  const existingMap = new Map(
    existingCats.map((c) => [c.name.toLowerCase().trim(), c])
  );

  for (const def of defs) {
    const norm = def.categoryName.toLowerCase().trim();
    const existing = existingMap.get(norm);
    const defType = isEventType(def.eventType) ? def.eventType : inferEventType(def.categoryName);
    if (existing && existing.eventType !== defType) {
      // The definition is the source of truth for the discipline.
      await db.update(categories).set({ eventType: defType }).where(eq(categories.id, existing.id));
    }
    if (!existing) {
      await db.insert(categories).values({
        tournamentId,
        name: def.categoryName,
        ageBracket: def.minAge && def.maxAge ? `${def.minAge}-${def.maxAge}` : null,
        weightClass:
          def.minWeight && def.maxWeight
            ? `${def.minWeight}-${def.maxWeight} kg`
            : null,
        eventType: defType,
        sex: def.gender === "any" ? null : def.gender,
        ageMin: def.minAge,
        ageMax: def.maxAge,
        athletesCount: 0,
        expectedMatches: 0,
        hasFullRoster: false,
      });
    }
  }
}
