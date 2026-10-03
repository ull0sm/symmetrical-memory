/**
 * Starting groups: the admin's plan applied to a division event's athletes
 * before the event. Each group is an ordinary `categories` row with its members
 * in `category_entries`, a `group_drafts` row (its seed, nothing pinned) and no
 * draw until a stager locks it. The stager changes them freely at the venue.
 * No authorization here: the admin actions guard it.
 */
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
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
import type { DbExecutor } from "@/lib/draws/generateDraws";
import type { DivisionEventType } from "@/lib/statuses";
import { LocalSetupError, readLocalSettings } from "./divisions";
import { distributeIntoGroups, effectiveEventSettings, engineBronze, expectedBouts, groupName, planGroupSizes } from "./rules";
import { insertGroupCards } from "./tatami";

/** A fresh 32-bit seed, stored with a group so its draw can be reproduced. */
export function newGroupSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now() >>> 0;
}

export interface EventParticipant {
  athleteId: string;
  registrationId: string;
  name: string;
  club: string | null;
  attendance: string | null;
}

/**
 * Athletes taking part in a division event: registered in the division with the
 * event's flag on. Absent and withdrawn athletes are included and flagged; callers
 * decide whether to leave them out.
 */
export async function eventParticipants(executor: DbExecutor, divisionEventId: string): Promise<EventParticipant[]> {
  const [event] = await executor
    .select({ divisionId: divisionEvents.divisionId, eventType: divisionEvents.eventType })
    .from(divisionEvents)
    .where(eq(divisionEvents.id, divisionEventId));
  if (!event) return [];
  const flag = event.eventType === "kata" ? tournamentRegistrations.kata : tournamentRegistrations.kumite;
  return executor
    .select({
      athleteId: athletes.id,
      registrationId: tournamentRegistrations.id,
      name: athletes.name,
      club: athletes.school,
      attendance: tournamentRegistrations.attendance,
    })
    .from(tournamentRegistrations)
    .innerJoin(athletes, eq(athletes.id, tournamentRegistrations.athleteId))
    .where(and(eq(tournamentRegistrations.divisionId, event.divisionId), eq(flag, true)))
    .orderBy(asc(athletes.name));
}

const isAway = (p: EventParticipant) => p.attendance === "absent" || p.attendance === "withdrawn";

/** Why an event's starting groups can't be rebuilt right now, or null. */
async function rebuildRefusal(executor: DbExecutor, divisionEventId: string, divisionId: string): Promise<string | null> {
  const [hold] = await executor.select({ name: divisionHolds.holderName }).from(divisionHolds).where(eq(divisionHolds.divisionId, divisionId));
  if (hold) return `${hold.name} is preparing this category right now.`;
  const started = await executor
    .select({ name: categories.name })
    .from(categories)
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .leftJoin(categoryAssignments, eq(categoryAssignments.categoryId, categories.id))
    .where(
      and(
        eq(categories.divisionEventId, divisionEventId),
        or(inArray(categoryAssignments.status, ["running", "paused", "completed"]), isNotNull(draws.id))
      )
    )
    .limit(1);
  if (started[0]) return `"${started[0].name}" is already locked or on a tatami, so its groups can't be rebuilt.`;
  return null;
}

/**
 * Builds (or rebuilds) an event's starting groups from its plan: as few groups
 * as the group size allows, sizes within one of each other, clubs spread across
 * them, nothing pinned. Absent athletes are left out. Rebuilt groups take the old
 * groups' place in their tatami's queue. Refused once any group is locked or on
 * a mat, or while someone holds the division.
 */
