import { z } from "zod";

/**
 * Server environment, validated once at boot (src/instrumentation.ts) so a bad
 * deployment fails at start-up with a clear message instead of at the first
 * request. See .env.example and docs/DEPLOYMENT.md.
 */

const truthy = (v: string | undefined) => ["true", "1", "yes"].includes(String(v ?? "").trim().toLowerCase());
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const keyIsSet = (v: string | undefined) => Boolean(v && v.trim() && v.trim() !== "disabled");

const schema = z
  .object({
    DATABASE_URL: z
      .string({ message: "is required (e.g. postgres://user:pass@host:5432/ringflow)" })
      .trim()
      .min(1, "is required (e.g. postgres://user:pass@host:5432/ringflow)")
      .refine((v) => /^postgres(ql)?:\/\//.test(v), "must start with postgres:// or postgresql://"),
    OFFLINE_MODE: z.string().optional(),
    APP_URL: z.preprocess(
      blankToUndefined,
      z
        .string()
        .url("must be a full URL such as https://ringflow.example.org")
        .refine((v) => /^https?:\/\//.test(v), "must start with http:// or https://")
        .optional()
    ),
    FRAME_ANCESTORS: z.preprocess(
      blankToUndefined,
      z
        .string()
        .regex(/^[\w\s'.:/*-]+$/, "must be a space-separated list of CSP sources, e.g. 'self' https://obs.example.org")
        .optional()
    ),
    TRUST_PROXY: z.enum(["true", "false"], { message: "must be true or false" }).optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (truthy(env.OFFLINE_MODE)) return;
    const site = keyIsSet(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
    const secret = keyIsSet(env.TURNSTILE_SECRET_KEY);
    if (site !== secret) {
      ctx.addIssue({
        code: "custom",
        path: [site ? "TURNSTILE_SECRET_KEY" : "NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
        message: "Turnstile needs both keys, or both set to \"disabled\"",
      });
    }
  });

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

/** Parse and check the environment. Throws one error listing every problem. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const res = schema.safeParse(source);
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`RingFlow cannot start: the environment is not valid.\n${lines.join("\n")}\nSee .env.example.`);
  }
  cached = res.data;
  return res.data;
}

export function getEnv(): ServerEnv {
  return cached ?? validateEnv();
}

/** The public base URL of this deployment (no trailing slash), or null on a LAN-only install. */
export function appUrl(): string | null {
  const url = getEnv().APP_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

/** CSP frame-ancestors for pages that may be embedded (scoreboard, public event). Default: same origin only. */
export function frameAncestors(): string {
  return process.env.FRAME_ANCESTORS?.trim() || "'self'";
}
