"use server";

import { createClient } from "@/utils/supabase/server";
import { db } from "@/db";
import { organiserRequests, tournaments } from "@/db/schema";
import { and, eq, isNotNull, ne, or, sql, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { ensureAdminOwnsTournament } from "./admin";
import { normalizeAccessCode, generateUnambiguousCode, isValidUuid } from "@/lib/utils";
import { secureCookieFlag } from "@/lib/serverCookies";
import { serializeOrganiserRequest } from "@/lib/serializers";
import { isOfflineMode } from "@/lib/offline";

async function setOrganiserCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set("org_token", token, {
    path: "/",
    maxAge: 604800,
    sameSite: "lax",
    secure: await secureCookieFlag(),
  });
}

/**
 * Organiser requests access to a tournament using a 6-character access code.
 */
export async function requestOrganiserAccess(
  accessCode: string,
  organiserName: string,
  deviceInfo?: any,
  turnstileToken?: string
) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const isTurnstileRequired = Boolean(
    secretKey && secretKey !== "disabled" && !isOfflineMode()
  );
  if (isTurnstileRequired) {
    if (!turnstileToken) {
      return { success: false, error: "Security check is required." };
    }

    const { verifyTurnstileToken } = await import("./turnstile");
    const verification = await verifyTurnstileToken(turnstileToken);

    if (!verification.success) {
      return { success: false, error: verification.error || "Security check failed." };
    }
  }

  const cleanCode = (accessCode || "").trim().toUpperCase();
  if (cleanCode.length < 6) {
    return { success: false, error: "Please enter a valid 6-character access code." };
  }

  const cleanName = (organiserName || "").trim().slice(0, 100);
  if (!cleanName) {
    return { success: false, error: "Please enter your name." };
  }

  // Try to resolve IP
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  let ip = "Unknown";
  if (forwardedFor) {
    ip = forwardedFor.split(",")[0].trim();
  } else {
    ip = headersList.get("x-real-ip") || "Unknown";
  }

  const finalDeviceInfo = {
    ...deviceInfo,
    ip: deviceInfo?.ip && deviceInfo.ip !== "Unknown" ? deviceInfo.ip : ip,
  };

  // 1. Locate the tournament by organiser_code. Exact match first, then a
  //    normalized pass (0/O, 1/I) over the tournaments that actually have a code.
  type TournamentMatch = {
    id: string;
    name: string;
    organiserCode: string | null;
  };

  const exactMatches: TournamentMatch[] = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      organiserCode: tournaments.organiserCode,
    })
    .from(tournaments)
    .where(sql`upper(${tournaments.organiserCode}) = ${cleanCode}`)
    .limit(1);

  let matchedTournament: TournamentMatch | undefined = exactMatches[0];

  if (!matchedTournament) {
    const normInput = normalizeAccessCode(cleanCode);
    const codedTournaments = await db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        organiserCode: tournaments.organiserCode,
      })
      .from(tournaments)
      .where(
        and(
          isNotNull(tournaments.organiserCode),
          ne(tournaments.organiserCode, "")
        )
      );

    matchedTournament = codedTournaments.find(
      (t) => t.organiserCode && normalizeAccessCode(t.organiserCode) === normInput
    );
  }

  if (!matchedTournament) {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tournaments)
      .where(and(isNotNull(tournaments.organiserCode), ne(tournaments.organiserCode, "")));

    console.warn(
      `[organiser] Access code rejected. ${count} tournament(s) currently have an organiser code configured.`
    );

    return {
      success: false,
      error:
        count === 0
          ? "No tournament has an organiser code yet. Ask the administrator to generate one in Event Settings."
          : "Invalid organiser access code. Please check with the administrator.",
    };
  }

  const canonicalCode = matchedTournament.organiserCode || cleanCode;

  // 2. Create the pending request through the database connection, so this path
  //    does not depend on the REST gateway exposing the table or its policies.
  try {
    const [request] = await db
      .insert(organiserRequests)
      .values({
        tournamentId: matchedTournament.id,
        accessCodeUsed: canonicalCode,
        status: "pending",
        organiserName: cleanName,
        deviceInfo: finalDeviceInfo,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
      })
      .returning({ id: organiserRequests.id });

    revalidatePath(`/admin/event/${matchedTournament.id}/settings`);

    return {
      success: true,
      requestId: request.id,
      tournamentName: matchedTournament.name,
    };
  } catch (err: any) {
    console.error("[organiser] Failed to create access request:", err);
    return {
      success: false,
      error: `Could not create the access request (${err?.message ?? "database error"}). Contact the administrator.`,
    };
  }
}

