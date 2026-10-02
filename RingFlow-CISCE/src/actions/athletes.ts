"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import { athletes, categories, categoryEntries } from "@/db/schema";
import { eq, and, sql, or, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTournamentStaff, requireTournamentAdmin } from "@/lib/auth/guards";
import { isValidUuid } from "@/lib/utils";
import { inferEventType } from "@/lib/categories/eventType";
import { athleteInputSchema, masterRosterSchema, parseInput, simpleRosterSchema } from "@/lib/validation";
import { syncTournamentCategoryCounts } from "@/lib/categories/syncCounts";

export type AthleteInput = {
  name: string;
  chest_number: string;
  category_id?: string | null;
  school?: string | null;
  school_code?: string | null;
  sports_id?: string | null;
  sex?: string | null;
  age?: string | null;
  belt?: string | null;
  weight?: string | number | null;
};

export async function addAthlete(tournamentId: string, rawInput: AthleteInput) {
  const admin = await requireTournamentAdmin(tournamentId);
  const input = parseInput(athleteInputSchema, rawInput, "athlete");

  const name = (input.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Athlete name is required");

  const chestNumber = (input.chest_number || "").trim().slice(0, 50);

  let targetCategoryId: string | null = null;

  if (input.category_id && input.category_id !== "uncategorized" && input.category_id !== "auto") {
    // Explicit category selection
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, input.category_id),
          eq(categories.tournamentId, tournamentId)
        )
      )
      .limit(1);

    if (cat) {
      targetCategoryId = cat.id;
    }
  } else if (input.category_id === "auto" || !input.category_id) {
    // Auto-assignment attempt if sex / age / belt provided
    const existingCats = await db
      .select()
      .from(categories)
      .where(eq(categories.tournamentId, tournamentId));

    const athleteAge = parseInt(input.age || "0", 10) || 0;
    const aSex = (input.sex || "").trim().toLowerCase();
    const aBelt = (input.belt || "").trim().toLowerCase();

    const matchedCat = existingCats.find((c) => {
      const cBelt = c.belt ? c.belt.trim().toLowerCase() : null;
      const cSex = c.sex ? c.sex.trim().toLowerCase() : null;

      if (cSex && aSex && cSex !== aSex) return false;
      if (cBelt && aBelt && cBelt !== aBelt) return false;
      if (c.ageMin !== null && athleteAge < c.ageMin) return false;
      if (c.ageMax !== null && athleteAge > c.ageMax) return false;
      return true;
    });

    if (matchedCat) {
      targetCategoryId = matchedCat.id;
    }
  }

  await db.insert(athletes).values({
    categoryId: targetCategoryId,
    tournamentId,
    name,
    chestNumber: chestNumber || null,
    school: input.school?.trim().slice(0, 200) || null,
    schoolCode: input.school_code?.trim().slice(0, 50) || null,
    sportsId: input.sports_id?.trim().slice(0, 50) || null,
    sex: input.sex?.trim().slice(0, 20) || null,
    age: input.age ? String(input.age).trim().slice(0, 20) : null,
    belt: input.belt?.trim().slice(0, 50) || null,
    weight: input.weight ? String(input.weight).trim().slice(0, 20) : null,
    dojo: input.school?.trim().slice(0, 200) || null,
  });

  await audit({ tournamentId, categoryId: targetCategoryId, actor: admin, action: "ATHLETE_ADDED", targetType: "athlete", after: { name, chestNumber } });
  await syncTournamentCategoryCounts(tournamentId);
  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
}

export async function deleteAthlete(athleteId: string, tournamentId: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  const [gone] = await db.select({ name: athletes.name, chestNumber: athletes.chestNumber, categoryId: athletes.categoryId }).from(athletes).where(and(eq(athletes.id, athleteId), eq(athletes.tournamentId, tournamentId)));
  if (gone) {
    await audit({ tournamentId, categoryId: gone.categoryId, actor: admin, action: "ATHLETE_DELETED", targetType: "athlete", targetId: athleteId, before: gone });
  }

  await db
    .delete(athletes)
    .where(
      and(eq(athletes.id, athleteId), eq(athletes.tournamentId, tournamentId))
    );

  await syncTournamentCategoryCounts(tournamentId);
  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
}

