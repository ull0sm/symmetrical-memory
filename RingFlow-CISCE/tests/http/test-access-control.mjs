// Access control: unauthenticated attacks, tenancy, and every role's real flow.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const { scrypt, randomBytes, randomUUID } = await import("node:crypto");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });

const A = loadActions();
const T1 = process.argv[2];
const R1 = process.argv[3];

const hash = (pw) =>
  new Promise((res, rej) => {
    const salt = randomBytes(16).toString("hex");
    scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(`${salt}:${k.toString("hex")}`)));
  });

const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || (r.value && r.value.success === false) || r.value === null;

// ── Fixtures ───────────────────────────────────────────────────────────────
const [assignment] = await sql`select * from category_assignments where ring_id=${R1} and status='running' limit 1`;
const ringMatches = await sql`
  select m.id, m.status, m.aka_score from matches m
  where m.category_id=${assignment.category_id} order by m.match_no`;
const slotRows = await sql`select match_id, position, athlete_id from match_slots where match_id = any(${ringMatches.map((m) => m.id)})`;
const readyMatch = ringMatches.find((m) => {
  const s = slotRows.filter((x) => x.match_id === m.id);
  return m.status !== "CONFIRMED" && s.length === 2 && s.every((x) => x.athlete_id);
});
const readySlots = slotRows.filter((s) => s.match_id === readyMatch.id);
const akaId = readySlots.find((s) => s.position === 1).athlete_id;
const [otherRing] = await sql`select id from rings where tournament_id=${T1} and id<>${R1} limit 1`;
const [otherAssign] = await sql`select category_id from category_assignments where ring_id=${otherRing.id} limit 1`;
const [otherMatch] = otherAssign
  ? await sql`select id from matches where category_id=${otherAssign.category_id} limit 1`
  : [null];

// Unique codes for this run (seed codes repeat across seeded events).
const ringCode = String(100000 + Math.floor(Math.random() * 899999));
await sql`update rings set access_code=${ringCode} where id=${R1}`;

console.log(`fixtures: match ${readyMatch.id} aka ${akaId}, otherMatch ${otherMatch?.id}`);

// ── A. Unauthenticated attacker ────────────────────────────────────────────
const anon = new Jar();
const before = (await sql`select aka_score, status from matches where id=${readyMatch.id}`)[0];

for (const [name, args] of [
  ["getAdminDashboardData", [T1]],
  ["getLiveLogs", [T1]],
  ["getStagerCodes", [T1]],
  ["getPendingModeratorRequests", [T1]],
  ["getTournamentSearchMeta", [T1]],
  ["saveCategoryDefinitions", [T1, []]],
  ["importOfficialRoster", [T1, []]],
  ["confirmBoutResult", [readyMatch.id, akaId, { akaPoints: 9 }]],
  ["updateLiveMatchState", [readyMatch.id, R1, { akaScore: 99 }]],
  ["setActiveBout", [R1, readyMatch.id]],
  ["submitModeratorManualKataMarks", [{ matchId: readyMatch.id, finalize: true, winnerSide: "AKA" }]],
  ["startRingClock", [R1]],
  ["setAllRingTimers", [T1, true]],
  ["updateTournamentSettings", [T1, { name: "pwned", status: "active", event_date: "", venue: "", city: "" }]],
  ["getBalancingAssignments", [[R1]]],
  ["getModeratorRingAssignments", [R1]],
  ["updateCategoryStagerStatus", [assignment.category_id, T1, "ready"]],
]) {
  const r = await call(A, name, args, anon, "/");
  const leakedList = Array.isArray(r.value) && r.value.length > 0;
  check(`anon ${name} is refused`, denied(r) && !leakedList, `HTTP ${r.status}`);
}

const after = (await sql`select aka_score, status from matches where id=${readyMatch.id}`)[0];
check("anon could not change the bout score", after.aka_score === before.aka_score && after.status === before.status);

// The old tunnel bypass: an admin action POSTed to the public judge path.
const viaJudge = await call(A, "confirmBoutResult", [readyMatch.id, akaId, {}], anon, `/judge/ring/${R1}`);
check("action posted via /judge path is still refused", denied(viaJudge), `HTTP ${viaJudge.status}`);

check("dev-admin backdoor action no longer exists", !A.loginAsDevAdmin);

