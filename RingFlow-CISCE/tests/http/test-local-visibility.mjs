// Local tournaments: what the public sees. A group being prepared shows by name only ("Being
// prepared"): no members through the event page, search, or draw views. A locked group shows up in
// search through its entries and opens its draw from an athlete's link, and only for that athlete's
// own group. An unlocked group disappears again. A guest is marked wherever the draw is shown.
// The staging tables (holds, drafts, entries, tie decisions) never reach the public live feed.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const page = (path, jar) => fetch(BASE + path, { headers: { Cookie: jar.header() }, redirect: "manual" });
const ok = (r) => r.value?.success === true;

const admin = new Jar();
let A = loadActions();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
A = loadActions();

// ── A Local tournament: Blue 9 M has four kumite athletes, Blue 10 M two plus Guesty (who stays away) ──
const L = (await call(A, "createTournament", [{ name: "Visibility check", categories: [], ringCount: 1, tournament_type: "LOCAL" }], admin)).value;
for (const p of ["categories", "athletes", "rings", "staging"]) await page(`/admin/event/${L}/${p}`, admin);
A = loadActions();
const CAT = `/admin/event/${L}/categories`;
await call(A, "generateDivisions", [L, { ages: [{ min: 9, max: 9 }, { min: 10, max: 10 }], beltBands: [["Blue"]], sexes: ["M"] }], admin, CAT);
const roster = [
  ...["Draftone Ay", "Drafttwo Bee", "Draftthree Cee", "Draftfour Dee"].map((name, i) => ({ name, club: `Club ${i + 1}`, age: 9 })),
  ...["Tenone Ex", "Tentwo Why", "Guesty Zed"].map((name, i) => ({ name, club: `Ten Club ${i + 1}`, age: 10 })),
].map((r) => ({ ...r, belt: "Blue", sex: "M", kumite: "Yes", kata: "No" }));
await call(A, "importLocalRoster", [L, roster], admin, `/admin/event/${L}/athletes`);
const div = async (name) => (await sql`select id from divisions where tournament_id=${L} and name=${name}`)[0].id;
const [D9, D10] = [await div("Blue · 9 · M"), await div("Blue · 10 · M")];
const eventOf = async (d, t) => (await sql`select id from division_events where division_id=${d} and event_type=${t}`)[0].id;
await call(A, "setDivisionEvent", [await eventOf(D9, "kumite"), { groupSize: 8 }], admin, CAT);
await call(A, "setDivisionEvent", [await eventOf(D10, "kumite"), { groupSize: 8 }], admin, CAT);
await call(A, "buildAllStartingGroups", [L], admin, CAT);
const [R1] = (await sql`select id from rings where tournament_id=${L} order by ring_order`).map((r) => r.id);
await call(A, "assignDivisionToRing", [D9, R1], admin, CAT);
await call(A, "assignDivisionToRing", [D10, R1], admin, CAT);
const idOf = async (name) => (await sql`select id from athletes where tournament_id=${L} and name=${name}`)[0].id;
const [G9] = await sql`select id, name from categories where division_event_id=${await eventOf(D9, "kumite")}`;
const [G10] = await sql`select id, name from categories where division_event_id=${await eventOf(D10, "kumite")}`;
await sql`update tournaments set status='active' where id=${L}`;

const stCode = (await call(A, "generateStagerCodes", [L, 1], admin)).value.stager_codes.at(-1).code;
const st = new Jar();
const sreq = await call(A, "requestStagerAccess", [stCode, "Asha", {}, "offline-bypass"], st);
await call(A, "approveStagerRequest", [sreq.value.requestId, L], admin);
await call(A, "checkStagerStatus", [sreq.value.requestId], st);
const DESK = `/stager/event/${L}`;
const WS = (d) => `/stager/event/${L}/category/${d}`;
const ADMIN_WS = (d) => `/admin/event/${L}/staging/${d}`;
await page(DESK, st);
await page(WS(D9), st);
await page(ADMIN_WS(D9), admin);
await page(`/public/event/${L}`, new Jar());
A = loadActions();

const visitor = new Jar();
const PUBLIC = `/public/event/${L}`;
const search = async (q) => (await call(A, "searchTournamentAthletes", [L, q], visitor, PUBLIC)).value ?? [];
const draftNames = ["Draftone Ay", "Drafttwo Bee", "Draftthree Cee", "Draftfour Dee"];

// ── A group being prepared: the name, nothing else ──
const html = await (await page(PUBLIC, visitor)).text();
check("the public page marks groups as being prepared", html.includes("being_prepared"));
check("and names no member of a draft group", !draftNames.some((n) => html.includes(n)) && !html.includes("Guesty"));
const draftView = (await call(A, "getCategoryDraw", [G9.id], visitor, PUBLIC)).value;
check("a draft group has no public draw", draftView?.locked === true && (draftView.matches ?? []).length === 0);
const viaAthlete = (await call(A, "getAthleteDraw", [await idOf("Draftone Ay"), G9.id], visitor, PUBLIC)).value;
check("not even through an athlete's own link", viaAthlete === null || viaAthlete?.locked === true && (viaAthlete.matches ?? []).length === 0);
const found = await search("Draftone");
check("search finds the athlete by name but not the group they're in",
  found.length === 1 && found[0].name === "Draftone Ay" && !found[0].category_id && !JSON.stringify(found).includes(G9.name));
check("a search by group name finds no members", (await search(G9.name)).every((r) => !draftNames.includes(r.name)));

