import { headers } from "next/headers";

/**
 * Fixed-window attempt limiter for anything that takes a guessable secret:
 * admin passwords, 6-character access codes, 4-digit judge PINs.
 *
 * In memory, per server process. RingFlow runs as one Node process (venue
 * laptop or a single hosted container); a multi-instance deployment would need
 * a shared store (see docs/PLAN.md, Phase 5).
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

/** Records one attempt; returns false once `limit` attempts happened inside `windowMs`. */
export function takeAttempt(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** Best-effort client address. Behind a proxy this is the forwarded address. */
export async function clientAddress(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64);
    return (h.get("x-real-ip") || "direct").slice(0, 64);
  } catch {
    return "direct";
  }
}

export const RATE_LIMITS = {
  /** Admin password attempts per address (all emails) and per email. */
  adminLoginPerAddress: { limit: 20, windowMs: 10 * 60_000 },
  adminLoginPerEmail: { limit: 8, windowMs: 10 * 60_000 },
  /** Access-code requests (moderator / stager / organiser) per address. */
  accessCodePerAddress: { limit: 15, windowMs: 10 * 60_000 },
  /** Judge PIN attempts per tatami (all devices) and per address. */
  judgePinPerRing: { limit: 30, windowMs: 10 * 60_000 },
  judgePinPerAddress: { limit: 10, windowMs: 10 * 60_000 },
} as const;

export const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes and try again.";

/** Convenience: check several limits at once (all are charged). */
export async function allowAttempt(
  checks: Array<{ key: string; limit: number; windowMs: number }>
): Promise<boolean> {
  let ok = true;
  for (const c of checks) {
    // Without a proxy every venue device shares the "direct" bucket, so that
    // bucket gets a much larger allowance; the per-email / per-tatami keys
    // still bound guessing on any single target.
    const limit = c.key.endsWith(":direct") ? c.limit * 10 : c.limit;
    if (!takeAttempt(c.key, limit, c.windowMs)) ok = false;
  }
  return ok;
}
