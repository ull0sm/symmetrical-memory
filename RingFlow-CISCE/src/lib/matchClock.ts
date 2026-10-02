/**
 * The single match-clock model for RingFlow.
 *
 * The moderator pad and the TV scoreboard must never disagree, so neither of
 * them owns a clock of its own. Both read the same persisted state and run the
 * same math from this file.
 *
 * Persisted on `rings`:
 *   timer_status          idle | running | paused | finished
 *   timer_duration_ms     the configured bout length
 *   timer_accumulated_ms  elapsed ms BEFORE the current run segment
 *   timer_started_at      real UTC instant the CURRENT run segment began
 *
 * remaining = duration - accumulated - (serverNow - startedAt)   [when running]
 * remaining = duration - accumulated                             [otherwise]
 */

export type ClockStatus = "idle" | "running" | "paused" | "finished";

export interface RingClock {
  status: ClockStatus;
  durationMs: number;
  accumulatedMs: number;
  startedAtMs: number | null;
}

export const DEFAULT_DURATION_MS = 3 * 60 * 1000;
export const LOW_TIME_MS = 15_000;
/**
 * Repaint cadence for the millisecond digits. Two screens showing this clock
 * can differ by up to one tick each, so this is halved from a 30fps value to
 * keep the worst-case difference between the desk and the arena screen small.
 */
export const MATCH_CLOCK_TICK_MS = 16;
/** How many server clock samples feed the rolling-median offset estimate. */
export const CLOCK_OFFSET_SAMPLES = 12;

const VALID_STATUSES: ClockStatus[] = ["idle", "running", "paused", "finished"];

function toMillis(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Turn a persisted ring row into the canonical clock shape. Accepts both the
 * Drizzle/camelCase shape and the raw snake_case row that live feed
 * delivers, so every caller normalizes through this one function.
 */
export interface ClockRowInput {
  timerStatus?: string | null;
  timerDurationMs?: number | null;
  timerAccumulatedMs?: number | null;
  timerStartedAt?: Date | string | number | null;
  matchDurationSeconds?: number | null;
  timer_status?: string | null;
  timer_duration_ms?: number | null;
  timer_accumulated_ms?: number | null;
  timer_started_at?: Date | string | number | null;
  timer_accumulated_seconds?: number | null;
  match_duration_seconds?: number | null;
}

export function normalizeClock(row: ClockRowInput | RingClock | null | undefined): RingClock {
  // Already a RingClock (callers legitimately pass either shape) — normalize
  // it in place rather than mistaking it for a row with no timer fields.
  const maybeClock = row as unknown as Partial<RingClock> | null | undefined;
  if (maybeClock && typeof maybeClock.status === "string" && typeof maybeClock.durationMs === "number") {
    const status = VALID_STATUSES.includes(maybeClock.status as ClockStatus)
      ? (maybeClock.status as ClockStatus)
      : "idle";
    const durationMs = maybeClock.durationMs > 0 ? maybeClock.durationMs : DEFAULT_DURATION_MS;
    const accumulatedMs = Math.max(0, maybeClock.accumulatedMs ?? 0);

    return {
      status,
      durationMs,
      accumulatedMs: Math.min(accumulatedMs, durationMs),
      startedAtMs: status === "running" ? (maybeClock.startedAtMs ?? null) : null,
    };
  }

  const source = row as ClockRowInput | null | undefined;
  const durationFromMs = firstPositive(source?.timerDurationMs, source?.timer_duration_ms);
  const durationFromSeconds = firstPositive(source?.matchDurationSeconds, source?.match_duration_seconds);
  const durationMs =
    durationFromMs ?? (durationFromSeconds ? durationFromSeconds * 1000 : DEFAULT_DURATION_MS);

  const rawStatus = (source?.timerStatus ?? source?.timer_status ?? "idle") as ClockStatus;
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "idle";

  const accumulatedMs =
    firstNonNegative(source?.timerAccumulatedMs, source?.timer_accumulated_ms) ?? 0;

  const startedAtMs = toMillis(source?.timerStartedAt ?? source?.timer_started_at);

  return {
    status,
    durationMs,
    accumulatedMs: Math.min(accumulatedMs, durationMs),
    startedAtMs: status === "running" ? startedAtMs : null,
  };
}

function firstPositive(...values: (number | null | undefined)[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function firstNonNegative(...values: (number | null | undefined)[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

/** Elapsed milliseconds at a given (server-corrected) instant. */
export function elapsedMs(clock: RingClock, nowMs: number): number {
  let elapsed = clock.accumulatedMs;
  if (clock.status === "running" && clock.startedAtMs !== null) {
    elapsed += Math.max(0, nowMs - clock.startedAtMs);
  }
  if (clock.status === "finished") return clock.durationMs;
  return Math.min(Math.max(0, elapsed), clock.durationMs);
}

/** Remaining milliseconds at a given (server-corrected) instant. */
export function remainingMs(clock: RingClock, nowMs: number): number {
  return Math.max(0, clock.durationMs - elapsedMs(clock, nowMs));
}

/** Milliseconds the local device clock is ahead of the server (half-RTT corrected). */
export function clockOffsetMs(serverNowMs: number, sentAtMs: number, receivedAtMs: number): number {
  const midpoint = sentAtMs + (receivedAtMs - sentAtMs) / 2;
  return serverNowMs - midpoint;
}

/**
 * Offset for a server-action response. The server stamps `serverNow` at the very
 * end of the handler, so almost all of the round trip is already behind it and
 * only the response transfer remains — far smaller than the server's own
 * processing time, which a midpoint estimate would wrongly attribute to the
 * network.
 */
export function clockOffsetFromResponse(serverNowMs: number, receivedAtMs: number): number {
  return serverNowMs - receivedAtMs;
}

/** Median of the collected offset samples — resistant to a single slow response. */
export function medianOffset(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function formatClockParts(ms: number): {
  minutes: string;
  seconds: string;
  millis: string;
} {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  return {
    minutes: String(Math.floor(totalSeconds / 60)).padStart(2, "0"),
    seconds: String(totalSeconds % 60).padStart(2, "0"),
    millis: String(safe % 1000).padStart(3, "0"),
  };
}

export function isLowTime(clock: RingClock, remaining: number): boolean {
  return clock.status === "running" && remaining > 0 && remaining <= LOW_TIME_MS;
}

export function isExpired(clock: RingClock, remaining: number): boolean {
  return clock.status === "finished" || remaining <= 0;
}

/** Remaining time a moderator means when they ask for a fresh bout. */
export function freshClock(durationMs: number): RingClock {
  return { status: "idle", durationMs, accumulatedMs: 0, startedAtMs: null };
}
