"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { requireLocalTournament, requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import { parseInput } from "@/lib/validation";
import { DIVISION_EVENT_TYPES } from "@/lib/statuses";
import { LocalSetupError } from "@/lib/local/divisions";
import {
  addLocalAthleteCore,
  assignAthleteDivisionCore,
  deleteLocalAthleteCore,
  importLocalRosterCore,
  setParticipationCore,
} from "@/lib/local/localRoster";
import { loadLocalAthletes } from "@/lib/local/setupView";

/**
 * The roster of a Local tournament, for its admin: adding and importing
 * athletes, putting them in a category, kumite and kata participation. Every
 * action checks the caller owns the tournament and that it is a Local one.
 */

type Result<T = object> = ({ success: true } & T) | { success: false; error: string };

async function settle<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, ...(await fn()) };
  } catch (err) {
    if (err instanceof LocalSetupError) return { success: false, error: err.message };
    throw err;
  }
}

async function adminOfLocal(tournamentId: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  await requireLocalTournament(tournamentId);
  return admin;
}

function refresh(tournamentId: string) {
  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  broadcastLiveEvent({ table: "divisions", op: "UPDATE", tournamentId });
}

const uuid = z.string().uuid();

export async function getLocalAthletes(tournamentId: string) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  await requireLocalTournament(tournamentId);
  return loadLocalAthletes(tournamentId);
}

const athleteSchema = z.object({
  name: z.string().trim().min(1, "The athlete needs a name").max(200),
  chestNumber: z.string().max(50).nullish(),
  club: z.string().max(200).nullish(),
  age: z.union([z.string().max(20), z.number()]).nullish(),
  belt: z.string().max(50).nullish(),
  sex: z.string().max(20).nullish(),
  divisionId: z.union([uuid, z.literal("auto")]).nullish(),
  kumite: z.boolean().optional(),
  kata: z.boolean().optional(),
});

export async function addLocalAthlete(tournamentId: string, raw: z.input<typeof athleteSchema>) {
  const admin = await adminOfLocal(tournamentId);
  const input = parseInput(athleteSchema, raw, "athlete");
  const result = await settle(async () => addLocalAthleteCore(tournamentId, input));
  if (result.success) {
    await audit({
      tournamentId,
      actor: admin,
      action: "ATHLETE_ADDED",
      targetType: "athlete",
      targetId: result.athlete.id,
      after: { name: result.athlete.name, chestNumber: result.chestNumber, divisionId: result.divisionId },
    });
    refresh(tournamentId);
    return { success: true as const, athleteId: result.athlete.id, divisionId: result.divisionId, chestNumber: result.chestNumber };
  }
  return result;
}

const cell = z.union([z.string().max(300), z.number(), z.boolean()]).nullish();
const importSchema = z
  .array(z.object({ name: cell, chestNumber: cell, club: cell, age: cell, belt: cell, sex: cell, kumite: cell, kata: cell }))
  .max(10000);

export async function importLocalRoster(tournamentId: string, rows: z.input<typeof importSchema>) {
  const admin = await adminOfLocal(tournamentId);
  const parsed = parseInput(importSchema, rows, "roster");
  const result = await settle(async () => ({ report: await importLocalRosterCore(tournamentId, parsed) }));
  if (result.success) {
    const r = result.report;
    await audit({
      tournamentId,
      actor: admin,
      action: "ATHLETES_IMPORTED",
      after: { source: "local roster", total: r.total, created: r.created, updated: r.updated, assigned: r.assigned, unassigned: r.unassigned.length },
    });
    refresh(tournamentId);
  }
  return result;
}

/** Puts an athlete in a category, or none. Before the event, so no reason is needed. */
export async function assignAthleteDivision(tournamentId: string, athleteId: string, divisionId: string | null) {
  const admin = await adminOfLocal(tournamentId);
  if (!uuid.safeParse(athleteId).success || (divisionId !== null && !uuid.safeParse(divisionId).success)) {
    return { success: false as const, error: "Unknown athlete or category." };
  }
  const result = await settle(async () => assignAthleteDivisionCore(tournamentId, athleteId, divisionId));
  if (result.success && result.before !== result.after) {
    await audit({
      tournamentId,
      actor: admin,
      action: "ATHLETE_DIVISION_SET",
      targetType: "athlete",
      targetId: athleteId,
      before: { divisionId: result.before },
      after: { divisionId: result.after, leftGroups: result.leftGroups },
    });
    refresh(tournamentId);
  }
  return result.success ? { success: true as const } : result;
}

export async function setAthleteParticipationAdmin(
  tournamentId: string,
  athleteId: string,
  eventType: (typeof DIVISION_EVENT_TYPES)[number],
  value: boolean
) {
  const admin = await adminOfLocal(tournamentId);
  if (!uuid.safeParse(athleteId).success || !DIVISION_EVENT_TYPES.includes(eventType) || typeof value !== "boolean") {
    return { success: false as const, error: "Unknown athlete or event." };
  }
  const result = await settle(async () => setParticipationCore(tournamentId, athleteId, eventType, value));
  if (result.success && result.before !== result.after) {
    await audit({
      tournamentId,
      actor: admin,
      action: "ATHLETE_PARTICIPATION_SET",
      targetType: "athlete",
      targetId: athleteId,
      before: { [eventType]: result.before },
      after: { [eventType]: result.after },
    });
    refresh(tournamentId);
  }
  return result.success ? { success: true as const } : result;
}

export async function deleteLocalAthlete(tournamentId: string, athleteId: string) {
  const admin = await adminOfLocal(tournamentId);
  if (!uuid.safeParse(athleteId).success) return { success: false as const, error: "Unknown athlete." };
  const result = await settle(async () => ({ athlete: await deleteLocalAthleteCore(tournamentId, athleteId) }));
  if (result.success) {
    await audit({
      tournamentId,
      actor: admin,
      action: "ATHLETE_DELETED",
      targetType: "athlete",
      targetId: athleteId,
      before: { name: result.athlete.name, chestNumber: result.athlete.chestNumber },
    });
    refresh(tournamentId);
  }
  return result.success ? { success: true as const } : result;
}
