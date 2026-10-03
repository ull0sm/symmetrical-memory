/**
 * Read models for the stager desk and a held division's workspace. The desk
 * lists every division with its derived status (waiting, held, partly sent,
 * sent, done) and where it stands in its tatami's queue, soonest first. The
 * workspace is everything a stager needs to build and lock the groups.
 * No authorization here: the staging actions guard it. Nothing secret is read:
 * holds carry names and code labels, never codes.
 */
import { asc, eq, inArray } from "drizzle-orm";
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
import { readLocalSettings } from "./divisions";
import { loadGroupState, previewGroup, sanitizePins, type PlacedAthlete } from "./groupBuild";
import type { HolderIdentity } from "./holds";
import { effectiveEventSettings } from "./rules";

export type DeskStatus = "waiting" | "held" | "partly" | "sent" | "done";

export interface DeskItem {
  divisionId: string;
  name: string;
  athletes: number;
  events: { eventType: DivisionEventType; participants: number; groups: number; locked: number }[];
  status: DeskStatus;
  holderName: string | null;
  holderLabel: string | null;
  isMine: boolean;
  /** The tatami of the division's next group to run, and how many cards are ahead of it (0 = on the mat now). */
  tatami: { ringId: string; ringName: string; ahead: number; onMat: boolean } | null;
}

export async function loadStagerDesk(tournamentId: string, me: HolderIdentity | null) {
  const [divisionRows, ringRows, holdRows, regs] = await Promise.all([
    db.select().from(divisions).where(eq(divisions.tournamentId, tournamentId)).orderBy(asc(divisions.sortOrder), asc(divisions.name)),
    db.select({ id: rings.id, name: rings.name }).from(rings).where(eq(rings.tournamentId, tournamentId)).orderBy(asc(rings.ringOrder)),
    db.select().from(divisionHolds).where(eq(divisionHolds.tournamentId, tournamentId)),
    db
      .select({ divisionId: tournamentRegistrations.divisionId, kumite: tournamentRegistrations.kumite, kata: tournamentRegistrations.kata, attendance: tournamentRegistrations.attendance })
      .from(tournamentRegistrations)
      .where(eq(tournamentRegistrations.tournamentId, tournamentId)),
  ]);
  const divisionIds = divisionRows.map((d) => d.id);
  const events = divisionIds.length ? await db.select().from(divisionEvents).where(inArray(divisionEvents.divisionId, divisionIds)) : [];
  const eventIds = events.map((e) => e.id);
  const groups = eventIds.length
    ? await db
        .select({
          id: categories.id,
          divisionEventId: categories.divisionEventId,
          drawState: draws.state,
          status: categoryAssignments.status,
          ringId: categoryAssignments.ringId,
          queueOrder: categoryAssignments.queueOrder,
        })
        .from(categories)
        .leftJoin(draws, eq(draws.categoryId, categories.id))
        .leftJoin(categoryAssignments, eq(categoryAssignments.categoryId, categories.id))
        .where(inArray(categories.divisionEventId, eventIds))
    : [];
  const ringIds = ringRows.map((r) => r.id);
  const queue = ringIds.length
    ? await db
        .select({ ringId: categoryAssignments.ringId, queueOrder: categoryAssignments.queueOrder, status: categoryAssignments.status })
        .from(categoryAssignments)
        .where(inArray(categoryAssignments.ringId, ringIds))
    : [];
  const ringName = new Map(ringRows.map((r) => [r.id, r.name]));
  const holdOf = new Map(holdRows.map((h) => [h.divisionId, h]));

  const items: DeskItem[] = divisionRows.map((d) => {
    const myEvents = events.filter((e) => e.divisionId === d.id && e.enabled);
    const myGroups = groups.filter((g) => myEvents.some((e) => e.id === g.divisionEventId));
    const hold = holdOf.get(d.id) ?? null;
    const locked = myGroups.filter((g) => g.drawState === "LOCKED").length;
    const completed = myGroups.filter((g) => g.status === "completed").length;
    let status: DeskStatus = "waiting";
    if (myGroups.length > 0 && completed === myGroups.length) status = "done";
    else if (hold) status = "held";
    else if (myGroups.length > 0 && locked === myGroups.length) status = "sent";
    else if (locked > 0) status = "partly";

    // Where the next unfinished group stands in its tatami's queue.
    const next = myGroups
      .filter((g) => g.ringId && g.status !== "completed")
      .sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0))[0];
    let tatami: DeskItem["tatami"] = null;
    if (next?.ringId) {
      const onMat = next.status === "running" || next.status === "paused";
      const ahead = onMat
        ? 0
        : queue.filter((c) => c.ringId === next.ringId && c.status !== "completed" && c.queueOrder < (next.queueOrder ?? 0)).length;
      tatami = { ringId: next.ringId, ringName: ringName.get(next.ringId) ?? "Tatami", ahead, onMat };
    }

    const isMine =
      hold !== null &&
      me !== null &&
      (me.kind === "stager" ? hold.stagerCodeHash === me.codeHash : hold.holderKind === "admin" && hold.adminId === me.adminId);
    const taking = regs.filter((r) => r.divisionId === d.id);
    return {
      divisionId: d.id,
      name: d.name,
      athletes: taking.length,
      events: myEvents.map((e) => {
        const eventType = e.eventType as DivisionEventType;
        const mine = myGroups.filter((g) => g.divisionEventId === e.id);
        return {
          eventType,
          participants: taking.filter((r) => (eventType === "kata" ? r.kata : r.kumite)).length,
          groups: mine.length,
          locked: mine.filter((g) => g.drawState === "LOCKED").length,
        };
      }),
      status,
      holderName: hold?.holderName ?? null,
      holderLabel: hold?.holderLabel ?? null,
      isMine,
      tatami,
    };
  });

  // Soonest first: a division whose next group is on a mat or nearest the front of its queue.
  const rank = (i: DeskItem) => (i.status === "done" ? 1e6 : i.tatami ? i.tatami.ahead : 1e5);
  items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { items, rings: ringRows, mine: items.find((i) => i.isMine)?.divisionId ?? null };
}

