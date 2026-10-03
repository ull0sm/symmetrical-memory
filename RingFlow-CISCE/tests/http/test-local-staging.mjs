// Local tournaments: the stager desk. Who may take, change and lock a category's groups (only whoever
// holds it), the take race, the admin's release and hand-on, a hold surviving a fresh sign-in, the
// screens, and that no stager code ever reaches a browser.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const [T1] = process.argv.slice(2); // the seeded Official tournament
const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || r.value?.success === false || r.value === null;
const page = (path, jar) => fetch(BASE + path, { headers: { Cookie: jar.header() }, redirect: "manual" });
/** A redirect, as a 3xx or (once a layout has streamed) inside the page payload. */
async function redirectsTo(res, path) {
  if (res.status >= 300 && res.status < 400) return (res.headers.get("location") ?? "").endsWith(path);
  return (await res.text()).includes(`NEXT_REDIRECT;replace;${path};`);
}

const admin = new Jar();
let A = loadActions();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
A = loadActions();

// ── A Local tournament: two categories with groups on one tatami ──
const L = (await call(A, "createTournament", [{ name: "Local staging check", categories: [], ringCount: 1, tournament_type: "LOCAL" }], admin)).value;
const [{ id: R1 }] = await sql`select id from rings where tournament_id=${L}`;
for (const p of ["categories", "athletes", "rings", "staging"]) await page(`/admin/event/${L}/${p}`, admin);
A = loadActions();
const CAT = `/admin/event/${L}/categories`;
await call(A, "generateDivisions", [L, { ages: [{ min: 9, max: 9 }], beltBands: [["Blue"]], sexes: ["M", "F"] }], admin, CAT);
const clubs = ["Sakura", "Kaizen", "Tiger"];
const rows = [
  ...Array.from({ length: 8 }, (_, i) => ({ name: `Desk Boy ${i + 1}`, club: clubs[i % 3], age: 9, belt: "Blue", sex: "M" })),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `Desk Girl ${i + 1}`, club: clubs[i % 3], age: 9, belt: "Blue", sex: "F" })),
];
await call(A, "importLocalRoster", [L, rows], admin, `/admin/event/${L}/athletes`);
await call(A, "buildAllStartingGroups", [L], admin, CAT);
const [DM] = await sql`select id from divisions where tournament_id=${L} and name='Blue · 9 · M'`;
const [DF] = await sql`select id from divisions where tournament_id=${L} and name='Blue · 9 · F'`;
await call(A, "assignDivisionToRing", [DM.id, R1], admin, CAT);
await call(A, "assignDivisionToRing", [DF.id, R1], admin, CAT);

// ── Staff: two stagers, a stager of another tournament, a moderator, an organiser ──
async function stagerSession(tournamentId, name, code) {
  const jar = new Jar();
  const req = await call(A, "requestStagerAccess", [code, name, {}, "offline-bypass"], jar);
  await call(A, "approveStagerRequest", [req.value.requestId, tournamentId], admin);
  await call(A, "checkStagerStatus", [req.value.requestId], jar);
  return { jar, requestId: req.value.requestId };
}
const codes = (await call(A, "generateStagerCodes", [L, 2], admin)).value.stager_codes.map((c) => c.code);
const [codeA, codeB] = codes.slice(-2);
const stA = await stagerSession(L, "Asha", codeA);
const stB = await stagerSession(L, "Bilal", codeB);
const otherCode = (await call(A, "generateStagerCodes", [T1, 1], admin)).value.stager_codes.at(-1).code;
const stOther = await stagerSession(T1, "Elsewhere", otherCode);

const modCode = String(100000 + Math.floor(Math.random() * 899999));
await sql`update rings set access_code=${modCode} where id=${R1}`;
const mod = new Jar();
const mreq = await call(A, "requestModeratorAccess", [modCode, "Mat 1", {}, "offline-bypass"], mod);
await call(A, "approveModeratorRequest", [mreq.value.requestId, R1, L], admin, `/admin/event/${L}/rings`);
await call(A, "checkModeratorStatus", [mreq.value.requestId], mod);

