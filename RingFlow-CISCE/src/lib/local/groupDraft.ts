/**
 * What a stager does to a division's groups while holding it: moving athletes
 * between groups, pinning places, shuffling, adding and removing groups, filling
 * and rebalancing, attendance, walk-ins, and finally locking a group, which turns
 * its draft into a real draw. Every change runs in a transaction that locks the
 * division row, so two changes never interleave.
 * No authorization here: the staging actions check the caller holds the division.
 */
import { and, asc, eq, ilike, max, or, sql } from "drizzle-orm";
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
  groupDrafts,
  tournamentRegistrations,
} from "@/db/schema";
import { writeDrawGraph, type DbExecutor } from "@/lib/draws/generateDraws";
import type { DivisionEventType } from "@/lib/statuses";
import { LocalSetupError, readLocalSettings } from "./divisions";
import { currentPlaces, loadGroupState, previewGroup, sanitizePins, type GroupState } from "./groupBuild";
import { releaseIfAllSent, touchHold } from "./holds";
import { addLocalAthleteCore, assignAthleteDivisionCore } from "./localRoster";
import { distributeIntoGroups, effectiveEventSettings, engineBronze, expectedBouts, groupName } from "./rules";
import { eventParticipants, newGroupSeed, refreshGroupCounts, removeFromDraftGroups } from "./startingGroups";
import { insertGroupCards } from "./tatami";

/** Runs a change on a division: one transaction, the division row locked, the hold marked active. */
async function withDivision<T>(divisionId: string, fn: (tx: DbExecutor, division: typeof divisions.$inferSelect) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [division] = await tx.select().from(divisions).where(eq(divisions.id, divisionId)).for("update");
    if (!division) throw new LocalSetupError("Category not found.");
    await touchHold(tx, divisionId);
    return fn(tx, division);
  });
}

async function eventOf(tx: DbExecutor, divisionId: string, eventType: DivisionEventType) {
  const [event] = await tx
    .select()
    .from(divisionEvents)
    .where(and(eq(divisionEvents.divisionId, divisionId), eq(divisionEvents.eventType, eventType)));
  if (!event || !event.enabled) throw new LocalSetupError(`This category has no ${eventType}.`);
  return event;
}

/** A group of this division that has not been locked. */
async function draftGroup(tx: DbExecutor, divisionId: string, groupId: string): Promise<GroupState> {
  const group = await loadGroupState(tx, groupId);
  if (!group) throw new LocalSetupError("Group not found.");
  const [event] = await tx.select({ divisionId: divisionEvents.divisionId }).from(divisionEvents).where(eq(divisionEvents.id, group.divisionEventId));
  if (event?.divisionId !== divisionId) throw new LocalSetupError("That group is not in this category.");
  if (group.locked) throw new LocalSetupError(`${group.name} is locked. Only the admin can change it now.`);
  return group;
}

function checkVersion(group: GroupState, expected: number | undefined) {
  if (expected !== undefined && expected !== group.version) {
    throw new LocalSetupError("This group changed since you looked at it. Check it again.");
  }
}

async function saveDraft(tx: DbExecutor, groupId: string, patch: { pins?: Record<string, number>; seed?: number }, by: string) {
  await tx
    .update(groupDrafts)
    .set({ ...patch, version: sql`${groupDrafts.version} + 1`, updatedBy: by, updatedAt: new Date() })
    .where(eq(groupDrafts.categoryId, groupId));
}

/** The registration of an athlete in this division, with their attendance and events. */
async function registrationIn(tx: DbExecutor, divisionId: string, athleteId: string) {
  const [row] = await tx
    .select({ registration: tournamentRegistrations, name: athletes.name })
    .from(tournamentRegistrations)
    .innerJoin(athletes, eq(athletes.id, tournamentRegistrations.athleteId))
    .where(and(eq(tournamentRegistrations.athleteId, athleteId), eq(tournamentRegistrations.divisionId, divisionId)));
  if (!row) throw new LocalSetupError("That athlete is not in this category.");
  return row;
}

const isAway = (attendance: string | null) => attendance === "absent" || attendance === "withdrawn";

/** The group an athlete is in for an event, or null. */
async function currentGroupOf(tx: DbExecutor, athleteId: string, divisionEventId: string): Promise<string | null> {
  const [entry] = await tx
    .select({ categoryId: categoryEntries.categoryId })
    .from(categoryEntries)
    .where(and(eq(categoryEntries.athleteId, athleteId), eq(categoryEntries.divisionEventId, divisionEventId)));
  return entry?.categoryId ?? null;
}