const forged = new Jar();
forged.c.set("admin_session", randomUUID());
check("forged random admin_session is refused", denied(await call(A, "getAdminDashboardData", [T1], forged, "/")));
const devCookie = new Jar();
devCookie.c.set("admin_dev_id", "00000000-0000-0000-0000-000000000001");
check("legacy admin_dev_id cookie grants nothing", denied(await call(A, "getAdminDashboardData", [T1], devCookie, "/")));

// Public surfaces carry no credentials.
await sql`update tournaments set status='active' where id=${T1}`;
const [t1] = await sql`select organiser_code from tournaments where id=${T1}`;
const pubHtml = await (await fetch(`${BASE}/public/event/${T1}`)).text();
check("public page has no organiser code", !pubHtml.includes(t1.organiser_code));
check("public page has no tatami access code", !pubHtml.includes(ringCode));
check("public page has no stager codes key", !pubHtml.includes("stager_codes"));
const bouts = await call(A, "getTournamentActiveBouts", [T1], anon);
const boutsJson = JSON.stringify(bouts.value ?? "");
check("public active-bouts has no access code / PIN / device token",
  !boutsJson.includes(ringCode) && !/judgePin|judge_pin|accessCode|judgeDeviceToken/.test(boutsJson));
const judgeBout = await call(A, "getJudgeBout", [R1], anon);
check("judge bout view refused without a judge session", denied(judgeBout));
const judgeStatus = await call(A, "getJudgeStatus", [R1], anon);
check("judge status carries no PIN or key", !/judgePin|judge_pin|pairing|\"pin\"/i.test(JSON.stringify(judgeStatus.value ?? "")));
await sql`update tournaments set show_public_scoreboard=false where id=${T1}`;
const bout = await call(A, "getRingActiveBout", [R1], anon);
check("scoreboard data hidden when public TV is off", bout.value === null || bout.value === "$undefined" || bout.value === undefined, JSON.stringify(bout.value)?.slice(0, 60));

// ── B. Tenancy ─────────────────────────────────────────────────────────────
const bEmail = `other-${Date.now()}@test.local`;
await sql`insert into admins (id, email, name, password_hash) values (${randomUUID()}, ${bEmail}, 'Other Director', ${await hash("other-pass-123")})`;
const adminB = new Jar();
const loginB = await call(A, "signInWithAdminPassword", [{ email: bEmail, password: "other-pass-123" }], adminB);
check("second admin can log in", loginB.value?.success === true);
check("admin cookie is httpOnly", adminB.flags?.admin_session?.includes("httponly"));
check("other admin cannot read T1 dashboard", denied(await call(A, "getAdminDashboardData", [T1], adminB)));
check("other admin cannot edit T1 settings", denied(await call(A, "updateTournamentSettings", [T1, { name: "x", status: "active", event_date: "", venue: "", city: "" }], adminB)));
const pageB = await fetch(`${BASE}/admin/event/${T1}/dashboard`, { headers: { Cookie: adminB.header() }, redirect: "manual" });
const bodyB = await pageB.text();
const [{ name: t1Name }] = await sql`select name from tournaments where id=${T1}`;
check("other admin is redirected away from T1 pages without its data",
  (pageB.status === 307 || bodyB.includes("NEXT_REDIRECT")) && !bodyB.includes(t1Name), `HTTP ${pageB.status}`);
const wrongPw = await call(A, "signInWithAdminPassword", [{ email: bEmail, password: "nope" }], new Jar());
check("wrong password refused", wrongPw.value?.success === false);
const noUser = await call(A, "signInWithAdminPassword", [{ email: "nobody@x.y", password: "admin123" }], new Jar());
check("unknown email refused with same message", noUser.value?.error === wrongPw.value?.error);

// ── C. Moderator flow ──────────────────────────────────────────────────────
const admin = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
const oldMod = new Jar();
oldMod.c.set("mod_token", "11111111-2222-3333-4444-555555555555");

const mod = new Jar();
const req = await call(A, "requestModeratorAccess", [ringCode, "Test Moderator", { userAgent: "test" }, "offline-bypass"], mod);
check("moderator access request accepted", req.value?.success === true, JSON.stringify(req.value));
const requestId = req.value?.requestId;
check("claim cookie issued httpOnly", mod.flags?.mod_claim?.includes("httponly"));

const thief = new Jar();
check("status is pending before approval", (await call(A, "checkModeratorStatus", [requestId], thief)).value?.status === "pending");
const appr = await call(A, "approveModeratorRequest", [requestId, R1, T1], admin);
check("admin approves moderator", appr.value?.success === true, JSON.stringify(appr.value));
const stolen = await call(A, "checkModeratorStatus", [requestId], thief);
check("another browser with the request id gets no session", stolen.value?.status === "approved_elsewhere" && !thief.c.has("mod_token"), JSON.stringify(stolen.value));
const claimed = await call(A, "checkModeratorStatus", [requestId], mod);
check("requesting browser receives the session", claimed.value?.status === "approved" && mod.c.has("mod_token"));
check("mod_token is httpOnly", mod.flags?.mod_token?.includes("httponly"));
check("request id is not accepted as a token", denied(await call(A, "getModeratorRingAssignments", [R1], Object.assign(new Jar(), { c: new Map([["mod_token", requestId]]) }))));
check("previous moderator's session was revoked", denied(await call(A, "startCategory", [assignment.id, R1], oldMod)));

const upd = await call(A, "updateLiveMatchState", [readyMatch.id, R1, { akaScore: 2, aoScore: 1, akaPenalties: 0, aoPenalties: 0, senshu: "AKA" }], mod);
check("moderator updates live score on own tatami", upd.value?.success === true, JSON.stringify(upd.value));
const live = (await sql`select aka_score, senshu, status from matches where id=${readyMatch.id}`)[0];
check("score persisted", live.aka_score === 2 && live.senshu === "AKA" && live.status === "LIVE");
if (otherMatch) {
  check("moderator cannot score another tatami's bout", denied(await call(A, "updateLiveMatchState", [otherMatch.id, R1, { akaScore: 5 }], mod)));
}
const badWinner = await call(A, "confirmBoutResult", [readyMatch.id, randomUUID(), { akaPoints: 2 }], mod);
check("winner outside the bout is rejected", badWinner.value?.success === false, JSON.stringify(badWinner.value));
const conf = await call(A, "confirmBoutResult", [readyMatch.id, akaId, { side: "AKA", akaPoints: 2, aoPoints: 1, method: "POINTS" }], mod);
check("moderator confirms result", conf.value?.success === true, JSON.stringify(conf.value));
const [ev] = await sql`select actor from match_events where match_id=${readyMatch.id} order by seq desc limit 1`;
check("result records who confirmed it", ev?.actor?.startsWith("moderator:Test Moderator"), ev?.actor);
const startOther = await call(A, "startCategory", [assignment.id, R1], mod);
check("startCategory on already running category still ok (idempotent)", startOther.value?.success === true || denied(startOther));

// ── D. Organiser (read-only) ───────────────────────────────────────────────
const ORG_PAGE = `/organiser/event/${T1}/dashboard`;
const regen = await call(A, "regenerateOrganiserCode", [T1], admin);
const orgCode = regen.value?.organiser_code;
const org = new Jar();
const oreq = await call(A, "requestOrganiserAccess", [orgCode, "Federation Observer", {}, "offline-bypass"], org);
check("organiser request accepted", oreq.value?.success === true, JSON.stringify(oreq.value));
await call(A, "approveOrganiserRequest", [oreq.value.requestId, T1], admin);
const oclaim = await call(A, "checkOrganiserStatus", [oreq.value.requestId], org);
check("organiser claims session", oclaim.value?.status === "approved" && org.c.has("org_token"));
const odash = await call(A, "getAdminDashboardData", [T1], org, ORG_PAGE);
check("organiser can read the live overview", odash.ok && Array.isArray(odash.value?.rings));
check("organiser overview has no access codes", !JSON.stringify(odash.value).includes(ringCode));
check("organiser cannot start a clock", denied(await call(A, "startRingClock", [R1], org, ORG_PAGE)));
check("organiser cannot pause all tatamis", denied(await call(A, "setAllRingTimers", [T1, true], org, ORG_PAGE)));
check("organiser cannot edit settings", denied(await call(A, "updateTournamentSettings", [T1, { name: "x", status: "active", event_date: "", venue: "", city: "" }], org, ORG_PAGE)));
check("organiser cannot save assignments", denied(await call(A, "saveAssignments", [T1, []], org, ORG_PAGE)));
// (Results export is allowed for organisers server-side but has no organiser UI yet.)

// ── E. Stager ──────────────────────────────────────────────────────────────
const ST_PAGE = `/stager/event/${T1}/balance`;
const codes = await call(A, "generateStagerCodes", [T1, 1], admin);
const stagerCode = codes.value?.stager_codes?.at(-1)?.code;
const st = new Jar();
const sreq = await call(A, "requestStagerAccess", [stagerCode, "Call Area 1", {}, "offline-bypass"], st);
check("stager request accepted", sreq.value?.success === true, JSON.stringify(sreq.value));
await call(A, "approveStagerRequest", [sreq.value.requestId, T1], admin);
const sclaim = await call(A, "checkStagerStatus", [sreq.value.requestId], st);
check("stager claims session", sclaim.value?.status === "approved" && st.c.has("stager_token"));
const mark = await call(A, "updateCategoryStagerStatus", [assignment.category_id, T1, "calling"], st, ST_PAGE);
check("stager marks category calling", mark.value?.success === true, JSON.stringify(mark.value));
const [stRow] = await sql`select stager_status, stager_name from category_assignments where id=${assignment.id}`;
check("stager name comes from the session, not the client", stRow.stager_name === "Call Area 1" && stRow.stager_status === "calling");
check("stager reads balancing for own event", Array.isArray((await call(A, "getBalancingAssignments", [[R1]], st, ST_PAGE)).value));
check("stager cannot save assignments", denied(await call(A, "saveAssignments", [T1, []], st, ST_PAGE)));
check("stager cannot download draw PDFs", denied(await call(A, "downloadAllCategoryDrawPdfs", [T1], st, ST_PAGE)));

// Draw administration is admin-only: every action that changes or reveals a draw's setup refuses
// the anonymous caller and the stager. (A missing action would also look "denied", so check it exists.)
const drawCat = assignment.category_id;
for (const [name, args] of [
  ["generateCategoryDraw", [drawCat]],
  ["flushCategoryDraw", [drawCat, { confirm: "FLUSH", reason: "attack test" }]],
  ["swapDrawAthletes", [drawCat, "a", "b", "attack test"]],
  ["setCategorySeeds", [drawCat, []]],
  ["setCategoryDrawProfile", [drawCat, "OFFICIAL"]],
  ["setCategoryDrawOption", [drawCat, 1]],
  ["getCategoryDrawSetup", [drawCat]],
]) {
  check(`${name} is compiled into a page`, Boolean(A[name]));
  check(`anonymous cannot ${name}`, denied(await call(A, name, args, new Jar(), "/")));
  check(`stager cannot ${name}`, denied(await call(A, name, args, st, ST_PAGE)));
}
const [stillDrawn] = await sql`select count(*)::int as n from matches where category_id=${drawCat}`;
check("the attacks above did not touch the category's bouts", stillDrawn.n > 0);

// ── F. Logout ends the server session ──────────────────────────────────────
const token = mod.c.get("mod_token");
await call(A, "logoutModerator", [], mod);
const reuse = new Jar();
reuse.c.set("mod_token", token);
check("moderator token dead after logout", denied(await call(A, "getModeratorRingAssignments", [R1], reuse)));

// ── G. Live feed ───────────────────────────────────────────────────────────
async function collect(url, ms, jar) {
  const ctrl = new AbortController();
  const events = [];
  const res = await fetch(url, { signal: ctrl.signal, headers: jar ? { Cookie: jar.header() } : {} });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const m of dec.decode(value).matchAll(/event: change\ndata: (.*)\n/g)) events.push(JSON.parse(m[1]));
    }
  } catch {}
  clearTimeout(t);
  return events;
}
const mod2 = new Jar();
const r2 = await call(A, "requestModeratorAccess", [ringCode, "Second Shift", {}, "offline-bypass"], mod2);
const unscoped = collect(`${BASE}/api/live`, 2500);
const publicT = collect(`${BASE}/api/live?tournamentId=${T1}`, 2500);
const staffT = collect(`${BASE}/api/live/staff?tournamentId=${T1}`, 2500, admin);
await new Promise((r) => setTimeout(r, 600));
await call(A, "approveModeratorRequest", [r2.value.requestId, R1, T1], admin);
await call(A, "updateCategoryStagerStatus", [assignment.category_id, T1, "ready"], st);
const [u, p, s] = await Promise.all([unscoped, publicT, staffT]);
check("unscoped live stream receives nothing", u.length === 0, `${u.length} events`);
check("public stream gets no access-request events", !p.some((e) => e.table.endsWith("_requests")));
check("public stream gets floor events", p.some((e) => e.table === "category_assignments"), `${p.length} events`);
check("staff stream gets access-request events", s.some((e) => e.table === "moderator_requests"), `${s.length} events`);
const all = JSON.stringify([...u, ...p, ...s]);
check("no session token in any live event", !/sessionToken|session_token|deviceToken/.test(all));

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