export async function buildStartingGroupsCore(divisionEventId: string, options: { seed?: number } = {}) {
  const [row] = await db
    .select({
      eventType: divisionEvents.eventType,
      enabled: divisionEvents.enabled,
      groupSize: divisionEvents.groupSize,
      bronzeMedals: divisionEvents.bronzeMedals,
      boutDurationMs: divisionEvents.boutDurationMs,
      divisionId: divisions.id,
      divisionName: divisions.name,
      tournamentId: divisions.tournamentId,
      sex: divisions.sex,
      ageMin: divisions.ageMin,
      ageMax: divisions.ageMax,
      belts: divisions.belts,
    })
    .from(divisionEvents)
    .innerJoin(divisions, eq(divisions.id, divisionEvents.divisionId))
    .where(eq(divisionEvents.id, divisionEventId));
  if (!row) throw new LocalSetupError("Event not found.");

  const eventType = row.eventType as DivisionEventType;
  const settings = effectiveEventSettings(eventType, row, await readLocalSettings(row.tournamentId));

  return db.transaction(async (tx) => {
    // Serialize with other rebuilds and with a stager taking the division.
    await tx.select({ id: divisions.id }).from(divisions).where(eq(divisions.id, row.divisionId)).for("update");
    const refusal = await rebuildRefusal(tx, divisionEventId, row.divisionId);
    if (refusal) throw new LocalSetupError(refusal);

    // Where the old groups stood, so the new ones take their place.
    const oldGroups = await tx.select({ id: categories.id }).from(categories).where(eq(categories.divisionEventId, divisionEventId));
    const oldCards = oldGroups.length
      ? await tx.select().from(categoryAssignments).where(inArray(categoryAssignments.categoryId, oldGroups.map((g) => g.id)))
      : [];
    const firstCard = oldCards[0];
    const place = firstCard
      ? {
          ringId: firstCard.ringId,
          queueOrder: Math.min(...oldCards.filter((c) => c.ringId === firstCard.ringId).map((c) => c.queueOrder)),
        }
      : null;
    if (oldGroups.length) await tx.delete(categories).where(inArray(categories.id, oldGroups.map((g) => g.id)));

    if (!row.enabled) return { groups: [] as { id: string; groupNo: number; size: number }[], left: 0 };

    const everyone = await eventParticipants(tx, divisionEventId);
    const present = everyone.filter((p) => !isAway(p));
    const sizes = planGroupSizes(present.length, settings.groupSize);
    const seed = options.seed ?? newGroupSeed();
    const members = distributeIntoGroups(present.map((p) => ({ id: p.athleteId, club: p.club })), sizes, seed);
    const byAthlete = new Map(present.map((p) => [p.athleteId, p]));

    const groups: { id: string; groupNo: number; size: number }[] = [];
    for (let i = 0; i < members.length; i += 1) {
      const ids = members[i] as string[];
      const groupNo = i + 1;
      const [group] = await tx
        .insert(categories)
        .values({
          tournamentId: row.tournamentId,
          name: groupName(row.divisionName, eventType, groupNo),
          eventType,
          kataFormat: eventType === "kata" ? "RANKED" : "BRACKET",
          kataScoringMode: "POINTS",
          bronzeMedals: engineBronze(eventType, settings.bronzeMedals),
          drawProfile: "LOCAL",
          divisionEventId,
          groupNo,
          sex: row.sex === "any" ? null : row.sex,
          ageMin: row.ageMin,
          ageMax: row.ageMax,
          belt: row.belts.join(" + ") || null,
          athletesCount: ids.length,
          expectedMatches: expectedBouts(eventType, ids.length, settings.bronzeMedals),
          hasFullRoster: true,
        })
        .returning({ id: categories.id });
      if (ids.length > 0) {
        await tx.insert(categoryEntries).values(
          ids.map((athleteId) => ({
            categoryId: group.id,
            athleteId,
            registrationId: byAthlete.get(athleteId)?.registrationId ?? null,
            divisionEventId,
          }))
        );
      }
      await tx.insert(groupDrafts).values({ categoryId: group.id, seed: newGroupSeed(), pins: {} });
      groups.push({ id: group.id, groupNo, size: ids.length });
    }

    if (place) await insertGroupCards(tx, place.ringId, groups.map((g) => g.id), place.queueOrder);
    return { groups, left: everyone.length - present.length };
  });
}

export interface StartingGroupsPreflightItem {
  divisionEventId: string;
  divisionId: string;
  name: string;
  eventType: DivisionEventType;
  participants: number;
  plannedSizes: number[];
  existingGroups: number;
  action: "BUILD" | "PROTECT" | "SKIP";
  reason: string;
}

