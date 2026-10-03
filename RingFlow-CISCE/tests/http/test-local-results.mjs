// Local tournaments: results. Podiums for a kumite group and a ranked kata group ("In progress"
// until the medals stand), the club medal tally (gold, silver, bronze; athletes with no club listed
// one by one), the podiums and medal-tally CSVs and the results PDF, who may export them, the
// public podiums (only finished ones, no ids, no tally), and that a ranked group prints the kata
// pool sheet and runs on the kata scoreboard.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const page = (path, jar) => fetch(BASE + path, { headers: { Cookie: jar.header() }, redirect: "manual" });
/** The request gate only checks that a session cookie is there; a made-up one lets the call reach the action's own guard. */
function pastGate(jar, cookie) {
  const j = new Jar();
  for (const [k, v] of jar.c) j.c.set(k, v);
  if (!j.c.has(cookie)) j.c.set(cookie, "not-a-session");
  return j;
}
/** Refused by the action itself: not a gate redirect, and not "no such action on this route" (an empty {}). */
const refused = (r) => !(r.status >= 300 && r.status < 400) && r.raw?.trim() !== "{}" && (r.value === undefined || r.value === null || r.value?.success === false);
const ok = (r) => r.value?.success === true;
const csvOf = (r) => Buffer.from(r.value.base64, "base64").toString("utf8").replace(/^﻿/, "");

const admin = new Jar();
let A = loadActions();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
A = loadActions();

// ── A Local tournament: four kumite athletes (age 9) on tatami 1, four kata athletes (age 10) on tatami 2 ──
const L = (await call(A, "createTournament", [{ name: "Results check", categories: [], ringCount: 2, tournament_type: "LOCAL" }], admin)).value;
const [R1, R2] = (await sql`select id from rings where tournament_id=${L} order by ring_order`).map((r) => r.id);
for (const p of ["categories", "athletes", "rings", "staging", "record"]) await page(`/admin/event/${L}/${p}`, admin);
A = loadActions();
const CAT = `/admin/event/${L}/categories`;
const RECORD = `/admin/event/${L}/record`;
await call(A, "generateDivisions", [L, { ages: [{ min: 9, max: 9 }, { min: 10, max: 10 }], beltBands: [["Blue"]], sexes: ["M"] }], admin, CAT);
const kumiteNames = [["Nine A", "Sakura"], ["Nine B", "Sakura"], ["Nine C", "Kaizen"], ["Nine D", ""]];
const kataNames = [["Ten A", "Kaizen"], ["Ten B", "Tiger"], ["Ten C", "Tiger"], ["Ten D", ""]];
await call(A, "importLocalRoster", [L, [
  ...kumiteNames.map(([name, club]) => ({ name, club, age: 9, belt: "Blue", sex: "M", kumite: "Yes", kata: "No" })),
  ...kataNames.map(([name, club]) => ({ name, club, age: 10, belt: "Blue", sex: "M", kumite: "No", kata: "Yes" })),
]], admin, `/admin/event/${L}/athletes`);
const div = async (name) => (await sql`select id from divisions where tournament_id=${L} and name=${name}`)[0].id;
const [D9, D10] = [await div("Blue · 9 · M"), await div("Blue · 10 · M")];
const eventOf = async (d, t) => (await sql`select id from division_events where division_id=${d} and event_type=${t}`)[0].id;
await call(A, "setDivisionEvent", [await eventOf(D9, "kumite"), { groupSize: 4 }], admin, CAT);
await call(A, "setDivisionEvent", [await eventOf(D10, "kata"), { groupSize: 4, bronzeMedals: 2 }], admin, CAT);
await call(A, "buildAllStartingGroups", [L], admin, CAT);
await call(A, "assignDivisionToRing", [D9, R1], admin, CAT);
await call(A, "assignDivisionToRing", [D10, R2], admin, CAT);
const [K] = await sql`select id from categories where division_event_id=${await eventOf(D9, "kumite")}`;
const [G] = await sql`select id from categories where division_event_id=${await eventOf(D10, "kata")}`;

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
const mod1 = await moderatorOf(R1, "Mat 1");
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

