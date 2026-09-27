"use server";

import { db } from "@/db";
import {
  categoryAssignments,
  rings,
  eventLog,
  moderatorRequests,
  categories,
} from "@/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { ensureAdminOwnsTournament } from "./admin";
import { secureCookieFlag } from "@/lib/serverCookies";
import { normalizeAccessCode, isValidUuid } from "@/lib/utils";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { serializeCategoryAssignment } from "@/lib/serializers";

export async function approveModeratorRequest(requestId: string, ringId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  const sessionToken = crypto.randomUUID();

  // 1. Revoke any previous approved session for this ring
  await db
    .update(moderatorRequests)
    .set({ status: "revoked", sessionToken: null })
    .where(
      and(
        eq(moderatorRequests.ringId, ringId),
        eq(moderatorRequests.status, "approved")
      )
    );

  // 2. Mark request as approved
  await db
    .update(moderatorRequests)
    .set({ status: "approved", sessionToken })
    .where(
      and(
        eq(moderatorRequests.id, requestId),
        eq(moderatorRequests.ringId, ringId)
      )
    );

  broadcastLiveEvent({
    table: "moderator_requests",
    op: "UPDATE",
    id: requestId,
    ringId,
    tournamentId,
    sessionToken,
    status: "approved",
  });

  revalidatePath(`/admin/event/${tournamentId}/rings`);
  revalidatePath(`/admin/event/${tournamentId}/dashboard`);
  return { success: true };
}