/** What "build all starting groups" would do, event by event. */
export async function startingGroupsPreflight(tournamentId: string): Promise<StartingGroupsPreflightItem[]> {
  const settings = await readLocalSettings(tournamentId);
  const events = await db
    .select({
      id: divisionEvents.id,
      eventType: divisionEvents.eventType,
      enabled: divisionEvents.enabled,
      groupSize: divisionEvents.groupSize,
      bronzeMedals: divisionEvents.bronzeMedals,
      boutDurationMs: divisionEvents.boutDurationMs,
      divisionId: divisions.id,
      name: divisions.name,
      sortOrder: divisions.sortOrder,
    })
    .from(divisionEvents)
    .innerJoin(divisions, eq(divisions.id, divisionEvents.divisionId))
    .where(eq(divisions.tournamentId, tournamentId))
    .orderBy(asc(divisions.sortOrder), asc(divisionEvents.eventType));

  const items: StartingGroupsPreflightItem[] = [];
  for (const e of events) {
    const eventType = e.eventType as DivisionEventType;
    const present = (await eventParticipants(db, e.id)).filter((p) => !isAway(p)).length;
    const existing = await db.select({ id: categories.id }).from(categories).where(eq(categories.divisionEventId, e.id));
    const plannedSizes = planGroupSizes(present, effectiveEventSettings(eventType, e, settings).groupSize);
    const base = { divisionEventId: e.id, divisionId: e.divisionId, name: e.name, eventType, participants: present, plannedSizes, existingGroups: existing.length };
    if (!e.enabled) {
      items.push({ ...base, action: "SKIP", reason: "This event is switched off" });
      continue;
    }
    const refusal = await rebuildRefusal(db, e.id, e.divisionId);
    if (refusal) items.push({ ...base, action: "PROTECT", reason: refusal });
    else if (present === 0) items.push({ ...base, action: "SKIP", reason: "Nobody takes part yet" });
    else items.push({ ...base, action: "BUILD", reason: existing.length ? "Groups will be rebuilt" : "Groups will be built" });
  }
  return items;
}

/** Builds every event the preflight marks BUILD. Returns how many events were built and any errors. */
export async function buildAllStartingGroupsCore(tournamentId: string) {
  const plan = await startingGroupsPreflight(tournamentId);
  let built = 0;
  const errors: string[] = [];
  for (const item of plan.filter((i) => i.action === "BUILD")) {
    try {
      await buildStartingGroupsCore(item.divisionEventId);
      built += 1;
    } catch (err) {
      if (err instanceof LocalSetupError) errors.push(`${item.name} (${item.eventType}): ${err.message}`);
      else throw err;
    }
  }
  return { built, protectedCount: plan.filter((i) => i.action === "PROTECT").length, errors };
}

/** Removes an athlete from the draft groups of the given division events, keeping counts and pins right. Locked groups are refused. */
export async function removeFromDraftGroups(tx: DbExecutor, athleteId: string, divisionEventIds: readonly string[]) {
  if (divisionEventIds.length === 0) return [];
  const entries = await tx
    .select({ categoryId: categoryEntries.categoryId, name: categories.name, drawState: draws.state })
    .from(categoryEntries)
    .innerJoin(categories, eq(categories.id, categoryEntries.categoryId))
    .leftJoin(draws, eq(draws.categoryId, categoryEntries.categoryId))
    .where(and(eq(categoryEntries.athleteId, athleteId), inArray(categoryEntries.divisionEventId, [...divisionEventIds])));
  const locked = entries.find((e) => e.drawState === "LOCKED");
  if (locked) throw new LocalSetupError(`This athlete is in "${locked.name}", which is locked. Only a late change can move them now.`);

  for (const e of entries) {
    await tx.delete(categoryEntries).where(and(eq(categoryEntries.categoryId, e.categoryId), eq(categoryEntries.athleteId, athleteId)));
    await refreshGroupCounts(tx, e.categoryId);
    // A membership change is a new version of the draft, pinned or not.
    const [draft] = await tx.select().from(groupDrafts).where(eq(groupDrafts.categoryId, e.categoryId));
    if (draft) {
      const pins = { ...draft.pins };
      delete pins[athleteId];
      await tx.update(groupDrafts).set({ pins, version: draft.version + 1, updatedAt: new Date() }).where(eq(groupDrafts.categoryId, e.categoryId));
    }
  }
  return entries.map((e) => e.categoryId);
}