const org = new Jar();
const orgCode = (await call(A, "regenerateOrganiserCode", [L], admin)).value?.organiser_code;
const oreq = await call(A, "requestOrganiserAccess", [orgCode, "Observer", {}, "offline-bypass"], org);
await call(A, "approveOrganiserRequest", [oreq.value.requestId, L], admin);
await call(A, "checkOrganiserStatus", [oreq.value.requestId], org);

// The screens compile the desk's actions.
const DESK = `/stager/event/${L}`;
const WS = (d) => `/stager/event/${L}/category/${d}`;
await page(DESK, stA.jar);
await page(WS(DM.id), stA.jar);
await page(`/admin/event/${L}/staging/${DM.id}`, admin);
A = loadActions();
const ADMIN_STAGING = `/admin/event/${L}/staging`;

// ── Screens ──
const deskHtml = await (await page(DESK, stA.jar)).text();
check("a Local stager lands on the desk", deskHtml.includes("Stager desk") && deskHtml.includes("Blue · 9 · M"));
check("a Local tournament has no calling board: it goes to the desk", await redirectsTo(await page(`/stager/event/${L}/balance`, stA.jar), `/stager/event/${L}`));
check("an Official tournament's stager keeps the tatami board", await redirectsTo(await page(`/stager/event/${T1}`, stOther.jar), `/stager/event/${T1}/balance`));
check("the admin's staging page opens for a Local tournament", (await (await page(ADMIN_STAGING, admin)).text()).includes("being prepared"));
check("and not for an Official one", await redirectsTo(await page(`/admin/event/${T1}/staging`, admin), `/admin/event/${T1}/categories`));

// ── Who can reach the desk at all ──
const anon = new Jar();
for (const [name, args] of [
  ["getStagerDesk", [L]],
  ["takeDivision", [DM.id]],
  ["getDivisionWorkspace", [DM.id]],
  ["searchDeskAthletes", [L, "Desk"]],
  ["releaseHold", [DM.id, "no reason"]],
]) {
  check(`a visitor cannot ${name}`, A[name] && denied(await call(A, name, args, anon, "/")));
}
for (const [who, jar] of [["the moderator", mod], ["the organiser", org], ["another tournament's stager", stOther.jar]]) {
  check(`${who} cannot read the desk`, denied(await call(A, "getStagerDesk", [L], jar, DESK)));
  check(`${who} cannot take a category`, denied(await call(A, "takeDivision", [DM.id], jar, DESK)));
}
check("the Official tournament has no desk", denied(await call(A, "getStagerDesk", [T1], stOther.jar, DESK)));
check("a stager cannot release a hold", denied(await call(A, "releaseHold", [DM.id, "trying it"], stB.jar, DESK)));
check("a stager cannot list the stagers to hand on to", denied(await call(A, "listStagersForHolds", [L], stB.jar, DESK)));

// ── Taking: one holder per category, one category per stager ──
const race = await Promise.all([call(A, "takeDivision", [DF.id], stA.jar, DESK), call(A, "takeDivision", [DF.id], stB.jar, DESK)]);
const won = race.filter((r) => r.value?.success === true).length;
check("two stagers taking the same category at once: exactly one gets it", won === 1, JSON.stringify(race.map((r) => r.value)));
const winner = race[0].value?.success ? stA : stB;
check("the winner can hand it back", (await call(A, "handBackDivision", [DF.id], winner.jar, WS(DF.id))).value?.success === true);

check("a stager takes a category", (await call(A, "takeDivision", [DM.id], stA.jar, DESK)).value?.success === true);
const taken = await call(A, "takeDivision", [DM.id], stB.jar, DESK);
check("another stager is told who has it", taken.value?.success === false && /Asha/.test(taken.value.error ?? ""));
check("a stager holds one category at a time", denied(await call(A, "takeDivision", [DF.id], stA.jar, DESK)));
const deskA = await call(A, "getStagerDesk", [L], stA.jar, DESK);
check("the desk shows the category in the stager's hands", deskA.value?.mine === DM.id);

