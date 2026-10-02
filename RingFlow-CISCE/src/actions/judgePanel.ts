"use server";

import { randomBytes, randomInt } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { judgeSessions, rings, tournaments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { describePrincipal, requireRingOperator, tournamentIdForRing } from "@/lib/auth";
import { JUDGE_PANEL_SEATS, JUDGE_SESSION_TTL_MS } from "@/lib/constants";
import { appUrl } from "@/lib/env";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { isValidUuid } from "@/lib/utils";

/**
 * The moderator desk's judge panel (docs/roles/judge.md): QR and PIN, the
 * phones waiting for a seat, approve / reject / kick, end the panel, rotate.
 * The tatami's moderator runs it; the event's admin may step in.
 */

function broadcastSession(id: string, ringId: string, status: string) {
  broadcastLiveEvent({ table: "judge_sessions", op: "UPDATE", id, ringId, status });
}

async function loadSession(sessionId: string) {
  if (!isValidUuid(sessionId)) return null;
  const [row] = await db.select().from(judgeSessions).where(eq(judgeSessions.id, sessionId)).limit(1);
  if (!row) return null;
  const operator = await requireRingOperator(row.ringId);
  return { row, operator, tournamentId: await tournamentIdForRing(row.ringId) };
}

/** QR key, PIN and the seats. Only for the people who run this tatami. */
export async function getJudgePanel(ringId: string) {
  await requireRingOperator(ringId);
  const [ring] = await db
    .select({ name: rings.name, pin: rings.judgePin, key: rings.judgePairingKey, tunnelUrl: tournaments.tunnelUrl })
    .from(rings)
    .innerJoin(tournaments, eq(tournaments.id, rings.tournamentId))
    .where(eq(rings.id, ringId))
    .limit(1);
  if (!ring) return { success: false as const, error: "Tatami not found" };

  const now = new Date();
  const rows = await db
    .select({
      id: judgeSessions.id,
      seat: judgeSessions.seat,
      judgeName: judgeSessions.judgeName,
      status: judgeSessions.status,
      tokenHash: judgeSessions.tokenHash,
      expiresAt: judgeSessions.expiresAt,
      createdAt: judgeSessions.createdAt,
    })
    .from(judgeSessions)
    .where(and(eq(judgeSessions.ringId, ringId), inArray(judgeSessions.status, ["pending", "approved"])))
    .orderBy(asc(judgeSessions.seat), asc(judgeSessions.createdAt));

  return {
    success: true as const,
    ringName: ring.name,
    pin: ring.pin,
    pairingKey: ring.key,
    // Where phones reach this server: the event's tunnel URL, else APP_URL; null = the desk's own origin.
    baseUrl: (ring.tunnelUrl?.trim() || appUrl() || null)?.replace(/\/+$/, "") ?? null,
    seats: JUDGE_PANEL_SEATS,
    sessions: rows
      .filter((r) => r.status === "pending" || (r.expiresAt && r.expiresAt > now))
      .map((r) => ({
        id: r.id,
        seat: r.seat,
        judgeName: r.judgeName,
        status: r.status as "pending" | "approved",
        // Approved but the phone has not picked up its session yet.
        connected: r.status === "approved" && Boolean(r.tokenHash),
        createdAt: r.createdAt.toISOString(),
      })),
  };
}

/** Give a waiting phone its seat. Any phone already on that seat is replaced. */
export async function approveJudge(sessionId: string) {
  const loaded = await loadSession(sessionId);
  if (!loaded) return { success: false as const, error: "Request not found" };
  const { row, operator, tournamentId } = loaded;
  if (row.status !== "pending") return { success: false as const, error: "This request is no longer waiting." };

  const now = new Date();
  const actor = describePrincipal(operator);
  let replaced: { id: string; judgeName: string }[] = [];
  try {
    replaced = await db.transaction(async (tx) => {
      const old = await tx
        .update(judgeSessions)
        .set({ status: "ended", endReason: "replaced", endedAt: now })
        .where(
          and(
            eq(judgeSessions.ringId, row.ringId),
            eq(judgeSessions.seat, row.seat),
            eq(judgeSessions.status, "approved"),
            ne(judgeSessions.id, row.id)
          )
        )
        .returning({ id: judgeSessions.id, judgeName: judgeSessions.judgeName });
      await tx
        .update(judgeSessions)
        .set({
          status: "approved",
          approvedBy: `${actor.role}:${actor.name}`,
          approvedAt: now,
          expiresAt: new Date(now.getTime() + JUDGE_SESSION_TTL_MS),
        })
        .where(and(eq(judgeSessions.id, row.id), eq(judgeSessions.status, "pending")));
      return old;
    });
  } catch (err) {
    console.error("approveJudge failed:", err);
    return { success: false as const, error: "Another phone was approved for this seat at the same moment. Try again." };
  }

  await audit({
    tournamentId,
    ringId: row.ringId,
    actor: operator,
    action: "JUDGE_APPROVED",
    targetType: "judge_session",
    targetId: row.id,
    before: replaced.length ? { replaced: replaced.map((r) => r.judgeName) } : null,
    after: { judge: row.judgeName, seat: row.seat },
  });
  for (const r of replaced) broadcastSession(r.id, row.ringId, "ended");
  broadcastSession(row.id, row.ringId, "approved");
  return { success: true as const };
}

export async function rejectJudge(sessionId: string) {
  const loaded = await loadSession(sessionId);
  if (!loaded) return { success: false as const, error: "Request not found" };
  const { row, operator, tournamentId } = loaded;
  if (row.status !== "pending") return { success: false as const, error: "This request is no longer waiting." };

  await db
    .update(judgeSessions)
    .set({ status: "rejected", endedAt: new Date() })
    .where(eq(judgeSessions.id, row.id));
  await audit({
    tournamentId,
    ringId: row.ringId,
    actor: operator,
    action: "JUDGE_REJECTED",
    targetType: "judge_session",
    targetId: row.id,
    after: { judge: row.judgeName, seat: row.seat },
  });
  broadcastSession(row.id, row.ringId, "rejected");
  return { success: true as const };
}

/** Take a seat away from a phone. Its session stops working immediately. */
export async function kickJudge(sessionId: string) {
  const loaded = await loadSession(sessionId);
  if (!loaded) return { success: false as const, error: "Judge not found" };
  const { row, operator, tournamentId } = loaded;
  if (row.status !== "approved") return { success: false as const, error: "This judge is not on the panel." };

  await db
    .update(judgeSessions)
    .set({ status: "ended", endReason: "kicked", endedAt: new Date() })
    .where(eq(judgeSessions.id, row.id));
  await audit({
    tournamentId,
    ringId: row.ringId,
    actor: operator,
    action: "JUDGE_KICKED",
    targetType: "judge_session",
    targetId: row.id,
    before: { judge: row.judgeName, seat: row.seat },
  });
  broadcastSession(row.id, row.ringId, "ended");
  return { success: true as const };
}

/** End every phone on this tatami (end of the kata session, or a judge rotation). */
export async function endJudgePanel(ringId: string) {
  const operator = await requireRingOperator(ringId);
  const ended = await db
    .update(judgeSessions)
    .set({ status: "ended", endReason: "panel_ended", endedAt: new Date() })
    .where(and(eq(judgeSessions.ringId, ringId), inArray(judgeSessions.status, ["pending", "approved"])))
    .returning({ id: judgeSessions.id, judgeName: judgeSessions.judgeName, seat: judgeSessions.seat });

  await audit({
    tournamentId: await tournamentIdForRing(ringId),
    ringId,
    actor: operator,
    action: "JUDGE_PANEL_ENDED",
    targetType: "ring",
    targetId: ringId,
    before: { judges: ended.map((e) => ({ judge: e.judgeName, seat: e.seat })) },
  });
  for (const e of ended) broadcastSession(e.id, ringId, "ended");
  return { success: true as const, ended: ended.length };
}

/**
 * New QR key and PIN. Phones still waiting for approval must pair again;
 * judges already on the panel keep their seats.
 */
export async function rotateJudgePairing(ringId: string) {
  const operator = await requireRingOperator(ringId);
  await db
    .update(rings)
    .set({ judgePin: String(randomInt(1000, 10000)), judgePairingKey: randomBytes(24).toString("base64url") })
    .where(eq(rings.id, ringId));
  const dropped = await db
    .update(judgeSessions)
    .set({ status: "ended", endReason: "rotated", endedAt: new Date() })
    .where(and(eq(judgeSessions.ringId, ringId), eq(judgeSessions.status, "pending")))
    .returning({ id: judgeSessions.id });

  await audit({
    tournamentId: await tournamentIdForRing(ringId),
    ringId,
    actor: operator,
    action: "JUDGE_PIN_CHANGED",
    targetType: "ring",
    targetId: ringId,
    after: { pendingDropped: dropped.length },
  });
  for (const d of dropped) broadcastSession(d.id, ringId, "ended");
  return { success: true as const };
}
