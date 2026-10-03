"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { athletes, stagerRequests } from "@/db/schema";
import { audit } from "@/lib/audit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import {
  describePrincipal,
  getDivisionHolder,
  requireDivisionHolder,
  requireLocalTournament,
  requireTournamentAdmin,
  requireTournamentStaff,
  type DivisionHolder,
} from "@/lib/auth/guards";
import type { Principal } from "@/lib/auth/principal";
import { scopeForDivision, scopeForGroup } from "@/lib/auth/localScope";
import { DIVISION_EVENT_TYPES } from "@/lib/statuses";
import { LocalSetupError } from "@/lib/local/divisions";
import {
  addGroupCore,
  autoFillCore,
  lockGroupCore,
  moveAthleteCore,
  moveIntoDivisionCore,
  placeAthleteCore,
  rebalanceCore,
  registerWalkInCore,
  removeGroupCore,
  restoreEventDraftCore,
  searchAthletesCore,
  setAttendanceCore,
  shuffleGroupCore,
  swapAthletesCore,
  unpinCore,
} from "@/lib/local/groupDraft";
import {
  handBackCore,
  reassignHoldCore,
  releaseHoldCore,
  stagerIdentity,
  takeDivisionCore,
  type HolderIdentity,
} from "@/lib/local/holds";
import { readRegistration, setParticipationCore } from "@/lib/local/localRoster";
import { changeLockedGroupCore, previewLateChangeCore, unlockGroupCore, type LateChange } from "@/lib/local/lateChanges";
import { placesInGraph } from "@/lib/local/lateChangePlan";
import { loadStagerDesk, loadWorkspace } from "@/lib/local/stagingView";

/**
 * The Local stager desk: taking a category, building its groups, and locking
 * them so they can start on their tatami. Every change is made by the person
 * holding the category (a stager, or the admin), checked by
 * `requireDivisionHolder` against the target row's real division. The admin can
 * release or hand on anyone's hold.
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

const uuid = z.string().uuid();
const eventType = z.enum(DIVISION_EVENT_TYPES);
const reason = z.string().trim().min(3, "Give a short reason").max(500);
const MIN_REASON = "Give a short reason (at least 3 characters).";

/** Who is acting, as the holder of a division. */
async function identityOf(principal: Principal): Promise<HolderIdentity | null> {
  if (principal.role === "admin") return { kind: "admin", adminId: principal.adminId, name: principal.name };
  if (principal.role === "stager") return stagerIdentity(principal.requestId);
  return null;
}

function changed(tournamentId: string, table: "division_holds" | "group_drafts" | "divisions") {
  broadcastLiveEvent({ table, op: "UPDATE", tournamentId });
  revalidatePath(`/admin/event/${tournamentId}/categories`);
}

/** The holder of the group's division; the group must be a Local group. */
async function holderOfGroup(groupId: string): Promise<DivisionHolder & { groupScope: Awaited<ReturnType<typeof scopeForGroup>> }> {
  const groupScope = await scopeForGroup(groupId);
  const holder = await requireDivisionHolder(groupScope.divisionId);
  return { ...holder, groupScope };
}

const byName = (holder: DivisionHolder) => `${holder.principal.role}:${describePrincipal(holder.principal).name}`;

// ── The desk ───────────────────────────────────────────────────────────────

/** Every category of the tournament, soonest first, for its stagers and its admin. */
export async function getStagerDesk(tournamentId: string) {
  const principal = await requireTournamentStaff(tournamentId, ["stager", "admin"]);
  await requireLocalTournament(tournamentId);
  return loadStagerDesk(tournamentId, await identityOf(principal));
}

export async function takeDivision(divisionId: string) {
  const scope = await scopeForDivision(divisionId);
  const principal = await requireTournamentStaff(scope.tournamentId, ["stager", "admin"]);
  await requireLocalTournament(scope.tournamentId);
  const who = await identityOf(principal);
  if (!who) return { success: false as const, error: "Only a stager or the admin can take a category." };
  const result = await settle(async () => takeDivisionCore(divisionId, who));
  if (result.success && !result.alreadyHeld) {
    await audit({ tournamentId: scope.tournamentId, actor: principal, action: "DIVISION_TAKEN", targetType: "division", targetId: divisionId, after: { holder: who.name } });
    changed(scope.tournamentId, "division_holds");
  }
  return result.success ? { success: true as const } : result;
}

