/**
 * Official roster import: one row per athlete with the events they entered;
 * athletes are placed into categories using the tournament's definitions.
 * No authorization here: `actions/officialImport.ts` and the seed scripts call it.
 */
import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  tournamentCategoryDefinitions,
  tournamentRegistrations,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { inferEventType, isEventType } from "@/lib/categories/eventType";

export type RawImportAthlete = {
  name: string;
  chestNumber?: string | null;
  school?: string | null;
  schoolCode?: string | null;
  sportsId?: string | null;
  belt?: string | null;
  age?: number | string | null;
  sex?: string | null;
  weight?: number | string | null;
  kata?: boolean | string | null;
  kumite?: boolean | string | null;
  teamKata?: boolean | string | null;
  teamKumite?: boolean | string | null;
};

export type ImportResult = {
  success: boolean;
  totalAthletes: number;
  kataEntriesCreated: number;
  kumiteEntriesCreated: number;
  teamKataEntriesCreated: number;
  teamKumiteEntriesCreated: number;
  uncategorized: Array<{
    name: string;
    reason: string;
  }>;
};

function normalizeBoolean(val: any): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "1";
  }
  return false;
}

function normalizeGender(val: any): "M" | "F" | "any" {
  if (!val) return "any";
  const s = String(val).trim().toLowerCase();
  if (s === "m" || s === "male" || s === "boy") return "M";
  if (s === "f" || s === "female" || s === "girl") return "F";
  return "any";
}

