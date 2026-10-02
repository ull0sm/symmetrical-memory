import type { NextRequest, NextResponse } from "next/server";
import { frameAncestors } from "@/lib/env";
import { isOfflineMode } from "@/lib/offline";

/**
 * Response security headers, set per request in src/proxy.ts so that
 * runtime settings (FRAME_ANCESTORS, OFFLINE_MODE) apply to a standalone build.
 *
 * - CSP: same-origin by default. Online deployments also allow Cloudflare
 *   Turnstile and the cdnjs PDF viewer; an offline venue allows nothing external.
 * - Framing: only the scoreboard and the public event page may be embedded
 *   (OBS / venue screens), by the origins in FRAME_ANCESTORS (default: same
 *   origin). Everything else refuses to be framed.
 * - HSTS only on HTTPS, so a LAN install over plain HTTP keeps working.
 */

const EMBEDDABLE = [/^\/scoreboard(\/|$)/, /^\/public(\/|$)/];

export function isEmbeddablePath(pathname: string): boolean {
  return EMBEDDABLE.some((re) => re.test(pathname));
}

export function isHttps(request: NextRequest): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return request.nextUrl.protocol === "https:";
}

export function contentSecurityPolicy(pathname: string): string {
  const dev = process.env.NODE_ENV === "development";
  const online = !isOfflineMode();
  const turnstile = online ? " https://challenges.cloudflare.com" : "";
  const cdn = online ? " https://cdnjs.cloudflare.com" : "";
  const ancestors = isEmbeddablePath(pathname) ? frameAncestors() : "'none'";

  return [
    "default-src 'self'",
    // Next.js inlines its bootstrap scripts; dev mode also needs eval for fast refresh.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${turnstile}${cdn}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}${cdn}`,
    `worker-src 'self' blob:${cdn}`,
    `frame-src 'self' blob:${turnstile}`,
    `frame-ancestors ${ancestors}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function withSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const h = response.headers;
  h.set("Content-Security-Policy", contentSecurityPolicy(pathname));
  if (!isEmbeddablePath(pathname)) h.set("X-Frame-Options", "DENY");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  if (isHttps(request)) h.set("Strict-Transport-Security", "max-age=15552000");
  return response;
}
