import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { isValidUuid } from "@/lib/utils";
import { AuthError } from "./errors";
import {
  getAdminPrincipal,
  getPrincipals,
  type AdminPrincipal,
  type ModeratorPrincipal,
  type Principal,
} from "./principal";
import { scopeForMatch, tournamentIdForRing, type MatchScope } from "./scope";

/**
 * Authorization guards. Every exported server action calls one of these
 * before it reads or writes anything. See docs/roles/README.md for the matrix.
 *
 * This is a plain module (no "use server"), so none of it is callable from a
 * browser on its own.
 */

export type StaffRole = Principal["role"];

const ownerOfTournament = cache(async (tournamentId: string): Promise<string | null> => {
  if (!isValidUuid(tournamentId)) return null;
  const [row] = await db
    .select({ adminId: tournaments.adminId })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  return row?.adminId ?? null;
});

export async function requireAdmin(): Promise<AdminPrincipal> {
  const admin = await getAdminPrincipal();
  if (!admin) throw new AuthError("Not authenticated", "UNAUTHENTICATED");
  return admin;
}

/** The admin who created this tournament. Other admins are refused (tenancy). */
export async function requireTournamentAdmin(tournamentId: string): Promise<AdminPrincipal> {
  const admin = await requireAdmin();
  const owner = await ownerOfTournament(tournamentId);
  if (!owner || owner !== admin.adminId) {
    throw new AuthError("Tournament not found or not yours", "FORBIDDEN");
  }
  return admin;
}

/** Same as requireTournamentAdmin, but returns null instead of throwing. */
export async function getTournamentAdmin(tournamentId: string): Promise<AdminPrincipal | null> {
  const admin = await getAdminPrincipal();
  if (!admin) return null;
  const owner = await ownerOfTournament(tournamentId);
  return owner && owner === admin.adminId ? admin : null;
}

/**
 * Any staff identity for this tournament, restricted to `allowed` roles.
 * Admins count only for tournaments they own; floor staff only for the
 * tournament their session was approved for. Returns the first match, admin first.
 */
export async function getTournamentStaff(
  tournamentId: string,
  allowed: StaffRole[] = ["admin", "organiser", "stager", "moderator"]
): Promise<Principal | null> {
  if (!isValidUuid(tournamentId)) return null;
  const principals = await getPrincipals();
  for (const p of principals) {
    if (!allowed.includes(p.role)) continue;
    if (p.role === "admin") {
      const owner = await ownerOfTournament(tournamentId);
      if (owner === p.adminId) return p;
      continue;
    }
    if (p.tournamentId === tournamentId) return p;
  }
  return null;
}

export async function requireTournamentStaff(
  tournamentId: string,
  allowed?: StaffRole[]
): Promise<Principal> {
  const p = await getTournamentStaff(tournamentId, allowed);
  if (!p) throw new AuthError("Not authorized for this tournament", "FORBIDDEN");
  return p;
}

/** True if the caller holds any staff identity at all (used only for UX decisions). */
export async function hasAnyStaffIdentity(): Promise<boolean> {
  return (await getPrincipals()).length > 0;
}

/** The approved moderator of exactly this tatami. */
export async function getRingModerator(ringId: string): Promise<ModeratorPrincipal | null> {
  if (!isValidUuid(ringId)) return null;
  const principals = await getPrincipals();
  const mod = principals.find((p) => p.role === "moderator" && p.ringId === ringId);
  return (mod as ModeratorPrincipal) ?? null;
}

export async function requireRingModerator(ringId: string): Promise<ModeratorPrincipal> {
  const mod = await getRingModerator(ringId);
  if (!mod) throw new AuthError("Unauthorized: you are not the active moderator of this tatami.", "FORBIDDEN");
  return mod;
}

/**
 * Floor control of a tatami (pause/resume, clock): its moderator, or the
 * tournament's admin as an override.
 */
export async function requireRingOperator(ringId: string): Promise<Principal> {
  const mod = await getRingModerator(ringId);
  if (mod) return mod;
  const tournamentId = await tournamentIdForRing(ringId);
  const admin = await getTournamentAdmin(tournamentId);
  if (admin) return admin;
  throw new AuthError("Not authorized to control this tatami", "FORBIDDEN");
}

/**
 * Scoring a bout: only the moderator of the tatami the bout's category is
 * assigned to, and only while that category is on the mat (running or paused).
 */
export async function requireMatchModerator(
  matchId: string
): Promise<{ moderator: ModeratorPrincipal; scope: MatchScope }> {
  const scope = await scopeForMatch(matchId);
  if (!scope.ringId) {
    throw new AuthError("This bout's category is not assigned to a tatami.", "FORBIDDEN");
  }
  const moderator = await requireRingModerator(scope.ringId);
  if (scope.assignmentStatus !== "running" && scope.assignmentStatus !== "paused") {
    throw new AuthError("Start this category on the tatami before scoring its bouts.", "FORBIDDEN");
  }
  return { moderator, scope };
}

/** Human-readable actor for logs and audit rows. */
export function describePrincipal(p: Principal): { role: StaffRole; id: string; name: string } {
  switch (p.role) {
    case "admin":
      return { role: "admin", id: p.adminId, name: p.name };
    default:
      return { role: p.role, id: p.requestId, name: p.name };
  }
}
