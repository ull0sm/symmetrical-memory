/**
 * Divisions (a Local tournament's "Categories") and the tournament's Local
 * settings. No authorization here: the actions in `actions/divisions.ts` guard
 * these, and seed scripts may call them directly.
 */
import { and, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, categoryAssignments, divisionEvents, divisionHolds, divisions, draws, tournaments } from "@/db/schema";
import { DIVISION_EVENT_TYPES, DIVISION_SEXES, LOCAL_EVENT_ORDERS, type DivisionEventType, type DivisionSex, type LocalEventOrder } from "@/lib/statuses";
import { canonicalBelt, divisionName, generateDivisionShapes, groupName, type DivisionShape, type GenerateSpec } from "./rules";

/** An expected refusal (not a bug): the action returns its message to the screen. */
export class LocalSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalSetupError";
  }
}

export const MAX_BELT_LEVELS = 30;
export const MAX_DIVISIONS = 1000;

export interface LocalSettings {
  beltLevels: string[];
  localBronzeMedals: 1 | 2;
  localKumiteGroupSize: number;
  localKataGroupSize: number;
  localBoutDurationMs: number | null;
  localEventOrder: LocalEventOrder;
}

export async function readLocalSettings(tournamentId: string): Promise<LocalSettings> {
  const [t] = await db
    .select({
      beltLevels: tournaments.beltLevels,
      localBronzeMedals: tournaments.localBronzeMedals,
      localKumiteGroupSize: tournaments.localKumiteGroupSize,
      localKataGroupSize: tournaments.localKataGroupSize,
      localBoutDurationMs: tournaments.localBoutDurationMs,
      localEventOrder: tournaments.localEventOrder,
    })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  if (!t) throw new LocalSetupError("Tournament not found.");
  return {
    beltLevels: Array.isArray(t.beltLevels) ? t.beltLevels : [],
    localBronzeMedals: t.localBronzeMedals === 1 ? 1 : 2,
    localKumiteGroupSize: t.localKumiteGroupSize,
    localKataGroupSize: t.localKataGroupSize,
    localBoutDurationMs: t.localBoutDurationMs,
    localEventOrder: t.localEventOrder === "KATA_FIRST" ? "KATA_FIRST" : "KUMITE_FIRST",
  };
}

const intIn = (value: unknown, min: number, max: number): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Validates and stores the Local settings. Returns what was stored before and after. */
export async function updateLocalSettingsCore(tournamentId: string, patch: Partial<LocalSettings>) {
  const before = await readLocalSettings(tournamentId);
  const next: LocalSettings = { ...before };

  if (patch.beltLevels !== undefined) {
    const seen = new Set<string>();
    const belts: string[] = [];
    for (const raw of patch.beltLevels) {
      const belt = String(raw ?? "").trim().slice(0, 40);
      if (!belt || seen.has(belt.toLowerCase())) continue;
      seen.add(belt.toLowerCase());
      belts.push(belt);
    }
    if (belts.length === 0) throw new LocalSetupError("The belt list needs at least one belt.");
    if (belts.length > MAX_BELT_LEVELS) throw new LocalSetupError(`The belt list can hold at most ${MAX_BELT_LEVELS} belts.`);
    next.beltLevels = belts;
  }
  if (patch.localBronzeMedals !== undefined) {
    if (patch.localBronzeMedals !== 1 && patch.localBronzeMedals !== 2) throw new LocalSetupError("Bronzes must be 1 or 2.");
    next.localBronzeMedals = patch.localBronzeMedals;
  }
  for (const key of ["localKumiteGroupSize", "localKataGroupSize"] as const) {
    if (patch[key] === undefined) continue;
    const size = intIn(patch[key], 1, 32);
    if (size === null) throw new LocalSetupError("A group size must be a whole number from 1 to 32.");
    next[key] = size;
  }
  if (patch.localBoutDurationMs !== undefined) {
    if (patch.localBoutDurationMs === null) next.localBoutDurationMs = null;
    else {
      const ms = intIn(patch.localBoutDurationMs, 10_000, 600_000);
      if (ms === null) throw new LocalSetupError("A bout must last between 10 seconds and 10 minutes.");
      next.localBoutDurationMs = ms;
    }
  }
  if (patch.localEventOrder !== undefined) {
    if (!LOCAL_EVENT_ORDERS.includes(patch.localEventOrder)) throw new LocalSetupError("Unknown event order.");
    next.localEventOrder = patch.localEventOrder;
  }

  await db
    .update(tournaments)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));
  return { before, after: next };
}

