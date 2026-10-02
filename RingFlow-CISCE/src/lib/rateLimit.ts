import { headers } from "next/headers";

/**
 * Failed-attempt limiter for anything that takes a guessable secret: admin
 * passwords, 6-character access codes, 4-digit judge PINs.
 *
 * Only failures count: `isBlocked` is checked first, `recordFailure` is called
 * when the secret was wrong. A busy venue desk that logs in correctly all day
 * is never throttled.
 *
 * In memory, per server process. RingFlow runs as one Node process (venue
 * laptop or a single hosted container); a multi-instance deployment would need
 * a shared store.
 */

type Bucket = { count: number; resetAt: number };
type Limit = { key: string; limit: number; windowMs: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

// Without a proxy every venue device shares the "direct" bucket, so that
// bucket gets a much larger allowance; the per-email / per-tatami keys still
// bound guessing on any single target.
function effectiveLimit(l: Limit) {
  return l.key.endsWith(":direct") ? l.limit * 10 : l.limit;
}

/** True when any of these keys has used up its failures for the window. */
export function isBlocked(limits: Limit[]): boolean {
  const now = Date.now();
  sweep(now);
  return limits.some((l) => {
    const b = buckets.get(l.key);
    return Boolean(b && b.resetAt > now && b.count >= effectiveLimit(l));
  });
}

/** Count one failed attempt against every key. */
export function recordFailure(limits: Limit[]): void {
  const now = Date.now();
  for (const l of limits) {
    const b = buckets.get(l.key);
    if (!b || b.resetAt <= now) buckets.set(l.key, { count: 1, resetAt: now + l.windowMs });
    else b.count += 1;
  }
}

/**
 * Best-effort client address. Next fills X-Forwarded-For with the socket
 * address only when the request has none, so on a direct (LAN) install a client
 * can send its own and pick its bucket: per-address limits are a convenience
 * there, and every secret also has a per-target or global cap. Behind a reverse
 * proxy set TRUST_PROXY=true: the proxy appends the real address, so the last
 * entry is the one to trust.
 */
export async function clientAddress(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
      const pick = process.env.TRUST_PROXY === "true" ? hops[hops.length - 1] : hops[0];
      if (pick) return pick.slice(0, 64);
    }
    return (h.get("x-real-ip") || "direct").slice(0, 64);
  } catch {
    return "direct";
  }
}

export const RATE_LIMITS = {
  /** Failed admin passwords per address (all emails) and per email. */
  adminLoginPerAddress: { limit: 20, windowMs: 10 * 60_000 },
  adminLoginPerEmail: { limit: 8, windowMs: 10 * 60_000 },
  /** Wrong access codes (moderator / stager / organiser) per address. */
  accessCodePerAddress: { limit: 15, windowMs: 10 * 60_000 },
  /**
   * Wrong access codes per role, all addresses together: the cap that holds
   * even when addresses are forged. A guess that hits still needs an admin's
   * approval; at this rate a 6-digit code space stays out of reach.
   */
  accessCodeGlobal: { limit: 200, windowMs: 10 * 60_000 },
  /** Wrong judge PINs per tatami (all devices) and per address. */
  judgePinPerRing: { limit: 30, windowMs: 10 * 60_000 },
  judgePinPerAddress: { limit: 10, windowMs: 10 * 60_000 },
} as const;

export const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes and try again.";