function normalizeNumber(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const cleaned = String(val).replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export async function importOfficialRosterCore(
  tournamentId: string,
  rawAthletes: RawImportAthlete[]
): Promise<ImportResult> {
  // 1. Fetch category definitions for this tournament
  const definitions = await db
    .select()
    .from(tournamentCategoryDefinitions)
    .where(eq(tournamentCategoryDefinitions.tournamentId, tournamentId));

  // 2. Fetch or ensure operational categories exist
  const existingCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  const catByName = new Map(
    existingCategories.map((c) => [c.name.toLowerCase().trim(), c])
  );

  // Helper to get or create operational category by name
  async function getCategory(catName: string, def: any) {
    const norm = catName.toLowerCase().trim();
    let cat = catByName.get(norm);
    if (!cat) {
      const [newCat] = await db
        .insert(categories)
        .values({
          tournamentId,
          name: catName,
          eventType: isEventType(def.eventType) ? def.eventType : inferEventType(catName),
          ageBracket: def.minAge && def.maxAge ? `${def.minAge}-${def.maxAge}` : null,
          weightClass:
            def.minWeight && def.maxWeight
              ? `${def.minWeight}-${def.maxWeight} kg`
              : null,
          sex: def.gender === "any" ? null : def.gender,
          ageMin: def.minAge,
          ageMax: def.maxAge,
          athletesCount: 0,
          expectedMatches: 0,
          hasFullRoster: false,
        })
        .returning();
      cat = newCat;
      catByName.set(norm, cat);
    }
    return cat;
  }

  const result: ImportResult = {
    success: true,
    totalAthletes: 0,
    kataEntriesCreated: 0,
    kumiteEntriesCreated: 0,
    teamKataEntriesCreated: 0,
    teamKumiteEntriesCreated: 0,
    uncategorized: [],
  };

  if (!Array.isArray(rawAthletes) || rawAthletes.length > 10000) {
    throw new Error("Import at most 10,000 athletes at a time");
  }

  for (const item of rawAthletes) {
    const name = (item.name || "").trim();
    if (!name) continue;

    result.totalAthletes++;

    const age = normalizeNumber(item.age);
    const weight = normalizeNumber(item.weight);
    const gender = normalizeGender(item.sex);

    const wantsKata = normalizeBoolean(item.kata);
    const wantsKumite = normalizeBoolean(item.kumite);
    const wantsTeamKata = normalizeBoolean(item.teamKata);
    const wantsTeamKumite = normalizeBoolean(item.teamKumite);

    // If no events specified explicitly, assume kumite if weight is provided, else kata
    const effectiveKumite = wantsKumite || (!wantsKata && weight != null && weight > 0);
    const effectiveKata = wantsKata || (!effectiveKumite && !wantsKumite);

    // 1. Create the athlete, or update the existing one with the same chest
    //    number, so importing a corrected sheet does not duplicate people.
    const chestNumber = item.chestNumber ? String(item.chestNumber).trim().slice(0, 50) : null;
    const [existingAthlete] = chestNumber
      ? await db
          .select({ id: athletes.id })
          .from(athletes)
          .where(and(eq(athletes.tournamentId, tournamentId), eq(athletes.chestNumber, chestNumber)))
          .limit(1)
      : [];

    const athleteValues = {
      tournamentId,
      name: name.slice(0, 200),
      chestNumber,
      school: item.school ? String(item.school).trim().slice(0, 200) : null,
      schoolCode: item.schoolCode ? String(item.schoolCode).trim().slice(0, 50) : null,
      sportsId: item.sportsId ? String(item.sportsId).trim().slice(0, 50) : null,
      dojo: item.school ? String(item.school).trim().slice(0, 200) : null,
      belt: item.belt ? String(item.belt).trim().slice(0, 50) : null,
      age: age != null ? String(age) : null,
      sex: gender !== "any" ? gender : null,
      weight: weight != null ? String(weight) : null,
    };

    const [athlete] = existingAthlete
      ? await db.update(athletes).set(athleteValues).where(eq(athletes.id, existingAthlete.id)).returning()
      : await db.insert(athletes).values(athleteValues).returning();

    // 2. Create tournament registration
    const registrationValues = {
      weight: weight != null ? String(weight) : null,
      kata: effectiveKata,
      kumite: effectiveKumite,
      teamKata: wantsTeamKata,
      teamKumite: wantsTeamKumite,
    };
    const [registration] = await db
      .insert(tournamentRegistrations)
      .values({ tournamentId, athleteId: athlete.id, ...registrationValues })
      .onConflictDoUpdate({
        target: [tournamentRegistrations.tournamentId, tournamentRegistrations.athleteId],
        set: registrationValues,
      })
      .returning();

    let matchedAnyCategory = false;
    const failureReasons: string[] = [];
    let primaryCatId: string | null = null;

    // 3. Match Kata
    if (effectiveKata) {
      const matchedKataDef = definitions.find((d) => {
        if (d.eventType !== "kata") return false;
        if (d.gender !== "any" && gender !== "any" && d.gender !== gender) return false;
        if (d.minAge != null && age != null && age < d.minAge) return false;
        if (d.maxAge != null && age != null && age > d.maxAge) return false;
        return true;
      });

      if (matchedKataDef) {
        const cat = await getCategory(matchedKataDef.categoryName, matchedKataDef);
        await db
          .insert(categoryEntries)
          .values({
            categoryId: cat.id,
            registrationId: registration.id,
            athleteId: athlete.id,
          })
          .onConflictDoNothing();

        result.kataEntriesCreated++;
        matchedAnyCategory = true;
        primaryCatId = cat.id;
      } else {
        failureReasons.push(`Kata: No matching age/gender category found for age ${age}, gender ${gender}`);
      }
    }

    // 4. Match Kumite
    if (effectiveKumite) {
      if (weight == null || weight <= 0) {
        failureReasons.push("Kumite: Weight is missing or 0 kg");
      } else {
        const matchedKumiteDef = definitions.find((d) => {
          if (d.eventType !== "kumite") return false;
          if (d.gender !== "any" && gender !== "any" && d.gender !== gender) return false;
          if (d.minAge != null && age != null && age < d.minAge) return false;
          if (d.maxAge != null && age != null && age > d.maxAge) return false;
          const minW = d.minWeight != null ? parseFloat(d.minWeight) : null;
          const maxW = d.maxWeight != null ? parseFloat(d.maxWeight) : null;
          if (minW != null && weight < minW) return false;
          if (maxW != null && weight > maxW) return false;
          return true;
        });

        if (matchedKumiteDef) {
          const cat = await getCategory(matchedKumiteDef.categoryName, matchedKumiteDef);
          await db
            .insert(categoryEntries)
            .values({
              categoryId: cat.id,
              registrationId: registration.id,
              athleteId: athlete.id,
            })
            .onConflictDoNothing();

          result.kumiteEntriesCreated++;
          matchedAnyCategory = true;
          primaryCatId = cat.id; // prefer kumite as primary
        } else {
          failureReasons.push(`Kumite: No weight bracket matched for ${weight}kg, age ${age}, gender ${gender}`);
        }
      }
    }

    // Backward compatibility: link primary category on athlete row
    if (primaryCatId) {
      await db
        .update(athletes)
        .set({ categoryId: primaryCatId })
        .where(eq(athletes.id, athlete.id));
    }

    if (!matchedAnyCategory && failureReasons.length > 0) {
      result.uncategorized.push({
        name: athlete.name,
        reason: failureReasons.join("; "),
      });
    }
  }

  // 5. Update athletesCount and expectedMatches on all categories
  const allCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  for (const cat of allCats) {
    const entries = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(categoryEntries)
      .where(eq(categoryEntries.categoryId, cat.id));

    const count = entries[0]?.count || 0;
    const expected = Math.max(0, count - 1);

    await db
      .update(categories)
      .set({
        athletesCount: count,
        expectedMatches: expected,
        hasFullRoster: count > 0,
      })
      .where(eq(categories.id, cat.id));
  }

  return result;
}
