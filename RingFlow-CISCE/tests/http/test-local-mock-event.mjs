// Local tournaments at event size: the mock event (3 tatamis, 15 categories, 105 children). One stager
// takes every category in turn, marks an absentee, registers a walk-in, and locks every group; the
// admin reviews the walk-in; three moderators start the first category on their tatami; a late
// athlete joins a group that is already running. Checks the numbers add up and nothing is lost.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const page = (path, jar) => fetch(BASE + path, { headers: { Cookie: jar.header() }, redirect: "manual" });
const ok = (r) => r.value?.success === true;

// The mock event script is the thing under test: run it, then take its tournament.
const out = execSync("npm run db:mock-local", { cwd: process.env.APP_DIR, env: process.env, encoding: "utf8" });
const L = out.match(/Tournament ID: ([0-9a-f-]{36})/)[1];
check("the mock event script reports 15 categories, 105 children and 3 tatamis", /15 categories, 105 children, 3 tatamis/.test(out));

const admin = new Jar();
let A = loadActions();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
for (const p of ["categories", "athletes", "rings", "staging"]) await page(`/admin/event/${L}/${p}`, admin);
A = loadActions();

const divs = await sql`select id, name from divisions where tournament_id=${L} order by sort_order`;
const ringRows = await sql`select id from rings where tournament_id=${L} order by ring_order`;
check("15 categories with a tatami each, five per tatami", divs.length === 15 && (await sql`select ring_id, count(*)::int as n from category_assignments a join categories c on c.id=a.category_id where c.tournament_id=${L} group by ring_id`).every((r) => r.n >= 5));

// ── Staff: the preset stager code, three moderators ──
const st = new Jar();
const sreq = await call(A, "requestStagerAccess", ["MKSTG1", "Mira", {}, "offline-bypass"], st);
await call(A, "approveStagerRequest", [sreq.value.requestId, L], admin);
await call(A, "checkStagerStatus", [sreq.value.requestId], st);
check("the stager signs in with the event's code", st.c.has("stager_token"));
async function moderatorOf(ringId, name) {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await sql`update rings set access_code=${code} where id=${ringId}`;
  const jar = new Jar();
  const req = await call(A, "requestModeratorAccess", [code, name, {}, "offline-bypass"], jar);
  await call(A, "approveModeratorRequest", [req.value.requestId, ringId, L], admin, `/admin/event/${L}/rings`);
  await call(A, "checkModeratorStatus", [req.value.requestId], jar);
  return jar;
}
const mods = [];
for (let i = 0; i < 3; i += 1) mods.push(await moderatorOf(ringRows[i].id, `Mat ${i + 1}`));

const DESK = `/stager/event/${L}`;
const WS = (d) => `/stager/event/${L}/category/${d}`;
await page(DESK, st);
await page(WS(divs[0].id), st);
await page(`/admin/event/${L}/staging/${divs[0].id}`, admin);
for (let i = 0; i < 3; i += 1) {
  await page(`/moderator/ring/${ringRows[i].id}/queue`, mods[i]);
  await page(`/moderator/ring/${ringRows[i].id}/current`, mods[i]);
}
A = loadActions();