// ── The staging tables stay off the public live feed ──
async function listen(path, jar, trigger, ms = 2500) {
  const ctrl = new AbortController();
  const res = await fetch(BASE + path, { headers: { Cookie: jar.header(), Accept: "text/event-stream" }, signal: ctrl.signal });
  let text = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const done = (async () => {
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
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
const stagingTables = /"table":"(division_holds|group_drafts|category_entries|kata_tie_decisions)"/;
const takeAndSwap = async () => {
  await call(A, "takeDivision", [D9], st, DESK);
  await call(A, "shuffleGroup", [(await call(A, "getDivisionWorkspace", [D9], st, WS(D9))).value.events[0].groups[0].id, 1], st, WS(D9));
};
const staffFeed = await listen(`/api/live/staff?tournamentId=${L}`, admin, takeAndSwap, 3000);
check("the staff feed carries the hold and draft changes", staffFeed.status === 200 && stagingTables.test(staffFeed.text), staffFeed.text.slice(0, 200));
await call(A, "handBackDivision", [D9], st, WS(D9));
const publicFeed = await listen(`/api/live?tournamentId=${L}`, visitor, takeAndSwap, 3000);
check("the public feed carries none of them", publicFeed.status === 200 && !stagingTables.test(publicFeed.text), publicFeed.text.slice(0, 200));
check("and no stager code, hash or name", !/stager_code|code_hash|Asha/i.test(publicFeed.text));
await call(A, "handBackDivision", [D9], st, WS(D9));

// ── The stager locks Blue 9 M and Blue 10 M (Guesty is away) ──
async function send(d, absent = []) {
  await call(A, "takeDivision", [d], st, DESK);
  for (const name of absent) await call(A, "setAttendanceLocal", [d, await idOf(name), "absent"], st, WS(d));
  for (const e of (await call(A, "getDivisionWorkspace", [d], st, WS(d))).value.events) {
    for (const g of e.groups) await call(A, "lockGroup", [g.id, g.checksum], st, WS(d));
  }
}
await send(D9);
await send(D10, ["Guesty Zed"]);
check("both groups are locked", (await sql`select count(*)::int as n from draws where category_id in (${G9.id}, ${G10.id}) and state='LOCKED'`)[0].n === 2);

// ── Locked: the group is public ──
const draftoneId = await idOf("Draftone Ay");
const hit = (await search("Draftone"))[0];
check("search lists the athlete's group through their entry", hit?.category_id === G9.id && hit.categories?.name === G9.name, JSON.stringify(hit));
const open = (await call(A, "getCategoryDraw", [G9.id], visitor, PUBLIC)).value;
check("the locked group's draw is public", open?.locked !== true && (open.matches ?? []).length > 0);
const mine = (await call(A, "getAthleteDraw", [draftoneId, G9.id], visitor, PUBLIC)).value;
check("an athlete's link opens their group, highlighted", mine?.highlightAthleteId === draftoneId && (mine.matches ?? []).length > 0);
check("but not a group they aren't in", (await call(A, "getAthleteDraw", [draftoneId, G10.id], visitor, PUBLIC)).value === null);
check("and not one named for someone else", (await call(A, "getAthleteDraw", [await idOf("Tenone Ex"), G9.id], visitor, PUBLIC)).value === null);
check("the page no longer calls a locked group 'being prepared'", !(await (await page(PUBLIC, visitor)).text()).includes("being_prepared"));

// ── Guests are marked ──
const guestId = await idOf("Guesty Zed");
const fp = await call(A, "previewLateChange", [G9.id, { kind: "add", athleteId: guestId }], admin, ADMIN_WS(D9));
check("the admin previews a guest entry", ok(fp), JSON.stringify(fp.value)?.slice(0, 200));
const placed = await call(A, "changeLockedGroup", [G9.id, { kind: "add", athleteId: guestId }, "Missed the Blue 10 call", fp.value?.fingerprint], admin, ADMIN_WS(D9));
check("and places the guest", ok(placed), JSON.stringify(placed.value)?.slice(0, 200));
const guestView = (await call(A, "getCategoryDraw", [G9.id], visitor, PUBLIC)).value;
const guestSides = (guestView?.matches ?? []).flatMap((m) => [m.aka, m.ao]).filter((s) => s?.id === guestId);
check("the draw marks the guest by name, on every public view", guestSides.length > 0 && guestSides.every((s) => s.displayName === "Guesty Zed (guest)" && s.guest === true), JSON.stringify(guestSides));
check("others are not marked", (guestView?.matches ?? []).flatMap((m) => [m.aka, m.ao]).filter((s) => s?.id && s.id !== guestId).every((s) => !s.displayName.includes("(guest)")));
const guestHit = (await search("Guesty"))[0];
check("search lists the guest in the group they play in", guestHit?.category_id === G9.id);
const podiumCsv = await call(A, "exportTournamentPodiumsCsv", [L], admin, `/admin/event/${L}/record`);
check("the podiums export lists groups in progress", ok(podiumCsv) && Buffer.from(podiumCsv.value.base64, "base64").toString().includes("In progress"));

// ── Unlocked, the group is hidden again ──
const { value: before } = await call(A, "unlockGroup", [G10.id, "Not ready after all"], admin, ADMIN_WS(D10));
check("the admin unlocks Blue 10 M's group", before?.success === true, JSON.stringify(before));
check("its draw is hidden again", (await call(A, "getCategoryDraw", [G10.id], visitor, PUBLIC)).value?.locked === true);
check("and its members show no group in search", (await search("Tenone")).every((r) => !r.category_id));
check("the public page marks it as being prepared again", (await (await page(PUBLIC, visitor)).text()).includes("being_prepared"));

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
