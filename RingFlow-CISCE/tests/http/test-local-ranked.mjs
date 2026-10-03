// Local tournaments: a ranked kata group on the mat. The moderator queue's labels (waiting, being
// prepared, ready), scoring performances with no winner, an athlete who didn't perform, the
// ranking and its tie-breaks, the desk decision on a medal tie (who may record it, and when), and
// that the group can't be finished while a medal tie is undecided.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const [T1, T1_RING] = process.argv.slice(2); // the seeded Official tournament and one of its tatamis
const page = (path, jar) => fetch(BASE + path, { headers: { Cookie: jar.header() }, redirect: "manual" });
/**
 * The request gate only checks that a moderator cookie is there; a made-up one lets the call reach the
 * action's own guard, which is what these checks are about.
 */
function pastGate(jar) {
  const j = new Jar();
  for (const [k, v] of jar.c) j.c.set(k, v);
  if (!j.c.has("mod_token")) j.c.set("mod_token", "not-a-session");
  return j;
}
/** Refused by the action itself: not a gate redirect, and not "no such action on this route" (an empty {}). */
const refused = (r) => !(r.status >= 300 && r.status < 400) && r.raw?.trim() !== "{}" && (r.value === undefined || r.value === null || r.value?.success === false);

const admin = new Jar();
let A = loadActions();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
A = loadActions();

// ── A Local tournament: one kata group of five on tatami 1 ──
const L = (await call(A, "createTournament", [{ name: "Ranked kata check", categories: [], ringCount: 2, tournament_type: "LOCAL" }], admin)).value;
const [R1, R2] = (await sql`select id from rings where tournament_id=${L} order by ring_order`).map((r) => r.id);
for (const p of ["categories", "athletes", "rings", "staging"]) await page(`/admin/event/${L}/${p}`, admin);
A = loadActions();
const CAT = `/admin/event/${L}/categories`;
await call(A, "generateDivisions", [L, { ages: [{ min: 10, max: 10 }], beltBands: [["Green"]], sexes: ["F"] }], admin, CAT);
const names = ["Kata One", "Kata Two", "Kata Three", "Kata Four", "Kata Five"];
const clubs = ["Sakura", "Kaizen", "Tiger", "Lotus", "Crane"];
await call(A, "importLocalRoster", [L, names.map((name, i) => ({ name, club: clubs[i], age: 10, belt: "Green", sex: "F", kumite: "No", kata: "Yes" }))], admin, `/admin/event/${L}/athletes`);
const [D] = await sql`select id from divisions where tournament_id=${L}`;
const [kataEvent] = await sql`select id from division_events where division_id=${D.id} and event_type='kata'`;
await call(A, "setDivisionEvent", [kataEvent.id, { groupSize: 5, bronzeMedals: 2 }], admin, CAT);
await call(A, "buildDivisionStartingGroups", [D.id], admin, CAT);
await call(A, "assignDivisionToRing", [D.id, R1], admin, CAT);
const [G] = await sql`select id from categories where division_event_id=${kataEvent.id}`;
const [card] = await sql`select id from category_assignments where category_id=${G.id}`;

// ── Staff ──
async function moderatorOf(ringId, name) {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await sql`update rings set access_code=${code} where id=${ringId}`;
  const jar = new Jar();
  const req = await call(A, "requestModeratorAccess", [code, name, {}, "offline-bypass"], jar);
  await call(A, "approveModeratorRequest", [req.value.requestId, ringId, L], admin, `/admin/event/${L}/rings`);
  await call(A, "checkModeratorStatus", [req.value.requestId], jar);
  return jar;
}
const mod = await moderatorOf(R1, "Mat 1");
const mod2 = await moderatorOf(R2, "Mat 2");
const stCode = (await call(A, "generateStagerCodes", [L, 1], admin)).value.stager_codes.at(-1).code;
const st = new Jar();
const sreq = await call(A, "requestStagerAccess", [stCode, "Asha", {}, "offline-bypass"], st);
await call(A, "approveStagerRequest", [sreq.value.requestId, L], admin);
await call(A, "checkStagerStatus", [sreq.value.requestId], st);
const org = new Jar();
const orgCode = (await call(A, "regenerateOrganiserCode", [L], admin)).value?.organiser_code;
const oreq = await call(A, "requestOrganiserAccess", [orgCode, "Observer", {}, "offline-bypass"], org);
await call(A, "approveOrganiserRequest", [oreq.value.requestId, L], admin);
await call(A, "checkOrganiserStatus", [oreq.value.requestId], org);