export async function rejectModeratorRequest(requestId: string, tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  // Verify request belongs to the tournament
  const [req] = await db
    .select({
      id: moderatorRequests.id,
      ringId: moderatorRequests.ringId,
      tournamentId: rings.tournamentId,
    })
    .from(moderatorRequests)
    .innerJoin(rings, eq(moderatorRequests.ringId, rings.id))
    .where(eq(moderatorRequests.id, requestId))
    .limit(1);

  if (!req || req.tournamentId !== tournamentId) {
    throw new Error("Request not found in this tournament");
  }

  await db
    .update(moderatorRequests)
    .set({ status: "rejected" })
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
  await ensureAdminOwnsTournament(tournamentId);

  const [ring] = await db
    .select({ id: rings.id })
    .from(rings)
    .where(and(eq(rings.id, ringId), eq(rings.tournamentId, tournamentId)))
    .limit(1);

  if (!ring) throw new Error("Ring not found in this tournament");

  await db
    .update(moderatorRequests)
    .set({ status: "revoked", sessionToken: null })
    .where(
      and(
        eq(moderatorRequests.ringId, ringId),
        eq(moderatorRequests.status, "approved")
      )
    );

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

export async function requestModeratorAccess(
  accessCode: string,
  moderatorName?: string,
  deviceInfo?: any,
  turnstileToken?: string
) {
  if (!moderatorName || !moderatorName.trim()) {
    return { success: false, error: "Please enter your name." };
  }
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

  // Try to get IP
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

  const cleanCode = (accessCode || "").trim().replace(/[\s\-_]/g, "").toUpperCase();

  // 1. Find the ring by access code
  let [ring] = await db
    .select({
      id: rings.id,
      name: rings.name,
      tournamentId: rings.tournamentId,
      accessCode: rings.accessCode,
    })
    .from(rings)
    .where(eq(rings.accessCode, cleanCode))
    .limit(1);

  // Fallback: match normalized code
  if (!ring) {
    const normInput = normalizeAccessCode(cleanCode);
    const candidateRings = await db
      .select({
        id: rings.id,
        name: rings.name,
        tournamentId: rings.tournamentId,
        accessCode: rings.accessCode,
      })
      .from(rings);

    ring =
      candidateRings.find(
        (r) => r.accessCode && normalizeAccessCode(r.accessCode) === normInput
      ) || undefined as any;
  }

  if (!ring) {
    return { success: false, error: "Invalid access code." };
  }

  // 2. Create moderator_requests entry
  const [request] = await db
    .insert(moderatorRequests)
    .values({
      ringId: ring.id,
      accessCodeUsed: ring.accessCode || cleanCode,
      status: "pending",
      moderatorName: moderatorName.trim(),
      deviceInfo: finalDeviceInfo,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
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

export async function checkModeratorStatus(requestId: string) {
  const [request] = await db
    .select({
      id: moderatorRequests.id,
      status: moderatorRequests.status,
      sessionToken: moderatorRequests.sessionToken,
      ringId: moderatorRequests.ringId,
      expiresAt: moderatorRequests.expiresAt,
    })
    .from(moderatorRequests)
    .where(eq(moderatorRequests.id, requestId))
    .limit(1);

  if (!request) return { status: "not_found" };

  if (request.expiresAt && new Date(request.expiresAt).getTime() < Date.now()) {
    return { status: "expired" };
  }

  if (request.status === "approved" && request.sessionToken) {
    const cookieStore = await cookies();
    cookieStore.set("mod_token", request.sessionToken, {
      path: "/",
      maxAge: 86400, // 24 hours
      sameSite: "lax",
      secure: await secureCookieFlag(),
    });
  }

  return {
    status: request.status,
    ringId: request.ringId,
    sessionToken: request.sessionToken,
  };
}

export async function validateModeratorSession(ringId: string, token: string) {
  if (!ringId || !isValidUuid(ringId) || !token || !isValidUuid(token)) return false;
  const [latestRequest] = await db
    .select({
      id: moderatorRequests.id,
      sessionToken: moderatorRequests.sessionToken,
      status: moderatorRequests.status,
      moderatorName: moderatorRequests.moderatorName,
      expiresAt: moderatorRequests.expiresAt,
    })
    .from(moderatorRequests)
    .where(
      and(
        eq(moderatorRequests.ringId, ringId),
        eq(moderatorRequests.status, "approved")
      )
    )
    .orderBy(desc(moderatorRequests.createdAt))
    .limit(1);

  if (!latestRequest) return false;

  if (latestRequest.expiresAt && new Date(latestRequest.expiresAt).getTime() < Date.now()) {
    return false;
  }

  if (latestRequest.sessionToken === token || latestRequest.id === token) {
    return latestRequest;
  }
  return false;
}

export async function startCategory(assignmentId: string, ringId: string) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.id, assignmentId))
    .limit(1);

  if (!assignment || assignment.ringId !== ringId) {
    throw new Error("Assignment not found on this ring");
  }

  const [ring] = await db
    .select({ tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  await db
    .update(categoryAssignments)
    .set({
      status: "running",
    })
    .where(eq(categoryAssignments.id, assignmentId));

  if (ring?.tournamentId) {
    try {
      await db.insert(eventLog).values({
        tournamentId: ring.tournamentId,
        ringId,
        categoryId: assignment.categoryId,
        action: "START_CATEGORY",
      });
    } catch {}
  }

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: assignmentId,
    ringId,
    tournamentId: ring?.tournamentId,
    status: "running",
  });

  revalidatePath(`/moderator/ring/${ringId}/current`);
  revalidatePath(`/moderator/ring/${ringId}/queue`);
}

// In-memory sliding window rate limiter for adjustMatchCount
const recentAdjustmentsMap = new Map<string, number[]>();

export async function adjustMatchCount(assignmentId: string, ringId: string, delta: number) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  // Server-side spam protection: reject if 3 or more rapid adjustments within 2.5s for this ring
  const now = Date.now();
  const windowMs = 2500;
  const history = (recentAdjustmentsMap.get(ringId) || []).filter((t) => now - t < windowMs);

  if (history.length >= 2) {
    recentAdjustmentsMap.set(ringId, []);
    throw new Error("Too many rapid attempts detected. Action rejected.");
  }

  history.push(now);
  recentAdjustmentsMap.set(ringId, history);

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.id, assignmentId))
    .limit(1);

  if (!assignment || assignment.ringId !== ringId) {
    throw new Error("Assignment not found on this ring");
  }

  if (assignment.status === "paused") {
    throw new Error("Cannot adjust match count while the ring/category is paused.");
  }

  const [cat] = await db
    .select({ expectedMatches: categories.expectedMatches })
    .from(categories)
    .where(eq(categories.id, assignment.categoryId))
    .limit(1);

  const maxMatches = cat?.expectedMatches ?? Infinity;
  const newCount = Math.min(maxMatches, Math.max(0, (assignment.matchesCompleted || 0) + delta));

  await db
    .update(categoryAssignments)
    .set({ matchesCompleted: newCount })
    .where(eq(categoryAssignments.id, assignmentId));

  const [ring] = await db
    .select({ tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  if (ring?.tournamentId) {
    try {
      await db.insert(eventLog).values({
        tournamentId: ring.tournamentId,
        ringId,
        categoryId: assignment.categoryId,
        action: delta > 0 ? "MATCH_COMPLETED_INCREMENT" : "MATCH_COMPLETED_DECREMENT",
        metadata: { delta },
      });
    } catch {}
  }

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: assignmentId,
    ringId,
    tournamentId: ring?.tournamentId,
    data: { matches_completed: newCount },
  });

  return { success: true, matches_completed: newCount };
}

