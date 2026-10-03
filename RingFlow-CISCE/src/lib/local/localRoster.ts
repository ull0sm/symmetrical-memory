/**
 * Athletes in a Local tournament: each belongs to at most one division (its
 * registration's `division_id`) and takes part in kumite, kata or both. Group
 * membership lives in `category_entries`; `athletes.category_id` stays null.
 * No authorization here: the admin and stager actions guard these.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { athletes, categories, categoryEntries, divisionEvents, divisions, draws, tournamentRegistrations } from "@/db/schema";
import type { DbExecutor } from "@/lib/draws/generateDraws";
import type { DivisionEventType } from "@/lib/statuses";
import { LocalSetupError, readLocalSettings } from "./divisions";
import { canonicalBelt, matchDivision, normalizeAge, normalizeSex } from "./rules";
import { refreshGroupCounts, removeFromDraftGroups } from "./startingGroups";

export interface LocalAthleteInput {
  name: string;
  chestNumber?: string | null;
  club?: string | null;
  age?: number | string | null;
  belt?: string | null;
  sex?: string | null;
  /** A division id, "auto" to match by age, belt and sex, or null for none. */
  divisionId?: string | null;
  kumite?: boolean;
  kata?: boolean;
  /** Registered at the venue by a stager. */
  walkIn?: boolean;
}

const clip = (value: unknown, max: number) => {
  const s = String(value ?? "").trim().slice(0, max);
  return s === "" ? null : s;
};

/** The next free numeric chest number in a tournament, from 101. */
export async function nextChestNumber(executor: DbExecutor, tournamentId: string): Promise<string> {
  const [row] = await executor
    .select({ m: sql<number | null>`max(${athletes.chestNumber}::int)` })
    .from(athletes)
    .where(and(eq(athletes.tournamentId, tournamentId), sql`${athletes.chestNumber} ~ '^[0-9]{1,9}$'`));
  return String(Math.max(100, Number(row?.m ?? 100)) + 1);
}

async function divisionsInOrder(tournamentId: string) {
  return db.select().from(divisions).where(eq(divisions.tournamentId, tournamentId)).orderBy(asc(divisions.sortOrder), asc(divisions.name));
}

async function assertDivision(tournamentId: string, divisionId: string) {
  const [d] = await db.select({ id: divisions.id, t: divisions.tournamentId }).from(divisions).where(eq(divisions.id, divisionId));
  if (!d || d.t !== tournamentId) throw new LocalSetupError("That category is not in this tournament.");
}

/** Adds one athlete with their registration. Returns the athlete, the division they landed in and their chest number. */
export async function addLocalAthleteCore(tournamentId: string, input: LocalAthleteInput) {
  const name = clip(input.name, 200);
  if (!name) throw new LocalSetupError("The athlete needs a name.");
  const { beltLevels } = await readLocalSettings(tournamentId);
  const age = normalizeAge(input.age);
  const sex = normalizeSex(input.sex);
  const belt = canonicalBelt(input.belt, beltLevels) ?? clip(input.belt, 50);
  const club = clip(input.club, 200);

  let divisionId: string | null = null;
  if (input.divisionId === "auto") {
    divisionId = matchDivision(await divisionsInOrder(tournamentId), { age, belt, sex }).division?.id ?? null;
  } else if (input.divisionId) {
    await assertDivision(tournamentId, input.divisionId);
    divisionId = input.divisionId;
  }

  return db.transaction(async (tx) => {
    let chestNumber = clip(input.chestNumber, 50);
    if (chestNumber) {
      const [taken] = await tx
        .select({ id: athletes.id })
        .from(athletes)
        .where(and(eq(athletes.tournamentId, tournamentId), eq(athletes.chestNumber, chestNumber)));
      if (taken) throw new LocalSetupError(`Chest number ${chestNumber} is already used.`);
    } else {
      chestNumber = await nextChestNumber(tx, tournamentId);
    }

    const [athlete] = await tx
      .insert(athletes)
      .values({
        tournamentId,
        name,
        chestNumber,
        school: club,
        dojo: club,
        age: age === null ? null : String(age),
        belt,
        sex,
        walkIn: input.walkIn === true,
        needsReview: input.walkIn === true,
      })
      .returning();
    await tx.insert(tournamentRegistrations).values({
      tournamentId,
      athleteId: athlete.id,
      divisionId,
      kumite: input.kumite !== false,
      kata: input.kata !== false,
    });
    return { athlete, divisionId, chestNumber };
  });
}

export interface LocalImportRow {
  name?: unknown;
  chestNumber?: unknown;
  club?: unknown;
  age?: unknown;
  belt?: unknown;
  sex?: unknown;
  kumite?: unknown;
  kata?: unknown;
}

