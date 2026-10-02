"use server";

import { db } from "@/db";
import { rings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireRingOperator } from "@/lib/auth/guards";
import { elapsedMs as elapsedFor, normalizeClock, type RingClock } from "@/lib/matchClock";
import {
  persistRingClock,
  readRingClockRow,
  revalidateRingClock,
} from "@/lib/ringClockStore";

export interface ClockResult {
  success: boolean;
  serverNow: number;
  clock?: RingClock;
  sidesSwapped?: boolean;
  error?: string;
}

/**
 * Writing a clock is the tatami's own moderator, or the event's admin as a
 * floor override. Organisers are read-only and never control a clock.
 */
async function authorizeRingControl(ringId: string): Promise<void> {
  await requireRingOperator(ringId);
}

export async function getRingClock(ringId: string): Promise<ClockResult> {
  const ring = await readRingClockRow(ringId);
  if (!ring) return { success: false, serverNow: Date.now(), error: "Ring not found" };
  return {
    success: true,
    serverNow: Date.now(),
    clock: normalizeClock(ring),
    sidesSwapped: ring.sidesSwapped,
  };
}

/**
 * Start (or resume) the clock. `elapsedMsOverride` lets the moderator desk
 * correct the clock to exactly what the official timekeeper reads.
 */
export async function startRingClock(ringId: string, elapsedMsOverride?: number): Promise<ClockResult> {
  await authorizeRingControl(ringId);
  const ring = await readRingClockRow(ringId);
  if (!ring) return { success: false, serverNow: Date.now(), error: "Ring not found" };

  const clock = normalizeClock(ring);
  const elapsed =
    typeof elapsedMsOverride === "number" && Number.isFinite(elapsedMsOverride)
      ? elapsedMsOverride
      : elapsedFor(clock, Date.now());

  const next = await persistRingClock(ringId, {
    status: "running",
    durationMs: clock.durationMs,
    accumulatedMs: elapsed,
    startedAt: new Date(),
  });

  return { success: true, serverNow: Date.now(), clock: next };
}

export async function pauseRingClock(ringId: string, elapsedMsOverride?: number): Promise<ClockResult> {
  await authorizeRingControl(ringId);
  const ring = await readRingClockRow(ringId);
  if (!ring) return { success: false, serverNow: Date.now(), error: "Ring not found" };

  const clock = normalizeClock(ring);
  const elapsed =
    typeof elapsedMsOverride === "number" && Number.isFinite(elapsedMsOverride)
      ? elapsedMsOverride
      : elapsedFor(clock, Date.now());

  const next = await persistRingClock(ringId, {
    status: "paused",
    durationMs: clock.durationMs,
    accumulatedMs: elapsed,
    startedAt: null,
  });

  return { success: true, serverNow: Date.now(), clock: next };
}

export async function resetRingClock(ringId: string, durationMs?: number): Promise<ClockResult> {
  await authorizeRingControl(ringId);
  const ring = await readRingClockRow(ringId);
  if (!ring) return { success: false, serverNow: Date.now(), error: "Ring not found" };

  const clock = normalizeClock(ring);

  const next = await persistRingClock(ringId, {
    status: "idle",
    durationMs:
      durationMs && Number.isFinite(durationMs) && durationMs > 0
        ? Math.min(30 * 60 * 1000, durationMs)
        : clock.durationMs,
    accumulatedMs: 0,
    startedAt: null,
  });

  return { success: true, serverNow: Date.now(), clock: next };
}

export async function setRingClockDuration(ringId: string, durationMs: number): Promise<ClockResult> {
  await authorizeRingControl(ringId);
  const ring = await readRingClockRow(ringId);
  if (!ring) return { success: false, serverNow: Date.now(), error: "Ring not found" };

  if (!Number.isFinite(durationMs)) return { success: false, serverNow: Date.now(), error: "Invalid duration" };
  // 1 second to 30 minutes covers every WKF bout and Bunkai format.
  const duration = Math.min(30 * 60 * 1000, Math.max(1000, Math.round(durationMs)));
  const clock = normalizeClock(ring);

  const next = await persistRingClock(ringId, {
    status: clock.status === "finished" ? "idle" : clock.status,
    durationMs: duration,
    accumulatedMs: clock.status === "finished" ? 0 : Math.min(clock.accumulatedMs, duration),
    startedAt: clock.status === "running" ? new Date() : null,
  });

  return { success: true, serverNow: Date.now(), clock: next };
}

/** Nudge the clock by a signed millisecond delta (the +/- 1s and +/- 100ms keys). */
export async function adjustRingClock(ringId: string, deltaMs: number): Promise<ClockResult> {
  await authorizeRingControl(ringId);
  const ring = await readRingClockRow(ringId);
  if (!ring) return { success: false, serverNow: Date.now(), error: "Ring not found" };

  if (!Number.isFinite(deltaMs)) return { success: false, serverNow: Date.now(), error: "Invalid adjustment" };
  const clock = normalizeClock(ring);
  const elapsed = elapsedFor(clock, Date.now());
  const nextElapsed = Math.max(0, Math.min(elapsed + deltaMs, clock.durationMs));

  const next = await persistRingClock(ringId, {
    status: clock.status === "finished" ? "paused" : clock.status,
    durationMs: clock.durationMs,
    accumulatedMs: nextElapsed,
    startedAt: clock.status === "running" ? new Date() : null,
  });

  return { success: true, serverNow: Date.now(), clock: next };
}

export async function finishRingClock(ringId: string): Promise<ClockResult> {
  await authorizeRingControl(ringId);
  const ring = await readRingClockRow(ringId);
  if (!ring) return { success: false, serverNow: Date.now(), error: "Ring not found" };

  const clock = normalizeClock(ring);

  const next = await persistRingClock(ringId, {
    status: "finished",
    durationMs: clock.durationMs,
    accumulatedMs: clock.durationMs,
    startedAt: null,
  });

  return { success: true, serverNow: Date.now(), clock: next };
}

/**
 * Mirror the arena display: which physical side (red/blue) sits in the TV's
 * left column. Persisted per tatami so the moderator pad and the TV agree.
 */
export async function setRingSidesSwapped(ringId: string, swapped: boolean): Promise<ClockResult> {
  await authorizeRingControl(ringId);

  await db.update(rings).set({ sidesSwapped: Boolean(swapped) }).where(eq(rings.id, ringId));

  revalidateRingClock(ringId);
  return { success: true, serverNow: Date.now(), sidesSwapped: swapped };
}
