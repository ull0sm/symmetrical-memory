// Phase 2: hashed sessions, logout, rate limits, input validation, staff-only PDFs.
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const A = loadActions();
const [T1, R1] = process.argv.slice(2);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || r.value?.success === false || r.value === null;

// ── Admin sessions ─────────────────────────────────────────────────────────
const admin = new Jar();
const login = await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
check("admin logs in", login.value?.success === true);
const cookie = admin.c.get("admin_session");
const [{ id: adminId }] = await sql`select id from admins where email='admin@ringflow.org'`;
check("admin cookie is not the admin id", cookie && cookie !== adminId && cookie.length >= 40);
const rows = await sql`select token_hash from admin_sessions where admin_id=${adminId}`;
check("only the token hash is stored", rows.some((r) => r.token_hash === sha(cookie)) && !rows.some((r) => r.token_hash === cookie));

const oldStyle = new Jar();
oldStyle.c.set("admin_session", adminId);
check("old-style cookie (admin id) no longer works", denied(await call(A, "getAdminDashboardData", [T1], oldStyle, "/")));
check("new session works", Array.isArray((await call(A, "getAdminDashboardData", [T1], admin, `/admin/event/${T1}/dashboard`)).value?.rings));

const copy = new Jar();
copy.c.set("admin_session", cookie);
await call(A, "logoutAdminAction", [], admin, `/admin/event/${T1}/dashboard`);
check("logout deletes the session row", (await sql`select 1 from admin_sessions where token_hash=${sha(cookie)}`).length === 0);
check("a copied cookie dies with logout", denied(await call(A, "getAdminDashboardData", [T1], copy, "/")));

// ── Staff sessions are hashed ──────────────────────────────────────────────
const admin2 = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin2);
const code = String(100000 + Math.floor(Math.random() * 899999));
await sql`update rings set access_code=${code} where id=${R1}`;
const mod = new Jar();
const req = await call(A, "requestModeratorAccess", [code, "Hash Check", {}, "offline-bypass"], mod);
await call(A, "approveModeratorRequest", [req.value.requestId, R1, T1], admin2, `/admin/event/${T1}/rings`);
const [beforeClaim] = await sql`select session_token, session_token_hash from moderator_requests where id=${req.value.requestId}`;
check("approval alone mints no session", !beforeClaim.session_token && !beforeClaim.session_token_hash);
await call(A, "checkModeratorStatus", [req.value.requestId], mod);
const token = mod.c.get("mod_token");
const [afterClaim] = await sql`select session_token, session_token_hash from moderator_requests where id=${req.value.requestId}`;
check("moderator session stored only as hash", !afterClaim.session_token && afterClaim.session_token_hash === sha(token));
check("hashed moderator session works", Array.isArray((await call(A, "getModeratorRingAssignments", [R1], mod, `/moderator/ring/${R1}/current`)).value));
const again = new Jar();
const reclaim = await call(A, "checkModeratorStatus", [req.value.requestId], again);
check("claim cannot be collected by another browser", reclaim.value?.status === "approved_elsewhere");
const plaintextLeft = await sql`
  select (select count(*) from moderator_requests where session_token is not null) +
         (select count(*) from stager_requests where session_token is not null) +
         (select count(*) from organiser_requests where session_token is not null) as n`;
check("no plaintext staff session tokens in the database", Number(plaintextLeft[0].n) === 0, `${plaintextLeft[0].n} left`);

// ── Rate limits ────────────────────────────────────────────────────────────
const victim = `ratelimit-${Date.now()}@test.local`;
let blocked = false;
for (let i = 0; i < 10; i++) {
  const r = await call(A, "signInWithAdminPassword", [{ email: victim, password: "wrong" + i }], new Jar());
  if (/Too many attempts/.test(r.value?.error || "")) { blocked = true; break; }
}
check("repeated wrong passwords for one email get throttled", blocked);

let pinBlocked = false;
for (let i = 0; i < 35; i++) {
  const r = await call(A, "requestJudgeSeat", [{ ringId: R1, pin: String(1000 + i), name: "x", seat: 1 }], new Jar());
  if (/Too many attempts/.test(r.value?.error || "")) { pinBlocked = true; break; }
}
check("judge PIN guessing on a tatami gets throttled", pinBlocked);

// ── Input validation ───────────────────────────────────────────────────────
const longName = "x".repeat(500);
const addLong = await call(A, "addAthlete", [T1, { name: longName, chest_number: "1" }], admin2, `/admin/event/${T1}/athletes`);
check("oversized athlete name rejected", denied(addLong));
const badTournament = await call(A, "createTournament", [{ name: "Big", event_date: "", venue: "", city: "", categories: [], ring_count: 999 }], admin2, "/admin/create");
check("absurd tatami count rejected", denied(badTournament));
const badDefs = await call(A, "saveCategoryDefinitions", [T1, [{ categoryName: "X", eventType: "boxing", gender: "M" }]], admin2, `/admin/event/${T1}/categories`);
check("unknown event type rejected", denied(badDefs));

// ── Category PDFs: staff only ──────────────────────────────────────────────
const [cat] = await sql`select id from categories where tournament_id=${T1} limit 1`;
const pdf = Buffer.from("%PDF-1.4\n% test\n");
await sql`insert into category_documents (category_id, filename, size_bytes, content)
          values (${cat.id}, 'test.pdf', ${pdf.length}, ${pdf})
          on conflict (category_id) do update set content = excluded.content, size_bytes = excluded.size_bytes`;
const url = `${BASE}/api/category-docs/${cat.id}`;
const anonPdf = await fetch(url);
check("anonymous cannot open a category PDF", anonPdf.status === 403, `HTTP ${anonPdf.status}`);
const staffPdf = await fetch(url, { headers: { Cookie: admin2.header() } });
check("staff can open a category PDF", staffPdf.status === 200 && staffPdf.headers.get("content-type") === "application/pdf", `HTTP ${staffPdf.status}`);
check("PDF response is not cacheable", /no-store/.test(staffPdf.headers.get("cache-control") || ""));
const otherAdmin = new Jar();
const email = (await sql`select email from admins where email like 'other-%' limit 1`)[0]?.email;
if (email) {
  await call(A, "signInWithAdminPassword", [{ email, password: "other-pass-123" }], otherAdmin);
  const otherPdf = await fetch(url, { headers: { Cookie: otherAdmin.header() } });
  check("another tournament's admin cannot open it", otherPdf.status === 403, `HTTP ${otherPdf.status}`);
}

// ── Supabase is gone ───────────────────────────────────────────────────────
const cb = await fetch(`${BASE}/auth/callback?code=x`, { redirect: "manual" });
check("old Supabase auth callback route is gone", cb.status === 404, `HTTP ${cb.status}`);

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