export async function handBackDivision(divisionId: string) {
  const holder = await requireDivisionHolder(divisionId);
  const who = await identityOf(holder.principal);
  if (!who) return { success: false as const, error: "You aren't preparing this category." };
  const result = await settle(async () => {
    await handBackCore(divisionId, who);
    return {};
  });
  if (result.success) {
    await audit({ tournamentId: holder.scope.tournamentId, actor: holder.principal, action: "DIVISION_HANDED_BACK", targetType: "division", targetId: divisionId, before: { holder: who.name } });
    changed(holder.scope.tournamentId, "division_holds");
  }
  return result;
}

/**
 * A category's workspace: for its holder, or for the admin to look at. Another stager of the
 * tournament gets null: drafts are seen only by whoever holds them, and the admin.
 */
export async function getDivisionWorkspace(divisionId: string) {
  const holder = await getDivisionHolder(divisionId);
  if (!holder) {
    const scope = await scopeForDivision(divisionId);
    const principal = await requireTournamentStaff(scope.tournamentId, ["stager", "admin"]);
    await requireLocalTournament(scope.tournamentId);
    if (principal.role !== "admin") return null;
  }
  const workspace = await loadWorkspace(divisionId);
  return workspace ? { ...workspace, youHold: holder !== null } : null;
}

/** Athletes of the tournament by name, chest number or club, with their category, for the desk's search. */
export async function searchDeskAthletes(tournamentId: string, query: string) {
  await requireTournamentStaff(tournamentId, ["stager", "admin"]);
  await requireLocalTournament(tournamentId);
  if (typeof query !== "string") return [];
  return searchAthletesCore(tournamentId, query);
}

// ── Athletes at the desk ───────────────────────────────────────────────────

const attendanceSchema = z.enum(["present", "absent", "withdrawn"]).nullable();

export async function setAttendanceLocal(divisionId: string, athleteId: string, status: z.input<typeof attendanceSchema>) {
  const holder = await requireDivisionHolder(divisionId);
  if (!uuid.safeParse(athleteId).success || !attendanceSchema.safeParse(status).success) return { success: false as const, error: "Unknown athlete or status." };
  const result = await settle(async () => setAttendanceCore(divisionId, athleteId, status, byName(holder)));
  if (result.success && result.before !== result.after) {
    await audit({ tournamentId: holder.scope.tournamentId, actor: holder.principal, action: "ATTENDANCE_SET", targetType: "athlete", targetId: athleteId, before: { attendance: result.before }, after: { attendance: result.after, divisionId } });
    changed(holder.scope.tournamentId, "group_drafts");
  }
  return result.success ? { success: true as const } : result;
}

export async function setParticipationLocal(divisionId: string, athleteId: string, event: z.input<typeof eventType>, value: boolean) {
  const holder = await requireDivisionHolder(divisionId);
  if (!uuid.safeParse(athleteId).success || !eventType.safeParse(event).success || typeof value !== "boolean") {
    return { success: false as const, error: "Unknown athlete or event." };
  }
  const result = await settle(async () => {
    const { registration } = await readRegistration(db, holder.scope.tournamentId, athleteId);
    if (registration?.divisionId !== divisionId) throw new LocalSetupError("That athlete is not in this category.");
    return setParticipationCore(holder.scope.tournamentId, athleteId, event, value);
  });
  if (result.success && result.before !== result.after) {
    await audit({ tournamentId: holder.scope.tournamentId, actor: holder.principal, action: "ATHLETE_PARTICIPATION_SET", targetType: "athlete", targetId: athleteId, before: { [event]: result.before }, after: { [event]: result.after } });
    changed(holder.scope.tournamentId, "group_drafts");
  }
  return result.success ? { success: true as const } : result;
}

