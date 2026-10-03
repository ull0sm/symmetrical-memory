/**
 * A Local group's draw, built from its draft: the members, the athletes pinned by
 * hand and the stored seed. The stager's preview and the lock use this same
 * function, so what is locked is exactly what was shown. Also the group's
 * validation: what blocks the lock, and what only warns.
 * No authorization here: the staging actions guard it.
 */
import { asc, eq } from "drizzle-orm";
import {
  athletes,
  categories,
  categoryEntries,
  divisionEvents,
  draws,
  groupDrafts,
  tournamentRegistrations,
  tournaments,
} from "@/db/schema";
import { WKF_KATA_2026, WKF_KUMITE_2026 } from "@/engine/rules-engine";
import { DrawInputError } from "@/engine/draw-engine/errors";
import { generateGroupDraw, groupBracketSize, placesOf } from "@/engine/draw-engine/groupDraw";
import { generateRankedKataDraw, performanceOrder } from "@/engine/draw-engine/rankedKataDraw";
import type { DrawGraph, Participant } from "@/engine/draw-engine/types";
import type { DbExecutor } from "@/lib/draws/generateDraws";
import { clubKey } from "@/lib/draws/generateDraws";
import type { DivisionEventType } from "@/lib/statuses";

export interface GroupMember {
  athleteId: string;
  registrationId: string | null;
  name: string;
  club: string | null;
  chestNumber: string | null;
  attendance: string | null;
  walkIn: boolean;
  needsReview: boolean;
}

export interface GroupState {
  id: string;
  groupNo: number;
  name: string;
  divisionEventId: string;
  eventType: DivisionEventType;
  /** The engine's bronze option stored on the group (kumite 3 or 1, kata 2 or 1). */
  bronze: number;
  /** The plan's group size, for the "more than the plan" warning. */
  planSize: number | null;
  locked: boolean;
  drawChecksum: string | null;
  seed: number;
  pins: Record<string, number>;
  version: number;
  separateClubs: boolean;
  members: GroupMember[];
}

/** Loads a group with its draft and members, or null if it is not a Local group. */
export async function loadGroupState(executor: DbExecutor, groupId: string): Promise<GroupState | null> {
  const [row] = await executor
    .select({
      id: categories.id,
      groupNo: categories.groupNo,
      name: categories.name,
      divisionEventId: categories.divisionEventId,
      eventType: categories.eventType,
      bronze: categories.bronzeMedals,
      drawState: draws.state,
      drawChecksum: draws.checksum,
      seed: groupDrafts.seed,
      pins: groupDrafts.pins,
      version: groupDrafts.version,
      groupSize: divisionEvents.groupSize,
      kumiteSize: tournaments.localKumiteGroupSize,
      kataSize: tournaments.localKataGroupSize,
      separation: tournaments.drawSeparation,
    })
    .from(categories)
    .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
    .innerJoin(tournaments, eq(tournaments.id, categories.tournamentId))
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .leftJoin(groupDrafts, eq(groupDrafts.categoryId, categories.id))
    .where(eq(categories.id, groupId));
  if (!row || !row.divisionEventId) return null;

  const members = await executor
    .select({
      athleteId: athletes.id,
      registrationId: categoryEntries.registrationId,
      name: athletes.name,
      club: athletes.school,
      dojo: athletes.dojo,
      chestNumber: athletes.chestNumber,
      attendance: tournamentRegistrations.attendance,
      walkIn: athletes.walkIn,
      needsReview: athletes.needsReview,
    })
    .from(categoryEntries)
    .innerJoin(athletes, eq(athletes.id, categoryEntries.athleteId))
    .leftJoin(tournamentRegistrations, eq(tournamentRegistrations.athleteId, athletes.id))
    .where(eq(categoryEntries.categoryId, groupId))
    .orderBy(asc(athletes.name));

  const eventType: DivisionEventType = row.eventType === "kata" ? "kata" : "kumite";
  return {
    id: row.id,
    groupNo: row.groupNo ?? 1,
    name: row.name,
    divisionEventId: row.divisionEventId,
    eventType,
    bronze: row.bronze ?? (eventType === "kata" ? 2 : 3),
    planSize: row.groupSize ?? (eventType === "kata" ? row.kataSize : row.kumiteSize),
    locked: row.drawState === "LOCKED",
    drawChecksum: row.drawChecksum ?? null,
    seed: Number(row.seed ?? 0),
    pins: (row.pins ?? {}) as Record<string, number>,
    version: row.version ?? 1,
    separateClubs: row.separation !== "OFF",
    members: members.map((m) => ({ ...m, club: m.club ?? m.dojo ?? null })),
  };
}