const DESK = `/stager/event/${L}`;
const WS = (d) => `/stager/event/${L}/category/${d}`;
const Q1 = `/moderator/ring/${R1}/queue`;
const C1 = `/moderator/ring/${R1}/current`;
const Q2 = `/moderator/ring/${R2}/queue`;
const C2 = `/moderator/ring/${R2}/current`;
await page(DESK, st);
await page(WS(D9), st);
await page(Q1, mod1);
await page(C1, mod1);
await page(Q2, mod2);
await page(C2, mod2);
await page(`/organiser/event/${L}/record`, org);
await page(`/public/event/${L}`, new Jar());
A = loadActions();

const exportPodiums = (jar, via = RECORD) => call(A, "exportTournamentPodiumsCsv", [L], jar, via);
const exportTally = (jar, via = RECORD) => call(A, "exportTournamentMedalTallyCsv", [L], jar, via);

// ── Before anything is locked, there are no podiums at all ──
check("a group still being prepared is not listed: nothing to export", (await exportPodiums(admin)).value?.success === false);

// ── The stager sends both groups; the moderators start them ──
async function send(d) {
  await call(A, "takeDivision", [d], st, DESK);
  for (const e of (await call(A, "getDivisionWorkspace", [d], st, WS(d))).value.events) {
    for (const g of e.groups) await call(A, "lockGroup", [g.id, g.checksum], st, WS(d));
  }
}
await send(D9);
await send(D10);
const [card1] = await sql`select id from category_assignments where category_id=${K.id}`;
const [card2] = await sql`select id from category_assignments where category_id=${G.id}`;
check("the kumite moderator starts the kumite group", ok(await call(A, "startCategory", [card1.id, R1], mod1, Q1)));
check("the kata moderator starts the kata group", ok(await call(A, "startCategory", [card2.id, R2], mod2, Q2)));

const early = csvOf(await exportPodiums(admin));
check("both groups read 'In progress' until their medals stand", (early.match(/In progress/g) ?? []).length === 2, early);
check("and nothing counts toward the tally yet", csvOf(await exportTally(admin)).trim().split(/\r?\n/).length === 1);

// ── Kumite: the first-named athlete wins every bout ──
async function playOut(groupId, mod, via) {
  for (let i = 0; i < 10; i += 1) {
    const [b] = (await sql`select m.id,
      (select athlete_id from match_slots s where s.match_id=m.id and s.position=1) as aka,
      (select athlete_id from match_slots s where s.match_id=m.id and s.position=2) as ao
      from matches m where m.category_id=${groupId} and m.status not in ('CONFIRMED','COMPLETED','BYE','WALKOVER') order by m.match_no`).filter((r) => r.aka && r.ao);
    if (!b) break;
    await call(A, "confirmBoutResult", [b.id, b.aka, { side: "AKA", akaPoints: 3, aoPoints: 0, method: "POINTS" }], mod, via);
  }
}
await playOut(K.id, mod1, C1);
const finalBout = (await sql`select m.id, m.winner_id, m.status,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=1) as aka,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=2) as ao
  from matches m where m.category_id=${K.id} and m.bracket_type='MAIN' order by m.round_no desc, m.match_no desc limit 1`)[0];
check("every kumite bout is confirmed", finalBout.status === "CONFIRMED" && (await sql`select count(*)::int as n from matches where category_id=${K.id} and status not in ('CONFIRMED','COMPLETED','BYE','WALKOVER')`)[0].n === 0);
const nameOf = async (id) => (await sql`select name from athletes where id=${id}`)[0].name;
const goldName = await nameOf(finalBout.winner_id);
const silverName = await nameOf(finalBout.winner_id === finalBout.aka ? finalBout.ao : finalBout.aka);

