import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, isEmbeddablePath } from "./securityHeaders";

afterEach(() => vi.unstubAllEnvs());

describe("security headers", () => {
  it("only lets the scoreboard and public pages be framed", () => {
    expect(isEmbeddablePath("/scoreboard/abc")).toBe(true);
    expect(isEmbeddablePath("/public/event/abc")).toBe(true);
    expect(isEmbeddablePath("/admin")).toBe(false);
    expect(isEmbeddablePath("/scoreboards")).toBe(false);
    expect(contentSecurityPolicy("/admin")).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy("/scoreboard/x")).toContain("frame-ancestors 'self'");
  });

  it("uses FRAME_ANCESTORS for embeddable pages", () => {
    vi.stubEnv("FRAME_ANCESTORS", "'self' https://obs.example.org");
    expect(contentSecurityPolicy("/scoreboard/x")).toContain("frame-ancestors 'self' https://obs.example.org");
    expect(contentSecurityPolicy("/moderator/ring/x")).toContain("frame-ancestors 'none'");
  });

  it("allows nothing external offline", () => {
    vi.stubEnv("OFFLINE_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_OFFLINE_MODE", "true");
    expect(contentSecurityPolicy("/login/mod")).not.toMatch(/cloudflare|cdnjs/);
  });

  it("allows Turnstile and the PDF viewer CDN online", () => {
    vi.stubEnv("OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_OFFLINE_MODE", "false");
    const csp = contentSecurityPolicy("/login/mod");
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("https://cdnjs.cloudflare.com");
    expect(csp).toContain("object-src 'none'");
  });
});
