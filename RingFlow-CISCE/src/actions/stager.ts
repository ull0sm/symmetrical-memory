"use server";

import { createClient } from "@/utils/supabase/server";
import { db } from "@/db";
import { tournaments, stagerRequests, categoryAssignments, rings, admins } from "@/db/schema";
import { eq, and, or, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { ensureAdminOwnsTournament } from "./admin";
import { normalizeAccessCode, generateUnambiguousCode, isValidUuid } from "@/lib/utils";
import { serializeStagerRequest } from "@/lib/serializers";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StagerCode = {
  code: string;
  label: string;
};

// ─── Public: Request stager access ────────────────────────────────────────────

/**
 * Stager submits their access code + name to request tournament access.
 * Validates code against the stager_codes JSONB array on the tournament.
 */
export async function requestStagerAccess(
  accessCode: string,
  stagerName: string,
  deviceInfo?: any,
  turnstileToken?: string
) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const isTurnstileRequired = Boolean(
    secretKey && secretKey !== "disabled" && process.env.OFFLINE_MODE !== "true"
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

  const cleanName = (stagerName || "").trim().slice(0, 100);
  if (!cleanName) {
    return { success: false, error: "Please enter your name." };
  }

  // Resolve IP from headers
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

  // Find a tournament that has this code in its stager_codes JSONB array.
  const activeTournaments = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      stagerCodes: tournaments.stagerCodes,
    })
    .from(tournaments)
    .where(inArray(tournaments.status, ["draft", "active"]));

  if (!activeTournaments || activeTournaments.length === 0) {
    return { success: false, error: "No active tournament found for this code." };
  }

  // Match code against each tournament's stager_codes array
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
    return { success: false, error: "Invalid stager access code. Please check with the tournament director." };
  }

  // Check if this code already has an active (approved) session
  const existingActiveList = await db
    .select({
      id: stagerRequests.id,
      status: stagerRequests.status,
      accessCodeUsed: stagerRequests.accessCodeUsed,
      expiresAt: stagerRequests.expiresAt,
    })
    .from(stagerRequests)
    .where(
      and(
        eq(stagerRequests.tournamentId, matchedTournament.id),
        eq(stagerRequests.status, "approved")
      )
    );

  const hasActiveSession = existingActiveList.some((r) => {
    const isNotExpired = !r.expiresAt || new Date(r.expiresAt).getTime() > Date.now();
    return isNotExpired && normalizeAccessCode(r.accessCodeUsed) === normInput;
  });

  if (hasActiveSession) {
    return {
      success: false,
      error:
        "This stager code already has an approved session. Ask the admin to revoke that stager (Event → Access → Stagers), or use a different code.",
    };
  }

  // Insert stager request using the tournament's canonical code format
  const [newRequest] = await db
    .insert(stagerRequests)
    .values({
      tournamentId: matchedTournament.id,
      accessCodeUsed: canonicalCode,
      status: "pending",
      stagerName: cleanName,
      deviceInfo: finalDeviceInfo,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    })
    .returning({ id: stagerRequests.id });

  if (!newRequest) {
    return { success: false, error: "Failed to submit access request. Please try again." };
  }

  revalidatePath(`/admin/event/${matchedTournament.id}/rings`);

  return { success: true, requestId: newRequest.id, tournamentName: matchedTournament.name };
}

// ─── Public: Poll request status (waiting room) ────────────────────────────