async function addEntry(tx: DbExecutor, groupId: string, divisionEventId: string, athleteId: string, registrationId: string | null) {
  await tx.insert(categoryEntries).values({ categoryId: groupId, athleteId, registrationId, divisionEventId });
}

async function removeEntry(tx: DbExecutor, groupId: string, athleteId: string, by: string) {
  await tx.delete(categoryEntries).where(and(eq(categoryEntries.categoryId, groupId), eq(categoryEntries.athleteId, athleteId)));
  const [draft] = await tx.select({ pins: groupDrafts.pins }).from(groupDrafts).where(eq(groupDrafts.categoryId, groupId));
  const pins = { ...((draft?.pins ?? {}) as Record<string, number>) };
  delete pins[athleteId];
  await saveDraft(tx, groupId, { pins }, by);
}

/** Creates an empty draft group for an event, placed on the tatami after the event's last group. */
async function createGroup(tx: DbExecutor, division: typeof divisions.$inferSelect, eventId: string, eventType: DivisionEventType) {
  const settings = effectiveEventSettings(
    eventType,
    (await tx.select().from(divisionEvents).where(eq(divisionEvents.id, eventId)))[0] ?? { groupSize: null, bronzeMedals: null, boutDurationMs: null },
    await readLocalSettings(division.tournamentId)
  );
  const [top] = await tx.select({ m: max(categories.groupNo) }).from(categories).where(eq(categories.divisionEventId, eventId));
  const groupNo = (top?.m ?? 0) + 1;
  const [group] = await tx
    .insert(categories)
    .values({
      tournamentId: division.tournamentId,
      name: groupName(division.name, eventType, groupNo),
      eventType,
      kataFormat: eventType === "kata" ? "RANKED" : "BRACKET",
      kataScoringMode: "POINTS",
      bronzeMedals: engineBronze(eventType, settings.bronzeMedals),
      drawProfile: "LOCAL",
      divisionEventId: eventId,
      groupNo,
      sex: division.sex === "any" ? null : division.sex,
      ageMin: division.ageMin,
      ageMax: division.ageMax,
      belt: division.belts.join(" + ") || null,
      athletesCount: 0,
      expectedMatches: 0,
      hasFullRoster: true,
    })
    .returning({ id: categories.id, name: categories.name });
  await tx.insert(groupDrafts).values({ categoryId: group.id, seed: newGroupSeed(), pins: {} });

  // Same tatami as the event's other groups, right after the last of them.
  const siblings = await tx
    .select({ ringId: categoryAssignments.ringId, queueOrder: categoryAssignments.queueOrder })
    .from(categoryAssignments)
    .innerJoin(categories, eq(categories.id, categoryAssignments.categoryId))
    .where(and(eq(categories.divisionEventId, eventId), sql`${categories.id} <> ${group.id}`));
  const ring = siblings[0]?.ringId;
  if (ring) {
    const last = Math.max(...siblings.filter((s) => s.ringId === ring).map((s) => s.queueOrder));
    await insertGroupCards(tx, ring, [group.id], last + 1);
  }
  return group;
}

// ── Moving athletes ────────────────────────────────────────────────────────

/** Moves an athlete within an event: into a group, into a new group, or out to Unplaced (null). */
export async function moveAthleteCore(
  divisionId: string,
  input: { athleteId: string; eventType: DivisionEventType; to: string | "new" | null },
  by: string
) {
  return withDivision(divisionId, async (tx, division) => {
    const event = await eventOf(tx, divisionId, input.eventType);
    const { registration, name } = await registrationIn(tx, divisionId, input.athleteId);
    if (!(input.eventType === "kata" ? registration.kata : registration.kumite)) {
      throw new LocalSetupError(`${name} doesn't take part in ${input.eventType}.`);
    }
    if (input.to !== null && isAway(registration.attendance)) {
      throw new LocalSetupError(`${name} is marked ${registration.attendance}. Mark them present first.`);
    }

    const from = await currentGroupOf(tx, input.athleteId, event.id);
    if (from) {
      await draftGroup(tx, divisionId, from);
      if (input.to === from) return { groupId: from };
    }
    let target: string | null = null;
    if (input.to === "new") target = (await createGroup(tx, division, event.id, input.eventType)).id;
    else if (input.to !== null) {
      const group = await draftGroup(tx, divisionId, input.to);
      if (group.divisionEventId !== event.id) throw new LocalSetupError("That group is in the other event.");
      target = group.id;
    }

    if (from) {
      await removeEntry(tx, from, input.athleteId, by);
      await refreshGroupCounts(tx, from);
    }
    if (target) {
      await addEntry(tx, target, event.id, input.athleteId, registration.id);
      await saveDraft(tx, target, {}, by);
      await refreshGroupCounts(tx, target);
    }
    return { groupId: target };
  });
}

