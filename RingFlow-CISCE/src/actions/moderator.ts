"use server";

import { db } from "@/db";
import {
  categoryAssignments,
  rings,
  eventLog,
  moderatorRequests,
  categories,
} from "@/db/schema";
import { eq, and, asc, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { normalizeAccessCode, isValidUuid } from "@/lib/utils";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { serializeCategoryAssignment } from "@/lib/serializers";
import { isOfflineMode } from "@/lib/offline";
import {
  SESSION_COOKIES,
  clearCookies,
  setSessionCookie,
} from "@/lib/auth/cookies";
import { claimCookieName, holdsClaim, issueClaim } from "@/lib/auth/claims";
import {
  getRingModerator,
  requireRingModerator,
  requireTournamentAdmin,
  requireTournamentStaff,
} from "@/lib/auth/guards";
import { tournamentIdForRing } from "@/lib/auth/scope";
import { getModeratorPrincipal } from "@/lib/auth/principal";

const MODERATOR_SESSION_SECONDS = 24 * 60 * 60;

// ─── Admin: approve / reject / revoke ────────────────────────────────────────

export async function approveModeratorRequest(requestId: string, ringId: string, tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  if ((await tournamentIdForRing(ringId)) !== tournamentId) {
    throw new Error("Tatami not found in this tournament");
  }

  const [request] = await db
    .select({ id: moderatorRequests.id, status: moderatorRequests.status })
    .from(moderatorRequests)
    .where(and(eq(moderatorRequests.id, requestId), eq(moderatorRequests.ringId, ringId)))
    .limit(1);
  if (!request) throw new Error("Request not found for this tatami");
  if (request.status !== "pending") throw new Error(`Request is already ${request.status}`);

  const sessionToken = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // One moderator per tatami: approving a new one ends the previous shift.
    await tx
      .update(moderatorRequests)
      .set({ status: "revoked", sessionToken: null })
      .where(and(eq(moderatorRequests.ringId, ringId), eq(moderatorRequests.status, "approved")));

    await tx
      .update(moderatorRequests)
      .set({
        status: "approved",
        sessionToken,
        expiresAt: new Date(Date.now() + MODERATOR_SESSION_SECONDS * 1000),
      })
      .where(eq(moderatorRequests.id, requestId));
  });

  broadcastLiveEvent({
    table: "moderator_requests",
    op: "UPDATE",
    id: requestId,
    ringId,
    tournamentId,
    status: "approved",
  });

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function rejectModeratorRequest(requestId: string, tournamentId: string) {
  await requireTournamentAdmin(tournamentId);

  const [req] = await db
    .select({ id: moderatorRequests.id, ringId: moderatorRequests.ringId, tournamentId: rings.tournamentId })
    .from(moderatorRequests)
    .innerJoin(rings, eq(moderatorRequests.ringId, rings.id))
    .where(eq(moderatorRequests.id, requestId))
    .limit(1);

  if (!req || req.tournamentId !== tournamentId) {
    throw new Error("Request not found in this tournament");
  }

  await db
    .update(moderatorRequests)
    .set({ status: "rejected", sessionToken: null })
    .where(eq(moderatorRequests.id, requestId));

  broadcastLiveEvent({
    table: "moderator_requests",
    op: "UPDATE",
    id: requestId,
    ringId: req.ringId,
    tournamentId,
    status: "rejected",
  });

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function revokeActiveModeratorSession(ringId: string, tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  if ((await tournamentIdForRing(ringId)) !== tournamentId) {
    throw new Error("Tatami not found in this tournament");
  }

  await db
    .update(moderatorRequests)
    .set({ status: "revoked", sessionToken: null })
    .where(and(eq(moderatorRequests.ringId, ringId), eq(moderatorRequests.status, "approved")));

  broadcastLiveEvent({
    table: "moderator_requests",
    op: "UPDATE",
    ringId,
    tournamentId,
    status: "revoked",
  });

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  return { success: true };
}

// ─── Public: request access, collect the session ────────────────────────────

export async function requestModeratorAccess(
  accessCode: string,
  moderatorName?: string,
  deviceInfo?: Record<string, unknown>,
  turnstileToken?: string
) {
  const cleanName = (moderatorName || "").trim().slice(0, 100);
  if (!cleanName) {
    return { success: false, error: "Please enter your name." };
  }
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const isTurnstileRequired = Boolean(secretKey && secretKey !== "disabled" && !isOfflineMode());
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

  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : headersList.get("x-real-ip") || "Unknown";

  const finalDeviceInfo = {
    userAgent: typeof deviceInfo?.userAgent === "string" ? deviceInfo.userAgent.slice(0, 300) : undefined,
    deviceId: typeof deviceInfo?.deviceId === "string" ? deviceInfo.deviceId.slice(0, 100) : undefined,
    platform: typeof deviceInfo?.platform === "string" ? deviceInfo.platform.slice(0, 100) : undefined,
    ip,
  };

  const cleanCode = (accessCode || "").trim().replace(/[\s\-_]/g, "").toUpperCase().slice(0, 20);
  if (cleanCode.length < 6) {
    return { success: false, error: "Please enter the 6-character tatami access code." };
  }

  let [ring] = await db
    .select({ id: rings.id, name: rings.name, tournamentId: rings.tournamentId, accessCode: rings.accessCode })
    .from(rings)
    .where(eq(rings.accessCode, cleanCode))
    .limit(1);

  if (!ring) {
    const normInput = normalizeAccessCode(cleanCode);
    const candidateRings = await db
      .select({ id: rings.id, name: rings.name, tournamentId: rings.tournamentId, accessCode: rings.accessCode })
      .from(rings);
    ring = candidateRings.find((r) => r.accessCode && normalizeAccessCode(r.accessCode) === normInput) as typeof ring;
  }

  if (!ring) {
    return { success: false, error: "Invalid access code." };
  }

  const claimHash = await issueClaim("moderator");

  const [request] = await db
    .insert(moderatorRequests)
    .values({
      ringId: ring.id,
      accessCodeUsed: ring.accessCode || cleanCode,
      status: "pending",
      moderatorName: cleanName,
      deviceInfo: finalDeviceInfo,
      claimHash,
      expiresAt: new Date(Date.now() + MODERATOR_SESSION_SECONDS * 1000),
    })
    .returning({ id: moderatorRequests.id });

  if (!request) {
    return { success: false, error: "Failed to request access." };
  }

  broadcastLiveEvent({
    table: "moderator_requests",
    op: "INSERT",
    id: request.id,
    ringId: ring.id,
    tournamentId: ring.tournamentId,
    status: "pending",
  });

  return { success: true, requestId: request.id };
}

/**
 * Waiting-room poll. Anyone may learn a request's status; only the browser
 * that made the request (it holds the claim secret) receives the session cookie.
 */
export async function checkModeratorStatus(requestId: string) {
  if (!isValidUuid(requestId)) return { status: "not_found" as const };

  const [request] = await db
    .select({
      status: moderatorRequests.status,
      sessionToken: moderatorRequests.sessionToken,
      ringId: moderatorRequests.ringId,
      expiresAt: moderatorRequests.expiresAt,
      claimHash: moderatorRequests.claimHash,
    })
    .from(moderatorRequests)
    .where(eq(moderatorRequests.id, requestId))
    .limit(1);

  if (!request) return { status: "not_found" as const };

  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    return { status: "expired" as const };
  }

  const ownsRequest = await holdsClaim("moderator", request.claimHash);

  if (request.status === "approved" && request.sessionToken && ownsRequest) {
    const secondsLeft = request.expiresAt
      ? Math.max(60, Math.floor((request.expiresAt.getTime() - Date.now()) / 1000))
      : MODERATOR_SESSION_SECONDS;
    await setSessionCookie(SESSION_COOKIES.moderator, request.sessionToken, secondsLeft);
    await clearCookies(claimCookieName("moderator"));
    return { status: "approved" as const, ringId: request.ringId };
  }

  if (request.status === "approved" && !ownsRequest) {
    // Approved, but this browser did not make the request.
    return { status: "approved_elsewhere" as const };
  }

  return { status: request.status as "pending" | "rejected" | "revoked" | "expired" };
}