export async function finishCategory(assignmentId: string, ringId: string) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.id, assignmentId))
    .limit(1);

  if (!assignment || assignment.ringId !== ringId) {
    throw new Error("Assignment not found on this ring");
  }

  const [ring] = await db
    .select({ tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  await db
    .update(categoryAssignments)
    .set({
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(categoryAssignments.id, assignmentId));

  await db
    .update(rings)
    .set({ currentMatchId: null })
    .where(eq(rings.id, ringId));

  if (ring?.tournamentId) {
    try {
      await db.insert(eventLog).values({
        tournamentId: ring.tournamentId,
        ringId,
        categoryId: assignment.categoryId,
        action: "FINISH_CATEGORY",
      });
    } catch {}
  }

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: assignmentId,
    ringId,
    tournamentId: ring?.tournamentId,
    status: "completed",
  });

  revalidatePath(`/moderator/ring/${ringId}/current`);
  revalidatePath(`/moderator/ring/${ringId}/queue`);
}

export async function setRingStatus(assignmentId: string, ringId: string, isPaused: boolean) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.id, assignmentId))
    .limit(1);

  if (!assignment || assignment.ringId !== ringId) {
    throw new Error("Assignment not found on this ring");
  }

  const [ring] = await db
    .select({ tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  await db
    .update(categoryAssignments)
    .set({
      status: isPaused ? "paused" : "running",
    })
    .where(eq(categoryAssignments.id, assignmentId));

  if (ring?.tournamentId) {
    try {
      await db.insert(eventLog).values({
        tournamentId: ring.tournamentId,
        ringId,
        categoryId: assignment.categoryId,
        action: isPaused ? "PAUSE_RING" : "RESUME_RING",
      });
    } catch {}
  }

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: assignmentId,
    ringId,
    tournamentId: ring?.tournamentId,
    status: isPaused ? "paused" : "running",
  });

  revalidatePath(`/moderator/ring/${ringId}/current`);
  revalidatePath(`/moderator/ring/${ringId}/queue`);
}

export async function pauseCurrentRingAssignment(ringId: string) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(and(eq(categoryAssignments.ringId, ringId), eq(categoryAssignments.status, "running")))
    .limit(1);

  if (assignment) {
    await setRingStatus(assignment.id, ringId, true);
  }
}