export async function searchAthletesForDivision(divisionId: string, query: string) {
  const holder = await requireDivisionHolder(divisionId);
  if (typeof query !== "string") return [];
  return searchAthletesCore(holder.scope.tournamentId, query);
}

export async function moveAthleteIntoDivision(divisionId: string, athleteId: string, why: string) {
  const holder = await requireDivisionHolder(divisionId);
  if (!uuid.safeParse(athleteId).success) return { success: false as const, error: "Unknown athlete." };
  const reasonText = reason.safeParse(why);
  if (!reasonText.success) return { success: false as const, error: MIN_REASON };
  const result = await settle(async () => moveIntoDivisionCore(divisionId, athleteId));
  if (result.success && result.before !== result.after) {
    await audit({
      tournamentId: holder.scope.tournamentId,
      actor: holder.principal,
      action: "ATHLETE_MOVED_DIVISION",
      targetType: "athlete",
      targetId: athleteId,
      before: { divisionId: result.before },
      after: { divisionId: result.after, leftGroups: result.leftGroups },
      reason: reasonText.data,
    });
    changed(holder.scope.tournamentId, "divisions");
  }
  return result.success ? { success: true as const } : result;
}

const walkInSchema = z.object({
  name: z.string().trim().min(1, "Enter the athlete's name").max(200),
  club: z.string().trim().min(1, "Enter the athlete's club").max(200),
  age: z.union([z.string().max(20), z.number()]).nullish(),
  belt: z.string().max(50).nullish(),
  sex: z.string().max(20).nullish(),
  kumite: z.boolean().optional(),
  kata: z.boolean().optional(),
});

/** Registers a walk-in into the held category. Offers same-named athletes first unless `confirmNew`. */
export async function registerWalkIn(divisionId: string, raw: z.input<typeof walkInSchema>, confirmNew = false) {
  const holder = await requireDivisionHolder(divisionId);
  const parsed = walkInSchema.safeParse(raw);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the walk-in's details." };
  const result = await settle(async () => registerWalkInCore(divisionId, parsed.data, confirmNew === true));
  if (result.success && result.athleteId) {
    await audit({ tournamentId: holder.scope.tournamentId, actor: holder.principal, action: "WALK_IN_REGISTERED", targetType: "athlete", targetId: result.athleteId, after: { name: result.name, chestNumber: result.chestNumber, divisionId } });
    changed(holder.scope.tournamentId, "divisions");
  }
  return result;
}

// ── Groups (drafts) ────────────────────────────────────────────────────────

const moveSchema = z.object({ athleteId: uuid, eventType, to: z.union([uuid, z.literal("new"), z.null()]) });

/** Moves an athlete into a group, into a new group, or out to Unplaced (`to: null`). */
export async function moveAthlete(divisionId: string, raw: z.input<typeof moveSchema>) {
  const holder = await requireDivisionHolder(divisionId);
  const input = moveSchema.safeParse(raw);
  if (!input.success) return { success: false as const, error: "Unknown athlete or group." };
  const result = await settle(async () => moveAthleteCore(divisionId, input.data, byName(holder)));
  if (result.success) changed(holder.scope.tournamentId, "group_drafts");
  return result;
}

const placeSchema = z.object({ athleteId: uuid, place: z.number().int().min(1).max(32), expectedVersion: z.number().int().optional() });

/** Pins an athlete to a place in their group's bracket or performance order. */
export async function placeAthlete(groupId: string, raw: z.input<typeof placeSchema>) {
  const holder = await holderOfGroup(groupId);
  const input = placeSchema.safeParse(raw);
  if (!input.success) return { success: false as const, error: "Unknown athlete or place." };
  const result = await settle(async () => placeAthleteCore(holder.groupScope.divisionId, { groupId, ...input.data }, byName(holder)));
  if (result.success) changed(holder.scope.tournamentId, "group_drafts");
  return result;
}

const swapSchema = z.object({ a: uuid, b: uuid, expectedVersion: z.number().int().optional() });

