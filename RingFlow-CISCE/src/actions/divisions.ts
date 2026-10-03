"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import {
  requireLocalTournament,
  requireTournamentAdmin,
  requireTournamentStaff,
} from "@/lib/auth/guards";
import { scopeForDivision, scopeForDivisionEvent } from "@/lib/auth/localScope";
import { parseInput } from "@/lib/validation";
import { DIVISION_SEXES, LOCAL_EVENT_ORDERS } from "@/lib/statuses";
import {
  createDivisionCore,
  deleteDivisionCore,
  generateDivisionsCore,
  LocalSetupError,
  updateDivisionCore,
  updateLocalSettingsCore,
} from "@/lib/local/divisions";
import {
  buildAllStartingGroupsCore,
  buildStartingGroupsCore,
  eventsOfDivision,
  setDivisionEventCore,
  startingGroupsPreflight,
} from "@/lib/local/startingGroups";
import { assignDivisionCore } from "@/lib/local/tatami";
import { loadLocalSetup } from "@/lib/local/setupView";

/**
 * Local tournament setup: the admin's categories (divisions), each event's plan,
 * starting groups and which tatami a category runs on. Every action checks the
 * caller owns the tournament and that it is a Local one, resolved from the row.
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

function refresh(tournamentId: string) {
  revalidatePath(`/admin/event/${tournamentId}/categories`);
  revalidatePath(`/admin/event/${tournamentId}/athletes`);
  revalidatePath(`/admin/event/${tournamentId}/rings/balance`);
  broadcastLiveEvent({ table: "divisions", op: "UPDATE", tournamentId });
}

async function adminOfLocal(tournamentId: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  await requireLocalTournament(tournamentId);
  return admin;
}

async function adminOfDivision(divisionId: string) {
  const scope = await scopeForDivision(divisionId);
  return { admin: await adminOfLocal(scope.tournamentId), tournamentId: scope.tournamentId };
}

const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

// ── Reading ────────────────────────────────────────────────────────────────

/** Everything the Local categories page shows. The admin and the event's organiser may read it. */
export async function getLocalSetup(tournamentId: string) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  await requireLocalTournament(tournamentId);
  return loadLocalSetup(tournamentId);
}

export async function getStartingGroupsPreflight(tournamentId: string) {
  await adminOfLocal(tournamentId);
  return startingGroupsPreflight(tournamentId);
}

// ── Settings ───────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  beltLevels: z.array(z.string().max(40)).max(40).optional(),
  localBronzeMedals: z.union([z.literal(1), z.literal(2)]).optional(),
  localKumiteGroupSize: z.number().int().min(1).max(32).optional(),
  localKataGroupSize: z.number().int().min(1).max(32).optional(),
  localBoutDurationMs: nullableInt(10_000, 600_000).optional(),
  localEventOrder: z.enum(LOCAL_EVENT_ORDERS).optional(),
});

export async function updateLocalSettings(tournamentId: string, raw: z.input<typeof settingsSchema>) {
  const admin = await adminOfLocal(tournamentId);
  const patch = parseInput(settingsSchema, raw, "Local settings");
  const result = await settle(async () => updateLocalSettingsCore(tournamentId, patch));
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "LOCAL_SETTINGS_UPDATED", targetType: "tournament", targetId: tournamentId, before: result.before, after: result.after });
    revalidatePath(`/admin/event/${tournamentId}/settings`);
    refresh(tournamentId);
  }
  return result.success ? { success: true as const } : result;
}

// ── Categories (divisions) ─────────────────────────────────────────────────

const divisionSchema = z.object({
  name: z.string().max(200).nullish(),
  sex: z.enum(DIVISION_SEXES),
  ageMin: nullableInt(0, 99),
  ageMax: nullableInt(0, 99),
  belts: z.array(z.string().max(40)).max(40),
  kumite: z.boolean().optional(),
  kata: z.boolean().optional(),
});

export async function createDivision(tournamentId: string, raw: z.input<typeof divisionSchema>) {
  const admin = await adminOfLocal(tournamentId);
  const input = parseInput(divisionSchema, raw, "category");
  const result = await settle(async () => ({ division: await createDivisionCore(tournamentId, input) }));
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "DIVISION_CREATED", targetType: "division", targetId: result.division.id, after: result.division });
    refresh(tournamentId);
    return { success: true as const, id: result.division.id, name: result.division.name };
  }
  return result;
}

const generateSchema = z.object({
  ages: z.array(z.object({ min: nullableInt(0, 99), max: nullableInt(0, 99) })).min(1).max(50),
  beltBands: z.array(z.array(z.string().max(40)).max(40)).min(1).max(40),
  sexes: z.array(z.enum(DIVISION_SEXES)).min(1).max(3),
});