/** Pins that still make sense: members only, places inside the group's bracket or order, one athlete per place. */
export function sanitizePins(group: Pick<GroupState, "eventType" | "pins" | "members">): Record<string, number> {
  const memberIds = new Set(group.members.map((m) => m.athleteId));
  const limit = group.eventType === "kata" ? group.members.length : groupBracketSize(group.members.length);
  const taken = new Set<number>();
  const out: Record<string, number> = {};
  for (const [athleteId, place] of Object.entries(group.pins)) {
    if (!memberIds.has(athleteId) || !Number.isInteger(place) || place < 1 || place > limit || taken.has(place)) continue;
    taken.add(place);
    out[athleteId] = place;
  }
  return out;
}

const participantOf = (m: GroupMember): Participant => ({
  registrationId: m.athleteId,
  displayName: m.name,
  clubId: clubKey(m.athleteId, m.club, null),
  districtId: null,
});

/** The group's draw from its draft. Throws the engine's DrawInputError when the pins can't be honoured. */
export function buildGroupGraph(group: GroupState, pins: Record<string, number> = sanitizePins(group)): DrawGraph {
  const participants = group.members.map(participantOf);
  if (group.eventType === "kata") {
    return generateRankedKataDraw(
      {
        categoryId: group.id,
        participants,
        pins,
        randomSeed: group.seed,
        separateClubs: group.separateClubs,
        bronzeMedals: group.bronze === 1 ? 1 : 2,
      },
      WKF_KATA_2026
    );
  }
  return generateGroupDraw(
    {
      categoryId: group.id,
      participants,
      pins,
      randomSeed: group.seed,
      separation: group.separateClubs ? { by: "CLUB", rule: "FIRST_ROUND" } : undefined,
      bronzeMedals: group.bronze === 1 ? 1 : 3,
    },
    WKF_KUMITE_2026
  );
}

export interface PlacedAthlete {
  place: number;
  athleteId: string | null;
  pinned: boolean;
}

export interface GroupPreview {
  graph: DrawGraph | null;
  /** Kumite: every place of the bracket, a null athlete being a bye. Kata: the performance order. */
  places: PlacedAthlete[];
  blockers: string[];
  warnings: string[];
}

const away = (m: GroupMember) => m.attendance === "absent" || m.attendance === "withdrawn";

/** The preview a stager sees, with what blocks the lock and what only warns. */
export function previewGroup(group: GroupState): GroupPreview {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const pins = sanitizePins(group);

  if (group.members.length === 0) blockers.push("The group is empty. Add at least one athlete.");
  for (const m of group.members.filter(away)) {
    blockers.push(`${m.name} is marked ${m.attendance}. Mark them present or take them out of the group.`);
  }

  let graph: DrawGraph | null = null;
  if (group.members.length > 0) {
    try {
      graph = buildGroupGraph(group, pins);
    } catch (err) {
      if (!(err instanceof DrawInputError)) throw err;
      for (const issue of err.issues) {
        blockers.push(
          issue.code === "PINS_LEAVE_EMPTY_BOUT"
            ? "The pinned places leave a bout with nobody in it. Move or unpin an athlete."
            : issue.code === "GROUP_TOO_LARGE"
              ? `A group holds at most 32 athletes; this one has ${group.members.length}. Split it.`
              : issue.message
        );
      }
    }
  }

  if (group.members.length === 1) warnings.push("One athlete: gold by walkover.");
  if (group.planSize !== null && group.members.length > group.planSize) {
    warnings.push(`${group.members.length} athletes, more than the plan's ${group.planSize}.`);
  }
  if (graph?.warnings.some((w) => w.code === "SEPARATION_IMPOSSIBLE")) {
    warnings.push(group.eventType === "kata" ? "Club-mates perform as a pair." : "Club-mates meet in the first round.");
  }
  for (const m of group.members.filter((m) => m.needsReview)) {
    warnings.push(`${m.name} is a walk-in the admin hasn't reviewed yet.`);
  }

  const places: PlacedAthlete[] = [];
  if (graph && group.eventType === "kata") {
    performanceOrder(graph).forEach((athleteId, i) => places.push({ place: i + 1, athleteId, pinned: pins[athleteId] === i + 1 }));
  } else if (graph) {
    const byPlace = new Map([...placesOf(graph)].map(([athleteId, place]) => [place, athleteId]));
    for (let place = 1; place <= graph.tournamentSize; place += 1) {
      const athleteId = byPlace.get(place) ?? null;
      places.push({ place, athleteId, pinned: athleteId !== null && pins[athleteId] === place });
    }
  }
  return { graph, places, blockers, warnings };
}

/** Each member's place in the group's current preview. */
export function currentPlaces(group: GroupState): Map<string, number> {
  const preview = previewGroup(group);
  const out = new Map<string, number>();
  for (const p of preview.places) if (p.athleteId) out.set(p.athleteId, p.place);
  return out;
}