export interface DivisionInput {
  /** Optional: generated from belt, age and sex when empty. */
  name?: string | null;
  sex: DivisionSex;
  ageMin: number | null;
  ageMax: number | null;
  belts: readonly string[];
  /** Which events the category holds. Both by default. */
  kumite?: boolean;
  kata?: boolean;
}

/** A division's shape checked against the tournament's belt list; belts come back in the list's order. */
function cleanShape(input: Omit<DivisionInput, "name" | "kumite" | "kata">, beltLevels: readonly string[]): DivisionShape {
  if (!DIVISION_SEXES.includes(input.sex)) throw new LocalSetupError("Sex must be M, F or mixed.");
  const ageMin = input.ageMin === null || input.ageMin === undefined ? null : intIn(input.ageMin, 0, 99);
  const ageMax = input.ageMax === null || input.ageMax === undefined ? null : intIn(input.ageMax, 0, 99);
  if ((input.ageMin != null && ageMin === null) || (input.ageMax != null && ageMax === null)) {
    throw new LocalSetupError("Ages must be whole numbers from 0 to 99.");
  }
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) throw new LocalSetupError("The youngest age is above the oldest.");

  const wanted = new Set<string>();
  for (const b of input.belts) {
    const belt = canonicalBelt(b, beltLevels);
    if (belt === null) throw new LocalSetupError(`"${b}" is not in the belt list.`);
    wanted.add(belt);
  }
  return { sex: input.sex, ageMin, ageMax, belts: beltLevels.filter((b) => wanted.has(b)) };
}

async function nextSortOrder(tournamentId: string): Promise<number> {
  const [row] = await db.select({ m: max(divisions.sortOrder) }).from(divisions).where(eq(divisions.tournamentId, tournamentId));
  return (row?.m ?? -1) + 1;
}

async function nameTaken(tournamentId: string, name: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: divisions.id })
    .from(divisions)
    .where(and(eq(divisions.tournamentId, tournamentId), sql`lower(${divisions.name}) = lower(${name})`));
  return rows.some((r) => r.id !== exceptId);
}

export async function createDivisionCore(tournamentId: string, input: DivisionInput) {
  const { beltLevels } = await readLocalSettings(tournamentId);
  const shape = cleanShape(input, beltLevels);
  const name = (input.name ?? "").trim().slice(0, 200) || divisionName(shape);
  if (await nameTaken(tournamentId, name)) throw new LocalSetupError(`There is already a category called "${name}".`);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(divisions).where(eq(divisions.tournamentId, tournamentId));
  if (count >= MAX_DIVISIONS) throw new LocalSetupError(`A tournament can have at most ${MAX_DIVISIONS} categories.`);

  const sortOrder = await nextSortOrder(tournamentId);
  return db.transaction(async (tx) => {
    const [division] = await tx
      .insert(divisions)
      .values({ tournamentId, name, sex: shape.sex, ageMin: shape.ageMin, ageMax: shape.ageMax, belts: [...shape.belts], sortOrder })
      .returning();
    await tx.insert(divisionEvents).values(
      DIVISION_EVENT_TYPES.map((eventType) => ({
        divisionId: division.id,
        eventType,
        enabled: eventType === "kata" ? input.kata !== false : input.kumite !== false,
      }))
    );
    return division;
  });
}

/** Creates every age x belt x sex combination that does not exist yet (by name). */
export async function generateDivisionsCore(tournamentId: string, spec: GenerateSpec) {
  const { beltLevels } = await readLocalSettings(tournamentId);
  const shapes = generateDivisionShapes(spec).map((s) => cleanShape(s as DivisionInput, beltLevels));
  if (shapes.length === 0) throw new LocalSetupError("Choose at least one age, belt group and sex.");
  if (shapes.length > 500) throw new LocalSetupError("That would create more than 500 categories; narrow it down.");

  const existing = await db.select({ name: divisions.name }).from(divisions).where(eq(divisions.tournamentId, tournamentId));
  const taken = new Set(existing.map((d) => d.name.toLowerCase()));
  let sortOrder = await nextSortOrder(tournamentId);
  const created: string[] = [];
  const skipped: string[] = [];

  await db.transaction(async (tx) => {
    for (const shape of shapes) {
      const name = divisionName(shape);
      if (taken.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }
      taken.add(name.toLowerCase());
      const [division] = await tx
        .insert(divisions)
        .values({ tournamentId, name, sex: shape.sex, ageMin: shape.ageMin, ageMax: shape.ageMax, belts: [...shape.belts], sortOrder: sortOrder++ })
        .returning({ id: divisions.id });
      await tx.insert(divisionEvents).values(DIVISION_EVENT_TYPES.map((eventType) => ({ divisionId: division.id, eventType })));
      created.push(name);
    }
  });
  return { created, skipped };
}

