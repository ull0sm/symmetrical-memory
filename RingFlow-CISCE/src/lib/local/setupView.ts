/**
 * Read models for the Local admin screens: every division with its events,
 * plans, participants and starting groups, and the roster with each athlete's
 * division and groups. No authorization here: the actions and pages guard it.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  categories,
  categoryAssignments,
  categoryEntries,
  divisionEvents,
  divisionHolds,
  divisions,
  draws,
  rings,
  tournamentRegistrations,
} from "@/db/schema";
import type { DivisionEventType } from "@/lib/statuses";
import { readLocalSettings, type LocalSettings } from "./divisions";
import { effectiveEventSettings, planGroupSizes } from "./rules";

export interface GroupView {
  id: string;
  groupNo: number;
  name: string;
  size: number;
  locked: boolean;
  status: string | null;
  ringId: string | null;
  ringName: string | null;
  members: { id: string; name: string; club: string | null }[];
}

export interface EventView {
  id: string;
  eventType: DivisionEventType;
  enabled: boolean;
  plan: { groupSize: number | null; bronzeMedals: number | null; boutDurationMs: number | null };
  effective: { groupSize: number; bronzeMedals: 1 | 2; boutDurationMs: number | null };
  participants: number;
  away: number;
  plannedSizes: number[];
  groups: GroupView[];
}

export interface DivisionView {
  id: string;
  name: string;
  sex: string;
  ageMin: number | null;
  ageMax: number | null;
  belts: string[];
  athletes: number;
  holder: string | null;
  /** The tatamis the division's groups are on (usually one). */
  ringIds: string[];
  events: EventView[];
}

export interface LocalSetupView {
  settings: LocalSettings;
  rings: { id: string; name: string }[];
  divisions: DivisionView[];
  totalAthletes: number;
  unassignedAthletes: number;
}

export async function loadLocalSetup(tournamentId: string): Promise<LocalSetupView> {
  const settings = await readLocalSettings(tournamentId);
  const [ringRows, divisionRows, registrationRows] = await Promise.all([
    db.select({ id: rings.id, name: rings.name }).from(rings).where(eq(rings.tournamentId, tournamentId)).orderBy(asc(rings.ringOrder)),
    db.select().from(divisions).where(eq(divisions.tournamentId, tournamentId)).orderBy(asc(divisions.sortOrder), asc(divisions.name)),
    db
      .select({
        divisionId: tournamentRegistrations.divisionId,
        kumite: tournamentRegistrations.kumite,
        kata: tournamentRegistrations.kata,
        attendance: tournamentRegistrations.attendance,
      })
      .from(tournamentRegistrations)
      .where(eq(tournamentRegistrations.tournamentId, tournamentId)),
  ]);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(athletes).where(eq(athletes.tournamentId, tournamentId));
  const divisionIds = divisionRows.map((d) => d.id);

  const [eventRows, holdRows] = divisionIds.length
    ? await Promise.all([
        db.select().from(divisionEvents).where(inArray(divisionEvents.divisionId, divisionIds)),
        db.select({ divisionId: divisionHolds.divisionId, name: divisionHolds.holderName }).from(divisionHolds).where(inArray(divisionHolds.divisionId, divisionIds)),
      ])
    : [[], []];
  const eventIds = eventRows.map((e) => e.id);

  const groupRows = eventIds.length
    ? await db
        .select({
          id: categories.id,
          divisionEventId: categories.divisionEventId,
          groupNo: categories.groupNo,
          name: categories.name,
          drawState: draws.state,
          status: categoryAssignments.status,
          ringId: categoryAssignments.ringId,
        })
        .from(categories)
        .leftJoin(draws, eq(draws.categoryId, categories.id))
        .leftJoin(categoryAssignments, eq(categoryAssignments.categoryId, categories.id))
        .where(inArray(categories.divisionEventId, eventIds))
        .orderBy(asc(categories.groupNo))
    : [];
  const memberRows = groupRows.length
    ? await db
        .select({ categoryId: categoryEntries.categoryId, id: athletes.id, name: athletes.name, club: athletes.school })
        .from(categoryEntries)
        .innerJoin(athletes, eq(athletes.id, categoryEntries.athleteId))
        .where(inArray(categoryEntries.categoryId, groupRows.map((g) => g.id)))
        .orderBy(asc(athletes.name))
    : [];

  const ringName = new Map(ringRows.map((r) => [r.id, r.name]));
  const holderOf = new Map(holdRows.map((h) => [h.divisionId, h.name]));
  const membersOf = new Map<string, GroupView["members"]>();
  for (const m of memberRows) membersOf.set(m.categoryId, [...(membersOf.get(m.categoryId) ?? []), { id: m.id, name: m.name, club: m.club }]);

  const view: DivisionView[] = divisionRows.map((d) => {
    const regs = registrationRows.filter((r) => r.divisionId === d.id);
    const events = eventRows
      .filter((e) => e.divisionId === d.id)
      .sort((a, b) => (a.eventType < b.eventType ? 1 : -1)) // kumite before kata
      .map((e): EventView => {
        const eventType = e.eventType as DivisionEventType;
        const taking = regs.filter((r) => (eventType === "kata" ? r.kata : r.kumite));
        const away = taking.filter((r) => r.attendance === "absent" || r.attendance === "withdrawn").length;
        const effective = effectiveEventSettings(eventType, e, settings);
        const groups = groupRows
          .filter((g) => g.divisionEventId === e.id)
          .map((g) => ({
            id: g.id,
            groupNo: g.groupNo ?? 0,
            name: g.name,
            size: membersOf.get(g.id)?.length ?? 0,
            locked: g.drawState === "LOCKED",
            status: g.status ?? null,
            ringId: g.ringId ?? null,
            ringName: g.ringId ? (ringName.get(g.ringId) ?? null) : null,
            members: membersOf.get(g.id) ?? [],
          }));
        return {
          id: e.id,
          eventType,
          enabled: e.enabled,
          plan: { groupSize: e.groupSize, bronzeMedals: e.bronzeMedals, boutDurationMs: e.boutDurationMs },
          effective,
          participants: taking.length - away,
          away,
          plannedSizes: planGroupSizes(taking.length - away, effective.groupSize),
          groups,
        };
      });
    const ringIds = [...new Set(events.flatMap((e) => e.groups.map((g) => g.ringId)).filter((r): r is string => r !== null))];
    return {
      id: d.id,
      name: d.name,
      sex: d.sex,
      ageMin: d.ageMin,
      ageMax: d.ageMax,
      belts: d.belts,
      athletes: regs.length,
      holder: holderOf.get(d.id) ?? null,
      ringIds,
      events,
    };
  });

  const assigned = registrationRows.filter((r) => r.divisionId !== null).length;
  return { settings, rings: ringRows, divisions: view, totalAthletes: total, unassignedAthletes: Math.max(0, total - assigned) };
}

