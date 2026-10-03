import { cache } from "react";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { categories, divisionEvents, divisionHolds, divisions, stagerRequests, tournaments } from "@/db/schema";
import { isValidUuid, normalizeAccessCode } from "@/lib/utils";
import type { TournamentType } from "@/lib/statuses";
import { AuthError } from "./errors";
import { hashToken } from "./tokens";

/**
 * Lookups the Local-tournament guards need: which tournament (and type) a
 * division, division event or group belongs to, who holds a division, and the
 * stager code behind a stager session. Resolved from the target row, never
 * from ids the caller sends alongside it.
 */

export interface DivisionScope {
  divisionId: string;
  tournamentId: string;
  tournamentType: TournamentType;
}

export interface DivisionEventScope extends DivisionScope {
  divisionEventId: string;
}

export interface GroupScope extends DivisionEventScope {
  categoryId: string;
}

const asType = (value: string): TournamentType => (value === "LOCAL" ? "LOCAL" : "OFFICIAL");

export const tournamentTypeOf = cache(async (tournamentId: string): Promise<TournamentType> => {
  if (!isValidUuid(tournamentId)) throw new AuthError("Tournament not found", "NOT_FOUND");
  const [row] = await db
    .select({ type: tournaments.tournamentType })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!row) throw new AuthError("Tournament not found", "NOT_FOUND");
  return asType(row.type);
});

export const scopeForDivision = cache(async (divisionId: string): Promise<DivisionScope> => {
  if (!isValidUuid(divisionId)) throw new AuthError("Category not found", "NOT_FOUND");
  const [row] = await db
    .select({ tournamentId: divisions.tournamentId, type: tournaments.tournamentType })
    .from(divisions)
    .innerJoin(tournaments, eq(tournaments.id, divisions.tournamentId))
    .where(eq(divisions.id, divisionId))
    .limit(1);
  if (!row) throw new AuthError("Category not found", "NOT_FOUND");
  return { divisionId, tournamentId: row.tournamentId, tournamentType: asType(row.type) };
});

export const scopeForDivisionEvent = cache(async (divisionEventId: string): Promise<DivisionEventScope> => {
  if (!isValidUuid(divisionEventId)) throw new AuthError("Event not found", "NOT_FOUND");
  const [row] = await db
    .select({ divisionId: divisions.id, tournamentId: divisions.tournamentId, type: tournaments.tournamentType })
    .from(divisionEvents)
    .innerJoin(divisions, eq(divisions.id, divisionEvents.divisionId))
    .innerJoin(tournaments, eq(tournaments.id, divisions.tournamentId))
    .where(eq(divisionEvents.id, divisionEventId))
    .limit(1);
  if (!row) throw new AuthError("Event not found", "NOT_FOUND");
  return { divisionEventId, divisionId: row.divisionId, tournamentId: row.tournamentId, tournamentType: asType(row.type) };
});

/** A Local group: a category that belongs to a division event. Anything else is "not found" here. */
export const scopeForGroup = cache(async (categoryId: string): Promise<GroupScope> => {
  if (!isValidUuid(categoryId)) throw new AuthError("Group not found", "NOT_FOUND");
  const [row] = await db
    .select({
      divisionEventId: divisionEvents.id,
      divisionId: divisions.id,
      tournamentId: divisions.tournamentId,
      type: tournaments.tournamentType,
    })
    .from(categories)
    .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
    .innerJoin(divisions, eq(divisions.id, divisionEvents.divisionId))
    .innerJoin(tournaments, eq(tournaments.id, divisions.tournamentId))
    .where(and(eq(categories.id, categoryId), isNotNull(categories.divisionEventId)))
    .limit(1);
  if (!row) throw new AuthError("Group not found", "NOT_FOUND");
  return {
    categoryId,
    divisionEventId: row.divisionEventId,
    divisionId: row.divisionId,
    tournamentId: row.tournamentId,
    tournamentType: asType(row.type),
  };
});

export interface DivisionHoldRef {
  holderKind: "stager" | "admin";
  stagerCodeHash: string | null;
  adminId: string | null;
}

/** Who holds a division right now, or null. Not cached: a hold changes within a request (take, hand back). */
export async function holdOfDivision(divisionId: string): Promise<DivisionHoldRef | null> {
  if (!isValidUuid(divisionId)) return null;
  const [row] = await db
    .select({
      holderKind: divisionHolds.holderKind,
      stagerCodeHash: divisionHolds.stagerCodeHash,
      adminId: divisionHolds.adminId,
    })
    .from(divisionHolds)
    .where(eq(divisionHolds.divisionId, divisionId))
    .limit(1);
  if (!row) return null;
  return {
    holderKind: row.holderKind === "admin" ? "admin" : "stager",
    stagerCodeHash: row.stagerCodeHash,
    adminId: row.adminId,
  };
}

/** The stored form of a stager code: a hash of its normalized text, so a hold never keeps the code itself. */
export function hashStagerCode(code: string): string {
  return hashToken(`stager-code:${normalizeAccessCode(code)}`);
}

/** The hashed stager code behind an approved stager session, so a hold follows the code across re-logins. */
export const stagerCodeHashFor = cache(async (requestId: string): Promise<string | null> => {
  if (!isValidUuid(requestId)) return null;
  const [row] = await db
    .select({ code: stagerRequests.accessCodeUsed })
    .from(stagerRequests)
    .where(eq(stagerRequests.id, requestId))
    .limit(1);
  return row?.code ? hashStagerCode(row.code) : null;
});
