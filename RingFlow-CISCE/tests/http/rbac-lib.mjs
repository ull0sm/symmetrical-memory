// Minimal client for calling Next.js server actions over HTTP, like a browser (or an attacker) would.
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.BASE || "http://127.0.0.1:3100";
export const APP = process.env.APP_DIR;

export function loadActions() {
  const file = path.join(APP, ".next/dev/server/server-reference-manifest.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = {};
  for (const [id, entry] of Object.entries(m.node || {})) {
    // Prefer a page that middleware never redirects for a cookie-less browser.
    const pages = Object.keys(entry.workers);
    const open = ["waiting", "login", "public", "judge", "scoreboard"];
    const page = pages.find((p) => open.some((o) => p.includes(o))) || pages[0];
    out[`${entry.filename}#${entry.exportedName}`] = { id, page };
    out[entry.exportedName] = out[entry.exportedName] || { id, page };
  }
  return out;
}

export class Jar {
  constructor() { this.c = new Map(); }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res) {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of list) {
      const [pair, ...attrs] = raw.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=Thu, 01 Jan 1970/i.test(a));
      if (!v || expired) this.c.delete(k); else this.c.set(k, v);
      this.flags = this.flags || {};
      this.flags[k] = attrs.map((a) => a.trim().toLowerCase());
    }
  }
}

/** Call a server action. Returns { status, ok, value, error, raw }. */
export async function call(actions, name, args, jar = new Jar(), via) {
  const a = actions[name];
  if (!a) return { status: 0, ok: false, error: `ACTION_NOT_COMPILED:${name}` };
  // Post to the action's own page (cookies set by the action only stick there).
  // Attack tests pass via="/" so middleware never short-circuits the call.
  const pagePath = via || "/" + a.page.replace(/^app\//, "").replace(/\/page$/, "").replace(/\[[^\]]+\]/g, "x").replace(/^page$/, "");
  const res = await fetch(BASE + pagePath, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Next-Action": a.id,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
      Origin: BASE,
      Host: new URL(BASE).host,
      Cookie: jar.header(),
    },
    body: JSON.stringify(args),
  });
  jar.absorb(res);
  const raw = await res.text();
  // RSC payload lines look like `1:{...}`; the action's return value is on line 1.
  let value;
  for (const line of raw.split("\n")) {
    const m = line.match(/^1:(.*)$/);
    if (m) {
      if (m[1].startsWith("E{")) { value = undefined; break; }
      try { value = JSON.parse(m[1]); } catch { value = m[1]; }
    }
  }
  // A thrown error (e.g. an AuthError) produces no return value line.
  const errored = res.status >= 400 || value === undefined;
  return { status: res.status, ok: !errored, value, raw };
}

export const results = [];
export function check(label, cond, detail = "") {
  results.push({ label, pass: Boolean(cond), detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}