export async function readDivision(divisionId: string) {
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));
  if (!division) throw new LocalSetupError("Category not found.");
  return division;
}

/**
 * Edits a division's name or shape. Athletes are never moved by it (the admin
 * moves them explicitly); a rename renames its groups too.
 */
export async function updateDivisionCore(divisionId: string, patch: Partial<DivisionInput>) {
  const before = await readDivision(divisionId);
  const { beltLevels } = await readLocalSettings(before.tournamentId);
  const shape = cleanShape(
    {
      sex: patch.sex ?? (before.sex as DivisionSex),
      ageMin: patch.ageMin !== undefined ? patch.ageMin : before.ageMin,
      ageMax: patch.ageMax !== undefined ? patch.ageMax : before.ageMax,
      belts: patch.belts ?? before.belts,
    },
    beltLevels
  );
  const name = patch.name !== undefined ? (patch.name ?? "").trim().slice(0, 200) || divisionName(shape) : before.name;
  if (name.toLowerCase() !== before.name.toLowerCase() && (await nameTaken(before.tournamentId, name, divisionId))) {
    throw new LocalSetupError(`There is already a category called "${name}".`);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(divisions)
      .set({ name, sex: shape.sex, ageMin: shape.ageMin, ageMax: shape.ageMax, belts: [...shape.belts] })
      .where(eq(divisions.id, divisionId));
    if (name !== before.name) {
      const groups = await tx
        .select({ id: categories.id, groupNo: categories.groupNo, eventType: divisionEvents.eventType })
        .from(categories)
        .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
        .where(eq(divisionEvents.divisionId, divisionId));
      for (const g of groups) {
        await tx
          .update(categories)
          .set({ name: groupName(name, g.eventType as DivisionEventType, g.groupNo ?? 1) })
          .where(eq(categories.id, g.id));
      }
    }
  });
  return { before, after: { name, ...shape } };
}

/** Groups of a division (or of one of its events) that can no longer simply be thrown away: drawn, on a tatami, or held. */
export async function divisionProtection(divisionId: string) {
  const groups = await db
    .select({
      id: categories.id,
      name: categories.name,
      hasDraw: sql<boolean>`${draws.id} is not null`,
      status: categoryAssignments.status,
    })
    .from(categories)
    .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .leftJoin(categoryAssignments, eq(categoryAssignments.categoryId, categories.id))
    .where(eq(divisionEvents.divisionId, divisionId));
  const [hold] = await db
    .select({ holderName: divisionHolds.holderName })
    .from(divisionHolds)
    .where(eq(divisionHolds.divisionId, divisionId));
  const started = groups.filter((g) => g.hasDraw || (g.status !== null && g.status !== "pending"));
  return { started, holder: hold?.holderName ?? null };
}

/** Deletes a division and its groups. Refused once any group is locked or on the mat, or while someone holds it. */
export async function deleteDivisionCore(divisionId: string) {
  const division = await readDivision(divisionId);
  const { started, holder } = await divisionProtection(divisionId);
  if (holder) throw new LocalSetupError(`${holder} is preparing this category right now.`);
  if (started.length > 0) {
    throw new LocalSetupError(`"${started[0]?.name}" is already locked or on a tatami, so this category can't be deleted.`);
  }
  // Events cascade to their groups (and the groups to their entries, drafts and tatami cards);
  // registrations keep their athletes, now without a category.
  await db.delete(divisions).where(eq(divisions.id, divisionId));
  return division;
}

/** All groups of the given division events. */
export async function groupsOfEvents(divisionEventIds: readonly string[]) {
  if (divisionEventIds.length === 0) return [];
  return db
    .select({ id: categories.id, divisionEventId: categories.divisionEventId, groupNo: categories.groupNo, name: categories.name })
    .from(categories)
    .where(inArray(categories.divisionEventId, [...divisionEventIds]));
}