// ─── Moderator desk (own tatami only) ───────────────────────────────────────

async function loadAssignmentOnRing(assignmentId: string, ringId: string) {
  if (!isValidUuid(assignmentId)) throw new Error("Assignment not found on this tatami");
  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.id, assignmentId))
    .limit(1);
  if (!assignment || assignment.ringId !== ringId) {
    throw new Error("Assignment not found on this tatami");
  }
  return assignment;
}

async function logAndBroadcast(params: {
  ringId: string;
  tournamentId: string;
  categoryId?: string | null;
  assignmentId?: string;
  action: string;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(eventLog).values({
      tournamentId: params.tournamentId,
      ringId: params.ringId,
      categoryId: params.categoryId ?? null,
      action: params.action,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    console.error(`[moderator] could not log ${params.action}:`, err);
  }

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: params.assignmentId,
    ringId: params.ringId,
    tournamentId: params.tournamentId,
    categoryId: params.categoryId ?? undefined,
    status: params.status,
  });
}

function revalidateDesk(ringId: string) {
  try {
    revalidatePath(`/moderator/ring/${ringId}/current`);
    revalidatePath(`/moderator/ring/${ringId}/queue`);
  } catch {
    // Not inside a request that can revalidate (e.g. a script).
  }
}

export async function startCategory(assignmentId: string, ringId: string) {
  const moderator = await requireRingModerator(ringId);
  const assignment = await loadAssignmentOnRing(assignmentId, ringId);

  if (assignment.status === "completed") {
    throw new Error("This category is already completed. Return it to the queue first.");
  }

  // A tatami runs exactly one category at a time.
  const [other] = await db
    .select({ id: categoryAssignments.id })
    .from(categoryAssignments)
    .where(
      and(
        eq(categoryAssignments.ringId, ringId),
        inArray(categoryAssignments.status, ["running", "paused"]),
        ne(categoryAssignments.id, assignmentId)
      )
    )
    .limit(1);
  if (other) {
    throw new Error("Another category is already on this tatami. Finish or return it to the queue first.");
  }

  await db
    .update(categoryAssignments)
    .set({ status: "running", startedAt: assignment.startedAt ?? new Date() })
    .where(eq(categoryAssignments.id, assignmentId));

  await logAndBroadcast({
    ringId,
    tournamentId: moderator.tournamentId,
    categoryId: assignment.categoryId,
    assignmentId,
    action: "START_CATEGORY",
    status: "running",
    metadata: { moderator: moderator.name },
  });

  revalidateDesk(ringId);
  return { success: true };
}

