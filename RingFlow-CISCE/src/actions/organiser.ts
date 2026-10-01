"use server";

import { db } from "@/db";
import { organiserRequests, tournaments } from "@/db/schema";
import { and, eq, isNotNull, ne, sql, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { normalizeAccessCode, isValidUuid } from "@/lib/utils";
import { uniqueOrganiserCode } from "@/lib/accessCodes";
import { serializeOrganiserRequest } from "@/lib/serializers";
import { isOfflineMode } from "@/lib/offline";
import { RATE_LIMITS, TOO_MANY_ATTEMPTS, allowAttempt, clientAddress } from "@/lib/rateLimit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { SESSION_COOKIES, LEGACY_COOKIES, clearCookies, setSessionCookie } from "@/lib/auth/cookies";
import { claimCookieName, holdsClaim, issueClaim } from "@/lib/auth/claims";
import { hashToken, newSessionToken } from "@/lib/auth/tokens";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import { getOrganiserPrincipal } from "@/lib/auth/principal";

const ORGANISER_SESSION_SECONDS = 48 * 60 * 60;

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : h.get("x-real-ip") || "Unknown";
}

function cleanDeviceInfo(deviceInfo: Record<string, unknown> | undefined, ip: string) {
  return {
    userAgent: typeof deviceInfo?.userAgent === "string" ? deviceInfo.userAgent.slice(0, 300) : undefined,
    deviceId: typeof deviceInfo?.deviceId === "string" ? deviceInfo.deviceId.slice(0, 100) : undefined,
    platform: typeof deviceInfo?.platform === "string" ? deviceInfo.platform.slice(0, 100) : undefined,
    ip,
  };
}

/** Organiser requests read-only access to a tournament with its 6-character code. */
export async function requestOrganiserAccess(
  accessCode: string,
  organiserName: string,
  deviceInfo?: Record<string, unknown>,
  turnstileToken?: string
) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const isTurnstileRequired = Boolean(secretKey && secretKey !== "disabled" && !isOfflineMode());
  if (isTurnstileRequired) {
    if (!turnstileToken) return { success: false, error: "Security check is required." };
    const { verifyTurnstileToken } = await import("./turnstile");
    const verification = await verifyTurnstileToken(turnstileToken);
    if (!verification.success) {
      return { success: false, error: verification.error || "Security check failed." };
    }
  }

  if (!(await allowAttempt([{ key: `access-code:organiser:${await clientAddress()}`, ...RATE_LIMITS.accessCodePerAddress }]))) {
    return { success: false, error: TOO_MANY_ATTEMPTS };
  }

  const cleanCode = (accessCode || "").trim().toUpperCase().slice(0, 20);
  if (cleanCode.length < 6) {
    return { success: false, error: "Please enter a valid 6-character access code." };
  }

  const cleanName = (organiserName || "").trim().slice(0, 100);
  if (!cleanName) return { success: false, error: "Please enter your name." };

  type TournamentMatch = { id: string; name: string; organiserCode: string | null };

  const exactMatches: TournamentMatch[] = await db
    .select({ id: tournaments.id, name: tournaments.name, organiserCode: tournaments.organiserCode })
    .from(tournaments)
    .where(sql`upper(${tournaments.organiserCode}) = ${cleanCode}`)
    .limit(1);

  let matchedTournament: TournamentMatch | undefined = exactMatches[0];

  if (!matchedTournament) {
    const normInput = normalizeAccessCode(cleanCode);
    const codedTournaments = await db
      .select({ id: tournaments.id, name: tournaments.name, organiserCode: tournaments.organiserCode })
      .from(tournaments)
      .where(and(isNotNull(tournaments.organiserCode), ne(tournaments.organiserCode, "")));
    matchedTournament = codedTournaments.find(
      (t) => t.organiserCode && normalizeAccessCode(t.organiserCode) === normInput
    );
  }

  if (!matchedTournament) {
    return { success: false, error: "Invalid organiser access code. Please check with the administrator." };
  }

  const claimHash = await issueClaim("organiser");

  try {
    const [request] = await db
      .insert(organiserRequests)
      .values({
        tournamentId: matchedTournament.id,
        accessCodeUsed: matchedTournament.organiserCode || cleanCode,
        status: "pending",
        organiserName: cleanName,
        deviceInfo: cleanDeviceInfo(deviceInfo, await clientIp()),
        claimHash,
        expiresAt: new Date(Date.now() + ORGANISER_SESSION_SECONDS * 1000),
      })
      .returning({ id: organiserRequests.id });

    broadcastLiveEvent({
      table: "organiser_requests",
      op: "INSERT",
      id: request.id,
      tournamentId: matchedTournament.id,
      status: "pending",
    });
    revalidatePath(`/admin/event/${matchedTournament.id}/settings`);

    return { success: true, requestId: request.id, tournamentName: matchedTournament.name };
  } catch (err) {
    console.error("[organiser] Failed to create access request:", err);
    return { success: false, error: "Could not create the access request. Contact the administrator." };
  }
}