// ── The workspace belongs to the holder (and the admin can look) ──
const ws = (await call(A, "getDivisionWorkspace", [DM.id], stA.jar, WS(DM.id))).value;
const kumite = ws?.events.find((e) => e.eventType === "kumite");
const [g1] = kumite?.groups ?? [];
check("the holder sees the groups", ws?.youHold === true && g1?.members.length > 0);
check("another stager sees no drafts", (await call(A, "getDivisionWorkspace", [DM.id], stB.jar, WS(DM.id))).value === null);
const memberName = (await sql`select name from athletes where id=${g1.members[0]}`)[0].name;
const otherPage = await (await page(WS(DM.id), stB.jar)).text();
check("nor on the category's page", otherPage.includes("Asha is preparing it") && !otherPage.includes(memberName));
const adminView = (await call(A, "getDivisionWorkspace", [DM.id], admin, ADMIN_STAGING)).value;
check("the admin can look, read only", adminView?.youHold === false && adminView.events.length === ws.events.length);

const [a1, a2] = g1.members;
for (const [name, args] of [
  ["moveAthlete", [DM.id, { athleteId: a1, eventType: "kumite", to: null }]],
  ["placeAthlete", [g1.id, { athleteId: a1, place: 1 }]],
  ["swapAthletes", [g1.id, { a: a1, b: a2 }]],
  ["shuffleGroup", [g1.id]],
  ["addGroup", [DM.id, "kumite"]],
  ["lockGroup", [g1.id, g1.checksum]],
  ["setAttendanceLocal", [DM.id, a1, "absent"]],
  ["registerWalkIn", [DM.id, { name: "Sneaky Walkin", club: "Tiger" }, true]],
  ["restoreEventDraft", [DM.id, "kumite", { groups: [] }, {}]],
  ["handBackDivision", [DM.id]],
]) {
  check(`only the holder can ${name}: not another stager`, denied(await call(A, name, args, stB.jar, WS(DM.id))));
  if (["moveAthlete", "lockGroup", "addGroup"].includes(name)) {
    check(`only the holder can ${name}: not the admin while a stager holds it`, denied(await call(A, name, args, admin, ADMIN_STAGING)));
  }
}
check("nothing changed", (await sql`select count(*)::int as n from category_entries where category_id=${g1.id}`)[0].n === g1.members.length);

// ── The holder's changes ──
const W = WS(DM.id);
const fresh = async () => (await call(A, "getDivisionWorkspace", [DM.id], stA.jar, W)).value;
const group = async (id) => (await fresh()).events.find((e) => e.eventType === "kumite").groups.find((g) => g.id === id);
const before = await group(g1.id);
check("a pin from a stale view is refused", (await call(A, "placeAthlete", [g1.id, { athleteId: a1, place: 1, expectedVersion: before.version - 1 }], stA.jar, W)).value?.success === false);
const swap = await call(A, "swapAthletes", [g1.id, { a: a1, b: a2, expectedVersion: before.version }], stA.jar, W);
const swapped = await group(g1.id);
check("a swap pins both athletes", swap.value?.success === true && swapped.pins[a1] !== undefined && swapped.pins[a2] !== undefined);
const snapshot = { groups: [{ id: g1.id, members: before.members, pins: before.pins, seed: before.seed }] };
const otherGroups = (await fresh()).events.find((e) => e.eventType === "kumite").groups.filter((g) => g.id !== g1.id && !g.locked);
snapshot.groups.push(...otherGroups.map((g) => ({ id: g.id, members: g.members, pins: g.pins, seed: g.seed })));
const versions = Object.fromEntries((await fresh()).events.find((e) => e.eventType === "kumite").groups.filter((g) => !g.locked).map((g) => [g.id, g.version]));
const undo = await call(A, "restoreEventDraft", [DM.id, "kumite", snapshot, versions], stA.jar, W);
check("undo puts the group back as it was", undo.value?.success === true && Object.keys((await group(g1.id)).pins).length === Object.keys(before.pins).length);
check("undo from a stale view is refused", (await call(A, "restoreEventDraft", [DM.id, "kumite", snapshot, versions], stA.jar, W)).value?.success === false);
const walk = await call(A, "registerWalkIn", [DM.id, { name: "Desk Walkin", club: "Tiger" }, false], stA.jar, W);
check("the holder registers a walk-in", walk.value?.success === true && typeof walk.value.athleteId === "string");
const [walkRow] = await sql`select walk_in, needs_review from athletes where id=${walk.value.athleteId}`;
check("flagged as a walk-in for the admin to review", walkRow?.walk_in === true && walkRow.needs_review === true);