// ── Places: pins, swaps, shuffles ──────────────────────────────────────────

/**
 * Pins an athlete to a place in their group's bracket (kumite) or performance order (kata).
 * Whoever was pinned there takes the athlete's old place; an unpinned athlete there is moved by
 * the draw. Refused when the pins would leave a bout empty.
 */
export async function placeAthleteCore(
  divisionId: string,
  input: { groupId: string; athleteId: string; place: number; expectedVersion?: number },
  by: string
) {
  return withDivision(divisionId, async (tx) => {
    const group = await draftGroup(tx, divisionId, input.groupId);
    checkVersion(group, input.expectedVersion);
    if (!group.members.some((m) => m.athleteId === input.athleteId)) throw new LocalSetupError("That athlete is not in this group.");
    const places = currentPlaces(group);
    const pins = sanitizePins(group);
    const occupant = [...places].find(([, place]) => place === input.place)?.[0];
    if (occupant && occupant !== input.athleteId && pins[occupant] !== undefined) {
      const mine = places.get(input.athleteId);
      if (mine !== undefined) pins[occupant] = mine;
      else delete pins[occupant];
    }
    pins[input.athleteId] = input.place;
    return applyPins(tx, group, pins, by);
  });
}

/** Swaps two athletes of a group and pins both. */
export async function swapAthletesCore(
  divisionId: string,
  input: { groupId: string; a: string; b: string; expectedVersion?: number },
  by: string
) {
  return withDivision(divisionId, async (tx) => {
    const group = await draftGroup(tx, divisionId, input.groupId);
    checkVersion(group, input.expectedVersion);
    const places = currentPlaces(group);
    const pa = places.get(input.a);
    const pb = places.get(input.b);
    if (pa === undefined || pb === undefined || input.a === input.b) throw new LocalSetupError("Choose two athletes of this group.");
    const pins = { ...sanitizePins(group), [input.a]: pb, [input.b]: pa };
    return applyPins(tx, group, pins, by);
  });
}

async function applyPins(tx: DbExecutor, group: GroupState, pins: Record<string, number>, by: string) {
  const trial = previewGroup({ ...group, pins });
  const pinProblem = trial.blockers.find((b) => b.startsWith("The pinned places"));
  if (pinProblem) throw new LocalSetupError(pinProblem);
  await saveDraft(tx, group.id, { pins }, by);
  return { groupId: group.id };
}

/** Unpins one athlete, or everyone in the group. */
export async function unpinCore(divisionId: string, input: { groupId: string; athleteId?: string }, by: string) {
  return withDivision(divisionId, async (tx) => {
    const group = await draftGroup(tx, divisionId, input.groupId);
    const pins = input.athleteId ? { ...sanitizePins(group) } : {};
    if (input.athleteId) delete pins[input.athleteId];
    await saveDraft(tx, group.id, { pins }, by);
    return { groupId: group.id };
  });
}

/** Draws the unpinned athletes again from a fresh seed. */
export async function shuffleGroupCore(divisionId: string, groupId: string, by: string) {
  return withDivision(divisionId, async (tx) => {
    const group = await draftGroup(tx, divisionId, groupId);
    await saveDraft(tx, group.id, { seed: newGroupSeed() }, by);
    return { groupId: group.id };
  });
}

// ── Groups ─────────────────────────────────────────────────────────────────

export async function addGroupCore(divisionId: string, eventType: DivisionEventType) {
  return withDivision(divisionId, async (tx, division) => {
    const event = await eventOf(tx, divisionId, eventType);
    return createGroup(tx, division, event.id, eventType);
  });
}