export async function updateAthleteCategory(
  athleteId: string,
  categoryId: string | null,
  tournamentId: string
) {
  const admin = await requireTournamentAdmin(tournamentId);

  if (categoryId) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, categoryId),
          eq(categories.tournamentId, tournamentId)
        )
      )
      .limit(1);

    if (!cat) throw new Error("Target category not found in this tournament");
  }

  const [athlete] = await db
    .select({ categoryId: athletes.categoryId })
    .from(athletes)
    .where(and(eq(athletes.id, athleteId), eq(athletes.tournamentId, tournamentId)))
    .limit(1);
  if (!athlete) throw new Error("Athlete not found in this tournament");

  await db.transaction(async (tx) => {
    await tx.update(athletes).set({ categoryId }).where(eq(athletes.id, athleteId));

    // The draw reads category_entries too: move the entry for the old category
    // with the athlete, otherwise they would be drawn into both.
    if (athlete.categoryId && athlete.categoryId !== categoryId) {
      if (categoryId) {
        const [already] = await tx
          .select({ id: categoryEntries.id })
          .from(categoryEntries)
          .where(and(eq(categoryEntries.categoryId, categoryId), eq(categoryEntries.athleteId, athleteId)))
          .limit(1);
        if (already) {
          await tx
            .delete(categoryEntries)
            .where(and(eq(categoryEntries.categoryId, athlete.categoryId), eq(categoryEntries.athleteId, athleteId)));
        } else {
          await tx
            .update(categoryEntries)
            .set({ categoryId, seed: null })
            .where(and(eq(categoryEntries.categoryId, athlete.categoryId), eq(categoryEntries.athleteId, athleteId)));
        }
      } else {
        await tx
          .delete(categoryEntries)
          .where(and(eq(categoryEntries.categoryId, athlete.categoryId), eq(categoryEntries.athleteId, athleteId)));
      }
    }
  });

  await audit({ tournamentId, categoryId, actor: admin, action: "ATHLETE_MOVED", targetType: "athlete", targetId: athleteId, before: { categoryId: athlete.categoryId }, after: { categoryId } });
  await syncTournamentCategoryCounts(tournamentId);
  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  revalidatePath(`/admin/event/${tournamentId}/rings/balance`);
}

export async function bulkAddAthletes(
  tournamentId: string,
  categoryName: string,
  rawList: { no: string; name: string }[]
) {
  const admin = await requireTournamentAdmin(tournamentId);
  // Blank spreadsheet rows are skipped, not an error.
  const rawAthletes = parseInput(simpleRosterSchema, rawList, "athlete list").filter((a) => a.name);
  categoryName = String(categoryName ?? "").trim().slice(0, 200);
  if (!categoryName) throw new Error("Category name is required");

  // Find or create category
  const existingCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  let cat = existingCats.find(
    (c) => c.name.toLowerCase().trim() === categoryName.toLowerCase().trim()
  );

  if (!cat) {
    const expectedMatches = Math.max(0, rawAthletes.length - 1);
    const [newCat] = await db
      .insert(categories)
      .values({
        tournamentId,
        name: categoryName,
        eventType: inferEventType(categoryName),
        athletesCount: rawAthletes.length,
        expectedMatches,
        hasFullRoster: true,
      })
      .returning();
    cat = newCat;
  } else {
    const newCount = (cat.athletesCount || 0) + rawAthletes.length;
    await db
      .update(categories)
      .set({
        athletesCount: newCount,
        expectedMatches: Math.max(0, newCount - 1),
      })
      .where(eq(categories.id, cat.id));
  }

  const categoryId = cat.id;

  const toInsert = rawAthletes.map((a) => ({
    categoryId,
    tournamentId,
    name: a.name,
    chestNumber: a.no ? String(a.no) : null,
  }));

  if (toInsert.length > 0) {
    await db.insert(athletes).values(toInsert);
  }

  await audit({ tournamentId, categoryId, actor: admin, action: "ATHLETES_IMPORTED", after: { source: "category list", category: categoryName, count: toInsert.length } });
  await syncTournamentCategoryCounts(tournamentId);
  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return { success: true, count: toInsert.length };
}

