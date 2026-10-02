import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { setSessionCookie } from "./cookies";

/**
 * Binding an access request to the browser that made it.
 *
 * When a moderator, stager or organiser asks for access, their browser gets a
 * random secret in an httpOnly cookie and the request row stores its hash.
 * Once the admin approves, only a browser presenting that secret can collect
 * the session — knowing the request id (it sits in the waiting-room URL) is
 * not enough.
 */

export type ClaimRole = "moderator" | "stager" | "organiser";

const CLAIM_COOKIE: Record<ClaimRole, string> = {
  moderator: "mod_claim",
  stager: "stager_claim",
  organiser: "org_claim",
};

const CLAIM_TTL_SECONDS = 48 * 60 * 60;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Issue a fresh claim secret to this browser; returns the hash to store on the request row. */
export async function issueClaim(role: ClaimRole): Promise<string> {
  const secret = randomBytes(32).toString("base64url");
  await setSessionCookie(CLAIM_COOKIE[role], secret, CLAIM_TTL_SECONDS);
  return sha256(secret);
}

/** True when this browser holds the secret whose hash is stored on the request. */
export async function holdsClaim(role: ClaimRole, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  try {
    const store = await cookies();
    const secret = store.get(CLAIM_COOKIE[role])?.value;
    if (!secret) return false;
    const a = Buffer.from(sha256(secret), "hex");
    const b = Buffer.from(storedHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function claimCookieName(role: ClaimRole): string {
  return CLAIM_COOKIE[role];
}
