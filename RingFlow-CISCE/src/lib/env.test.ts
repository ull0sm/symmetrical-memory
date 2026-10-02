import { describe, expect, it } from "vitest";
import { validateEnv } from "./env";

const DB = "postgres://u:p@db:5432/ringflow";
const problems = (env: NodeJS.ProcessEnv) => {
  try {
    validateEnv(env);
    return "";
  } catch (err) {
    return (err as Error).message;
  }
};

describe("validateEnv", () => {
  it("requires DATABASE_URL and names it", () => {
    expect(problems({})).toMatch(/DATABASE_URL: is required/);
  });

  it("rejects a non-Postgres URL", () => {
    expect(problems({ DATABASE_URL: "mysql://x" })).toMatch(/postgres:\/\//);
  });

  it("accepts a minimal LAN setup", () => {
    expect(problems({ DATABASE_URL: DB, OFFLINE_MODE: "true" })).toBe("");
  });

  it("checks APP_URL is a full http(s) URL", () => {
    expect(problems({ DATABASE_URL: DB, APP_URL: "ringflow.example.org" })).toMatch(/APP_URL/);
    expect(problems({ DATABASE_URL: DB, APP_URL: "https://ringflow.example.org" })).toBe("");
    expect(problems({ DATABASE_URL: DB, APP_URL: "" })).toBe("");
  });

  it("needs both Turnstile keys online, but not offline", () => {
    expect(problems({ DATABASE_URL: DB, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "disabled" })).toMatch(/TURNSTILE_SECRET_KEY/);
    expect(problems({ DATABASE_URL: DB, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", OFFLINE_MODE: "true" })).toBe("");
    expect(problems({ DATABASE_URL: DB, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "disabled", TURNSTILE_SECRET_KEY: "disabled" })).toBe("");
  });

  it("refuses FRAME_ANCESTORS that would inject other CSP directives", () => {
    expect(problems({ DATABASE_URL: DB, FRAME_ANCESTORS: "'self'; script-src *" })).toMatch(/FRAME_ANCESTORS/);
    expect(problems({ DATABASE_URL: DB, FRAME_ANCESTORS: "'self' https://obs.example.org" })).toBe("");
  });

  it("lists every problem at once", () => {
    const msg = problems({ DATABASE_URL: "x", APP_URL: "nope", TRUST_PROXY: "yes" });
    expect(msg).toMatch(/DATABASE_URL/);
    expect(msg).toMatch(/APP_URL/);
    expect(msg).toMatch(/TRUST_PROXY/);
  });
});