/**
 * Removes a draft group; its athletes become unplaced. Later groups move down a number when
 * none of them is locked yet, so the names stay Group 1, 2, 3.
 */
export async function removeGroupCore(divisionId: string, groupId: string) {
  return withDivision(divisionId, async (tx, division) => {
    const group = await draftGroup(tx, divisionId, groupId);
    await deleteDraftGroup(tx, division, group);
    return { removed: group.name, members: group.members.length };
  });
}

async function deleteDraftGroup(tx: DbExecutor, division: typeof divisions.$inferSelect, group: GroupState) {
  await tx.delete(categories).where(eq(categories.id, group.id));
  const later = await tx
    .select({ id: categories.id, groupNo: categories.groupNo, locked: draws.state })
    .from(categories)
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(and(eq(categories.divisionEventId, group.divisionEventId), sql`${categories.groupNo} > ${group.groupNo}`))
    .orderBy(asc(categories.groupNo));
  if (later.every((g) => g.locked === null)) {
    for (const g of later) {
      const groupNo = (g.groupNo ?? 1) - 1;
      await tx.update(categories).set({ groupNo, name: groupName(division.name, group.eventType, groupNo) }).where(eq(categories.id, g.id));
    }
  }
}

/** How an event's draft groups looked: the stager's undo point. */
export interface EventDraftSnapshot {
  groups: { id: string; members: string[]; pins: Record<string, number>; seed: number }[];
}

/**
 * Puts an event's draft groups back as they were (the stager's undo): who is in which group, the
 * pins and the seed. Refused when the groups changed since the stager last looked
 * (`expectedVersions`, one per draft group), or when a group of the snapshot was locked or
 * removed since. A group added since is removed again. Athletes who can't be placed any more
 * (absent, moved out, no longer taking part) stay out and are counted in `skipped`.
 */
export async function restoreEventDraftCore(
  divisionId: string,
  eventType: DivisionEventType,
  snapshot: EventDraftSnapshot,
  expectedVersions: Record<string, number>,
  by: string
) {
  return withDivision(divisionId, async (tx, division) => {
    const event = await eventOf(tx, divisionId, eventType);
    const groups = await draftGroupsOf(tx, divisionId, event.id);
    const current = new Map(groups.map((g) => [g.id, g]));
    const stale =
      groups.some((g) => expectedVersions[g.id] !== g.version) || Object.keys(expectedVersions).some((id) => !current.has(id));
    if (stale) throw new LocalSetupError("This category changed since you looked at it, so that can't be undone.");
    if (snapshot.groups.some((s) => !current.has(s.id))) {
      throw new LocalSetupError("A group was locked or removed since, so that can't be undone.");
    }

    const eligible = new Map((await eventParticipants(tx, event.id)).filter((p) => !isAway(p.attendance)).map((p) => [p.athleteId, p]));
    const seen = new Set<string>();
    let skipped = 0;
    const plan = snapshot.groups.map((s) => {
      const members = s.members.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        if (!eligible.has(id)) skipped += 1;
        return eligible.has(id);
      });
      return { group: current.get(s.id) as GroupState, members, pins: s.pins, seed: s.seed };
    });

    // Athletes in a locked group of the event stay there: only draft groups are rewritten.
    for (const g of groups) await tx.delete(categoryEntries).where(eq(categoryEntries.categoryId, g.id));
    const locked = new Set(
      (await tx.select({ id: categoryEntries.athleteId }).from(categoryEntries).where(eq(categoryEntries.divisionEventId, event.id))).map((r) => r.id)
    );
    for (const p of plan) {
      const members = p.members.filter((id) => !locked.has(id));
      skipped += p.members.length - members.length;
      for (const id of members) await addEntry(tx, p.group.id, event.id, id, eligible.get(id)?.registrationId ?? null);
      const pins = Object.fromEntries(Object.entries(p.pins).filter(([id]) => members.includes(id)));
      await saveDraft(tx, p.group.id, { pins, seed: p.seed }, by);
      await refreshGroupCounts(tx, p.group.id);
      // Pins that only worked with someone who is now missing are dropped rather than left blocking.
      const restored = await loadGroupState(tx, p.group.id);
      if (restored && previewGroup(restored).blockers.some((b) => b.startsWith("The pinned places"))) {
        await tx.update(groupDrafts).set({ pins: {} }).where(eq(groupDrafts.categoryId, p.group.id));
      }
    }

    const inSnapshot = new Set(snapshot.groups.map((s) => s.id));
    const added = groups.filter((g) => !inSnapshot.has(g.id)).sort((a, b) => b.groupNo - a.groupNo);
    for (const g of added) await deleteDraftGroup(tx, division, g);
    return { skipped, removedGroups: added.map((g) => ({ id: g.id, name: g.name })) };
  });
}