export async function logRingEvent(
  ringId: string,
  actionName: "EMERGENCY_ALERT" | "PAUSE_RING" | "REQUEST_ASSISTANCE",
  metadata?: any
) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  const [ring] = await db
    .select({ tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  if (!ring) return;

  await db.insert(eventLog).values({
    tournamentId: ring.tournamentId,
    ringId: ringId,
    action: actionName,
    metadata: metadata || null,
  });

  broadcastLiveEvent({
    table: "event_log",
    op: "INSERT",
    tournamentId: ring.tournamentId,
    ringId,
    data: { action: actionName, metadata },
  });
}

export async function returnCategoryToQueue(assignmentId: string, ringId: string) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  const [assignment] = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.id, assignmentId))
    .limit(1);

  if (!assignment || assignment.ringId !== ringId) throw new Error("Assignment not found on this ring");

  const [ring] = await db
    .select({ tournamentId: rings.tournamentId })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  await db
    .update(categoryAssignments)
    .set({
      status: "pending",
      completedAt: null,
    })
    .where(eq(categoryAssignments.id, assignmentId));

  await db
    .update(rings)
    .set({ currentMatchId: null })
    .where(eq(rings.id, ringId));

  if (ring?.tournamentId) {
    await db.insert(eventLog).values({
      tournamentId: ring.tournamentId,
      ringId: ringId,
      categoryId: assignment.categoryId,
      action: "RETURNED_TO_QUEUE",
    });
  }

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    id: assignmentId,
    ringId,
    tournamentId: ring?.tournamentId,
    status: "pending",
  });
}

export async function reorderCategory(assignmentId: string, ringId: string, direction: "up" | "down") {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken || !(await validateModeratorSession(ringId, modToken))) {
    throw new Error("Unauthorized: Session is not the active moderator.");
  }

  const assignments = await db
    .select()
    .from(categoryAssignments)
    .where(and(eq(categoryAssignments.ringId, ringId), eq(categoryAssignments.status, "pending")))
    .orderBy(asc(categoryAssignments.queueOrder));

  if (!assignments || assignments.length === 0) return;

  const currentIndex = assignments.findIndex((a) => a.id === assignmentId);
  if (currentIndex === -1) return;

  if (direction === "up" && currentIndex > 0) {
    const prev = assignments[currentIndex - 1];
    const curr = assignments[currentIndex];

    await db.update(categoryAssignments).set({ queueOrder: curr.queueOrder }).where(eq(categoryAssignments.id, prev.id));
    await db.update(categoryAssignments).set({ queueOrder: prev.queueOrder }).where(eq(categoryAssignments.id, curr.id));
  } else if (direction === "down" && currentIndex < assignments.length - 1) {
    const next = assignments[currentIndex + 1];
    const curr = assignments[currentIndex];

    await db.update(categoryAssignments).set({ queueOrder: curr.queueOrder }).where(eq(categoryAssignments.id, next.id));
    await db.update(categoryAssignments).set({ queueOrder: next.queueOrder }).where(eq(categoryAssignments.id, curr.id));
  }

  broadcastLiveEvent({
    table: "category_assignments",
    op: "UPDATE",
    ringId,
  });
}

export async function logoutModerator() {
  const cookieStore = await cookies();
  cookieStore.delete("mod_token");
}

export async function updateModeratorName(requestId: string, newName: string) {
  const cookieStore = await cookies();
  const modToken = cookieStore.get("mod_token")?.value;
  if (!modToken) {
    throw new Error("Unauthorized: Active moderator session required.");
  }

  await db
    .update(moderatorRequests)
    .set({ moderatorName: newName.trim() })
    .where(
      and(
        eq(moderatorRequests.id, requestId),
        eq(moderatorRequests.sessionToken, modToken)
      )
    );
}

export async function getModeratorRingAssignments(ringId: string) {
  const rawAssignments = await db
    .select()
    .from(categoryAssignments)
    .where(eq(categoryAssignments.ringId, ringId))
    .orderBy(asc(categoryAssignments.queueOrder));

  const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId).filter(Boolean)));
  const catMap = new Map<string, any>();
  if (categoryIds.length > 0) {
    const cats = await db.select().from(categories).where(inArray(categories.id, categoryIds));
    cats.forEach((c) => catMap.set(c.id, c));
  }

  return rawAssignments.map((a) => serializeCategoryAssignment(a, catMap.get(a.categoryId)));
}