export async function bulkAddMasterAthletes(
  tournamentId: string,
  rawList: unknown[]
) {
  const admin = await requireTournamentAdmin(tournamentId);
  // Blank spreadsheet rows are skipped, not an error.
  const rawAthletes = parseInput(masterRosterSchema, rawList, "athlete list").filter((a) => a.name);

  const existingCats = await db
    .select({
      id: categories.id,
      name: categories.name,
      belt: categories.belt,
      ageMin: categories.ageMin,
      ageMax: categories.ageMax,
      sex: categories.sex,
      day: categories.day,
    })
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  const catMap = new Map<string, string>();
  for (const c of existingCats) {
    catMap.set(c.name.toLowerCase().trim(), c.id);
  }

  const toInsert = rawAthletes.map((a) => {
    let matchedId: string | null = null;

    if (a.age && a.sex && a.category) {
      const constructedName = `${a.age.trim()}_${a.sex.trim()}_${a.category.trim()}`.toLowerCase();
      matchedId = catMap.get(constructedName) || null;
    }

    if (!matchedId && a.category_name) {
      matchedId = catMap.get(a.category_name.toLowerCase().trim()) || null;
    }
    if (!matchedId && a.category) {
      matchedId = catMap.get(a.category.toLowerCase().trim()) || null;
    }

    if (!matchedId && a.belt && a.sex) {
      const athleteAge = parseInt(a.age ?? "") || 0;
      const aBelt = a.belt.trim().toLowerCase();
      const aSex = a.sex.trim().toLowerCase();
      const aDay = a.day ? a.day.trim().toLowerCase() : null;

      const matchedCat = existingCats.find((c) => {
        const cBelt = c.belt ? c.belt.trim().toLowerCase() : null;
        const cSex = c.sex ? c.sex.trim().toLowerCase() : null;
        const cDay = c.day ? c.day.trim().toLowerCase() : null;

        return (
          cBelt === aBelt &&
          cSex === aSex &&
          (!cDay || cDay === aDay) &&
          (c.ageMin === null || athleteAge >= c.ageMin) &&
          (c.ageMax === null || athleteAge <= c.ageMax)
        );
      });
      if (matchedCat) {
        matchedId = matchedCat.id;
      }
    }

    return {
      categoryId: matchedId,
      tournamentId,
      name: a.name,
      chestNumber: a.no ? String(a.no) : null,
      belt: a.belt || null,
      age: a.age ? String(a.age) : null,
      sex: a.sex || null,
      school: a.school || a.dojo || null,
      schoolCode: a.school_code || null,
      sportsId: a.sports_id || null,
      day: a.day || null,
    };
  });

  if (toInsert.length > 0) {
    await db.insert(athletes).values(toInsert);
  }

  await audit({ tournamentId, actor: admin, action: "ATHLETES_IMPORTED", after: { source: "master list", count: toInsert.length, uncategorized: toInsert.filter((a) => !a.categoryId).length } });
  await syncTournamentCategoryCounts(tournamentId);
  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return { success: true, count: toInsert.length };
}

/**
 * Athlete search by name or chest number. Public (the spectator page uses it),
 * so it returns only what a spectator needs; staff also get the category PDF link.
 */
export async function searchTournamentAthletes(
  tournamentId: string,
  query: string,
  categoryIds?: string[]
) {
  if (!isValidUuid(tournamentId)) return [];
  const cleanQ = String(query || "").trim().replace(/^#/, "").slice(0, 100);
  const cleanCategoryIds = (Array.isArray(categoryIds) ? categoryIds : []).filter(isValidUuid).slice(0, 50);
  if (!cleanQ && cleanCategoryIds.length === 0) return [];

  const isStaff = Boolean(await getTournamentStaff(tournamentId));

  // LIKE wildcards typed into the search box are dropped, not interpreted.
  const words = cleanQ
    .split(/[\s\u00A0\u2000-\u200B]+/)
    .filter(Boolean)
    .map((w) => w.replace(/[%_]/g, ""))
    .filter(Boolean);
  const pattern = words.length > 0 ? `%${words.join("%")}%` : "";

  const whereConditions = [eq(athletes.tournamentId, tournamentId)];

  const textMatches = [];
  if (pattern) {
    textMatches.push(sql`LOWER(${athletes.name}) LIKE LOWER(${pattern})`);
    textMatches.push(sql`LOWER(COALESCE(${athletes.chestNumber}, '')) LIKE LOWER(${pattern})`);
  }
  if (cleanCategoryIds.length > 0) {
    textMatches.push(inArray(athletes.categoryId, cleanCategoryIds));
  }

  if (textMatches.length > 0) {
    whereConditions.push(or(...textMatches)!);
  }

  const results = await db
    .select({
      id: athletes.id,
      name: athletes.name,
      chestNumber: athletes.chestNumber,
      categoryId: athletes.categoryId,
      categoryName: categories.name,
      categoryDocUrl: categories.docUrl,
    })
    .from(athletes)
    .leftJoin(categories, eq(athletes.categoryId, categories.id))
    .where(and(...whereConditions))
    .limit(30);

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    chest_number: r.chestNumber,
    chestNumber: r.chestNumber,
    category_id: r.categoryId,
    categories: r.categoryId
      ? { id: r.categoryId, name: r.categoryName, doc_url: isStaff ? r.categoryDocUrl : null }
      : null,
  }));
}
