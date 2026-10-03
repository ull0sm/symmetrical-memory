/**
 * Who is preparing a division right now. One holder per division and one
 * division per holder; a stager's hold belongs to their stager code (stored as a
 * hash), so signing in again on the same code continues it. The admin can hold a
 * division too, and can release or hand on anyone's hold.
 * No authorization here: the staging actions guard it.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, divisionEvents, divisionHolds, divisions, draws, stagerRequests, tournaments } from "@/db/schema";
import type { DbExecutor } from "@/lib/draws/generateDraws";
import { hashStagerCode } from "@/lib/auth/localScope";
import { normalizeAccessCode } from "@/lib/utils";
import { LocalSetupError } from "./divisions";
import { buildStartingGroupsCore, eventParticipants } from "./startingGroups";

export type HolderIdentity =
  | { kind: "stager"; codeHash: string; name: string; label: string | null }
  | { kind: "admin"; adminId: string; name: string };

/** The holder identity of an approved stager session: their name, their code (hashed) and its label. */
export async function stagerIdentity(requestId: string): Promise<HolderIdentity | null> {
  const [row] = await db
    .select({ code: stagerRequests.accessCodeUsed, name: stagerRequests.stagerName, codes: tournaments.stagerCodes })
    .from(stagerRequests)
    .innerJoin(tournaments, eq(tournaments.id, stagerRequests.tournamentId))
    .where(eq(stagerRequests.id, requestId));
  if (!row?.code) return null;
  const list = Array.isArray(row.codes) ? (row.codes as { code: string; label: string }[]) : [];
  const label = list.find((c) => normalizeAccessCode(c.code) === normalizeAccessCode(row.code))?.label ?? null;
  return { kind: "stager", codeHash: hashStagerCode(row.code), name: row.name || "Stager", label };
}

export async function readHold(executor: DbExecutor, divisionId: string) {
  const [hold] = await executor.select().from(divisionHolds).where(eq(divisionHolds.divisionId, divisionId));
  return hold ?? null;
}

const holderWhere = (who: HolderIdentity) =>
  who.kind === "stager" ? eq(divisionHolds.stagerCodeHash, who.codeHash) : eq(divisionHolds.adminId, who.adminId);

const sameHolder = (hold: { holderKind: string; stagerCodeHash: string | null; adminId: string | null }, who: HolderIdentity) =>
  who.kind === "stager" ? hold.stagerCodeHash === who.codeHash : hold.holderKind === "admin" && hold.adminId === who.adminId;

/** The division this identity holds, if any. */
export async function holdOf(who: HolderIdentity) {
  const [hold] = await db
    .select({ divisionId: divisionHolds.divisionId, name: divisions.name })
    .from(divisionHolds)
    .innerJoin(divisions, eq(divisions.id, divisionHolds.divisionId))
    .where(holderWhere(who));
  return hold ?? null;
}

/** Whether every group of the division's events is locked (and it has at least one). */
async function everythingSent(executor: DbExecutor, divisionId: string): Promise<boolean> {
  const groups = await executor
    .select({ state: draws.state })
    .from(categories)
    .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(and(eq(divisionEvents.divisionId, divisionId), eq(divisionEvents.enabled, true)));
  return groups.length > 0 && groups.every((g) => g.state === "LOCKED");
}

/**
 * Takes a division. Builds its starting groups first if an event with athletes has
 * none. Refused while someone else holds it, while this holder holds another, and
 * once everything in it has been sent.
 */