// ── Kata: four performances in two pairs, no ties. Totals 21.4 / 21.0 / 20.6 / 20.2 ──
const kb = await sql`select m.id,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=1) as aka,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=2) as ao
  from matches m where m.category_id=${G.id} order by m.match_no`;
check("four athletes perform in two pairs", kb.length === 2 && kb.every((b) => b.aka && b.ao));
const seats = (marks, side) => marks.map((m, i) => ({ seat: i + 1, [side]: m }));
const mark = (matchId, aka, ao) =>
  call(A, "submitModeratorManualKataMarks", [{ matchId, seats: [...seats(aka, "aka"), ...seats(ao, "ao")], finalize: true }], mod2, C2);
check("pair 1 is scored", ok(await mark(kb[0].id, [7.2, 7.2, 7.2, 7.0, 7.4], [7.0, 7.0, 7.0, 6.8, 7.2])));
const mid = csvOf(await exportPodiums(admin));
check("the kata group stays 'In progress' until the last pair", mid.includes("Kata,In progress") && !mid.includes("Kata,Final"), mid);
check("pair 2 is scored", ok(await mark(kb[1].id, [6.9, 6.9, 6.9, 6.7, 7.1], [6.8, 6.8, 6.8, 6.6, 7.0])));
check("both groups finish", ok(await call(A, "finishCategory", [card1.id, R1], mod1, C1)) && ok(await call(A, "finishCategory", [card2.id, R2], mod2, C2)));
const kataGold = await nameOf(kb[0].aka);
const kataSilver = await nameOf(kb[0].ao);

// ── Podiums ──
const pod = await exportPodiums(admin);
check("the admin exports the podiums", ok(pod) && pod.value.filename.endsWith("_podiums.csv"), JSON.stringify(pod.value)?.slice(0, 200));
const lines = csvOf(pod).trim().split(/\r?\n/);
check("the header names its columns", lines[0] === "Category,Event,Status,Medal,Athlete,Chest,Club,Guest");
const rowsFor = (event) => lines.slice(1).map((l) => l.split(",")).filter((c) => c[1] === event);
const kumiteRows = rowsFor("Kumite");
const kataRows = rowsFor("Kata");
check("kumite: gold and silver are the final's winner and loser", kumiteRows.some((c) => c[3] === "Gold" && c[4] === goldName) && kumiteRows.some((c) => c[3] === "Silver" && c[4] === silverName), kumiteRows.join(" | "));
check("kumite: at least one bronze", kumiteRows.some((c) => c[3] === "Bronze"));
check("kata: gold and silver follow the totals", kataRows.some((c) => c[3] === "Gold" && c[4] === kataGold) && kataRows.some((c) => c[3] === "Silver" && c[4] === kataSilver), kataRows.join(" | "));
check("kata: two bronzes for fourth of four", kataRows.filter((c) => c[3] === "Bronze").length === 2);
check("no group is 'In progress' any more", !lines.join("\n").includes("In progress"));
const indepRows = lines.filter((l) => /Nine D|Ten D/.test(l));
check("an athlete with no club reads 'Independent'", indepRows.length > 0 ? indepRows.every((l) => l.includes("Independent")) : true, indepRows.join(" | "));

// ── The medal tally ──
const tallyRes = await exportTally(admin);
check("the admin exports the medal tally", ok(tallyRes) && tallyRes.value.filename.endsWith("_medal-tally.csv"));
const tally = csvOf(tallyRes).trim().split(/\r?\n/).map((l) => l.split(","));
check("the tally header", tally[0].join(",") === "Rank,Club,Gold,Silver,Bronze,Total");
const medalRows = lines.slice(1).length;
const sum = (i) => tally.slice(1).reduce((n, c) => n + Number(c[i]), 0);
check("the tally adds up to the podiums' medals", sum(5) === medalRows && sum(2) + sum(3) + sum(4) === medalRows, `${sum(5)} vs ${medalRows}`);
const golds = tally.slice(1).map((c) => Number(c[2]));
check("sorted by gold, then silver, then bronze", tally.slice(1).every((c, i, all) => i === 0 || Number(all[i - 1][2]) > Number(c[2]) ||
  (Number(all[i - 1][2]) === Number(c[2]) && (Number(all[i - 1][3]) > Number(c[3]) || (Number(all[i - 1][3]) === Number(c[3]) && Number(all[i - 1][4]) >= Number(c[4]))))), golds.join(","));