export interface LocalImportReport {
  total: number;
  created: number;
  updated: number;
  assigned: number;
  unassigned: { name: string; reason: string }[];
  ambiguous: { name: string; category: string; matches: number }[];
  possibleDuplicates: { name: string; club: string | null }[];
  keptCategory: { name: string; category: string }[];
}

/** A Y/N cell; an empty cell means yes, so a sheet without the column enters everyone in both events. */
function yes(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  return !["n", "no", "0", "false", "x", "-"].includes(s);
}

/**
 * The Local roster import: one row per athlete. Athletes are matched to a
 * division by age, belt and sex; a row with a known chest number updates that
 * athlete. An athlete already in a division with groups keeps it.
 */
export async function importLocalRosterCore(tournamentId: string, rows: readonly LocalImportRow[]): Promise<LocalImportReport> {
  if (rows.length > 10000) throw new LocalSetupError("Import at most 10,000 athletes at a time.");
  const { beltLevels } = await readLocalSettings(tournamentId);
  const allDivisions = await divisionsInOrder(tournamentId);
  const report: LocalImportReport = {
    total: 0,
    created: 0,
    updated: 0,
    assigned: 0,
    unassigned: [],
    ambiguous: [],
    possibleDuplicates: [],
    keptCategory: [],
  };
  const seenNameClub = new Set<string>();

  for (const row of rows) {
    const name = clip(row.name, 200);
    if (!name) continue;
    report.total += 1;
    const club = clip(row.club, 200);
    const age = normalizeAge(row.age);
    const sex = normalizeSex(row.sex);
    const rawBelt = clip(row.belt, 50);
    const belt = canonicalBelt(rawBelt, beltLevels) ?? rawBelt;
    const chestNumber = clip(row.chestNumber, 50);

    const nameClub = `${name.toLowerCase()}|${(club ?? "").toLowerCase()}`;
    if (!chestNumber && seenNameClub.has(nameClub)) report.possibleDuplicates.push({ name, club });
    seenNameClub.add(nameClub);

    const match = matchDivision(allDivisions, { age, belt, sex });
    if (!match.division) {
      const reasons = [age === null && "no age", !belt && "no belt", belt && !canonicalBelt(belt, beltLevels) && `belt "${belt}" is not in the belt list`, !sex && "no sex"].filter(Boolean);
      report.unassigned.push({ name, reason: reasons.length ? reasons.join(", ") : "no category fits" });
    } else if (match.matches > 1) {
      report.ambiguous.push({ name, category: match.division.name, matches: match.matches });
    }

    await db.transaction(async (tx) => {
      const [existing] = chestNumber
        ? await tx.select({ id: athletes.id }).from(athletes).where(and(eq(athletes.tournamentId, tournamentId), eq(athletes.chestNumber, chestNumber)))
        : [];
      const values = { tournamentId, name, school: club, dojo: club, age: age === null ? null : String(age), belt, sex };
      const [athlete] = existing
        ? await tx.update(athletes).set(values).where(eq(athletes.id, existing.id)).returning({ id: athletes.id })
        : await tx.insert(athletes).values({ ...values, chestNumber: chestNumber ?? (await nextChestNumber(tx, tournamentId)) }).returning({ id: athletes.id });
      if (existing) report.updated += 1;
      else report.created += 1;

      const [registration] = await tx
        .select()
        .from(tournamentRegistrations)
        .where(and(eq(tournamentRegistrations.tournamentId, tournamentId), eq(tournamentRegistrations.athleteId, athlete.id)));
      const flags = { kumite: yes(row.kumite), kata: yes(row.kata) };
      let divisionId = match.division?.id ?? null;
      if (registration?.divisionId && registration.divisionId !== divisionId) {
        const inGroups = await tx.select({ id: categoryEntries.id }).from(categoryEntries).where(and(eq(categoryEntries.athleteId, athlete.id), sql`${categoryEntries.divisionEventId} is not null`)).limit(1);
        if (inGroups.length > 0) {
          divisionId = registration.divisionId;
          const current = allDivisions.find((d) => d.id === divisionId);
          report.keptCategory.push({ name, category: current?.name ?? "its category" });
        }
      }
      if (divisionId) report.assigned += 1;

      if (registration) {
        await tx.update(tournamentRegistrations).set({ divisionId, ...flags }).where(eq(tournamentRegistrations.id, registration.id));
      } else {
        await tx.insert(tournamentRegistrations).values({ tournamentId, athleteId: athlete.id, divisionId, ...flags });
      }
    });
  }
  return report;
}

