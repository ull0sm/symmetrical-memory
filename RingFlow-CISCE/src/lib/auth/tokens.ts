import { createHash, randomBytes } from "node:crypto";

/**
 * Session tokens. The browser keeps the token in an httpOnly cookie; the
 * database stores only its sha256, so a database dump cannot be replayed as
 * a login.
 */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check before touching the database. UUIDs are sessions issued before hashing existed. */
export function looksLikeToken(value: string | undefined | null): value is string {
  return typeof value === "string" && (TOKEN_RE.test(value) || UUID_RE.test(value));
}