export async function swapAthletes(groupId: string, raw: z.input<typeof swapSchema>) {
  const holder = await holderOfGroup(groupId);
  const input = swapSchema.safeParse(raw);
  if (!input.success) return { success: false as const, error: "Choose two athletes of this group." };
  const result = await settle(async () => swapAthletesCore(holder.groupScope.divisionId, { groupId, ...input.data }, byName(holder)));
  if (result.success) changed(holder.scope.tournamentId, "group_drafts");
  return result;
}

/** Unpins one athlete, or the whole group when no athlete is given. */
export async function unpinAthletes(groupId: string, athleteId?: string) {
  const holder = await holderOfGroup(groupId);
  if (athleteId !== undefined && !uuid.safeParse(athleteId).success) return { success: false as const, error: "Unknown athlete." };
  const result = await settle(async () => unpinCore(holder.groupScope.divisionId, { groupId, athleteId }, byName(holder)));
  if (result.success) changed(holder.scope.tournamentId, "group_drafts");
  return result;
}

export async function shuffleGroup(groupId: string) {
  const holder = await holderOfGroup(groupId);
  const result = await settle(async () => shuffleGroupCore(holder.groupScope.divisionId, groupId, byName(holder)));
  if (result.success) changed(holder.scope.tournamentId, "group_drafts");
  return result;
}

export async function addGroup(divisionId: string, event: z.input<typeof eventType>) {
  const holder = await requireDivisionHolder(divisionId);
  if (!eventType.safeParse(event).success) return { success: false as const, error: "Unknown event." };
  const result = await settle(async () => ({ group: await addGroupCore(divisionId, event) }));
  if (result.success) {
    await audit({ tournamentId: holder.scope.tournamentId, categoryId: result.group.id, actor: holder.principal, action: "GROUP_ADDED", targetType: "category", targetId: result.group.id, after: { name: result.group.name } });
    changed(holder.scope.tournamentId, "group_drafts");
    broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId: holder.scope.tournamentId });
    return { success: true as const, groupId: result.group.id };
  }
  return result;
}

export async function removeGroup(groupId: string) {
  const holder = await holderOfGroup(groupId);
  const result = await settle(async () => removeGroupCore(holder.groupScope.divisionId, groupId));
  if (result.success) {
    await audit({ tournamentId: holder.scope.tournamentId, actor: holder.principal, action: "GROUP_REMOVED", targetType: "category", targetId: groupId, before: { name: result.removed, members: result.members } });
    changed(holder.scope.tournamentId, "group_drafts");
    broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId: holder.scope.tournamentId });
  }
  return result;
}

/** Puts every unplaced, present athlete of an event into the smallest groups. */
export async function autoFillEvent(divisionId: string, event: z.input<typeof eventType>) {
  const holder = await requireDivisionHolder(divisionId);
  if (!eventType.safeParse(event).success) return { success: false as const, error: "Unknown event." };
  const result = await settle(async () => autoFillCore(divisionId, event, byName(holder)));
  if (result.success) changed(holder.scope.tournamentId, "group_drafts");
  return result;
}

/** Evens out an event's unlocked groups; pinned athletes stay. */
export async function rebalanceEvent(divisionId: string, event: z.input<typeof eventType>) {
  const holder = await requireDivisionHolder(divisionId);
  if (!eventType.safeParse(event).success) return { success: false as const, error: "Unknown event." };
  const result = await settle(async () => rebalanceCore(divisionId, event, byName(holder)));
  if (result.success) changed(holder.scope.tournamentId, "group_drafts");
  return result;
}

/**
 * Locks a group and sends it to its tatami. `expectedChecksum` is the draw the stager was shown;
 * a group that changed since is refused.
 */
export async function lockGroup(groupId: string, expectedChecksum?: string) {
  const holder = await holderOfGroup(groupId);
  if (expectedChecksum !== undefined && !/^[0-9a-f]{64}$/.test(expectedChecksum)) return { success: false as const, error: "Check the group again before locking." };
  const lockedBy = describePrincipal(holder.principal).name;
  const result = await settle(async () => lockGroupCore(holder.groupScope.divisionId, groupId, lockedBy, expectedChecksum));
  if (result.success) {
    await audit({
      tournamentId: holder.scope.tournamentId,
      categoryId: groupId,
      actor: holder.principal,
      action: "GROUP_LOCKED",
      targetType: "category",
      targetId: groupId,
      after: { name: result.group.name, ...result.snapshot, holdReleased: result.released },
    });
    changed(holder.scope.tournamentId, "group_drafts");
    broadcastLiveEvent({ table: "draws", op: "UPDATE", id: groupId, categoryId: groupId, tournamentId: holder.scope.tournamentId });
    broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId: holder.scope.tournamentId });
    return { success: true as const, released: result.released, checksum: result.snapshot.checksum };
  }
  return result;
}