const QUEUE = `/moderator/ring/${R1}/queue`;
const CURRENT = `/moderator/ring/${R1}/current`;
await page(QUEUE, mod);
await page(CURRENT, mod);
await page(`/stager/event/${L}/category/${D.id}`, st);
A = loadActions();

// ── The queue says where the group is ──
const queueText = async () => (await (await page(QUEUE, mod)).text());
check("a group nobody has taken waits for the stager, with no Start", (await queueText()).includes("Waiting for stager") && !(await queueText()).includes("Start this category"));
await call(A, "takeDivision", [D.id], st, `/stager/event/${L}`);
check("a held group shows who is preparing it", (await queueText()).includes("Being prepared by Asha"));
const ws = (await call(A, "getDivisionWorkspace", [D.id], st, `/stager/event/${L}/category/${D.id}`)).value;
const group = ws.events.find((e) => e.eventType === "kata").groups[0];
check("the stager locks the group", (await call(A, "lockGroup", [group.id, group.checksum], st, `/stager/event/${L}/category/${D.id}`)).value?.success === true);
const ready = await queueText();
check("a locked group is ready and can start", ready.includes("Ready") && ready.includes("Start this category"));
check("the moderator starts it", (await call(A, "startCategory", [card.id, R1], mod, QUEUE)).value?.success === true);

// ── Scoring performances ──
const bouts = await sql`select m.id, m.match_no,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=1) as aka,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=2) as ao
  from matches m where m.category_id=${G.id} order by m.match_no`;
check("five athletes perform in two pairs and a solo", bouts.length === 3 && bouts[2].ao === null);
const seats = (marks, side) => marks.map((m, i) => ({ seat: i + 1, [side]: m }));
const score = (matchId, aka, ao, extra = {}) =>
  call(A, "submitModeratorManualKataMarks", [{ matchId, seats: [...(aka ? seats(aka, "aka") : []), ...(ao ? seats(ao, "ao") : [])], ...extra }], mod, CURRENT);

// Pair 1: Red 21.0 (drops 6.8 and 7.4), Blue 21.6.
const s1 = await score(bouts[0].id, [7.0, 7.0, 7.0, 6.8, 7.4], [7.2, 7.2, 7.2, 7.0, 7.4], { finalize: true });
const [m1] = await sql`select status, winner_id, winner_side, decision_method from matches where id=${bouts[0].id}`;
check("a ranked pair is confirmed with no winner", s1.value?.success === true && m1.status === "CONFIRMED" && m1.winner_id === null && m1.winner_side === null && m1.decision_method === "RANKED");
const [ring1] = await sql`select current_match_id from rings where id=${R1}`;
check("the next pair comes up on the tatami", ring1.current_match_id === bouts[1].id);

// Pair 2: Red exactly level with pair 1's Red, Blue doesn't perform.
check("a pair can't be confirmed while someone has no total", refused(await score(bouts[1].id, [7.0, 7.0, 7.0, 6.8, 7.4], null, { finalize: true })));
const s2 = await call(A, "submitModeratorManualKataMarks", [{ matchId: bouts[1].id, finalize: true, notPerformed: ["AO"] }], mod, CURRENT);
check("the desk marks an athlete who didn't perform", s2.value?.success === true);

const standingsBy = (jar, via) => call(A, "getRankedStandings", [G.id], jar, via);
let st1 = (await standingsBy(mod, CURRENT)).value;
check("the ranking waits for the last performance", st1?.complete === false && st1.final === false);
const tieIds = [bouts[0].aka, bouts[1].aka];
check("a tie can't be decided before everyone has performed",
  refused(await call(A, "resolveKataTie", [{ matchId: bouts[0].id, athleteIds: tieIds, method: "REPERFORMANCE", note: "too early" }], mod, CURRENT)));