// In-memory sliding-window guard against accidental double taps on the counter.
const recentAdjustmentsMap = new Map<string, number[]>();

export async function adjustMatchCount(assignmentId: string, ringId: string, delta: number) {
  const moderator = await requireRingModerator(ringId);

  const step = Math.trunc(Number(delta));
  if (!Number.isFinite(step) || step === 0 || Math.abs(step) > 500) {
    throw new Error("Invalid adjustment");
  }

  const now = Date.now();
  const windowMs = 2500;
  const history = (recentAdjustmentsMap.get(ringId) || []).filter((t) => now - t < windowMs);
  if (history.length >= 2) {
    recentAdjustmentsMap.set(ringId, []);
    throw new Error("Too many rapid attempts detected. Action rejected.");
  }
  history.push(now);
  recentAdjustmentsMap.set(ringId, history);

  const assignment = await loadAssignmentOnRing(assignmentId, ringId);
  if (assignment.status === "paused") {
    throw new Error("Cannot adjust match count while the ring/category is paused.");
  }

  const [cat] = await db
    .select({ expectedMatches: categories.expectedMatches })
    .from(categories)
    .where(eq(categories.id, assignment.categoryId))
    .limit(1);

  const maxMatches = cat?.expectedMatches ?? Number.MAX_SAFE_INTEGER;
  const newCount = Math.min(maxMatches, Math.max(0, (assignment.matchesCompleted || 0) + step));

  await db
    .update(categoryAssignments)
    .set({ matchesCompleted: newCount })
    .where(eq(categoryAssignments.id, assignmentId));

  await logAndBroadcast({
    ringId,
    tournamentId: moderator.tournamentId,
    categoryId: assignment.categoryId,
    assignmentId,
    action: step > 0 ? "MATCH_COMPLETED_INCREMENT" : "MATCH_COMPLETED_DECREMENT",
    metadata: { delta: step, moderator: moderator.name },
  });

  return { success: true, matches_completed: newCount };
}