const snapshotSchema = z.object({
  groups: z
    .array(
      z.object({
        id: uuid,
        members: z.array(uuid).max(64),
        pins: z.record(uuid, z.number().int().min(1).max(32)),
        seed: z.number().int().min(0).max(2 ** 32),
      })
    )
    .max(64),
});
const versionsSchema = z.record(uuid, z.number().int());

/**
 * Undo: puts an event's draft groups back to a snapshot the stager's screen took before a change.
 * `expectedVersions` are the draft groups' versions as the screen shows them now.
 */
export async function restoreEventDraft(
  divisionId: string,
  event: z.input<typeof eventType>,
  snapshot: z.input<typeof snapshotSchema>,
  expectedVersions: z.input<typeof versionsSchema>
) {
  const holder = await requireDivisionHolder(divisionId);
  const parsedEvent = eventType.safeParse(event);
  const parsedSnapshot = snapshotSchema.safeParse(snapshot);
  const parsedVersions = versionsSchema.safeParse(expectedVersions);
  if (!parsedEvent.success || !parsedSnapshot.success || !parsedVersions.success) return { success: false as const, error: "That can't be undone." };
  const result = await settle(async () => restoreEventDraftCore(divisionId, parsedEvent.data, parsedSnapshot.data, parsedVersions.data, byName(holder)));
  if (result.success) {
    for (const g of result.removedGroups) {
      await audit({ tournamentId: holder.scope.tournamentId, actor: holder.principal, action: "GROUP_REMOVED", targetType: "category", targetId: g.id, before: { name: g.name, members: 0 }, reason: "Undo" });
    }
    changed(holder.scope.tournamentId, "group_drafts");
    if (result.removedGroups.length > 0) broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId: holder.scope.tournamentId });
  }
  return result.success ? { success: true as const, skipped: result.skipped, removedGroups: result.removedGroups.length } : result;
}

// ── The admin's hand on holds ──────────────────────────────────────────────

export async function releaseHold(divisionId: string, why: string) {
  const scope = await scopeForDivision(divisionId);
  const admin = await requireTournamentAdmin(scope.tournamentId);
  await requireLocalTournament(scope.tournamentId);
  const reasonText = reason.safeParse(why);
  if (!reasonText.success) return { success: false as const, error: MIN_REASON };
  const result = await settle(async () => ({ before: await releaseHoldCore(divisionId) }));
  if (result.success) {
    await audit({ tournamentId: scope.tournamentId, actor: admin, action: "DIVISION_HOLD_RELEASED", targetType: "division", targetId: divisionId, before: { holder: result.before.holderName, label: result.before.holderLabel }, reason: reasonText.data });
    changed(scope.tournamentId, "division_holds");
  }
  return result.success ? { success: true as const } : result;
}

/** Hands a held (or free) category to an approved stager of the tournament. */
export async function reassignHold(divisionId: string, stagerRequestId: string, why: string) {
  const scope = await scopeForDivision(divisionId);
  const admin = await requireTournamentAdmin(scope.tournamentId);
  await requireLocalTournament(scope.tournamentId);
  const reasonText = reason.safeParse(why);
  if (!reasonText.success) return { success: false as const, error: MIN_REASON };
  if (!uuid.safeParse(stagerRequestId).success) return { success: false as const, error: "Unknown stager." };
  const [target] = await db
    .select({ id: stagerRequests.id })
    .from(stagerRequests)
    .where(and(eq(stagerRequests.id, stagerRequestId), eq(stagerRequests.tournamentId, scope.tournamentId), eq(stagerRequests.status, "approved")));
  const to = target ? await stagerIdentity(target.id) : null;
  if (!to) return { success: false as const, error: "That stager isn't signed in to this tournament." };
  const result = await settle(async () => ({ before: await reassignHoldCore(divisionId, to) }));
  if (result.success) {
    await audit({
      tournamentId: scope.tournamentId,
      actor: admin,
      action: "DIVISION_HOLD_REASSIGNED",
      targetType: "division",
      targetId: divisionId,
      before: { holder: result.before?.holderName ?? null },
      after: { holder: to.name, label: to.kind === "stager" ? to.label : null },
      reason: reasonText.data,
    });
    changed(scope.tournamentId, "division_holds");
  }
  return result.success ? { success: true as const } : result;
}

