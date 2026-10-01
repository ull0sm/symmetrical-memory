import { cookies, headers } from "next/headers";

/** Every session cookie RingFlow issues. One name per role, nothing else is trusted. */
export const SESSION_COOKIES = {
  admin: "admin_session",
  organiser: "org_token",
  stager: "stager_token",
  moderator: "mod_token",
  judge: "judge_token",
} as const;

export type SessionCookieRole = keyof typeof SESSION_COOKIES;

/** Cookies retired by the security rework; deleted on logout / login so old browsers stop sending them. */
export const LEGACY_COOKIES = ["admin_dev_id", "org_name", "stager_name"] as const;

/**
 * A `Secure` cookie is dropped by the browser over plain HTTP, which breaks LAN
 * deployments (venue laptops talking to a local server). Decide from the actual
 * request protocol instead of NODE_ENV.
 */
export async function isHttpsRequest(): Promise<boolean> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto");
    if (proto) return proto.split(",")[0].trim() === "https";
    const origin = h.get("origin") || h.get("referer") || "";
    return origin.startsWith("https://");
  } catch {
    return false;
  }
}

export async function setSessionCookie(name: string, value: string, maxAgeSeconds: number) {
  const store = await cookies();
  store.set(name, value, {
    path: "/",
    maxAge: maxAgeSeconds,
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttpsRequest(),
  });
}

export async function clearCookies(...names: string[]) {
  try {
    const store = await cookies();
    for (const name of names) store.delete(name);
  } catch {
    // Called from a Server Component render, where cookies are read-only.
  }
}