/** Present athletes of an event who are in no group. */
async function unplacedOf(tx: DbExecutor, divisionEventId: string) {
  const everyone = await eventParticipants(tx, divisionEventId);
  const placed = new Set(
    (await tx.select({ id: categoryEntries.athleteId }).from(categoryEntries).where(eq(categoryEntries.divisionEventId, divisionEventId))).map((r) => r.id)
  );
  return everyone.filter((p) => !placed.has(p.athleteId) && !isAway(p.attendance));
}

async function draftGroupsOf(tx: DbExecutor, divisionId: string, divisionEventId: string) {
  const rows = await tx
    .select({ id: categories.id })
    .from(categories)
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(and(eq(categories.divisionEventId, divisionEventId), sql`${draws.state} is distinct from 'LOCKED'`))
    .orderBy(asc(categories.groupNo));
  const groups: GroupState[] = [];
  for (const r of rows) groups.push(await draftGroup(tx, divisionId, r.id));
  return groups;
}

/** Puts every unplaced, present athlete into the smallest unlocked group, spreading clubs. Nobody already placed moves. */
export async function autoFillCore(divisionId: string, eventType: DivisionEventType, by: string) {
  return withDivision(divisionId, async (tx) => {
    const event = await eventOf(tx, divisionId, eventType);
    const groups = await draftGroupsOf(tx, divisionId, event.id);
    if (groups.length === 0) throw new LocalSetupError("Add a group first.");
    const sizes = new Map(groups.map((g) => [g.id, g.members.length]));
    const clubs = new Map(groups.map((g) => [g.id, g.members.map((m) => (m.club ?? "").toLowerCase())]));
    const unplaced = (await unplacedOf(tx, event.id)).sort((a, b) => a.name.localeCompare(b.name));
    for (const p of unplaced) {
      const club = (p.club ?? "").toLowerCase();
      const target = [...groups].sort(
        (a, b) =>
          (sizes.get(a.id) ?? 0) - (sizes.get(b.id) ?? 0) ||
          (clubs.get(a.id) ?? []).filter((c) => club && c === club).length - (clubs.get(b.id) ?? []).filter((c) => club && c === club).length ||
          a.groupNo - b.groupNo
      )[0] as GroupState;
      await addEntry(tx, target.id, event.id, p.athleteId, p.registrationId);
      sizes.set(target.id, (sizes.get(target.id) ?? 0) + 1);
      clubs.get(target.id)?.push(club);
    }
    for (const g of groups) {
      await saveDraft(tx, g.id, {}, by);
      await refreshGroupCounts(tx, g.id);
    }
    return { placed: unplaced.length };
  });
}

/**
 * Lays an event's present athletes out evenly over its unlocked groups: pinned athletes stay
 * where they are, everyone else (and anyone unplaced) is dealt so sizes differ by at most one and
 * clubs are spread. Absent athletes leave the groups.
 */