export async function finishCategory(assignmentId: string, ringId: string) {
  const moderator = await requireRingModerator(ringId);
  const assignment = await loadAssignmentOnRing(assignmentId, ringId);

  await db
    .update(categoryAssignments)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(categoryAssignments.id, assignmentId));

  await db.update(rings).set({ currentMatchId: null }).where(eq(rings.id, ringId));

  await logAndBroadcast({
    ringId,
    tournamentId: moderator.tournamentId,
    categoryId: assignment.categoryId,
    assignmentId,
    action: "FINISH_CATEGORY",
    status: "completed",
    metadata: { moderator: moderator.name },
  });

  revalidateDesk(ringId);
  return { success: true };
}

export async function setRingStatus(assignmentId: string, ringId: string, isPaused: boolean) {
  const moderator = await requireRingModerator(ringId);
  const assignment = await loadAssignmentOnRing(assignmentId, ringId);

  if (assignment.status !== "running" && assignment.status !== "paused") {
    throw new Error("Only the category on the mat can be paused or resumed.");
  }

  await db
    .update(categoryAssignments)
    .set({ status: isPaused ? "paused" : "running" })
    .where(eq(categoryAssignments.id, assignmentId));

  await logAndBroadcast({
    ringId,
    tournamentId: moderator.tournamentId,
    categoryId: assignment.categoryId,
    assignmentId,
    action: isPaused ? "PAUSE_RING" : "RESUME_RING",
    status: isPaused ? "paused" : "running",
    metadata: { moderator: moderator.name },
  });

  revalidateDesk(ringId);
  return { success: true };
}

export async function pauseCurrentRingAssignment(ringId: string) {
  await requireRingModerator(ringId);

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(and(eq(categoryAssignments.ringId, ringId), eq(categoryAssignments.status, "running")))
    .limit(1);

  if (assignment) {
    await setRingStatus(assignment.id, ringId, true);
  }
  return { success: true };
}

const RING_EVENT_ACTIONS = ["EMERGENCY_ALERT", "PAUSE_RING", "REQUEST_ASSISTANCE"] as const;

export async function logRingEvent(
  ringId: string,
  actionName: (typeof RING_EVENT_ACTIONS)[number],
  metadata?: Record<string, unknown>
) {
  const moderator = await requireRingModerator(ringId);
  if (!RING_EVENT_ACTIONS.includes(actionName)) throw new Error("Unknown ring event");

  const safeMetadata = {
    message: typeof metadata?.message === "string" ? metadata.message.slice(0, 300) : undefined,
    type: typeof metadata?.type === "string" ? metadata.type.slice(0, 100) : undefined,
    reason: typeof metadata?.reason === "string" ? metadata.reason.slice(0, 300) : undefined,
    moderator: moderator.name,
  };

  const [row] = await db
    .insert(eventLog)
    .values({
      tournamentId: moderator.tournamentId,
      ringId,
      action: actionName,
      metadata: safeMetadata,
    })
    .returning();

  broadcastLiveEvent({
    table: "event_log",
    op: "INSERT",
    tournamentId: moderator.tournamentId,
    ringId,
    data: {
      id: row?.id,
      tournament_id: moderator.tournamentId,
      ring_id: ringId,
      action: actionName,
      metadata: safeMetadata,
      created_at: (row?.createdAt ?? new Date()).toISOString(),
    },
  });

  return { success: true };
}

export async function returnCategoryToQueue(assignmentId: string, ringId: string) {
  const moderator = await requireRingModerator(ringId);
  const assignment = await loadAssignmentOnRing(assignmentId, ringId);

  await db
    .update(categoryAssignments)
    .set({ status: "pending", completedAt: null })
    .where(eq(categoryAssignments.id, assignmentId));

  await db.update(rings).set({ currentMatchId: null }).where(eq(rings.id, ringId));

  await logAndBroadcast({
    ringId,
    tournamentId: moderator.tournamentId,
    categoryId: assignment.categoryId,
    assignmentId,
    action: "RETURNED_TO_QUEUE",
    status: "pending",
    metadata: { moderator: moderator.name },
  });

  revalidateDesk(ringId);
  return { success: true };
}

