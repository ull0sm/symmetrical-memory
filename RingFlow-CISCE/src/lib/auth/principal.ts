import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  admins,
  adminSessions,
  judgeSessions,
  moderatorRequests,
  organiserRequests,
  rings,
  stagerRequests,
} from "@/db/schema";
import { hashToken, looksLikeToken } from "./tokens";
import { SESSION_COOKIES } from "./cookies";

/**
 * Who is calling. A browser may hold more than one identity at once (an admin
 * testing the moderator pad), so guards look for the one they need.
 *
 * Every identity is re-verified against the database on each request: a
 * revoked or expired session stops working on the very next click.
 */
export type AdminPrincipal = { role: "admin"; adminId: string; name: string; sessionId: string };
export type OrganiserPrincipal = {
  role: "organiser";
  requestId: string;
  name: string;
  tournamentId: string;
};
export type StagerPrincipal = {
  role: "stager";
  requestId: string;
  name: string;
  tournamentId: string;
};
export type ModeratorPrincipal = {
  role: "moderator";
  requestId: string;
  name: string;
  ringId: string;
  tournamentId: string;
};

export type Principal = AdminPrincipal | OrganiserPrincipal | StagerPrincipal | ModeratorPrincipal;

/**
 * A judge's phone. Deliberately not part of `Principal`: judges are not event
 * staff and must never pass a staff check. Bound to one tatami seat.
 */
export type JudgePrincipal = {
  role: "judge";
  sessionId: string;
  name: string;
  ringId: string;
  seat: number;
  tournamentId: string;
};

const notExpired = (col: AnyPgColumn) => or(isNull(col), gt(col, new Date()));

async function resolveAdmin(token: string | undefined): Promise<AdminPrincipal | null> {
  if (!looksLikeToken(token)) return null;
  const [row] = await db
    .select({ id: admins.id, name: admins.name, email: admins.email, sessionId: adminSessions.id })
    .from(adminSessions)
    .innerJoin(admins, eq(admins.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return { role: "admin", adminId: row.id, name: row.name || row.email, sessionId: row.sessionId };
}

async function resolveOrganiser(token: string | undefined): Promise<OrganiserPrincipal | null> {
  if (!looksLikeToken(token)) return null;
  const [row] = await db
    .select({
      id: organiserRequests.id,
      name: organiserRequests.organiserName,
      tournamentId: organiserRequests.tournamentId,
    })
    .from(organiserRequests)
    .where(
      and(
        eq(organiserRequests.sessionTokenHash, hashToken(token)),
        eq(organiserRequests.status, "approved"),
        notExpired(organiserRequests.expiresAt)
      )
    )
    .limit(1);
  if (!row) return null;
  return { role: "organiser", requestId: row.id, name: row.name || "Organiser", tournamentId: row.tournamentId };
}

async function resolveStager(token: string | undefined): Promise<StagerPrincipal | null> {
  if (!looksLikeToken(token)) return null;
  const [row] = await db
    .select({
      id: stagerRequests.id,
      name: stagerRequests.stagerName,
      tournamentId: stagerRequests.tournamentId,
    })
    .from(stagerRequests)
    .where(
      and(
        eq(stagerRequests.sessionTokenHash, hashToken(token)),
        eq(stagerRequests.status, "approved"),
        notExpired(stagerRequests.expiresAt)
      )
    )
    .limit(1);
  if (!row) return null;
  return { role: "stager", requestId: row.id, name: row.name || "Stager", tournamentId: row.tournamentId };
}

async function resolveModerator(token: string | undefined): Promise<ModeratorPrincipal | null> {
  if (!looksLikeToken(token)) return null;
  const [row] = await db
    .select({
      id: moderatorRequests.id,
      name: moderatorRequests.moderatorName,
      ringId: moderatorRequests.ringId,
      tournamentId: rings.tournamentId,
    })
    .from(moderatorRequests)
    .innerJoin(rings, eq(rings.id, moderatorRequests.ringId))
    .where(
      and(
        eq(moderatorRequests.sessionTokenHash, hashToken(token)),
        eq(moderatorRequests.status, "approved"),
        notExpired(moderatorRequests.expiresAt)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    role: "moderator",
    requestId: row.id,
    name: row.name || "Moderator",
    ringId: row.ringId,
    tournamentId: row.tournamentId,
  };
}

/** All identities the current request carries, verified. Memoised per request. */
export const getPrincipals = cache(async (): Promise<Principal[]> => {
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return [];
  }

  const [admin, organiser, stager, moderator] = await Promise.all([
    resolveAdmin(store.get(SESSION_COOKIES.admin)?.value),
    resolveOrganiser(store.get(SESSION_COOKIES.organiser)?.value),
    resolveStager(store.get(SESSION_COOKIES.stager)?.value),
    resolveModerator(store.get(SESSION_COOKIES.moderator)?.value),
  ]);

  return [admin, organiser, stager, moderator].filter((p): p is Principal => p !== null);
});

/** The approved, unexpired judge session this browser holds, if any. Memoised per request. */
export const getJudgePrincipal = cache(async (): Promise<JudgePrincipal | null> => {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIES.judge)?.value;
  } catch {
    return null;
  }
  if (!looksLikeToken(token)) return null;
  const [row] = await db
    .select({
      id: judgeSessions.id,
      name: judgeSessions.judgeName,
      ringId: judgeSessions.ringId,
      seat: judgeSessions.seat,
      tournamentId: rings.tournamentId,
    })
    .from(judgeSessions)
    .innerJoin(rings, eq(rings.id, judgeSessions.ringId))
    .where(
      and(
        eq(judgeSessions.tokenHash, hashToken(token)),
        eq(judgeSessions.status, "approved"),
        gt(judgeSessions.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    role: "judge",
    sessionId: row.id,
    name: row.name,
    ringId: row.ringId,
    seat: row.seat,
    tournamentId: row.tournamentId,
  };
});

export async function getAdminPrincipal(): Promise<AdminPrincipal | null> {
  return ((await getPrincipals()).find((p) => p.role === "admin") as AdminPrincipal) ?? null;
}

export async function getOrganiserPrincipal(): Promise<OrganiserPrincipal | null> {
  return ((await getPrincipals()).find((p) => p.role === "organiser") as OrganiserPrincipal) ?? null;
}

export async function getStagerPrincipal(): Promise<StagerPrincipal | null> {
  return ((await getPrincipals()).find((p) => p.role === "stager") as StagerPrincipal) ?? null;
}

export async function getModeratorPrincipal(): Promise<ModeratorPrincipal | null> {
  return ((await getPrincipals()).find((p) => p.role === "moderator") as ModeratorPrincipal) ?? null;
}