/** Approved stagers of a tournament, for the admin to hand a category to: names and code labels only. */
export async function listStagersForHolds(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  await requireLocalTournament(tournamentId);
  const rows = await db
    .select({ id: stagerRequests.id, name: stagerRequests.stagerName })
    .from(stagerRequests)
    .where(and(eq(stagerRequests.tournamentId, tournamentId), eq(stagerRequests.status, "approved")));
  const out: { requestId: string; name: string; label: string | null }[] = [];
  for (const r of rows) {
    const identity = await stagerIdentity(r.id);
    out.push({ requestId: r.id, name: r.name || "Stager", label: identity?.kind === "stager" ? identity.label : null });
  }
  return out;
}

// ── The admin's changes after lock ─────────────────────────────────────────

const lateReason = z.string().trim().min(5).max(500);
const LATE_REASON = "Give a reason (at least 5 characters).";

/** The admin of a Local group's tournament, resolved from the group row. */
async function adminOfGroup(groupId: string) {
  const scope = await scopeForGroup(groupId);
  const admin = await requireTournamentAdmin(scope.tournamentId);
  await requireLocalTournament(scope.tournamentId);
  return { admin, scope };
}

function groupChanged(tournamentId: string, groups: { id: string; ringId: string | null }[]) {
  for (const g of groups) {
    broadcastLiveEvent({ table: "draws", op: "UPDATE", id: g.id, categoryId: g.id, tournamentId, ringId: g.ringId ?? undefined });
    broadcastLiveEvent({ table: "matches", op: "UPDATE", categoryId: g.id, tournamentId, ringId: g.ringId ?? undefined });
  }
  broadcastLiveEvent({ table: "category_assignments", op: "UPDATE", tournamentId });
  changed(tournamentId, "group_drafts");
  revalidatePath(`/admin/event/${tournamentId}/staging`);
}

/**
 * Sends a locked group back to Draft. Only before its first bout, and not while it is on the mat.
 * Its bouts are deleted and its draw hidden; whoever takes the category next finds the same layout.
 */
export async function unlockGroup(groupId: string, why: string) {
  const { admin, scope } = await adminOfGroup(groupId);
  const reasonText = lateReason.safeParse(why);
  if (!reasonText.success) return { success: false as const, error: LATE_REASON };
  const result = await settle(async () => unlockGroupCore(groupId));
  if (result.success) {
    await audit({
      tournamentId: scope.tournamentId,
      categoryId: groupId,
      ringId: result.group.ringId,
      actor: admin,
      action: "GROUP_UNLOCKED",
      targetType: "category",
      targetId: groupId,
      before: { name: result.group.name, ...result.before },
      after: { state: "DRAFT" },
      reason: reasonText.data,
    });
    groupChanged(scope.tournamentId, [{ id: groupId, ringId: result.group.ringId }]);
    return { success: true as const };
  }
  return result;
}

const lateChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), athleteId: uuid, place: z.number().int().min(1).max(32).optional() }),
  z.object({ kind: z.literal("remove"), athleteId: uuid }),
  z.object({ kind: z.literal("move"), athleteId: uuid, toGroupId: uuid, place: z.number().int().min(1).max(32).optional() }),
]);

/**
 * What a change to a locked group would do, for the admin to check before confirming: the new
 * draw of each group it touches, who meets whom differently, and whether the athlete joins as a
 * guest. `fingerprint` goes back with the confirm.
 */