/**
 * Swap a pending category with its neighbour. (ring_id, queue_order) is
 * unique, so the swap parks one row on a temporary slot inside a transaction.
 */
export async function reorderCategory(assignmentId: string, ringId: string, direction: "up" | "down") {
  const moderator = await requireRingModerator(ringId);

  const pending = await db
    .select()
    .from(categoryAssignments)
    .where(and(eq(categoryAssignments.ringId, ringId), eq(categoryAssignments.status, "pending")))
    .orderBy(asc(categoryAssignments.queueOrder));

  const currentIndex = pending.findIndex((a) => a.id === assignmentId);
  if (currentIndex === -1) return { success: false, error: "Only pending categories can be reordered." };

  const neighbourIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (neighbourIndex < 0 || neighbourIndex >= pending.length) return { success: true };

  const curr = pending[currentIndex];
  const other = pending[neighbourIndex];

  await db.transaction(async (tx) => {
    const [{ parking }] = await tx
      .select({ parking: sql<number>`coalesce(max(${categoryAssignments.queueOrder}), 0) + 1000` })
      .from(categoryAssignments)
      .where(eq(categoryAssignments.ringId, ringId));
    await tx.update(categoryAssignments).set({ queueOrder: Number(parking) }).where(eq(categoryAssignments.id, curr.id));
    await tx.update(categoryAssignments).set({ queueOrder: curr.queueOrder }).where(eq(categoryAssignments.id, other.id));
    await tx.update(categoryAssignments).set({ queueOrder: other.queueOrder }).where(eq(categoryAssignments.id, curr.id));
  });

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    ringId,
    tournamentId: moderator.tournamentId,
  });

  revalidateDesk(ringId);
  return { success: true };
}

/** Ends this browser's moderator session on the server too, so the token is dead. */
export async function logoutModerator() {
  const moderator = await getModeratorPrincipal();
  if (moderator) {
    await db
      .update(moderatorRequests)
      .set({ status: "expired", sessionToken: null })
      .where(eq(moderatorRequests.id, moderator.requestId));
    broadcastLiveEvent({
      table: "moderator_requests",
      op: "UPDATE",
      id: moderator.requestId,
      ringId: moderator.ringId,
      tournamentId: moderator.tournamentId,
      status: "expired",
    });
  }
  await clearCookies(SESSION_COOKIES.moderator);
  return { success: true };
}

export async function updateModeratorName(newName: string) {
  const moderator = await getModeratorPrincipal();
  if (!moderator) throw new Error("Unauthorized: Active moderator session required.");

  const clean = (newName || "").trim().slice(0, 100);
  if (!clean) throw new Error("Name cannot be empty");

  await db
    .update(moderatorRequests)
    .set({ moderatorName: clean })
    .where(eq(moderatorRequests.id, moderator.requestId));
  return { success: true, name: clean };
}

/** The tatami's queue: its moderator, or tournament staff watching the floor. */
export async function getModeratorRingAssignments(ringId: string) {
  if (!(await getRingModerator(ringId))) {
    await requireTournamentStaff(await tournamentIdForRing(ringId));
  }

  const rawAssignments = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.ringId, ringId))
    .orderBy(asc(categoryAssignments.queueOrder));

  const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId).filter(Boolean)));
  const catMap = new Map<string, typeof categories.$inferSelect>();
  if (categoryIds.length > 0) {
    const cats = await db.select().from(categories).where(inArray(categories.id, categoryIds));
    cats.forEach((c) => catMap.set(c.id, c));
  }

  return rawAssignments.map((a) => serializeCategoryAssignment(a, catMap.get(a.categoryId)));
}

/** Who this desk is signed in as (for the profile menu). Never includes the token. */
export async function getCurrentModeratorProfile() {
  const moderator = await getModeratorPrincipal();
  if (!moderator) return null;
  return { id: moderator.requestId, moderator_name: moderator.name, ringId: moderator.ringId };
}