/**
 * Check request status from client waiting room polling or initial load.
 */
export async function checkOrganiserStatus(requestId: string) {
  const [request] = await db
    .select({
      status: organiserRequests.status,
      sessionToken: organiserRequests.sessionToken,
      tournamentId: organiserRequests.tournamentId,
      expiresAt: organiserRequests.expiresAt,
      organiserName: organiserRequests.organiserName,
    })
    .from(organiserRequests)
    .where(eq(organiserRequests.id, requestId));

  if (!request) return { status: "not_found" };

  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    return { status: "expired" };
  }

  if (request.status === "approved") {
    await setOrganiserCookie(request.sessionToken || requestId);
  }

  return {
    status: request.status,
    sessionToken: request.sessionToken,
    tournamentId: request.tournamentId,
    organiserName: request.organiserName,
  };
}

/**
 * Admin approves an incoming organiser request. Multiple organisers can be approved concurrently.
 */
export async function approveOrganiserRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const sessionToken = crypto.randomUUID();

  await db
    .update(organiserRequests)
    .set({ status: "approved", sessionToken })
    .where(
      and(
        eq(organiserRequests.id, requestId),
        eq(organiserRequests.tournamentId, tournamentId)
      )
    );

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

/**
 * Admin rejects a pending organiser request.
 */
export async function rejectOrganiserRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db
    .update(organiserRequests)
    .set({ status: "rejected" })
    .where(
      and(
        eq(organiserRequests.id, requestId),
        eq(organiserRequests.tournamentId, tournamentId)
      )
    );

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

/**
 * Admin revokes an approved organiser's active session.
 */
export async function revokeOrganiserSession(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db
    .update(organiserRequests)
    .set({ status: "revoked", sessionToken: null })
    .where(
      and(
        eq(organiserRequests.id, requestId),
        eq(organiserRequests.tournamentId, tournamentId)
      )
    );

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

export async function getOrganiserRequests(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const rows = await db
    .select()
    .from(organiserRequests)
    .where(eq(organiserRequests.tournamentId, tournamentId))
    .orderBy(desc(organiserRequests.createdAt))
    .limit(50);

  return rows.map(serializeOrganiserRequest);
}

export async function regenerateOrganiserCode(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const newCode = generateUnambiguousCode(6);

  try {
    await db
      .update(tournaments)
      .set({ organiserCode: newCode })
      .where(eq(tournaments.id, tournamentId));
  } catch (err: any) {
    console.error("[organiser] Could not save the organiser code:", err);
    return {
      success: false,
      error: `Could not save the organiser code: ${err?.message ?? "database error"}`,
    };
  }

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true, organiser_code: newCode };
}

async function findApprovedOrganiserRequest(token: string) {
  const [request] = await db
    .select({
      id: organiserRequests.id,
      tournamentId: organiserRequests.tournamentId,
      status: organiserRequests.status,
      organiserName: organiserRequests.organiserName,
      sessionToken: organiserRequests.sessionToken,
      expiresAt: organiserRequests.expiresAt,
    })
    .from(organiserRequests)
    .where(
      or(
        eq(organiserRequests.sessionToken, token),
        eq(organiserRequests.id, token)
      )
    );

  if (!request || request.status !== "approved") return null;
  return request;
}

/**
 * Ensures the caller is an authorized organiser for the SPECIFIC tournament.
 * Accepts either:
 * 1) A logged-in Admin who owns the tournament
 * 2) An Organiser with an approved session_token in their org_token cookie.
 */
