"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import { tournaments, stagerRequests, categoryAssignments, rings } from "@/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { normalizeAccessCode, generateUnambiguousCode, isValidUuid } from "@/lib/utils";
import { serializeStagerRequest } from "@/lib/serializers";
import { isOfflineMode } from "@/lib/offline";
import { RATE_LIMITS, TOO_MANY_ATTEMPTS, clientAddress, isBlocked, recordFailure } from "@/lib/rateLimit";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { SESSION_COOKIES, LEGACY_COOKIES, clearCookies, setSessionCookie } from "@/lib/auth/cookies";
import { claimCookieName, holdsClaim, issueClaim } from "@/lib/auth/claims";
import { hashToken, newSessionToken } from "@/lib/auth/tokens";
import { requireOfficialTournament, requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import { releaseHoldsOfCode } from "@/lib/local/holds";
import { getStagerPrincipal } from "@/lib/auth/principal";
import { SESSION_TTL_SECONDS } from "@/lib/constants";

export type StagerCode = {
  code: string;
  label: string;
};

const STAGER_SESSION_SECONDS = SESSION_TTL_SECONDS.stager;

// ─── Public: request access ─────────────────────────────────────────────────

/** A stager asks for access with one of the tournament's stager codes. */
export async function requestStagerAccess(
  accessCode: string,
  stagerName: string,
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

  const codeLimits = [
    { key: `access-code:stager:${await clientAddress()}`, ...RATE_LIMITS.accessCodePerAddress },
    { key: `access-code:stager:all`, ...RATE_LIMITS.accessCodeGlobal },
  ];
  if (isBlocked(codeLimits)) {
    return { success: false, error: TOO_MANY_ATTEMPTS };
  }

  const cleanCode = (accessCode || "").trim().toUpperCase().slice(0, 20);
  if (cleanCode.length < 6) {
    return { success: false, error: "Please enter a valid 6-character access code." };
  }

  const cleanName = (stagerName || "").trim().slice(0, 100);
  if (!cleanName) return { success: false, error: "Please enter your name." };

  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : h.get("x-real-ip") || "Unknown";
  const finalDeviceInfo = {
    userAgent: typeof deviceInfo?.userAgent === "string" ? deviceInfo.userAgent.slice(0, 300) : undefined,
    deviceId: typeof deviceInfo?.deviceId === "string" ? deviceInfo.deviceId.slice(0, 100) : undefined,
    ip,
  };

  const activeTournaments = await db
    .select({ id: tournaments.id, name: tournaments.name, stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(inArray(tournaments.status, ["draft", "active"]));

  const normInput = normalizeAccessCode(cleanCode);
  let matchedTournament: { id: string; name: string } | null = null;
  let canonicalCode = cleanCode;

  for (const t of activeTournaments) {
    const codes: StagerCode[] = Array.isArray(t.stagerCodes) ? (t.stagerCodes as StagerCode[]) : [];
    const matched = codes.find((c) => normalizeAccessCode(c.code) === normInput);
    if (matched) {
      matchedTournament = { id: t.id, name: t.name };
      canonicalCode = matched.code.toUpperCase();
      break;
    }
  }

  if (!matchedTournament) {
    recordFailure(codeLimits);
    return { success: false, error: "Invalid stager access code. Please check with the tournament director." };
  }

  const claimHash = await issueClaim("stager");

  // A code already in use is not an error: approving this request will end
  // the previous holder's session (shift change on the same code).
  const [newRequest] = await db
    .insert(stagerRequests)
    .values({
      tournamentId: matchedTournament.id,
      accessCodeUsed: canonicalCode,
      status: "pending",
      stagerName: cleanName,
      deviceInfo: finalDeviceInfo,
      claimHash,
      expiresAt: new Date(Date.now() + STAGER_SESSION_SECONDS * 1000),
    })
    .returning({ id: stagerRequests.id });

  if (!newRequest) {
    return { success: false, error: "Failed to submit access request. Please try again." };
  }

  broadcastLiveEvent({
    table: "stager_requests",
    op: "INSERT",
    id: newRequest.id,
    tournamentId: matchedTournament.id,
    status: "pending",
  });
  revalidatePath(`/admin/event/${matchedTournament.id}/rings`);

  return { success: true, requestId: newRequest.id, tournamentName: matchedTournament.name };
}

/** Waiting-room poll; only the requesting browser receives the session cookie. */
export async function checkStagerStatus(requestId: string) {
  if (!isValidUuid(requestId)) return { status: "not_found" as const };

  const [request] = await db
    .select({
      status: stagerRequests.status,
      tournamentId: stagerRequests.tournamentId,
      expiresAt: stagerRequests.expiresAt,
      stagerName: stagerRequests.stagerName,
      claimHash: stagerRequests.claimHash,
    })
    .from(stagerRequests)
    .where(eq(stagerRequests.id, requestId))
    .limit(1);

  if (!request) return { status: "not_found" as const };
  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) return { status: "expired" as const };

  const ownsRequest = await holdsClaim("stager", request.claimHash);

  if (request.status === "approved" && ownsRequest) {
    // The session is minted here, for the browser that asked; only its hash is kept.
    const token = newSessionToken();
    await db
      .update(stagerRequests)
      .set({ sessionToken: null, sessionTokenHash: hashToken(token) })
      .where(eq(stagerRequests.id, requestId));
    const secondsLeft = Math.max(60, Math.floor((request.expiresAt.getTime() - Date.now()) / 1000));
    await setSessionCookie(SESSION_COOKIES.stager, token, secondsLeft);
    await clearCookies(claimCookieName("stager"), ...LEGACY_COOKIES);
    return { status: "approved" as const, tournamentId: request.tournamentId, stagerName: request.stagerName };
  }

  if (request.status === "approved") return { status: "approved_elsewhere" as const };
  return { status: request.status as "pending" | "rejected" | "revoked" | "expired" };
}

// ─── Admin: approve / reject / revoke ──────────────────────────────────────

async function loadRequestInTournament(requestId: string, tournamentId: string) {
  if (!isValidUuid(requestId)) throw new Error("Request not found");
  const [request] = await db
    .select({ id: stagerRequests.id, status: stagerRequests.status, accessCodeUsed: stagerRequests.accessCodeUsed })
    .from(stagerRequests)
    .where(and(eq(stagerRequests.id, requestId), eq(stagerRequests.tournamentId, tournamentId)))
    .limit(1);
  if (!request) throw new Error("Request not found in this tournament");
  return request;
}

export async function approveStagerRequest(requestId: string, tournamentId: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  const target = await loadRequestInTournament(requestId, tournamentId);
  if (target.status !== "pending") throw new Error(`Request is already ${target.status}`);

  await db.transaction(async (tx) => {
    // One live session per code: approving ends the previous holder's session.
    const activeSessions = await tx
      .select({ id: stagerRequests.id, accessCodeUsed: stagerRequests.accessCodeUsed })
      .from(stagerRequests)
      .where(and(eq(stagerRequests.tournamentId, tournamentId), eq(stagerRequests.status, "approved")));

    const targetNorm = normalizeAccessCode(target.accessCodeUsed);
    const toRevokeIds = activeSessions
      .filter((s) => normalizeAccessCode(s.accessCodeUsed) === targetNorm && s.id !== requestId)
      .map((s) => s.id);

    if (toRevokeIds.length > 0) {
      await tx
        .update(stagerRequests)
        .set({ status: "revoked", sessionToken: null, sessionTokenHash: null })
        .where(inArray(stagerRequests.id, toRevokeIds));
    }

    await tx
      .update(stagerRequests)
      .set({
        status: "approved",
        sessionToken: null,
        sessionTokenHash: null,
        expiresAt: new Date(Date.now() + STAGER_SESSION_SECONDS * 1000),
      })
      .where(eq(stagerRequests.id, requestId));
  });

  broadcastLiveEvent({ table: "stager_requests", op: "UPDATE", id: requestId, tournamentId, status: "approved" });
  await audit({ tournamentId, actor: admin, action: "STAGER_APPROVED", targetType: "stager_request", targetId: requestId });
  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

export async function rejectStagerRequest(requestId: string, tournamentId: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  await loadRequestInTournament(requestId, tournamentId);

  await db
    .update(stagerRequests)
    .set({ status: "rejected", sessionToken: null, sessionTokenHash: null })
    .where(eq(stagerRequests.id, requestId));

  broadcastLiveEvent({ table: "stager_requests", op: "UPDATE", id: requestId, tournamentId, status: "rejected" });
  await audit({ tournamentId, actor: admin, action: "STAGER_REJECTED", targetType: "stager_request", targetId: requestId });
  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

export async function revokeStagerSession(requestId: string, tournamentId: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  await loadRequestInTournament(requestId, tournamentId);

  await db
    .update(stagerRequests)
    .set({ status: "revoked", sessionToken: null, sessionTokenHash: null })
    .where(eq(stagerRequests.id, requestId));

  broadcastLiveEvent({ table: "stager_requests", op: "UPDATE", id: requestId, tournamentId, status: "revoked" });
  await audit({ tournamentId, actor: admin, action: "STAGER_REVOKED", targetType: "stager_request", targetId: requestId });
  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

// ─── Admin: stager codes ───────────────────────────────────────────────────

/** Generates N new unique 6-char stager codes and appends them to stager_codes. */
export async function generateStagerCodes(tournamentId: string, count: number) {
  const admin = await requireTournamentAdmin(tournamentId);
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1 || n > 50) {
    throw new Error("Count must be between 1 and 50.");
  }

  const [t] = await db
    .select({ stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  const existing: StagerCode[] = Array.isArray(t?.stagerCodes) ? (t.stagerCodes as StagerCode[]) : [];
  // Codes are matched across every tournament, so avoid every code in use anywhere.
  const everyEvent = await db.select({ stagerCodes: tournaments.stagerCodes }).from(tournaments);
  const usedCodes = new Set(
    everyEvent.flatMap((row) =>
      Array.isArray(row.stagerCodes) ? (row.stagerCodes as StagerCode[]).map((c) => normalizeAccessCode(c.code)) : []
    )
  );

  const newCodes: StagerCode[] = [];
  let attempts = 0;
  const startIndex = existing.length + 1;

  while (newCodes.length < n && attempts < 1000) {
    attempts++;
    const candidate = generateUnambiguousCode(6);
    const normCandidate = normalizeAccessCode(candidate);
    if (!usedCodes.has(normCandidate)) {
      usedCodes.add(normCandidate);
      newCodes.push({ code: candidate, label: `Stager ${startIndex + newCodes.length}` });
    }
  }

  const merged = [...existing, ...newCodes];
  await db.update(tournaments).set({ stagerCodes: merged }).where(eq(tournaments.id, tournamentId));

  await audit({ tournamentId, actor: admin, action: "STAGER_CODES_GENERATED", after: { labels: newCodes.map((c) => c.label) } });
  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true, stager_codes: merged };
}

/** Remove a stager code. Sessions opened with it are revoked too. */
export async function removeStagerCode(tournamentId: string, code: string) {
  const admin = await requireTournamentAdmin(tournamentId);

  const [t] = await db
    .select({ stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  const target = normalizeAccessCode(code);
  const existing: StagerCode[] = Array.isArray(t?.stagerCodes) ? (t.stagerCodes as StagerCode[]) : [];
  const updated = existing.filter((c) => normalizeAccessCode(c.code) !== target);

  await db.update(tournaments).set({ stagerCodes: updated }).where(eq(tournaments.id, tournamentId));

  const holders = await db
    .select({ id: stagerRequests.id, accessCodeUsed: stagerRequests.accessCodeUsed })
    .from(stagerRequests)
    .where(and(eq(stagerRequests.tournamentId, tournamentId), inArray(stagerRequests.status, ["approved", "pending"])));
  const holderIds = holders.filter((h) => normalizeAccessCode(h.accessCodeUsed) === target).map((h) => h.id);
  if (holderIds.length > 0) {
    await db
      .update(stagerRequests)
      .set({ status: "revoked", sessionToken: null, sessionTokenHash: null })
      .where(inArray(stagerRequests.id, holderIds));
  }

  // A Local category held under this code is free again; its drafts stay.
  await releaseHoldsOfCode(code);

  await audit({ tournamentId, actor: admin, action: "STAGER_CODE_REMOVED", after: { revokedSessions: holderIds.length } });
  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true, stager_codes: updated };
}

export async function getStagerRequests(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);

  const rows = await db
    .select()
    .from(stagerRequests)
    .where(eq(stagerRequests.tournamentId, tournamentId))
    .orderBy(desc(stagerRequests.createdAt))
    .limit(50);

  return rows.map((row) => serializeStagerRequest(row));
}

export async function getStagerCodes(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);

  const [t] = await db
    .select({ stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  return (Array.isArray(t?.stagerCodes) ? (t.stagerCodes as StagerCode[]) : []) as StagerCode[];
}

// ─── Stager session ────────────────────────────────────────────────────────

/** For the stager login page: where to send a browser that already has a session. */
export async function getCurrentStagerSession() {
  const stager = await getStagerPrincipal();
  if (!stager) return null;
  return { tournamentId: stager.tournamentId, name: stager.name };
}

export async function logoutStager() {
  const stager = await getStagerPrincipal();
  if (stager) {
    await db
      .update(stagerRequests)
      .set({ status: "expired", sessionToken: null, sessionTokenHash: null })
      .where(eq(stagerRequests.id, stager.requestId));
  }
  await clearCookies(SESSION_COOKIES.stager, ...LEGACY_COOKIES);
  return { success: true };
}

// ─── Stager board ──────────────────────────────────────────────────────────

/** Mark a category calling / ready (or clear it). Stagers and the event's admin. */
export async function updateCategoryStagerStatus(
  categoryId: string,
  tournamentId: string,
  newStatus: "calling" | "ready" | null,
  /** Which card of the category: 'POOL:n' or 'FINALS' for a split category; the whole category otherwise. */
  part?: string
): Promise<{ success: boolean; error?: string }> {
  let actor;
  try {
    actor = await requireTournamentStaff(tournamentId, ["stager", "admin"]);
    // A Local tournament has no calling board: its stagers lock groups at the desk instead.
    await requireOfficialTournament(tournamentId);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unauthorized" };
  }

  if (newStatus !== null && newStatus !== "calling" && newStatus !== "ready") {
    return { success: false, error: "Invalid status" };
  }
  if (!isValidUuid(categoryId)) return { success: false, error: "Category not found" };
  if (part !== undefined && !/^(ALL|FINALS|POOL:[1-9]\d{0,2})$/.test(part)) return { success: false, error: "Unknown part" };

  const [assignment] = await db
    .select({
      id: categoryAssignments.id,
      ringId: categoryAssignments.ringId,
      tournamentId: rings.tournamentId,
    })
    .from(categoryAssignments)
    .innerJoin(rings, eq(categoryAssignments.ringId, rings.id))
    .where(
      and(
        eq(categoryAssignments.categoryId, categoryId),
        part ? eq(categoryAssignments.part, part) : inArray(categoryAssignments.part, ["ALL", "FINALS"])
      )
    )
    .limit(1);

  if (!assignment) return { success: false, error: "Category is not assigned to any ring yet." };
  if (assignment.tournamentId !== tournamentId) {
    return { success: false, error: "Unauthorized: Category does not belong to this tournament." };
  }

  await db
    .update(categoryAssignments)
    .set({
      stagerStatus: newStatus,
      stagerName: newStatus ? actor.name : null,
      stagerActionAt: newStatus ? new Date() : null,
    })
    .where(eq(categoryAssignments.id, assignment.id));

  await audit({
    tournamentId,
    ringId: assignment.ringId,
    categoryId,
    actor,
    action: "STAGER_STATUS",
    targetType: "category_assignment",
    targetId: assignment.id,
    after: { stagerStatus: newStatus },
  });

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: assignment.id,
    ringId: assignment.ringId,
    tournamentId,
    categoryId,
  });

  return { success: true };
}