// The solo: 19.5.
check("the solo performance is confirmed", (await score(bouts[2].id, [6.5, 6.5, 6.5, 6.0, 7.0], null, { finalize: true })).value?.success === true);
st1 = (await standingsBy(mod, CURRENT)).value;
const row = (id) => st1.standings.find((s) => s.athleteId === id);
check("highest total is gold", row(bouts[0].ao)?.label === "1" && row(bouts[0].ao)?.medal === "gold");
check("two athletes level on total and dropped marks share 2nd, medals pending",
  row(tieIds[0])?.label === "2=" && row(tieIds[1])?.label === "2=" && row(tieIds[0])?.medal === null);
check("fourth of five takes the second bronze", row(bouts[2].aka)?.label === "4" && row(bouts[2].aka)?.medal === "bronze");
check("the athlete who didn't perform ranks last with no medal", row(bouts[1].ao)?.label === "DNP" && row(bouts[1].ao)?.medal === null);
check("the podium isn't final while the medal tie stands", st1.complete === true && st1.final === false && st1.medalTies.length === 1);

// ── Who sees the ranking ──
check("the organiser can read the ranking", (await standingsBy(pastGate(org), CURRENT)).value?.categoryId === G.id);
check("a visitor cannot", refused(await standingsBy(pastGate(new Jar()), CURRENT)));
const otherMod = new Jar();
{
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await sql`update rings set access_code=${code} where id=${T1_RING}`;
  const req = await call(A, "requestModeratorAccess", [code, "Elsewhere", {}, "offline-bypass"], otherMod);
  await call(A, "approveModeratorRequest", [req.value.requestId, T1_RING, T1], admin, `/admin/event/${T1}/rings`);
  await call(A, "checkModeratorStatus", [req.value.requestId], otherMod);
}
check("another tournament's moderator cannot", refused(await standingsBy(otherMod, CURRENT)));

// ── The desk decision ──
check("the tie can't hold up the end: finishing is refused", refused(await call(A, "finishCategory", [card.id, R1], mod, CURRENT)));
const decision = { matchId: bouts[0].id, athleteIds: [tieIds[1], tieIds[0]], method: "FLAG_VOTE", note: "Flag vote 3-2 after re-call" };
check("a stager can't decide a tie", refused(await call(A, "resolveKataTie", [decision], pastGate(st), CURRENT)));
check("another tatami's moderator can't", refused(await call(A, "resolveKataTie", [decision], mod2, CURRENT)));
check("the admin can't (the moderator records it)", refused(await call(A, "resolveKataTie", [decision], pastGate(admin), CURRENT)));
check("athletes who aren't tied are refused",
  refused(await call(A, "resolveKataTie", [{ ...decision, athleteIds: [bouts[0].ao, tieIds[0]] }], mod, CURRENT)));
check("a decision needs a note", refused(await call(A, "resolveKataTie", [{ ...decision, note: "" }], mod, CURRENT)));
check("nothing was recorded by any of them", (await sql`select count(*)::int as n from kata_tie_decisions where category_id=${G.id}`)[0].n === 0);
const decided = await call(A, "resolveKataTie", [decision], mod, CURRENT);
const after = decided.value?.standings;
const rowAfter = (id) => after?.standings.find((s) => s.athleteId === id);
check("the moderator decides it: silver and bronze follow the order", decided.value?.success === true && rowAfter(tieIds[1])?.medal === "silver" && rowAfter(tieIds[0])?.medal === "bronze");
check("and the podium is final", after?.final === true);
const [auditRow] = await sql`select reason, after from audit_log where tournament_id=${L} and action='KATA_TIE_DECIDED'`;
check("the decision is audited with its note", auditRow?.reason === decision.note && auditRow.after.method === "FLAG_VOTE");
await call(A, "resolveKataTie", [{ ...decision, athleteIds: tieIds, note: "Corrected: wrong order entered" }], mod, CURRENT);
const rows = await sql`select athlete_ids from kata_tie_decisions where category_id=${G.id}`;
check("deciding the same tie again replaces the order", rows.length === 1 && rows[0].athlete_ids[0] === tieIds[0]);
check("then the group finishes", (await call(A, "finishCategory", [card.id, R1], mod, CURRENT)).value?.success === true);

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