export async function checkStagerStatus(requestId: string) {
  const [request] = await db
    .select({
      status: stagerRequests.status,
      sessionToken: stagerRequests.sessionToken,
      tournamentId: stagerRequests.tournamentId,
      expiresAt: stagerRequests.expiresAt,
      stagerName: stagerRequests.stagerName,
    })
    .from(stagerRequests)
    .where(eq(stagerRequests.id, requestId))
    .limit(1);

  if (!request) return { status: "not_found" };

  if (request.expiresAt && new Date(request.expiresAt).getTime() < Date.now()) {
    return { status: "expired" };
  }

  if (request.status === "approved" && request.sessionToken) {
    const cookieStore = await cookies();
    cookieStore.set("stager_token", request.sessionToken, {
      path: "/",
      maxAge: 604800, // 7 days
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    if (request.stagerName) {
      cookieStore.set("stager_name", encodeURIComponent(request.stagerName), {
        path: "/",
        maxAge: 604800, // 7 days
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  }

  return {
    status: request.status,
    sessionToken: request.sessionToken,
    tournamentId: request.tournamentId,
    stagerName: request.stagerName,
  };
}

// ─── Admin: Approve / Reject / Revoke ─────────────────────────────────────

export async function approveStagerRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  // Find the request to get its access_code_used
  const [targetReq] = await db
    .select({ accessCodeUsed: stagerRequests.accessCodeUsed })
    .from(stagerRequests)
    .where(and(eq(stagerRequests.id, requestId), eq(stagerRequests.tournamentId, tournamentId)))
    .limit(1);

  // Revoke any existing approved sessions using this code (or equivalent normalized code)
  if (targetReq?.accessCodeUsed) {
    const activeSessions = await db
      .select({ id: stagerRequests.id, accessCodeUsed: stagerRequests.accessCodeUsed })
      .from(stagerRequests)
      .where(and(eq(stagerRequests.tournamentId, tournamentId), eq(stagerRequests.status, "approved")));

    const targetNorm = normalizeAccessCode(targetReq.accessCodeUsed);
    const toRevokeIds = activeSessions
      .filter((s) => normalizeAccessCode(s.accessCodeUsed) === targetNorm && s.id !== requestId)
      .map((s) => s.id);

    if (toRevokeIds.length > 0) {
      await db
        .update(stagerRequests)
        .set({ status: "revoked", sessionToken: null })
        .where(inArray(stagerRequests.id, toRevokeIds));
    }
  }

  const sessionToken = crypto.randomUUID();

  await db
    .update(stagerRequests)
    .set({ status: "approved", sessionToken })
    .where(and(eq(stagerRequests.id, requestId), eq(stagerRequests.tournamentId, tournamentId)));

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

export async function rejectStagerRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db
    .update(stagerRequests)
    .set({ status: "rejected" })
    .where(and(eq(stagerRequests.id, requestId), eq(stagerRequests.tournamentId, tournamentId)));

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

export async function revokeStagerSession(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db
    .update(stagerRequests)
    .set({ status: "revoked", sessionToken: null })
    .where(and(eq(stagerRequests.id, requestId), eq(stagerRequests.tournamentId, tournamentId)));

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true };
}

// ─── Admin: Generate stager codes ─────────────────────────────────────────

/**
 * Generates N new unique 6-char stager codes and APPENDS them to stager_codes.
 */
export async function generateStagerCodes(tournamentId: string, count: number) {
  await ensureAdminOwnsTournament(tournamentId);
  if (count < 1 || count > 50) {
    throw new Error("Count must be between 1 and 50.");
  }

  const [t] = await db
    .select({ stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  const existing: StagerCode[] = Array.isArray(t?.stagerCodes) ? (t.stagerCodes as StagerCode[]) : [];
  const usedCodes = new Set(existing.map((c) => normalizeAccessCode(c.code)));

  const newCodes: StagerCode[] = [];
  let attempts = 0;
  const startIndex = existing.length + 1;

  while (newCodes.length < count && attempts < 1000) {
    attempts++;
    const candidate = generateUnambiguousCode(6);
    const normCandidate = normalizeAccessCode(candidate);
    if (!usedCodes.has(normCandidate)) {
      usedCodes.add(normCandidate);
      newCodes.push({
        code: candidate,
        label: `Stager ${startIndex + newCodes.length}`,
      });
    }
  }

  const merged = [...existing, ...newCodes];

  await db
    .update(tournaments)
    .set({ stagerCodes: merged })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true, stager_codes: merged };
}

/**
 * Remove a single stager code by its code value.
 */
export async function removeStagerCode(tournamentId: string, code: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const [t] = await db
    .select({ stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  const existing: StagerCode[] = Array.isArray(t?.stagerCodes) ? (t.stagerCodes as StagerCode[]) : [];
  const updated = existing.filter((c) => c.code.toUpperCase() !== code.toUpperCase());

  await db
    .update(tournaments)
    .set({ stagerCodes: updated })
    .where(eq(tournaments.id, tournamentId));

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  return { success: true, stager_codes: updated };
}

export async function getStagerRequests(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const rows = await db
    .select()
    .from(stagerRequests)
    .where(eq(stagerRequests.tournamentId, tournamentId))
    .orderBy(desc(stagerRequests.createdAt))
    .limit(50);

  return rows.map(serializeStagerRequest);
}

export async function getStagerCodes(tournamentId: string) {
  const [t] = await db
    .select({ stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  return (Array.isArray(t?.stagerCodes) ? (t.stagerCodes as StagerCode[]) : []) as StagerCode[];
}

// ─── Stager Auth Helpers ───────────────────────────────────────────────────

export async function ensureStagerHasAccessToTournament(tournamentId: string) {
  const cookieStore = await cookies();
  const stagerToken = cookieStore.get("stager_token")?.value;

  if (stagerToken && isValidUuid(stagerToken)) {
    const [request] = await db
      .select({
        id: stagerRequests.id,
        tournamentId: stagerRequests.tournamentId,
        status: stagerRequests.status,
        stagerName: stagerRequests.stagerName,
        sessionToken: stagerRequests.sessionToken,
        expiresAt: stagerRequests.expiresAt,
        tournamentName: tournaments.name,
      })
      .from(stagerRequests)
      .leftJoin(tournaments, eq(stagerRequests.tournamentId, tournaments.id))
      .where(
        and(
          or(
            eq(stagerRequests.sessionToken, stagerToken),
            eq(stagerRequests.id, stagerToken)
          ),
          eq(stagerRequests.status, "approved"),
          eq(stagerRequests.tournamentId, tournamentId)
        )
      )
      .limit(1);

    if (request && (!request.expiresAt || new Date(request.expiresAt).getTime() >= Date.now())) {
      const cookieName = cookieStore.get("stager_name")?.value;
      const finalName = request.stagerName || (cookieName ? decodeURIComponent(cookieName) : "Stager");
      return {
        role: "stager",
        id: request.id,
        name: finalName,
        tournamentId: request.tournamentId,
        tournament: { id: request.tournamentId, name: request.tournamentName },
      };
    }
  }

  // Fallback: Allow authenticated admin who owns the tournament
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const [admin] = await db
      .select({ id: admins.id, email: admins.email })
      .from(admins)
      .where(eq(admins.id, user.id))
      .limit(1);

    if (admin) {
      const [t] = await db
        .select({ id: tournaments.id, name: tournaments.name })
        .from(tournaments)
        .where(and(eq(tournaments.id, tournamentId), eq(tournaments.adminId, admin.id)))
        .limit(1);

      if (t) {
        const cookieName = cookieStore.get("stager_name")?.value;
        const resolvedName = cookieName
          ? decodeURIComponent(cookieName)
          : user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Admin";

        return { role: "admin", id: admin.id, name: resolvedName, tournament: t };
      }
    }
  }

  if (!stagerToken) {
    throw new Error("Not authenticated: Missing stager session");
  }

  throw new Error("Unauthorized: Invalid or expired stager session");
}

export async function ensureStager() {
  const cookieStore = await cookies();
  const stagerToken = cookieStore.get("stager_token")?.value;

  if (stagerToken && isValidUuid(stagerToken)) {
    const [request] = await db
      .select({
        id: stagerRequests.id,
        tournamentId: stagerRequests.tournamentId,
        status: stagerRequests.status,
        stagerName: stagerRequests.stagerName,
        expiresAt: stagerRequests.expiresAt,
      })
      .from(stagerRequests)
      .where(
        and(
          or(
            eq(stagerRequests.sessionToken, stagerToken),
            eq(stagerRequests.id, stagerToken)
          ),
          eq(stagerRequests.status, "approved")
        )
      )
      .limit(1);

    if (request && (!request.expiresAt || new Date(request.expiresAt).getTime() >= Date.now())) {
      return {
        id: request.id,
        name: request.stagerName,
        role: "stager",
        tournamentId: request.tournamentId,
      };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const [admin] = await db
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.id, user.id))
      .limit(1);

    if (admin) {
      const cookieName = cookieStore.get("stager_name")?.value;
      const adminName = cookieName
        ? decodeURIComponent(cookieName)
        : user.user_metadata?.full_name || user.user_metadata?.name || "Administrator";
      return { id: admin.id, name: adminName, role: "admin" };
    }
  }

  throw new Error("Not authenticated");
}

export async function logoutStager() {
  const cookieStore = await cookies();
  cookieStore.delete("stager_token");
  cookieStore.delete("stager_name");
  return { success: true };
}

// ─── Stager Board Action: Update category status ───────────────────────────

export async function updateCategoryStagerStatus(
  categoryId: string,
  tournamentId: string,
  newStatus: "calling" | "ready" | null,
  stagerName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let stagerInfo: Awaited<ReturnType<typeof ensureStagerHasAccessToTournament>>;
    try {
      stagerInfo = await ensureStagerHasAccessToTournament(tournamentId);
    } catch (err: any) {
      return { success: false, error: err?.message || "Unauthorized: Invalid or expired stager session." };
    }

    const effectiveName = stagerName && stagerName !== "Stager"
      ? stagerName
      : (stagerInfo.name || "Stager");

    // Verify the category belongs to a ring in this tournament
    const [assignment] = await db
      .select({
        categoryId: categoryAssignments.categoryId,
        ringId: categoryAssignments.ringId,
        tournamentId: rings.tournamentId,
      })
      .from(categoryAssignments)
      .innerJoin(rings, eq(categoryAssignments.ringId, rings.id))
      .where(eq(categoryAssignments.categoryId, categoryId))
      .limit(1);

    if (!assignment) {
      return { success: false, error: "Category is not assigned to any ring yet." };
    }
    if (assignment.tournamentId !== tournamentId) {
      return { success: false, error: "Unauthorized: Category does not belong to this tournament." };
    }

    await db
      .update(categoryAssignments)
      .set({
        stagerStatus: newStatus,
        stagerName: newStatus ? effectiveName : null,
        stagerActionAt: newStatus ? new Date() : null,
      })
      .where(eq(categoryAssignments.categoryId, categoryId));

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Unexpected error updating stager status" };
  }
}
