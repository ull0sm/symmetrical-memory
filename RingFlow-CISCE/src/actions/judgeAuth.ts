"use server";

import { db } from "@/db";
import { rings, judgeRequests } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { revalidatePath } from "next/cache";

/**
 * Judge phone requests access to a Tatami.
 * Validates PIN first, then creates or updates a pending approval request.
 */
export async function requestJudgeAccess(params: {
  ringId: string;
  deviceToken: string;
  judgeName?: string;
  requestedSeat?: number;
  pin: string;
}) {
  const { ringId, deviceToken, judgeName = "Judge", requestedSeat = 1, pin } = params;

  // 1. Fetch Ring & verify PIN
  const [ring] = await db
    .select({
      id: rings.id,
      name: rings.name,
      judgePin: rings.judgePin,
    })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  if (!ring) {
    return { success: false, error: "Tatami not found" };
  }

  if (ring.judgePin.trim() !== pin.trim()) {
    return { success: false, error: "Invalid Tatami PIN" };
  }

  // 2. Check if this device already has an existing request
  const [existing] = await db
    .select()
    .from(judgeRequests)
    .where(
      and(
        eq(judgeRequests.ringId, ringId),
        eq(judgeRequests.deviceToken, deviceToken)
      )
    )
    .limit(1);

  let record: any;

  if (existing) {
    // If already approved, return approved status
    if (existing.status === "approved") {
      return {
        success: true,
        status: "approved" as const,
        seatNumber: existing.seatNumber,
        judgeName: existing.judgeName,
        ringName: ring.name,
      };
    }

    // Re-request approval
    const [updated] = await db
      .update(judgeRequests)
      .set({
        judgeName: judgeName.trim() || existing.judgeName,
        seatNumber: requestedSeat,
        status: "pending",
        updatedAt: new Date(),
      })
      .where(eq(judgeRequests.id, existing.id))
      .returning();

    record = updated;
  } else {
    // Insert new request
    const [inserted] = await db
      .insert(judgeRequests)
      .values({
        ringId,
        deviceToken,
        judgeName: judgeName.trim() || "Judge",
        seatNumber: requestedSeat,
        status: "pending",
      })
      .returning();

    record = inserted;
  }

  // Broadcast to moderator desk
  broadcastLiveEvent({
    table: "judge_requests",
    op: "INSERT",
    id: record.id,
    ringId,
    status: "pending",
    data: {
      judgeName: record.judgeName,
      seatNumber: record.seatNumber,
    },
  });

  return {
    success: true,
    status: record.status as "pending" | "approved" | "rejected",
    seatNumber: record.seatNumber,
    judgeName: record.judgeName,
    ringName: ring.name,
  };
}

/**
 * Judge phone checks current approval status.
 */
export async function checkJudgeAccessStatus(ringId: string, deviceToken: string) {
  const [ring] = await db
    .select({ name: rings.name })
    .from(rings)
    .where(eq(rings.id, ringId))
    .limit(1);

  const [req] = await db
    .select()
    .from(judgeRequests)
    .where(
      and(
        eq(judgeRequests.ringId, ringId),
        eq(judgeRequests.deviceToken, deviceToken)
      )
    )
    .limit(1);

  if (!req) {
    return { success: true, status: "none" as const, ringName: ring?.name || "Tatami" };
  }

  return {
    success: true,
    status: req.status as "pending" | "approved" | "rejected",
    seatNumber: req.seatNumber,
    judgeName: req.judgeName,
    ringName: ring?.name || "Tatami",
  };
}

/**
 * Moderator gets all pending and active judge devices for their Tatami.
 */
export async function getRingJudgeRequests(ringId: string) {
  return db
    .select()
    .from(judgeRequests)
    .where(eq(judgeRequests.ringId, ringId))
    .orderBy(judgeRequests.seatNumber);
}

/**
 * Moderator approves a judge device and assigns their seat.
 */
export async function approveJudgeRequest(requestId: string, assignedSeat?: number) {
  const [current] = await db
    .select()
    .from(judgeRequests)
    .where(eq(judgeRequests.id, requestId))
    .limit(1);

  if (!current) {
    return { success: false, error: "Request not found" };
  }

  const [updated] = await db
    .update(judgeRequests)
    .set({
      status: "approved",
      seatNumber: assignedSeat ?? current.seatNumber,
      updatedAt: new Date(),
    })
    .where(eq(judgeRequests.id, requestId))
    .returning();

  broadcastLiveEvent({
    table: "judge_requests",
    op: "UPDATE",
    id: requestId,
    ringId: current.ringId,
    status: "approved",
    data: {
      deviceToken: current.deviceToken,
      seatNumber: updated.seatNumber,
    },
  });

  try {
    revalidatePath(`/moderator/ring/${current.ringId}/current`);
    revalidatePath(`/judge/ring/${current.ringId}`);
  } catch {}

  return { success: true, request: updated };
}

/**
 * Moderator rejects a judge request.
 */
export async function rejectJudgeRequest(requestId: string) {
  const [current] = await db
    .select()
    .from(judgeRequests)
    .where(eq(judgeRequests.id, requestId))
    .limit(1);

  if (!current) {
    return { success: false, error: "Request not found" };
  }

  await db
    .update(judgeRequests)
    .set({
      status: "rejected",
      updatedAt: new Date(),
    })
    .where(eq(judgeRequests.id, requestId));

  broadcastLiveEvent({
    table: "judge_requests",
    op: "UPDATE",
    id: requestId,
    ringId: current.ringId,
    status: "rejected",
    data: {
      deviceToken: current.deviceToken,
    },
  });

  return { success: true };
}

/**
 * Moderator kicks / revokes access of an approved judge.
 */
export async function revokeJudgeAccess(requestId: string) {
  return rejectJudgeRequest(requestId);
}