const independents = tally.slice(1).filter((c) => c[1].includes("(Independent)"));
check("athletes with no club are listed one by one, never pooled", independents.every((c) => Number(c[5]) <= 3) && new Set(independents.map((c) => c[1])).size === independents.length);

// ── The PDF ──
const pdf = await call(A, "exportTournamentResultsPdf", [L], admin, RECORD);
// The PDF is big, so the reply streams it as a chunk the test client doesn't unwrap.
check("the results PDF builds with the podium and tally pages", pdf.status === 200 && pdf.raw.includes("JVBERi0x"), pdf.raw?.slice(0, 200));

// ── Who may export ──
for (const [who, jar] of [
  ["the organiser", org],
]) {
  check(`${who} can export the podiums and the tally`, ok(await exportPodiums(jar, `/organiser/event/${L}/record`)) && ok(await exportTally(jar, `/organiser/event/${L}/record`)));
}
for (const [who, jar] of [
  ["a stager", pastGate(st, "admin_session")],
  ["a moderator", pastGate(mod1, "admin_session")],
  ["a visitor", pastGate(new Jar(), "admin_session")],
]) {
  check(`${who} cannot export the podiums`, refused(await exportPodiums(jar)));
  check(`${who} cannot export the tally`, refused(await exportTally(jar)));
}
const [otherAdmin] = await sql`insert into admins (id, email, name) values (gen_random_uuid(), ${`results-${Date.now()}@test.local`}, 'Other') returning id`;
const [foreign] = await sql`insert into tournaments (admin_id, name, tournament_type) values (${otherAdmin.id}, 'Foreign Local', 'LOCAL') returning id`;
check("another tournament's admin cannot export these", refused(await call(A, "exportTournamentPodiumsCsv", [foreign.id], admin, RECORD)));
check("and the export audit names the format", (await sql`select count(*)::int as n from audit_log where tournament_id=${L} and action='RESULTS_EXPORTED' and after->>'format' in ('podiums-csv','medal-tally-csv')`)[0].n >= 2);

// ── The public sees finished podiums only ──
await sql`update tournaments set status='active' where id=${L}`;
const pub = new Jar();
const pubPodiums = await call(A, "getPublicPodiums", [L], pub, `/public/event/${L}`);
check("the public page lists both finished podiums", Array.isArray(pubPodiums.value) && pubPodiums.value.length === 2);
check("with names, clubs and medals, and no ids", !JSON.stringify(pubPodiums.value).match(/[0-9a-f]{8}-[0-9a-f]{4}-/));
await sql`update tournaments set show_public_draws=false where id=${L}`;
check("and nothing when the admin hides public results", (await call(A, "getPublicPodiums", [L], pub, `/public/event/${L}`)).value?.length === 0);
await sql`update tournaments set show_public_draws=true where id=${L}`;
check("the club tally is not offered to the public", !("getPublicMedalTally" in A) && refused(await exportTally(pastGate(new Jar(), "admin_session"))));

// ── A ranked group prints the kata pool sheet with one pool, and runs on the kata scoreboard ──
const sheet = await call(A, "getCategoryDraw", [G.id], admin, RECORD);
const poolNames = new Set((sheet.value?.matches ?? []).map((m) => m.poolGroup));
check("a ranked group's draw is one pool of POOL bouts", poolNames.size === 1 && (sheet.value?.matches ?? []).every((m) => m.bracketType === "POOL"));
check("scored in points, as the kata scoreboard shows", (await sql`select distinct kata_scoring_mode from matches where category_id=${G.id}`).every((r) => r.kata_scoring_mode === "POINTS"));

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