export async function takeDivisionCore(divisionId: string, who: HolderIdentity) {
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));
  if (!division) throw new LocalSetupError("Category not found.");

  const current = await readHold(db, divisionId);
  if (current) {
    if (sameHolder(current, who)) return { division, alreadyHeld: true };
    throw new LocalSetupError(`${current.holderName} is preparing this category.`);
  }
  const other = await holdOf(who);
  if (other) throw new LocalSetupError(`You're already preparing "${other.name}". Hand it back first.`);
  if (await everythingSent(db, divisionId)) throw new LocalSetupError("Every group in this category has been sent to its tatami.");

  // An event with athletes but no groups gets its starting groups before anyone holds it.
  const events = await db.select().from(divisionEvents).where(eq(divisionEvents.divisionId, divisionId));
  for (const event of events) {
    if (!event.enabled) continue;
    const groups = await db.select({ id: categories.id }).from(categories).where(eq(categories.divisionEventId, event.id));
    if (groups.length === 0 && (await eventParticipants(db, event.id)).length > 0) await buildStartingGroupsCore(event.id);
  }

  try {
    await db.insert(divisionHolds).values({
      divisionId,
      tournamentId: division.tournamentId,
      holderKind: who.kind,
      stagerCodeHash: who.kind === "stager" ? who.codeHash : null,
      adminId: who.kind === "admin" ? who.adminId : null,
      holderName: who.name,
      holderLabel: who.kind === "stager" ? who.label : "Admin",
    });
  } catch (err) {
    // Two people pressed Take together, or this holder took another division in the same instant.
    const raced = await readHold(db, divisionId);
    if (raced && !sameHolder(raced, who)) throw new LocalSetupError(`${raced.holderName} took this a moment ago.`);
    const mine = await holdOf(who);
    if (mine && mine.divisionId !== divisionId) throw new LocalSetupError(`You're already preparing "${mine.name}". Hand it back first.`);
    throw err;
  }
  return { division, alreadyHeld: false };
}

/** Hands back a division the identity holds. */
export async function handBackCore(divisionId: string, who: HolderIdentity) {
  const deleted = await db
    .delete(divisionHolds)
    .where(and(eq(divisionHolds.divisionId, divisionId), holderWhere(who)))
    .returning({ divisionId: divisionHolds.divisionId });
  if (deleted.length === 0) throw new LocalSetupError("You aren't preparing this category.");
}

/** Ends anyone's hold on a division (the admin's release). Returns who held it. */
export async function releaseHoldCore(divisionId: string) {
  const [gone] = await db.delete(divisionHolds).where(eq(divisionHolds.divisionId, divisionId)).returning();
  if (!gone) throw new LocalSetupError("Nobody is preparing this category.");
  return gone;
}

/** Gives a division's hold to someone else (the admin's reassign). Returns who held it before. */
export async function reassignHoldCore(divisionId: string, to: HolderIdentity) {
  const [division] = await db.select({ tournamentId: divisions.tournamentId }).from(divisions).where(eq(divisions.id, divisionId));
  if (!division) throw new LocalSetupError("Category not found.");
  const other = await holdOf(to);
  if (other && other.divisionId !== divisionId) throw new LocalSetupError(`${to.name} is already preparing "${other.name}".`);
  return db.transaction(async (tx) => {
    const before = await readHold(tx, divisionId);
    await tx.delete(divisionHolds).where(eq(divisionHolds.divisionId, divisionId));
    await tx.insert(divisionHolds).values({
      divisionId,
      tournamentId: division.tournamentId,
      holderKind: to.kind,
      stagerCodeHash: to.kind === "stager" ? to.codeHash : null,
      adminId: to.kind === "admin" ? to.adminId : null,
      holderName: to.name,
      holderLabel: to.kind === "stager" ? to.label : "Admin",
    });
    return before;
  });
}

/** Marks the hold as active now (every draft change), so the admin can see a stalled hold. */
export async function touchHold(executor: DbExecutor, divisionId: string) {
  await executor.update(divisionHolds).set({ lastActiveAt: new Date() }).where(eq(divisionHolds.divisionId, divisionId));
}

/** Releases the hold once every group of the division is locked. Returns whether it did. */
export async function releaseIfAllSent(executor: DbExecutor, divisionId: string): Promise<boolean> {
  if (!(await everythingSent(executor, divisionId))) return false;
  const gone = await executor.delete(divisionHolds).where(eq(divisionHolds.divisionId, divisionId)).returning();
  return gone.length > 0;
}

/** Ends the holds of a stager code that is being removed. */
export async function releaseHoldsOfCode(code: string) {
  await db.delete(divisionHolds).where(eq(divisionHolds.stagerCodeHash, hashStagerCode(code)));
}