/** Waiting-room poll; only the requesting browser receives the session cookie. */
export async function checkOrganiserStatus(requestId: string) {
  if (!isValidUuid(requestId)) return { status: "not_found" as const };

  const [request] = await db
    .select({
      status: organiserRequests.status,
      tournamentId: organiserRequests.tournamentId,
      expiresAt: organiserRequests.expiresAt,
      organiserName: organiserRequests.organiserName,
      claimHash: organiserRequests.claimHash,
    })
    .from(organiserRequests)
    .where(eq(organiserRequests.id, requestId));

  if (!request) return { status: "not_found" as const };
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) return { status: "expired" as const };

  const ownsRequest = await holdsClaim("organiser", request.claimHash);

  if (request.status === "approved" && ownsRequest) {
    // The session is minted here, for the browser that asked; only its hash is kept.
    const token = newSessionToken();
    await db
      .update(organiserRequests)
      .set({ sessionToken: null, sessionTokenHash: hashToken(token) })
      .where(eq(organiserRequests.id, requestId));
    const secondsLeft = Math.max(60, Math.floor((request.expiresAt.getTime() - Date.now()) / 1000));
    await setSessionCookie(SESSION_COOKIES.organiser, token, secondsLeft);
    await clearCookies(claimCookieName("organiser"), ...LEGACY_COOKIES);
    return {
      status: "approved" as const,
      tournamentId: request.tournamentId,
      organiserName: request.organiserName,
    };
  }

  if (request.status === "approved") return { status: "approved_elsewhere" as const };
  return { status: request.status as "pending" | "rejected" | "revoked" | "expired" };
}

async function loadRequestInTournament(requestId: string, tournamentId: string) {
  if (!isValidUuid(requestId)) throw new Error("Request not found");
  const [request] = await db
    .select({ id: organiserRequests.id, status: organiserRequests.status })
    .from(organiserRequests)
    .where(and(eq(organiserRequests.id, requestId), eq(organiserRequests.tournamentId, tournamentId)))
    .limit(1);
  if (!request) throw new Error("Request not found in this tournament");
  return request;
}

/** Admin approves an organiser. Several organisers may be approved at once. */
export async function approveOrganiserRequest(requestId: string, tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  const request = await loadRequestInTournament(requestId, tournamentId);
  if (request.status !== "pending") throw new Error(`Request is already ${request.status}`);

  await db
    .update(organiserRequests)
    .set({
      status: "approved",
      sessionToken: null,
        sessionTokenHash: null,
      expiresAt: new Date(Date.now() + ORGANISER_SESSION_SECONDS * 1000),
    })
    .where(eq(organiserRequests.id, requestId));

  broadcastLiveEvent({ table: "organiser_requests", op: "UPDATE", id: requestId, tournamentId, status: "approved" });
  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

export async function rejectOrganiserRequest(requestId: string, tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  await loadRequestInTournament(requestId, tournamentId);

  await db
    .update(organiserRequests)
    .set({ status: "rejected", sessionToken: null, sessionTokenHash: null })
    .where(eq(organiserRequests.id, requestId));

  broadcastLiveEvent({ table: "organiser_requests", op: "UPDATE", id: requestId, tournamentId, status: "rejected" });
  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

export async function revokeOrganiserSession(requestId: string, tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  await loadRequestInTournament(requestId, tournamentId);

  await db
    .update(organiserRequests)
    .set({ status: "revoked", sessionToken: null, sessionTokenHash: null })
    .where(eq(organiserRequests.id, requestId));

  broadcastLiveEvent({ table: "organiser_requests", op: "UPDATE", id: requestId, tournamentId, status: "revoked" });
  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true };
}

export async function getOrganiserRequests(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);

  const rows = await db
    .select()
    .from(organiserRequests)
    .where(eq(organiserRequests.tournamentId, tournamentId))
    .orderBy(desc(organiserRequests.createdAt))
    .limit(50);

  return rows.map(serializeOrganiserRequest);
}

export async function regenerateOrganiserCode(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);

  const newCode = await uniqueOrganiserCode();
  await db.update(tournaments).set({ organiserCode: newCode }).where(eq(tournaments.id, tournamentId));

  revalidatePath(`/admin/event/${tournamentId}/settings`);
  return { success: true, organiser_code: newCode };
}

/**
 * Session check for the organiser sidebar. Reads only the httpOnly cookie,
 * and reports "valid" on a transient database error so a flaky venue network
 * does not throw the organiser out.
 */
export async function validateOrganiserSessionAction() {
  try {
    const organiser = await getOrganiserPrincipal();
    if (!organiser) return { valid: false as const, reason: "revoked" as const };
    return {
      valid: true as const,
      requestId: organiser.requestId,
      organiserName: organiser.name,
      tournamentId: organiser.tournamentId,
    };
  } catch (error) {
    console.error("[organiser] session check failed:", error);
    return { valid: true as const, transient: true };
  }
}

/** Log out: end the session on the server as well as in this browser. */
export async function logoutOrganiser() {
  const organiser = await getOrganiserPrincipal();
  if (organiser) {
    await db
      .update(organiserRequests)
      .set({ status: "expired", sessionToken: null, sessionTokenHash: null })
      .where(eq(organiserRequests.id, organiser.requestId));
  }
  await clearCookies(SESSION_COOKIES.organiser, ...LEGACY_COOKIES);
  return { success: true };
}