export async function rebalanceCore(divisionId: string, eventType: DivisionEventType, by: string) {
  return withDivision(divisionId, async (tx) => {
    const event = await eventOf(tx, divisionId, eventType);
    const groups = await draftGroupsOf(tx, divisionId, event.id);
    if (groups.length === 0) throw new LocalSetupError("Add a group first.");

    const pinnedIn = new Map<string, string[]>();
    const pool: { id: string; club: string | null; registrationId: string | null }[] = [];
    for (const g of groups) {
      const pins = sanitizePins(g);
      pinnedIn.set(g.id, []);
      for (const m of g.members) {
        if (isAway(m.attendance)) continue;
        if (pins[m.athleteId] !== undefined) pinnedIn.get(g.id)?.push(m.athleteId);
        else pool.push({ id: m.athleteId, club: m.club, registrationId: m.registrationId });
      }
    }
    for (const p of await unplacedOf(tx, event.id)) pool.push({ id: p.athleteId, club: p.club, registrationId: p.registrationId });

    const total = pool.length + [...pinnedIn.values()].reduce((n, l) => n + l.length, 0);
    const k = groups.length;
    const target = groups.map((_, i) => Math.floor(total / k) + (i < total % k ? 1 : 0));
    const capacity = groups.map((g, i) => Math.max(0, (target[i] as number) - (pinnedIn.get(g.id)?.length ?? 0)));
    // Pinned athletes over a group's target leave too little room elsewhere: give the rest to the emptiest groups.
    const filled = (j: number) => (capacity[j] ?? 0) + (pinnedIn.get(groups[j]?.id ?? "")?.length ?? 0);
    let short = pool.length - capacity.reduce((a, b) => a + b, 0);
    while (short > 0) {
      let emptiest = 0;
      for (let j = 1; j < capacity.length; j += 1) if (filled(j) < filled(emptiest)) emptiest = j;
      capacity[emptiest] = (capacity[emptiest] ?? 0) + 1;
      short -= 1;
    }
    const dealt = distributeIntoGroups(pool, capacity, newGroupSeed());
    const registrationOf = new Map(pool.map((p) => [p.id, p.registrationId]));

    // Clear every group first: an athlete may move from a later group to an earlier one, and an
    // athlete is in one group per event.
    for (const g of groups) await tx.delete(categoryEntries).where(eq(categoryEntries.categoryId, g.id));
    for (const [i, g] of groups.entries()) {
      const keep = new Set([...(pinnedIn.get(g.id) ?? []), ...(dealt[i] ?? [])]);
      for (const athleteId of keep) await addEntry(tx, g.id, event.id, athleteId, registrationOf.get(athleteId) ?? g.members.find((m) => m.athleteId === athleteId)?.registrationId ?? null);
      await saveDraft(tx, g.id, { pins: Object.fromEntries(Object.entries(sanitizePins(g)).filter(([id]) => keep.has(id))) }, by);
      await refreshGroupCounts(tx, g.id);
    }
    return { groups: groups.length, athletes: total };
  });
}

// ── Athletes at the desk ───────────────────────────────────────────────────

/** Marks an athlete present (null clears it), absent or withdrawn. Absent athletes leave their draft groups. */
export async function setAttendanceCore(divisionId: string, athleteId: string, status: "present" | "absent" | "withdrawn" | null, by: string) {
  return withDivision(divisionId, async (tx) => {
    const { registration } = await registrationIn(tx, divisionId, athleteId);
    const before = registration.attendance;
    if (isAway(status)) {
      const events = await tx.select({ id: divisionEvents.id }).from(divisionEvents).where(eq(divisionEvents.divisionId, divisionId));
      await removeFromDraftGroups(tx, athleteId, events.map((e) => e.id));
    }
    await tx
      .update(tournamentRegistrations)
      .set({ attendance: status, attendanceSetBy: status ? by : null, attendanceSetAt: status ? new Date() : null })
      .where(eq(tournamentRegistrations.id, registration.id));
    return { before, after: status };
  });
}

export interface WalkInInput {
  name: string;
  club: string;
  age?: number | string | null;
  belt?: string | null;
  sex?: string | null;
  kumite?: boolean;
  kata?: boolean;
}

/**
 * Registers a walk-in straight into the held division. Age, belt and sex default from the division.
 * Unless `confirmNew`, athletes of the tournament with the same name are offered first.
 */
export async function registerWalkInCore(divisionId: string, input: WalkInInput, confirmNew: boolean) {
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));
  if (!division) throw new LocalSetupError("Category not found.");
  const name = input.name.trim();
  const club = input.club.trim();
  if (!name || !club) throw new LocalSetupError("A walk-in needs a name and a club.");

  if (!confirmNew) {
    const same = await db
      .select({ id: athletes.id, name: athletes.name, club: athletes.school, divisionName: divisions.name })
      .from(athletes)
      .leftJoin(tournamentRegistrations, eq(tournamentRegistrations.athleteId, athletes.id))
      .leftJoin(divisions, eq(divisions.id, tournamentRegistrations.divisionId))
      .where(and(eq(athletes.tournamentId, division.tournamentId), sql`lower(trim(${athletes.name})) = lower(${name})`))
      .limit(5);
    if (same.length > 0) return { duplicates: same, athleteId: null };
  }

  const added = await addLocalAthleteCore(division.tournamentId, {
    name,
    club,
    age: input.age ?? (division.ageMin === division.ageMax ? division.ageMin : null),
    belt: input.belt ?? (division.belts.length === 1 ? division.belts[0] : null),
    sex: input.sex ?? (division.sex === "any" ? null : division.sex),
    divisionId,
    kumite: input.kumite !== false,
    kata: input.kata !== false,
    walkIn: true,
  });
  return { duplicates: [], athleteId: added.athlete.id, chestNumber: added.chestNumber, name: added.athlete.name };
}