export interface WorkspaceGroup {
  id: string;
  groupNo: number;
  name: string;
  locked: boolean;
  version: number;
  checksum: string | null;
  members: string[];
  pinned: string[];
  places: PlacedAthlete[];
  blockers: string[];
  warnings: string[];
  ringName: string | null;
  status: string | null;
}

export interface WorkspaceEvent {
  id: string;
  eventType: DivisionEventType;
  planSize: number;
  bronzeMedals: 1 | 2;
  groups: WorkspaceGroup[];
  unplaced: string[];
  warnings: string[];
}

export interface WorkspaceAthlete {
  id: string;
  name: string;
  club: string | null;
  chestNumber: string | null;
  age: string | null;
  belt: string | null;
  kumite: boolean;
  kata: boolean;
  attendance: string | null;
  walkIn: boolean;
}

export async function loadWorkspace(divisionId: string) {
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));
  if (!division) return null;
  const settings = await readLocalSettings(division.tournamentId);
  const [hold] = await db
    .select({ name: divisionHolds.holderName, label: divisionHolds.holderLabel, kind: divisionHolds.holderKind })
    .from(divisionHolds)
    .where(eq(divisionHolds.divisionId, divisionId));

  const roster = await db
    .select({ athlete: athletes, registration: tournamentRegistrations })
    .from(tournamentRegistrations)
    .innerJoin(athletes, eq(athletes.id, tournamentRegistrations.athleteId))
    .where(eq(tournamentRegistrations.divisionId, divisionId))
    .orderBy(asc(athletes.name));
  const people: WorkspaceAthlete[] = roster.map(({ athlete: a, registration: r }) => ({
    id: a.id,
    name: a.name,
    club: a.school ?? a.dojo,
    chestNumber: a.chestNumber,
    age: a.age,
    belt: a.belt,
    kumite: r.kumite,
    kata: r.kata,
    attendance: r.attendance,
    walkIn: a.walkIn,
  }));

  const eventRows = await db.select().from(divisionEvents).where(eq(divisionEvents.divisionId, divisionId));
  const ringNames = new Map((await db.select({ id: rings.id, name: rings.name }).from(rings).where(eq(rings.tournamentId, division.tournamentId))).map((r) => [r.id, r.name]));
  const events: WorkspaceEvent[] = [];
  for (const e of eventRows.filter((x) => x.enabled).sort((a, b) => (a.eventType < b.eventType ? 1 : -1))) {
    const eventType = e.eventType as DivisionEventType;
    const effective = effectiveEventSettings(eventType, e, settings);
    const groupRows = await db
      .select({ id: categories.id, ringId: categoryAssignments.ringId, status: categoryAssignments.status })
      .from(categories)
      .leftJoin(categoryAssignments, eq(categoryAssignments.categoryId, categories.id))
      .where(eq(categories.divisionEventId, e.id))
      .orderBy(asc(categories.groupNo));
    const groups: WorkspaceGroup[] = [];
    for (const row of groupRows) {
      const state = await loadGroupState(db, row.id);
      if (!state) continue;
      const preview = previewGroup(state);
      groups.push({
        id: state.id,
        groupNo: state.groupNo,
        name: state.name,
        locked: state.locked,
        version: state.version,
        checksum: state.locked ? state.drawChecksum : (preview.graph?.checksum ?? null),
        members: state.members.map((m) => m.athleteId),
        pinned: Object.keys(sanitizePins(state)),
        places: preview.places,
        blockers: state.locked ? [] : preview.blockers,
        warnings: state.locked ? [] : preview.warnings,
        ringName: row.ringId ? (ringNames.get(row.ringId) ?? null) : null,
        status: row.status ?? null,
      });
    }
    const placed = new Set(
      (await db.select({ id: categoryEntries.athleteId }).from(categoryEntries).where(eq(categoryEntries.divisionEventId, e.id))).map((r) => r.id)
    );
    const unplaced = people
      .filter((p) => (eventType === "kata" ? p.kata : p.kumite) && !placed.has(p.id) && p.attendance !== "absent" && p.attendance !== "withdrawn")
      .map((p) => p.id);

    const warnings: string[] = [];
    if (unplaced.length > 0) warnings.push(`${unplaced.length} present athlete${unplaced.length === 1 ? " is" : "s are"} in no group.`);
    const open = groups.filter((g) => !g.locked).map((g) => g.members.length);
    if (open.length > 1 && Math.max(...open) - Math.min(...open) > 2) warnings.push("Group sizes differ by more than 2.");

    events.push({ id: e.id, eventType, planSize: effective.groupSize, bronzeMedals: effective.bronzeMedals, groups, unplaced, warnings });
  }

  return {
    division: { id: division.id, name: division.name, tournamentId: division.tournamentId, sex: division.sex, ageMin: division.ageMin, ageMax: division.ageMax, belts: division.belts },
    holder: hold ? { name: hold.name, label: hold.label, kind: hold.kind } : null,
    athletes: people,
    events,
  };
}

export type Workspace = NonNullable<Awaited<ReturnType<typeof loadWorkspace>>>;