const shown = await group(g1.id);
check("a lock against a draw that changed since is refused", (await call(A, "lockGroup", [g1.id, "0".repeat(64)], stA.jar, W)).value?.success === false);
const lock = await call(A, "lockGroup", [g1.id, shown.checksum], stA.jar, W);
const [draw] = await sql`select state, checksum from draws where category_id=${g1.id}`;
check("the holder locks a group: the draw shown is the draw stored", lock.value?.success === true && draw?.state === "LOCKED" && draw.checksum === shown.checksum);
check("a locked group can't be changed at the desk", (await call(A, "shuffleGroup", [g1.id], stA.jar, W)).value?.success === false);
const [lockAudit] = await sql`select actor_role, actor_name from audit_log where tournament_id=${L} and action='GROUP_LOCKED' and target_id=${g1.id}`;
check("the lock is audited with the stager's name", lockAudit?.actor_role === "stager" && lockAudit.actor_name === "Asha");

// ── The admin's hand on holds ──
check("a release needs a reason", (await call(A, "releaseHold", [DM.id, "x"], admin, ADMIN_STAGING)).value?.success === false);
const stagers = (await call(A, "listStagersForHolds", [L], admin, ADMIN_STAGING)).value ?? [];
check("the admin sees the signed-in stagers by name", stagers.some((s) => s.name === "Bilal") && stagers.some((s) => s.name === "Asha"));
const reassign = await call(A, "reassignHold", [DM.id, stB.requestId, "Asha went to lunch"], admin, ADMIN_STAGING);
check("the admin hands a category to another stager", reassign.value?.success === true);
check("the old holder can no longer change it", denied(await call(A, "moveAthlete", [DM.id, { athleteId: a1, eventType: "kumite", to: null }], stA.jar, W)));
check("the new holder can", (await call(A, "getDivisionWorkspace", [DM.id], stB.jar, W)).value?.youHold === true);
const [handOn] = await sql`select reason from audit_log where tournament_id=${L} and action='DIVISION_HOLD_REASSIGNED' order by created_at desc limit 1`;
check("the hand-on is audited with its reason", handOn?.reason === "Asha went to lunch");

// ── A hold belongs to the stager code, not the phone ──
await call(A, "logoutStager", [], stB.jar, DESK);
check("signed out, the stager can't change it", denied(await call(A, "getDivisionWorkspace", [DM.id], stB.jar, W)));
const again = await stagerSession(L, "Bilal", codeB);
const deskAgain = await call(A, "getStagerDesk", [L], again.jar, DESK);
check("signing in again with the same code carries on with the same category", deskAgain.value?.mine === DM.id);
check("and can change it", (await call(A, "getDivisionWorkspace", [DM.id], again.jar, W)).value?.youHold === true);

// ── No stager code reaches a browser ──
const raws = [
  (await call(A, "getStagerDesk", [L], again.jar, DESK)).raw,
  (await call(A, "getDivisionWorkspace", [DM.id], again.jar, W)).raw,
  (await call(A, "listStagersForHolds", [L], admin, ADMIN_STAGING)).raw,
  (await call(A, "getStagerDesk", [L], admin, ADMIN_STAGING)).raw,
  deskHtml,
];
check("no response carries a stager code or its hash", raws.every((r) => !r.includes(codeA) && !r.includes(codeB) && !/code_?hash/i.test(r)));

// ── Removing the code ends its hold ──
await call(A, "removeStagerCode", [L, codeB], admin, `/admin/event/${L}/rings`);
check("removing a stager code frees the category it held", (await sql`select count(*)::int as n from division_holds where division_id=${DM.id}`)[0].n === 0);

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