export async function generateDivisions(tournamentId: string, raw: z.input<typeof generateSchema>) {
  const admin = await adminOfLocal(tournamentId);
  const spec = parseInput(generateSchema, raw, "category generator");
  const result = await settle(async () => generateDivisionsCore(tournamentId, spec));
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "DIVISIONS_GENERATED", after: { created: result.created, skipped: result.skipped.length } });
    refresh(tournamentId);
  }
  return result;
}

export async function updateDivision(divisionId: string, raw: Partial<z.input<typeof divisionSchema>>) {
  const { admin, tournamentId } = await adminOfDivision(divisionId);
  const patch = parseInput(divisionSchema.partial(), raw, "category");
  const result = await settle(async () => updateDivisionCore(divisionId, patch));
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "DIVISION_UPDATED", targetType: "division", targetId: divisionId, before: result.before, after: result.after });
    refresh(tournamentId);
  }
  return result.success ? { success: true as const } : result;
}

export async function deleteDivision(divisionId: string) {
  const { admin, tournamentId } = await adminOfDivision(divisionId);
  const result = await settle(async () => ({ division: await deleteDivisionCore(divisionId) }));
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "DIVISION_DELETED", targetType: "division", targetId: divisionId, before: result.division });
    refresh(tournamentId);
  }
  return result.success ? { success: true as const } : result;
}

// ── Event plans and starting groups ────────────────────────────────────────

const planSchema = z.object({
  enabled: z.boolean().optional(),
  groupSize: nullableInt(1, 32).optional(),
  bronzeMedals: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  boutDurationMs: nullableInt(10_000, 600_000).optional(),
});

export async function setDivisionEvent(divisionEventId: string, raw: z.input<typeof planSchema>) {
  const scope = await scopeForDivisionEvent(divisionEventId);
  const admin = await adminOfLocal(scope.tournamentId);
  const patch = parseInput(planSchema, raw, "plan");
  const result = await settle(async () => setDivisionEventCore(divisionEventId, patch));
  if (result.success) {
    await audit({ tournamentId: scope.tournamentId, actor: admin, action: "DIVISION_EVENT_UPDATED", targetType: "division_event", targetId: divisionEventId, before: result.before, after: result.after });
    refresh(scope.tournamentId);
  }
  return result.success ? { success: true as const } : result;
}

/** Builds (or rebuilds) one category's starting groups, for both its events. */
export async function buildDivisionStartingGroups(divisionId: string) {
  const { admin, tournamentId } = await adminOfDivision(divisionId);
  const result = await settle(async () => {
    const built: { eventType: string; sizes: number[] }[] = [];
    for (const event of await eventsOfDivision(db, divisionId)) {
      const { groups } = await buildStartingGroupsCore(event.id);
      built.push({ eventType: event.eventType, sizes: groups.map((g) => g.size) });
    }
    return { built };
  });
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "STARTING_GROUPS_BUILT", targetType: "division", targetId: divisionId, after: result.built });
    refresh(tournamentId);
  }
  return result;
}

/** Builds every category's starting groups that can still be built; the rest are reported. */
export async function buildAllStartingGroups(tournamentId: string) {
  const admin = await adminOfLocal(tournamentId);
  const result = await settle(async () => buildAllStartingGroupsCore(tournamentId));
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "STARTING_GROUPS_BUILT", after: { events: result.built, protected: result.protectedCount, errors: result.errors } });
    refresh(tournamentId);
  }
  return result;
}

// ── Tatamis ────────────────────────────────────────────────────────────────

/** Puts a whole category on a tatami (its groups join the end of the queue), or takes it off with null. */
export async function assignDivisionToRing(divisionId: string, ringId: string | null) {
  const { admin, tournamentId } = await adminOfDivision(divisionId);
  if (ringId !== null && !z.string().uuid().safeParse(ringId).success) return { success: false as const, error: "Unknown tatami." };
  const result = await settle(async () => {
    // A category without groups gets its starting groups first.
    const events = await eventsOfDivision(db, divisionId);
    const setup = await loadLocalSetup(tournamentId);
    const division = setup.divisions.find((d) => d.id === divisionId);
    for (const event of events) {
      const view = division?.events.find((e) => e.id === event.id);
      if (view && view.enabled && view.groups.length === 0 && view.participants > 0) await buildStartingGroupsCore(event.id);
    }
    return assignDivisionCore(divisionId, ringId);
  });
  if (result.success) {
    await audit({ tournamentId, actor: admin, action: "DIVISION_ASSIGNED", targetType: "division", targetId: divisionId, after: { ringId, moved: result.moved, stayed: result.stayed } });
    refresh(tournamentId);
    broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId });
    if (ringId) broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", ringId, tournamentId });
  }
  return result;
}
