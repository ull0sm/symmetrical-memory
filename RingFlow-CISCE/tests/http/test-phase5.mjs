// Phase 5: split live feeds, security headers, tunnel isolation of the staff feed.
import { createRequire } from "node:module";
import http from "node:http";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const A = loadActions();
const [T1, R1] = process.argv.slice(2);

const admin = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);

/** Open an SSE stream, run `trigger`, and return everything received within `ms`. */
async function listen(path, jar, trigger, ms = 2500, headers = {}) {
  const ctrl = new AbortController();
  const res = await fetch(BASE + path, { headers: { Cookie: jar?.header() ?? "", Accept: "text/event-stream", ...headers }, signal: ctrl.signal });
  if (res.status !== 200 || !res.body) {
    ctrl.abort();
    return { status: res.status, text: "" };
  }
  let text = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    } catch {
      // aborted
    }
  })();
  await new Promise((r) => setTimeout(r, 400));
  await trigger?.();
  await new Promise((r) => setTimeout(r, ms));
  ctrl.abort();
  await done;
  return { status: res.status, text };
}

// ── Staff feed requires a staff session for the scope ──
check("staff feed refuses anonymous", (await listen(`/api/live/staff?tournamentId=${T1}`, new Jar(), null, 100)).status === 401);
check("staff feed refuses an unscoped request", (await listen(`/api/live/staff`, admin, null, 100)).status === 401);
check("staff feed refuses a waiting-room scope", (await listen(`/api/live/staff?requestId=${T1}`, admin, null, 100)).status === 401);
const [other] = await sql`select id from tournaments where id <> ${T1} and admin_id <> (select admin_id from tournaments where id=${T1}) limit 1`;
if (other) check("staff feed refuses another admin's tournament", (await listen(`/api/live/staff?tournamentId=${other.id}`, admin, null, 100)).status === 401);

// event_log rows reach the staff feed only.
const [ring] = await sql`select id from rings where tournament_id=${T1} limit 1`;
const writeLog = () => sql`insert into event_log (tournament_id, ring_id, action, metadata) values (${T1}, ${ring.id}, 'PHASE5_PROBE', '{}'::jsonb)`;
const staff = await listen(`/api/live/staff?tournamentId=${T1}`, admin, writeLog);
check("staff feed opens for the event's admin", staff.status === 200);
check("staff feed carries event_log changes", staff.text.includes('"table":"event_log"'), staff.text.slice(0, 120));
const pub = await listen(`/api/live?tournamentId=${T1}`, admin, writeLog);
check("public feed opens without a session", (await listen(`/api/live?tournamentId=${T1}`, new Jar(), null, 100)).status === 200);
check("public feed never carries event_log, even for staff", pub.status === 200 && !pub.text.includes("event_log"));
const pubRing = await listen(`/api/live?ringId=${ring.id}`, new Jar(), () => sql`update rings set sides_swapped = not sides_swapped where id=${ring.id}`);
check("public feed carries public tables (rings)", pubRing.text.includes('"table":"rings"'));
check("public feed events carry no tokens", !/token|session|pin/i.test(pubRing.text));

// ── Tunnel hosts reach only the public feed ──
// fetch() drops a custom Host header, so tunnel requests go through node:http.
const viaHost = (path, host) =>
  new Promise((resolve) => {
    const u = new URL(BASE + path);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Host: host } }, (res) => {
      resolve(res.statusCode);
      res.destroy();
    });
    req.on("error", () => resolve(0));
    req.end();
  });
const TUNNEL = "judge-test.trycloudflare.com";
check("tunnel host blocks the staff feed", (await viaHost(`/api/live/staff?tournamentId=${T1}`, TUNNEL)) === 403);
check("tunnel host blocks admin pages", (await viaHost("/admin", TUNNEL)) === 403);
check("tunnel host allows the public feed", (await viaHost(`/api/live?ringId=${ring.id}`, TUNNEL)) === 200);
check("tunnel host allows the judge page", (await viaHost(`/judge/ring/${ring.id}`, TUNNEL)) === 200);

// ── Security headers ──
const page = await fetch(`${BASE}/login/admin`, { redirect: "manual" });
const csp = page.headers.get("content-security-policy") || "";
check("CSP is set", csp.includes("default-src 'self'") && csp.includes("object-src 'none'"));
check("ordinary pages cannot be framed", csp.includes("frame-ancestors 'none'") && page.headers.get("x-frame-options") === "DENY");
check("nosniff and referrer policy set", page.headers.get("x-content-type-options") === "nosniff" && Boolean(page.headers.get("referrer-policy")));
check("offline mode allows no external script origins", !/cloudflare|cdnjs/.test(csp));
check("no HSTS over plain HTTP", !page.headers.get("strict-transport-security"));
const viaHttps = await fetch(`${BASE}/login/admin`, { redirect: "manual", headers: { "X-Forwarded-Proto": "https" } });
check("HSTS behind an HTTPS proxy", (viaHttps.headers.get("strict-transport-security") || "").includes("max-age="));
const board = await fetch(`${BASE}/scoreboard/${R1}`, { redirect: "manual" });
const boardCsp = board.headers.get("content-security-policy") || "";
check("scoreboard may be framed by the configured origins", !board.headers.get("x-frame-options") && boardCsp.includes("frame-ancestors 'self'"));

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