export interface LocalAthleteView {
  id: string;
  name: string;
  chestNumber: string | null;
  club: string | null;
  age: string | null;
  belt: string | null;
  sex: string | null;
  walkIn: boolean;
  needsReview: boolean;
  divisionId: string | null;
  kumite: boolean;
  kata: boolean;
  attendance: string | null;
  groups: { eventType: string; name: string; groupNo: number | null }[];
}

export async function loadLocalAthletes(tournamentId: string) {
  const [settings, rows, divisionRows, entryRows] = await Promise.all([
    readLocalSettings(tournamentId),
    db
      .select({ athlete: athletes, registration: tournamentRegistrations })
      .from(athletes)
      .leftJoin(tournamentRegistrations, eq(tournamentRegistrations.athleteId, athletes.id))
      .where(eq(athletes.tournamentId, tournamentId))
      .orderBy(asc(athletes.name)),
    db.select({ id: divisions.id, name: divisions.name }).from(divisions).where(eq(divisions.tournamentId, tournamentId)).orderBy(asc(divisions.sortOrder), asc(divisions.name)),
    db
      .select({ athleteId: categoryEntries.athleteId, eventType: categories.eventType, name: categories.name, groupNo: categories.groupNo })
      .from(categoryEntries)
      .innerJoin(categories, eq(categories.id, categoryEntries.categoryId))
      .where(sql`${categories.tournamentId} = ${tournamentId} and ${categories.divisionEventId} is not null`),
  ]);
  const groupsOf = new Map<string, LocalAthleteView["groups"]>();
  for (const e of entryRows) groupsOf.set(e.athleteId, [...(groupsOf.get(e.athleteId) ?? []), { eventType: e.eventType, name: e.name, groupNo: e.groupNo }]);

  const list: LocalAthleteView[] = rows.map(({ athlete: a, registration: r }) => ({
    id: a.id,
    name: a.name,
    chestNumber: a.chestNumber,
    club: a.school ?? a.dojo,
    age: a.age,
    belt: a.belt,
    sex: a.sex,
    walkIn: a.walkIn,
    needsReview: a.needsReview,
    divisionId: r?.divisionId ?? null,
    kumite: r?.kumite ?? false,
    kata: r?.kata ?? false,
    attendance: r?.attendance ?? null,
    groups: groupsOf.get(a.id) ?? [],
  }));
  return { athletes: list, divisions: divisionRows, beltLevels: settings.beltLevels };
}