export async function ensureOrganiserHasAccessToTournament(tournamentId: string) {
  const supabase = await createClient();

  // 1. Check if authenticated admin
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: admin } = await supabase
      .from("admins")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (admin) {
      const { data: tournament } = await supabase
        .from("tournaments")
        .select("id, name")
        .eq("id", tournamentId)
        .eq("admin_id", admin.id)
        .maybeSingle();

      if (tournament) {
        return { role: "admin", id: admin.id, tournament };
      }
    }
  }

  // 2. Check org_token cookie
  const cookieStore = await cookies();
  const orgToken = cookieStore.get("org_token")?.value;

  if (!orgToken) {
    throw new Error("Not authenticated: Missing organiser session");
  }

  const request = await findApprovedOrganiserRequest(orgToken);

  if (!request) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    throw new Error("Not authenticated: Invalid or revoked organiser session");
  }

  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    throw new Error("Not authenticated: Organiser session expired");
  }

  if (request.tournamentId !== tournamentId) {
    throw new Error("Not authenticated: Not authorized for this tournament");
  }

  // If the cookie held the request id, move it to the session token.
  if (request.sessionToken && orgToken !== request.sessionToken) {
    try {
      await setOrganiserCookie(request.sessionToken);
    } catch {}
  }

  const [tournament] = await db
    .select({ id: tournaments.id, name: tournaments.name })
    .from(tournaments)
    .where(eq(tournaments.id, request.tournamentId));

  return {
    role: "organiser",
    id: request.id,
    name: request.organiserName,
    tournamentId: request.tournamentId,
    tournament,
  };
}

/**
 * Ensures the caller has general organiser access.
 */
export async function ensureOrganiser() {
  const supabase = await createClient();

  // Check admin
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: admin } = await supabase
      .from("admins")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (admin) {
      return { id: admin.id, name: "Administrator", role: "admin" };
    }
  }

  // Check org_token
  const cookieStore = await cookies();
  const orgToken = cookieStore.get("org_token")?.value;

  if (!orgToken) {
    throw new Error("Not authenticated");
  }

  const request = await findApprovedOrganiserRequest(orgToken);

  if (!request || (request.expiresAt && request.expiresAt.getTime() < Date.now())) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    throw new Error("Not authenticated");
  }

  if (request.sessionToken && orgToken !== request.sessionToken) {
    try {
      await setOrganiserCookie(request.sessionToken);
    } catch {}
  }

  return {
    id: request.id,
    name: request.organiserName,
    role: "organiser",
    tournamentId: request.tournamentId,
  };
}

/**
 * Validates the current organiser session without risk of aggressive client-side deletion.
 * Returns valid: true on transient database errors to protect user sessions during offline/reconnects.
 */
export async function validateOrganiserSessionAction(token?: string) {
  let cookieStore: any = null;
  try {
    cookieStore = await cookies();
  } catch {
    // Called outside Next.js request context
  }
  const orgToken = token || cookieStore?.get("org_token")?.value;
  if (!orgToken) return { valid: false, reason: "missing" };
  if (!isValidUuid(orgToken)) return { valid: false, reason: "not_found" };

  let request;
  try {
    const [row] = await db
      .select({
        id: organiserRequests.id,
        status: organiserRequests.status,
        organiserName: organiserRequests.organiserName,
        tournamentId: organiserRequests.tournamentId,
        expiresAt: organiserRequests.expiresAt,
      })
      .from(organiserRequests)
      .where(
        or(
          eq(organiserRequests.sessionToken, orgToken),
          eq(organiserRequests.id, orgToken)
        )
      );
    request = row;
  } catch (error: any) {
    // Network or temporary DB error: do NOT revoke session
    return { valid: true, error: error?.message };
  }

  if (!request) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    return { valid: false, reason: "not_found" };
  }

  if (request.status === "revoked" || request.status === "rejected") {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    return { valid: false, reason: "revoked", requestId: request.id };
  }

  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    try {
      cookieStore.delete("org_token");
      cookieStore.delete("org_name");
    } catch {}
    return { valid: false, reason: "expired", requestId: request.id };
  }

  return {
    valid: true,
    requestId: request.id,
    status: request.status,
    organiserName: request.organiserName,
    tournamentId: request.tournamentId,
  };
}

/**
 * Log out the current organiser session.
 */
export async function logoutOrganiser() {
  const cookieStore = await cookies();
  cookieStore.delete("org_token");
  cookieStore.delete("org_name");
  return { success: true };
}