/** Moves an athlete from another category (or none) into the held one. Refused while someone else holds theirs. */
export async function moveIntoDivisionCore(divisionId: string, athleteId: string) {
  const [division] = await db.select({ tournamentId: divisions.tournamentId }).from(divisions).where(eq(divisions.id, divisionId));
  if (!division) throw new LocalSetupError("Category not found.");
  const [reg] = await db
    .select({ divisionId: tournamentRegistrations.divisionId })
    .from(tournamentRegistrations)
    .where(and(eq(tournamentRegistrations.athleteId, athleteId), eq(tournamentRegistrations.tournamentId, division.tournamentId)));
  if (reg?.divisionId && reg.divisionId !== divisionId) {
    const [hold] = await db.select({ name: divisionHolds.holderName }).from(divisionHolds).where(eq(divisionHolds.divisionId, reg.divisionId));
    if (hold) throw new LocalSetupError(`${hold.name} is preparing that athlete's category. Ask them to hand it back first.`);
  }
  return assignAthleteDivisionCore(division.tournamentId, athleteId, divisionId);
}

/** Athletes of the tournament matching a name, chest number or club, with their category. */
export async function searchAthletesCore(tournamentId: string, query: string) {
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return [];
  return db
    .select({
      id: athletes.id,
      name: athletes.name,
      chestNumber: athletes.chestNumber,
      club: athletes.school,
      age: athletes.age,
      belt: athletes.belt,
      divisionId: tournamentRegistrations.divisionId,
      divisionName: divisions.name,
    })
    .from(athletes)
    .leftJoin(tournamentRegistrations, eq(tournamentRegistrations.athleteId, athletes.id))
    .leftJoin(divisions, eq(divisions.id, tournamentRegistrations.divisionId))
    .where(and(eq(athletes.tournamentId, tournamentId), or(ilike(athletes.name, `%${q}%`), eq(athletes.chestNumber, q), ilike(athletes.school, `%${q}%`))))
    .orderBy(asc(athletes.name))
    .limit(20);
}

// ── Lock and send ──────────────────────────────────────────────────────────

/**
 * Locks a group: its draft becomes a real draw, built by exactly the function the preview uses,
 * and the group can start on its tatami. Refused while anything blocks it, and when the group
 * changed since the stager looked (`expectedChecksum`). The hold ends once every group is locked.
 */
export async function lockGroupCore(divisionId: string, groupId: string, lockedBy: string, expectedChecksum?: string) {
  return withDivision(divisionId, async (tx) => {
    const group = await draftGroup(tx, divisionId, groupId);
    const preview = previewGroup(group);
    if (preview.blockers.length > 0 || preview.graph === null) {
      throw new LocalSetupError(preview.blockers[0] ?? "This group can't be locked yet.");
    }
    const graph = preview.graph;
    if (expectedChecksum && expectedChecksum !== graph.checksum) {
      throw new LocalSetupError("This group changed since you looked at it. Check it again before locking.");
    }
    const { version } = await writeDrawGraph(tx, groupId, graph, {
      format: group.eventType === "kata" ? "KATA_RANKED" : "SINGLE_ELIM_REPECHAGE",
      state: "LOCKED",
      bronzeMedals: group.bronze,
      reason: `Locked by ${lockedBy}`,
    });
    await tx
      .update(categories)
      .set({ athletesCount: group.members.length })
      .where(eq(categories.id, groupId));
    const released = await releaseIfAllSent(tx, divisionId);
    const pins = sanitizePins(group);
    return {
      group,
      released,
      snapshot: {
        members: group.members.map((m) => m.athleteId),
        places: preview.places.map((p) => ({ place: p.place, athleteId: p.athleteId })),
        pinned: Object.keys(pins),
        seed: group.seed,
        checksum: graph.checksum,
        version,
        bouts: expectedBouts(group.eventType, group.members.length, group.bronze === 1 ? 1 : 2),
      },
    };
  });
}