/** Re-counts a group's athletes and expected bouts from its entries. */
export async function refreshGroupCounts(tx: DbExecutor, categoryId: string) {
  const [group] = await tx
    .select({ eventType: categories.eventType, bronze: categories.bronzeMedals })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!group) return;
  const members = await tx.select({ id: categoryEntries.id }).from(categoryEntries).where(eq(categoryEntries.categoryId, categoryId));
  const eventType = group.eventType === "kata" ? "kata" : "kumite";
  // Stored as the engine's option (kumite 3 or 1, kata 2 or 1); 1 always means a single bronze.
  const bronze = group.bronze === 1 ? 1 : 2;
  await tx
    .update(categories)
    .set({ athletesCount: members.length, expectedMatches: expectedBouts(eventType, members.length, bronze) })
    .where(eq(categories.id, categoryId));
}

/** Division events of a division, optionally of one type. */
export async function eventsOfDivision(executor: DbExecutor, divisionId: string, eventType?: DivisionEventType) {
  return executor
    .select({ id: divisionEvents.id, eventType: divisionEvents.eventType, enabled: divisionEvents.enabled })
    .from(divisionEvents)
    .where(eventType ? and(eq(divisionEvents.divisionId, divisionId), eq(divisionEvents.eventType, eventType)) : eq(divisionEvents.divisionId, divisionId));
}


export interface EventPlanPatch {
  enabled?: boolean;
  /** Null means "use the tournament default". */
  groupSize?: number | null;
  bronzeMedals?: 1 | 2 | null;
  boutDurationMs?: number | null;
}

/**
 * Changes an event's plan. A new plan shapes the next starting-groups build, never
 * existing groups. Switching an event off removes its draft groups, and is refused
 * once any of them is locked or on a mat.
 */
export async function setDivisionEventCore(divisionEventId: string, patch: EventPlanPatch) {
  const [event] = await db.select().from(divisionEvents).where(eq(divisionEvents.id, divisionEventId));
  if (!event) throw new LocalSetupError("Event not found.");
  const next = {
    enabled: patch.enabled ?? event.enabled,
    groupSize: patch.groupSize !== undefined ? patch.groupSize : event.groupSize,
    bronzeMedals: patch.bronzeMedals !== undefined ? patch.bronzeMedals : event.bronzeMedals,
    boutDurationMs: patch.boutDurationMs !== undefined ? patch.boutDurationMs : event.boutDurationMs,
  };
  if (next.groupSize !== null && !(Number.isInteger(next.groupSize) && next.groupSize >= 1 && next.groupSize <= 32)) {
    throw new LocalSetupError("A group size must be a whole number from 1 to 32.");
  }
  if (next.bronzeMedals !== null && next.bronzeMedals !== 1 && next.bronzeMedals !== 2) throw new LocalSetupError("Bronzes must be 1 or 2.");
  if (next.boutDurationMs !== null && !(Number.isInteger(next.boutDurationMs) && next.boutDurationMs >= 10_000 && next.boutDurationMs <= 600_000)) {
    throw new LocalSetupError("A bout must last between 10 seconds and 10 minutes.");
  }

  return db.transaction(async (tx) => {
    if (!next.enabled && event.enabled) {
      const refusal = await rebuildRefusal(tx, divisionEventId, event.divisionId);
      if (refusal) throw new LocalSetupError(refusal);
      await tx.delete(categories).where(eq(categories.divisionEventId, divisionEventId));
    }
    await tx.update(divisionEvents).set(next).where(eq(divisionEvents.id, divisionEventId));
    return { before: event, after: { ...event, ...next } };
  });
}