export async function readRegistration(executor: DbExecutor, tournamentId: string, athleteId: string) {
  const [row] = await executor
    .select({ registration: tournamentRegistrations, athlete: athletes })
    .from(athletes)
    .leftJoin(
      tournamentRegistrations,
      and(eq(tournamentRegistrations.athleteId, athletes.id), eq(tournamentRegistrations.tournamentId, tournamentId))
    )
    .where(and(eq(athletes.id, athleteId), eq(athletes.tournamentId, tournamentId)));
  if (!row) throw new LocalSetupError("Athlete not found in this tournament.");
  return row;
}

/** Event ids of a division (both events). */
async function eventIdsOf(executor: DbExecutor, divisionId: string | null): Promise<string[]> {
  if (!divisionId) return [];
  const rows = await executor.select({ id: divisionEvents.id }).from(divisionEvents).where(eq(divisionEvents.divisionId, divisionId));
  return rows.map((r) => r.id);
}

/**
 * Moves an athlete to another division (or to none). They leave the old
 * division's draft groups and are unplaced in the new one, so the stager or the
 * next starting-groups build places them. Refused while they are in a locked group.
 */
export async function assignAthleteDivisionCore(tournamentId: string, athleteId: string, divisionId: string | null) {
  if (divisionId) await assertDivision(tournamentId, divisionId);
  return db.transaction(async (tx) => {
    const { registration } = await readRegistration(tx, tournamentId, athleteId);
    const before = registration?.divisionId ?? null;
    if (before === divisionId) return { before, after: divisionId, leftGroups: [] as string[] };
    const leftGroups = await removeFromDraftGroups(tx, athleteId, await eventIdsOf(tx, before));
    if (registration) {
      await tx.update(tournamentRegistrations).set({ divisionId }).where(eq(tournamentRegistrations.id, registration.id));
    } else {
      await tx.insert(tournamentRegistrations).values({ tournamentId, athleteId, divisionId, kumite: true, kata: true });
    }
    return { before, after: divisionId, leftGroups };
  });
}

/** Switches an athlete's kumite or kata on or off. Switching off takes them out of that event's draft groups. */
export async function setParticipationCore(tournamentId: string, athleteId: string, eventType: DivisionEventType, value: boolean) {
  return db.transaction(async (tx) => {
    const { registration } = await readRegistration(tx, tournamentId, athleteId);
    if (!registration) throw new LocalSetupError("This athlete has no registration yet; put them in a category first.");
    const before = eventType === "kata" ? registration.kata : registration.kumite;
    if (before === value) return { before, after: value };
    if (!value && registration.divisionId) {
      const events = await tx
        .select({ id: divisionEvents.id })
        .from(divisionEvents)
        .where(and(eq(divisionEvents.divisionId, registration.divisionId), eq(divisionEvents.eventType, eventType)));
      await removeFromDraftGroups(tx, athleteId, events.map((e) => e.id));
    }
    await tx
      .update(tournamentRegistrations)
      .set(eventType === "kata" ? { kata: value } : { kumite: value })
      .where(eq(tournamentRegistrations.id, registration.id));
    return { before, after: value };
  });
}

/** Deletes an athlete. Refused while they are in any group with a draw. */
export async function deleteLocalAthleteCore(tournamentId: string, athleteId: string) {
  const { athlete } = await readRegistration(db, tournamentId, athleteId);
  const drawn = await db
    .select({ name: categories.name })
    .from(categoryEntries)
    .innerJoin(categories, eq(categories.id, categoryEntries.categoryId))
    .innerJoin(draws, eq(draws.categoryId, categoryEntries.categoryId))
    .where(eq(categoryEntries.athleteId, athleteId))
    .limit(1);
  if (drawn[0]) throw new LocalSetupError(`${athlete.name} is in "${drawn[0].name}", which has been drawn.`);
  const groups = await db.select({ id: categoryEntries.categoryId }).from(categoryEntries).where(eq(categoryEntries.athleteId, athleteId));
  await db.transaction(async (tx) => {
    await tx.delete(athletes).where(eq(athletes.id, athleteId));
    for (const g of groups) await refreshGroupCounts(tx, g.id);
  });
  return athlete;
}

/** The groups each athlete of a tournament is in, keyed by athlete. */
export async function groupsByAthlete(tournamentId: string) {
  const rows = await db
    .select({ athleteId: categoryEntries.athleteId, categoryId: categories.id, groupNo: categories.groupNo, eventType: categories.eventType, name: categories.name })
    .from(categoryEntries)
    .innerJoin(categories, eq(categories.id, categoryEntries.categoryId))
    .where(and(eq(categories.tournamentId, tournamentId), sql`${categories.divisionEventId} is not null`));
  const out = new Map<string, typeof rows>();
  for (const r of rows) out.set(r.athleteId, [...(out.get(r.athleteId) ?? []), r]);
  return out;
}

