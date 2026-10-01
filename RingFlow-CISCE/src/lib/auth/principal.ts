import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  admins,
  moderatorRequests,
  organiserRequests,
  rings,
  stagerRequests,
} from "@/db/schema";
import { isValidUuid } from "@/lib/utils";
import { SESSION_COOKIES } from "./cookies";

/**
 * Who is calling. A browser may hold more than one identity at once (an admin
 * testing the moderator pad), so guards look for the one they need.
 *
 * Every identity is re-verified against the database on each request: a
 * revoked or expired session stops working on the very next click.
 */
export type AdminPrincipal = { role: "admin"; adminId: string; name: string };
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

const notExpired = (col: AnyPgColumn) => or(isNull(col), gt(col, new Date()));

async function resolveAdmin(token: string | undefined): Promise<AdminPrincipal | null> {
  if (!token || !isValidUuid(token)) return null;
  const [row] = await db
    .select({ id: admins.id, name: admins.name, email: admins.email })
    .from(admins)
    .where(eq(admins.id, token))
    .limit(1);
  if (!row) return null;
  return { role: "admin", adminId: row.id, name: row.name || row.email };
}

async function resolveOrganiser(token: string | undefined): Promise<OrganiserPrincipal | null> {
  if (!token || !isValidUuid(token)) return null;
  const [row] = await db
    .select({
      id: organiserRequests.id,
      name: organiserRequests.organiserName,
      tournamentId: organiserRequests.tournamentId,
    })
    .from(organiserRequests)
    .where(
      and(
        eq(organiserRequests.sessionToken, token),
        eq(organiserRequests.status, "approved"),
        notExpired(organiserRequests.expiresAt)
      )
    )
    .limit(1);
  if (!row) return null;
  return { role: "organiser", requestId: row.id, name: row.name || "Organiser", tournamentId: row.tournamentId };
}

async function resolveStager(token: string | undefined): Promise<StagerPrincipal | null> {
  if (!token || !isValidUuid(token)) return null;
  const [row] = await db
    .select({
      id: stagerRequests.id,
      name: stagerRequests.stagerName,
      tournamentId: stagerRequests.tournamentId,
    })
    .from(stagerRequests)
    .where(
      and(
        eq(stagerRequests.sessionToken, token),
        eq(stagerRequests.status, "approved"),
        notExpired(stagerRequests.expiresAt)
      )
    )
    .limit(1);
  if (!row) return null;
  return { role: "stager", requestId: row.id, name: row.name || "Stager", tournamentId: row.tournamentId };
}

async function resolveModerator(token: string | undefined): Promise<ModeratorPrincipal | null> {
  if (!token || !isValidUuid(token)) return null;
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
        eq(moderatorRequests.sessionToken, token),
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