export async function previewLateChange(groupId: string, raw: z.input<typeof lateChangeSchema>) {
  const { scope } = await adminOfGroup(groupId);
  const change = lateChangeSchema.safeParse(raw);
  if (!change.success) return { success: false as const, error: "Choose an athlete and what to do." };
  const result = await settle(async () => previewLateChangeCore(groupId, change.data as LateChange));
  if (!result.success) return result;

  const ids = [...new Set(result.groups.flatMap((g) => g.graph.slots.map((s) => s.registrationId).filter((id): id is string => Boolean(id))))];
  const people = ids.length
    ? await db
        .select({ id: athletes.id, name: athletes.name, club: athletes.school, dojo: athletes.dojo, chestNumber: athletes.chestNumber })
        .from(athletes)
        .where(and(inArray(athletes.id, ids), eq(athletes.tournamentId, scope.tournamentId)))
    : [];
  return {
    success: true as const,
    fingerprint: result.fingerprint,
    newcomer: result.newcomer,
    groups: result.groups.map((g) => ({
      id: g.id,
      name: g.name,
      mode: g.mode,
      lines: g.lines,
      places: placesInGraph(g.graph, g.graph.format === "KATA_RANKED" ? "kata" : "kumite"),
    })),
    people: people.map((p) => ({ id: p.id, name: p.name, club: p.club ?? p.dojo, chestNumber: p.chestNumber })),
  };
}

/**
 * Changes a locked group, with a reason: adds an athlete (from this category, or as a guest from
 * another), takes one out, or moves one to another locked group of the same event. Before the
 * first bout the draw is rebuilt with everyone else in place; once under way only a kumite bye can
 * be filled or a kata performer appended. Refused when the draws differ from `fingerprint`, the
 * preview the admin confirmed.
 */
export async function changeLockedGroup(groupId: string, raw: z.input<typeof lateChangeSchema>, why: string, fingerprint?: string) {
  const { admin, scope } = await adminOfGroup(groupId);
  const change = lateChangeSchema.safeParse(raw);
  if (!change.success) return { success: false as const, error: "Choose an athlete and what to do." };
  const reasonText = lateReason.safeParse(why);
  if (!reasonText.success) return { success: false as const, error: LATE_REASON };
  if (fingerprint !== undefined && (typeof fingerprint !== "string" || !/^[0-9a-f]{64}(:[0-9a-f]{64})?$/.test(fingerprint))) {
    return { success: false as const, error: "Check the change again before confirming." };
  }
  const by = describePrincipal(admin).name;
  const result = await settle(async () => changeLockedGroupCore(groupId, change.data as LateChange, by, reasonText.data, fingerprint));
  if (!result.success) return result;

  const kind = change.data.kind;
  for (const g of result.groups) {
    const what =
      kind === "move" ? (g.removed ? "move-out" : "move-in") : kind === "remove" ? "remove" : g.mode === "fill-bye" ? "fill-bye" : g.mode === "append" ? "append" : "add";
    const athlete = g.added ?? g.removed;
    await audit({
      tournamentId: scope.tournamentId,
      categoryId: g.id,
      ringId: g.ringId,
      actor: admin,
      action: "GROUP_CHANGED_AFTER_LOCK",
      targetType: "category",
      targetId: g.id,
      before: { name: g.name, stage: g.stage, members: g.membersBefore, drawVersion: g.drawVersionBefore, checksum: g.checksumBefore },
      after: {
        change: what,
        athleteId: athlete?.athleteId ?? null,
        athleteName: athlete?.name ?? null,
        guest: g.added?.guest ?? false,
        markedPresent: g.added?.wasAway ?? null,
        drawVersion: g.drawVersionAfter,
        checksum: g.checksumAfter,
        effects: g.lines,
      },
      reason: reasonText.data,
    });
  }
  groupChanged(scope.tournamentId, result.groups.map((g) => ({ id: g.id, ringId: g.ringId })));
  return { success: true as const, groups: result.groups.map((g) => ({ id: g.id, name: g.name, mode: g.mode })) };
}
