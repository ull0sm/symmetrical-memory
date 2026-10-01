import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { athletes, categories, categoryAssignments, matches, rings } from "@/db/schema";
import { isValidUuid } from "@/lib/utils";
import { AuthError } from "./errors";

/**
 * Resolve which tournament (and tatami) a target row belongs to. Every guard
 * checks the caller against the target's real owner, never against an id the
 * caller passed alongside it.
 */

export const tournamentIdForRing = cache(async (ringId: string): Promise<string> => {
  if (!isValidUuid(ringId)) throw new AuthError("Tatami not found", "NOT_FOUND");
  const [row] = await db
    .select({ tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);
  if (!row) throw new AuthError("Tatami not found", "NOT_FOUND");
  return row.tournamentId;
});

export const tournamentIdForCategory = cache(async (categoryId: string): Promise<string> => {
  if (!isValidUuid(categoryId)) throw new AuthError("Category not found", "NOT_FOUND");
  const [row] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!row) throw new AuthError("Category not found", "NOT_FOUND");
  return row.tournamentId;
});

export const tournamentIdForAthlete = cache(async (athleteId: string): Promise<string> => {
  if (!isValidUuid(athleteId)) throw new AuthError("Athlete not found", "NOT_FOUND");
  const [row] = await db
    .select({ tournamentId: athletes.tournamentId })
    .from(athletes)
    .where(eq(athletes.id, athleteId))
    .limit(1);
  if (!row?.tournamentId) throw new AuthError("Athlete not found", "NOT_FOUND");
  return row.tournamentId;
});

export interface MatchScope {
  matchId: string;
  categoryId: string;
  tournamentId: string;
  /** Tatami the match's category is assigned to, if any. */
  ringId: string | null;
  /** Status of that category on its tatami ('pending' | 'running' | 'paused' | 'completed'). */
  assignmentStatus: string | null;
}

export const scopeForMatch = cache(async (matchId: string): Promise<MatchScope> => {
  if (!matchId || typeof matchId !== "string" || matchId.length > 200) {
    throw new AuthError("Bout not found", "NOT_FOUND");
  }
  const [row] = await db
    .select({
      categoryId: matches.categoryId,
      tournamentId: categories.tournamentId,
      ringId: categoryAssignments.ringId,
      assignmentStatus: categoryAssignments.status,
    })
    .from(matches)
    .innerJoin(categories, eq(categories.id, matches.categoryId))
    .leftJoin(categoryAssignments, eq(categoryAssignments.categoryId, matches.categoryId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) throw new AuthError("Bout not found", "NOT_FOUND");
  return {
    matchId,
    categoryId: row.categoryId,
    tournamentId: row.tournamentId,
    ringId: row.ringId ?? null,
    assignmentStatus: row.assignmentStatus ?? null,
  };
});