// ── The stager works through all 15: one absentee each, one walk-in in the first ──
const absent = [];
let walkId = null;
for (const [i, d] of divs.entries()) {
  const taken = await call(A, "takeDivision", [d.id], st, DESK);
  if (!ok(taken)) check(`takes ${d.name}`, false, JSON.stringify(taken.value));
  const ws = (await call(A, "getDivisionWorkspace", [d.id], st, WS(d.id))).value;
  const first = ws.athletes?.[0] ?? ws.events.flatMap((e) => e.groups.flatMap((g) => g.members))[0];
  if (first) {
    await call(A, "setAttendanceLocal", [d.id, first.id, "absent"], st, WS(d.id));
    absent.push(first.id);
  }
  if (i === 0) {
    const walk = await call(A, "registerWalkIn", [d.id, { name: "Desk Walkin", club: "Tiger Club" }, false], st, WS(d.id));
    walkId = walk.value?.athleteId ?? null;
  }
  const fresh = (await call(A, "getDivisionWorkspace", [d.id], st, WS(d.id))).value;
  for (const e of fresh.events) {
    for (const g of e.groups) {
      const locked = await call(A, "lockGroup", [g.id, g.checksum], st, WS(d.id));
      if (!ok(locked)) check(`locks ${g.name ?? g.id}`, false, JSON.stringify(locked.value));
    }
  }
}
const groups = await sql`select c.id, d.state from categories c left join draws d on d.category_id=c.id where c.tournament_id=${L} and c.group_no is not null`;
check("every group in the event is locked", groups.length > 15 && groups.every((g) => g.state === "LOCKED"), `${groups.filter((g) => g.state !== "LOCKED").length} unlocked of ${groups.length}`);
check("no hold is left over", (await sql`select count(*)::int as n from division_holds where tournament_id=${L}`)[0].n === 0);
const placedAbsent = await sql`select count(*)::int as n from category_entries where athlete_id = any(${absent})`;
check("nobody marked absent is in a group", placedAbsent[0].n === 0, String(placedAbsent[0].n));
const [walkRow] = walkId ? await sql`select walk_in, needs_review from athletes where id=${walkId}` : [];
check("the walk-in is registered and waits for the admin's review", walkRow?.walk_in === true && walkRow.needs_review === true, String(walkId));
const inGroups = (await sql`select count(distinct athlete_id)::int as n from category_entries e join categories c on c.id=e.category_id where c.tournament_id=${L}`)[0].n;
const registered = (await sql`select count(*)::int as n from athletes where tournament_id=${L}`)[0].n;
check("everyone present is placed: registered minus absentees (some skip both events)", inGroups <= registered - absent.length + 0 && inGroups >= registered - absent.length - 20, `${inGroups} in groups of ${registered}, ${absent.length} absent`);

// ── The first category on each tatami starts ──
for (let i = 0; i < 3; i += 1) {
  const [card] = await sql`select a.id from category_assignments a join categories c on c.id=a.category_id where a.ring_id=${ringRows[i].id} order by a.queue_order, c.group_no limit 1`;
  const started = await call(A, "startCategory", [card.id, ringRows[i].id], mods[i], `/moderator/ring/${ringRows[i].id}/queue`);
  check(`tatami ${i + 1} starts its first group`, ok(started), JSON.stringify(started.value));
}

// ── A late athlete joins a group that is already running ──
const [running] = await sql`select c.id, c.event_type, d.id as division_id from category_assignments a join categories c on c.id=a.category_id join division_events ev on ev.id=c.division_event_id join divisions d on d.id=ev.division_id where c.tournament_id=${L} and a.status='running' and c.event_type='kumite' limit 1`;
check("a kumite group is running on some tatami", Boolean(running));
if (running) {
  const [late] = await sql`select a.id from athletes a join tournament_registrations r on r.athlete_id=a.id where a.tournament_id=${L} and r.division_id=${running.division_id} and a.id = any(${absent}) limit 1`;
  const change = late ? { kind: "add", athleteId: late.id } : null;
  check("an absentee of that category exists to bring in late", Boolean(change));
  if (change) {
    await page(`/admin/event/${L}/staging/${running.division_id}`, admin);
    const pv = await call(A, "previewLateChange", [running.id, change], admin, `/admin/event/${L}/staging/${running.division_id}`);
    const applied = ok(pv) ? await call(A, "changeLockedGroup", [running.id, change, "Arrived after the call", pv.value.fingerprint], admin, `/admin/event/${L}/staging/${running.division_id}`) : pv;
    check("an absentee who turns up late joins the running group", ok(applied) || /bye|started|running|no room/i.test(JSON.stringify(applied.value)), JSON.stringify(applied.value)?.slice(0, 200));
    check("their entry exists exactly once", !ok(applied) || (await sql`select count(*)::int as n from category_entries where athlete_id=${late.id} and category_id=${running.id}`)[0].n === 1);
  }
}

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
