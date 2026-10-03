// Local tournaments: changes after a group is locked. Only the admin may make them, with a reason.
// Unlocking a group before its first bout; adding, taking out and moving athletes before it starts
// (everyone else keeps their place); a late kumite athlete filling a bye in a group under way, and
// refused once the bye-holder has fought on; a late kata athlete appended; a guest from another
// category; nothing on a finished group. Then walk-ins: the admin's review and merge.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const [T1] = process.argv.slice(2); // the seeded Official tournament
const page = (path, jar) => fetch(BASE + path, { headers: { Cookie: jar.header() }, redirect: "manual" });
/** The request gate only checks that a session cookie is there; a made-up one lets the call reach the action's own guard. */
function pastGate(jar, cookie = "stager_token") {
  const j = new Jar();
  for (const [k, v] of jar.c) j.c.set(k, v);
  if (!j.c.has(cookie)) j.c.set(cookie, "not-a-session");
  return j;
}
/** Refused by the action itself: not a gate redirect, and not "no such action on this route" (an empty {}). */
const refused = (r) => !(r.status >= 300 && r.status < 400) && r.raw?.trim() !== "{}" && (r.value === undefined || r.value === null || r.value?.success === false);
const ok = (r) => r.value?.success === true;

const admin = new Jar();
let A = loadActions();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
A = loadActions();

// ── A Local tournament: Blue 9 M (two kumite groups of four, one kata group) on tatami 1, Blue 10 M on tatami 2 ──
const L = (await call(A, "createTournament", [{ name: "Late changes check", categories: [], ringCount: 2, tournament_type: "LOCAL" }], admin)).value;
const [R1, R2] = (await sql`select id from rings where tournament_id=${L} order by ring_order`).map((r) => r.id);
for (const p of ["categories", "athletes", "rings", "staging"]) await page(`/admin/event/${L}/${p}`, admin);
A = loadActions();
const CAT = `/admin/event/${L}/categories`;
await call(A, "generateDivisions", [L, { ages: [{ min: 9, max: 9 }, { min: 10, max: 10 }, { min: 11, max: 11 }], beltBands: [["Blue"]], sexes: ["M"] }], admin, CAT);
const roster = [
  ...Array.from({ length: 8 }, (_, i) => ({ name: `Nine ${i + 1}`, club: `Club ${i + 1}`, age: 9 })),
  ...["Ten 1", "Ten 2", "Ten 3", "Guesty Ten", "Spare Ten"].map((name, i) => ({ name, club: `Ten Club ${i + 1}`, age: 10 })),
  ...["Real Eleven", "Other Eleven"].map((name, i) => ({ name, club: `Eleven Club ${i + 1}`, age: 11 })),
].map((r) => ({ ...r, belt: "Blue", sex: "M", kumite: "Yes", kata: "Yes" }));
await call(A, "importLocalRoster", [L, roster], admin, `/admin/event/${L}/athletes`);
const div = async (name) => (await sql`select id from divisions where tournament_id=${L} and name=${name}`)[0].id;
const [D9, D10, D11] = [await div("Blue · 9 · M"), await div("Blue · 10 · M"), await div("Blue · 11 · M")];
const eventOf = async (d, t) => (await sql`select id from division_events where division_id=${d} and event_type=${t}`)[0].id;
await call(A, "setDivisionEvent", [await eventOf(D9, "kumite"), { groupSize: 4 }], admin, CAT);
for (const d of [D9, D10]) await call(A, "setDivisionEvent", [await eventOf(d, "kata"), { groupSize: 8 }], admin, CAT);
await call(A, "buildAllStartingGroups", [L], admin, CAT);
await call(A, "assignDivisionToRing", [D9, R1], admin, CAT);
await call(A, "assignDivisionToRing", [D10, R2], admin, CAT);
await call(A, "assignDivisionToRing", [D11, R2], admin, CAT);
const idOf = async (name) => (await sql`select id from athletes where tournament_id=${L} and name=${name}`)[0].id;

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
const ADMIN_WS = (d) => `/admin/event/${L}/staging/${d}`;
const STAGING = `/admin/event/${L}/staging`;
await page(DESK, st);
await page(WS(D9), st);
await page(ADMIN_WS(D9), admin);
await page(STAGING, admin);
await page(`/moderator/ring/${R1}/queue`, mod1);
await page(`/moderator/ring/${R1}/current`, mod1);
A = loadActions();

// ── The stager sends everything: Nine 8, Guesty and Spare don't turn up ──
const workspace = async (d, jar = st, via = WS(d)) => (await call(A, "getDivisionWorkspace", [d], jar, via)).value;
async function sendAll(d, absent) {
  await call(A, "takeDivision", [d], st, DESK);
  for (const name of absent) await call(A, "setAttendanceLocal", [d, await idOf(name), "absent"], st, WS(d));
  for (const e of (await workspace(d)).events) {
    for (const g of e.groups) await call(A, "lockGroup", [g.id, g.checksum], st, WS(d));
  }
}
await sendAll(D9, ["Nine 8"]);
await sendAll(D10, ["Guesty Ten", "Spare Ten"]);
const groupsOf = async (d, t) => (await workspace(d, admin, ADMIN_WS(d))).events.find((e) => e.eventType === t).groups;
const k9 = await groupsOf(D9, "kumite");
check("Blue 9 M is sent: two kumite groups and a kata group, all locked", k9.length === 2 && k9.every((g) => g.locked) && (await groupsOf(D9, "kata")).every((g) => g.locked));
check("and its hold ended with the last lock", (await sql`select count(*)::int as n from division_holds where division_id=${D9}`)[0].n === 0);
const small = k9.find((g) => g.members.length === 3);
const full = k9.find((g) => g.members.length === 4);
check("one kumite group has three (one bye), the other four", Boolean(small && full));
const [kata9] = await groupsOf(D9, "kata");

const firstRound = async (groupId) => {
  const rows = await sql`select m.match_no, s.position, s.athlete_id, s.slot_type from matches m join match_slots s on s.match_id=m.id
    where m.category_id=${groupId} and m.round_no=0 and m.bracket_type='MAIN' order by m.match_no, s.position`;
  return new Map(rows.filter((r) => r.athlete_id && r.slot_type === "ATHLETE").map((r) => [r.athlete_id, (r.match_no - 1) * 2 + r.position]));
};
const sameSpots = (before, after, except = []) => [...before].every(([id, p]) => except.includes(id) || after.get(id) === p);
const drawOf = async (groupId) => (await sql`select state, version, checksum, tournament_size from draws where category_id=${groupId}`)[0];
const lastAudit = async (action, groupId) =>
  (await sql`select * from audit_log where tournament_id=${L} and action=${action} and (${groupId}::uuid is null or category_id=${groupId}) order by created_at desc limit 1`)[0];

// ── Only the admin ──
const preview = (g, change, jar = admin, via = ADMIN_WS(D9)) => call(A, "previewLateChange", [g, change], jar, via);
const apply = (g, change, why, fp, jar = admin, via = ADMIN_WS(D9)) => call(A, "changeLockedGroup", [g, change, why, fp], jar, via);
async function late(g, change, why = "Arrived after the call") {
  const p = await preview(g, change);
  if (!ok(p)) return { preview: p, result: p };
  return { preview: p, result: await apply(g, change, why, p.value.fingerprint) };
}
const nine8 = await idOf("Nine 8");
for (const [who, jar] of [["the stager", st], ["the moderator", pastGate(mod1)], ["the organiser", pastGate(org)], ["a visitor", pastGate(new Jar())]]) {
  check(`${who} cannot unlock a group`, refused(await call(A, "unlockGroup", [kata9.id, "Not my call"], jar, WS(D9))));
  check(`${who} cannot change a locked group`, refused(await apply(small.id, { kind: "add", athleteId: nine8 }, "Not my call", undefined, jar, WS(D9))));
  check(`${who} cannot preview a change`, refused(await preview(small.id, { kind: "add", athleteId: nine8 }, jar, WS(D9))));
}
const [otherAdmin] = await sql`insert into admins (id, email, name) values (gen_random_uuid(), ${`late-${Date.now()}@test.local`}, 'Other') returning id`;
const [foreignT] = await sql`insert into tournaments (admin_id, name, tournament_type) values (${otherAdmin.id}, 'Foreign Local', 'LOCAL') returning id`;
const [foreignD] = await sql`insert into divisions (tournament_id, name, sex, belts) values (${foreignT.id}, 'Foreign', 'M', '[]'::jsonb) returning id`;
const [foreignE] = await sql`insert into division_events (division_id, event_type) values (${foreignD.id}, 'kumite') returning id`;
const [foreignG] = await sql`insert into categories (tournament_id, name, event_type, division_event_id, group_no) values (${foreignT.id}, 'Foreign G1', 'kumite', ${foreignE.id}, 1) returning id`;
check("an admin cannot unlock another admin's group", refused(await call(A, "unlockGroup", [foreignG.id, "Not my tournament"], admin, ADMIN_WS(D9))));
const [officialCat] = await sql`select id from categories where tournament_id=${T1} limit 1`;
check("an Official category isn't a group to change", refused(await apply(officialCat.id, { kind: "remove", athleteId: nine8 }, "Not a Local group")));

// ── Unlock ──
const kataBefore = await drawOf(kata9.id);
check("an unlock needs a reason", refused(await call(A, "unlockGroup", [kata9.id, "no"], admin, ADMIN_WS(D9))) && (await drawOf(kata9.id)).state === "LOCKED");
check("the admin unlocks a group before its first bout", ok(await call(A, "unlockGroup", [kata9.id, "Wrong order sent"], admin, ADMIN_WS(D9))));
check("its draw is hidden and its bouts are gone",
  (await drawOf(kata9.id)).state === "DRAFT" && (await sql`select count(*)::int as n from matches where category_id=${kata9.id}`)[0].n === 0);
const unlockAudit = await lastAudit("GROUP_UNLOCKED", kata9.id);
check("the unlock is audited with its reason", unlockAudit?.reason === "Wrong order sent" && unlockAudit.actor_role === "admin");
const desk = (await call(A, "getStagerDesk", [L], st, DESK)).value;
check("the category is partly sent again on the desk", desk.items.find((i) => i.divisionId === D9)?.status === "partly");
check("the stager takes it again", ok(await call(A, "takeDivision", [D9], st, DESK)));
const kataDraft = (await workspace(D9)).events.find((e) => e.eventType === "kata").groups[0];
check("the draft shows the draw it had", kataDraft.locked === false && kataDraft.checksum === kataBefore.checksum);
check("and the stager locks it again", ok(await call(A, "lockGroup", [kataDraft.id, kataDraft.checksum], st, WS(D9))) && (await drawOf(kata9.id)).state === "LOCKED");

// ── Before the first bout: add, take out, move ──
const smallBefore = await firstRound(small.id);
const drawBefore = await drawOf(small.id);
check("a confirm against a stale preview is refused", refused(await apply(small.id, { kind: "add", athleteId: nine8 }, "Arrived after the call", "0".repeat(64))));
check("a late change needs a reason", refused(await apply(small.id, { kind: "add", athleteId: nine8 }, "late")));
const add = await late(small.id, { kind: "add", athleteId: nine8 });
check("the preview says who joins and that they were marked absent",
  add.preview.value?.newcomer?.wasAway === "absent" && add.preview.value.groups[0].lines.some((l) => l.startsWith("Nine 8 joins")), JSON.stringify(add.preview.value?.groups?.[0]?.lines));
check("the admin adds a late athlete to a locked group", ok(add.result), JSON.stringify(add.result.value));
const smallAfter = await firstRound(small.id);
check("they take the bye: nobody else moves", smallAfter.size === 4 && sameSpots(smallBefore, smallAfter) && (await drawOf(small.id)).tournament_size === 4);
check("a new draw version, still locked", (await drawOf(small.id)).version > drawBefore.version && (await drawOf(small.id)).state === "LOCKED");
check("adding them marked them present", (await sql`select attendance from tournament_registrations where athlete_id=${nine8}`)[0].attendance === "present");
const addAudit = await lastAudit("GROUP_CHANGED_AFTER_LOCK", small.id);
check("the change is audited with its reason", addAudit?.reason === "Arrived after the call" && addAudit.after?.change === "add" && addAudit.after?.markedPresent === "absent");
check("an athlete already in a group can't be added to another", refused((await late(full.id, { kind: "add", athleteId: nine8 })).result));

// Take one out of the full group: their opponent gets a bye.
const fullBefore = await firstRound(full.id);
const [leaver] = [...fullBefore].find(([, p]) => p === 1);
const opponent = [...fullBefore].find(([, p]) => p === 2)?.[0];
check("the admin takes an athlete out before the group starts", ok((await late(full.id, { kind: "remove", athleteId: leaver }, "Hurt in warm-up")).result));
const fullAfter = await firstRound(full.id);
check("their opponent now has a bye; nobody else moves", !fullAfter.has(leaver) && fullAfter.get(opponent) === 2 && sameSpots(fullBefore, fullAfter, [leaver]));

// Move one from the small group (now four) into the full group's new bye.
const mover = [...smallAfter].find(([id]) => id !== nine8)?.[0];
const move = await late(small.id, { kind: "move", athleteId: mover, toGroupId: full.id, place: 1 }, "Better match for them");
check("the admin moves an athlete between locked groups", ok(move.result), JSON.stringify(move.result.value));
check("they leave one group and take the chosen bye in the other",
  !(await firstRound(small.id)).has(mover) && (await firstRound(full.id)).get(mover) === 1);
const moveAudits = await sql`select after from audit_log where tournament_id=${L} and action='GROUP_CHANGED_AFTER_LOCK' and reason='Better match for them'`;
check("a move is audited on both groups", moveAudits.map((a) => a.after.change).sort().join() === "move-in,move-out");

// The full group is full again: one more athlete makes the bracket grow.
const fullFour = await firstRound(full.id);
check("the full group has four in a bracket of four", fullFour.size === 4 && (await drawOf(full.id)).tournament_size === 4);
const grow = await preview(full.id, { kind: "add", athleteId: leaver });
check("adding to a full bracket says it grows and is drawn again", grow.value?.groups?.[0]?.lines?.[0] === "The bracket grows from 4 to 8 places, so every bout is drawn again.");
check("it grows to eight places", ok(await apply(full.id, { kind: "add", athleteId: leaver }, "Fit to fight after all", grow.value.fingerprint)) && (await drawOf(full.id)).tournament_size === 8);

// Kata before it starts: someone leaves, and the order closes up.
const kataOrder = async () => (await sql`select s.athlete_id from matches m join match_slots s on s.match_id=m.id where m.category_id=${kata9.id} order by m.match_no, s.position`).map((r) => r.athlete_id);
const orderBefore = await kataOrder();
check("the admin takes a performer out of a kata group", ok((await late(kata9.id, { kind: "remove", athleteId: orderBefore[1] }, "Went home ill")).result));
const orderAfter = await kataOrder();
check("the order keeps everyone else in turn", orderAfter.join() === orderBefore.filter((_, i) => i !== 1).join());

// ── Under way: a kumite bye taken by a guest ──
const QUEUE1 = `/moderator/ring/${R1}/queue`;
const CURRENT1 = `/moderator/ring/${R1}/current`;
const cardOf = async (groupId) => (await sql`select id from category_assignments where category_id=${groupId}`)[0].id;
// The small group is three again (four minus the mover): one bout and a bye.
check("the small group starts on tatami 1", ok(await call(A, "startCategory", [await cardOf(small.id), R1], mod1, QUEUE1)));
const bouts = async (groupId) => sql`select m.id, m.match_no, m.round_no, m.status, m.winner_id,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=1) as aka,
  (select athlete_id from match_slots s where s.match_id=m.id and s.position=2) as ao,
  (select slot_type from match_slots s where s.match_id=m.id and s.position=2) as ao_type
  from matches m where m.category_id=${groupId} order by m.match_no`;
let sb = await bouts(small.id);
const real = sb.find((b) => b.round_no === 0 && b.aka && b.ao);
const byeBout = sb.find((b) => b.round_no === 0 && b.id !== real.id);
check("the moderator confirms the real first-round bout", ok(await call(A, "confirmBoutResult", [real.id, real.aka, { side: "AKA", akaPoints: 3, aoPoints: 0, method: "POINTS" }], mod1, CURRENT1)));
sb = await bouts(small.id);
const finalBout = sb.find((b) => b.round_no === 1);
check("the bye-holder walks over into the final", finalBout.aka && finalBout.ao && finalBout.status === "READY");
check("a group under way can't be unlocked", refused(await call(A, "unlockGroup", [small.id, "Too late now"], admin, ADMIN_WS(D9))));
check("nobody can be taken out of a group under way", refused((await late(small.id, { kind: "remove", athleteId: real.aka }, "Too late now")).result));

const guesty = await idOf("Guesty Ten");
const guest = await late(small.id, { kind: "add", athleteId: guesty }, "Missed Blue 10 M");
check("the preview says it's a guest entry from another category",
  guest.preview.value?.newcomer?.guest === true && guest.preview.value.newcomer.guestFrom === "Blue · 10 · M" && guest.preview.value.groups[0].mode === "fill-bye");
check("the admin puts a guest into the open bye of a group under way", ok(guest.result), JSON.stringify(guest.result.value));
sb = await bouts(small.id);
const filled = sb.find((b) => b.id === byeBout.id);
const finalNow = sb.find((b) => b.round_no === 1);
check("the bye is now a real bout, ready to fight", filled.aka && filled.ao && [filled.aka, filled.ao].includes(guesty) && filled.status === "READY" && filled.winner_id === null);
check("the bye-holder's walkover is undone in the final", [finalNow.aka, finalNow.ao].filter(Boolean).length === 1 && finalNow.status === "PENDING");
check("the result already fought stands", sb.find((b) => b.id === real.id).status === "CONFIRMED");
const [entry] = await sql`select guest from category_entries where category_id=${small.id} and athlete_id=${guesty}`;
const [home] = await sql`select d.name from tournament_registrations r join divisions d on d.id=r.division_id where r.athlete_id=${guesty}`;
check("the entry is marked guest and their own category doesn't change", entry?.guest === true && home?.name === "Blue · 10 · M");
check("the group now expects one more bout", (await sql`select expected_matches from categories where id=${small.id}`)[0].expected_matches === 3);
const guestAudit = await lastAudit("GROUP_CHANGED_AFTER_LOCK", small.id);
check("the guest entry is audited", guestAudit?.after?.change === "fill-bye" && guestAudit.after.guest === true && guestAudit.reason === "Missed Blue 10 M");
const ws9 = await workspace(D9, admin, ADMIN_WS(D9));
check("the category's workspace names the guest and where they're from", ws9.guests.some((g) => g.id === guesty && g.guestFrom === "Blue · 10 · M"));
const ws10 = await workspace(D10, admin, ADMIN_WS(D10));
check("at home they no longer show as unplaced in kumite", !ws10.events.find((e) => e.eventType === "kumite").unplaced.includes(guesty));
check("a guest can't be entered twice in one event", refused((await late(full.id, { kind: "add", athleteId: guesty }, "Second guest entry")).result));
const spare = await idOf("Spare Ten");
check("with no bye left, a late athlete is refused", refused((await late(small.id, { kind: "add", athleteId: spare }, "No room left")).result));

// Finish the small group, then nothing in it can change.
sb = await bouts(small.id);
const b2 = sb.find((b) => b.id === byeBout.id);
await call(A, "confirmBoutResult", [b2.id, b2.aka, { side: "AKA", akaPoints: 2, aoPoints: 1, method: "POINTS" }], mod1, CURRENT1);
sb = await bouts(small.id);
const fin = sb.find((b) => b.round_no === 1);
await call(A, "confirmBoutResult", [fin.id, fin.aka, { side: "AKA", akaPoints: 4, aoPoints: 1, method: "POINTS" }], mod1, CURRENT1);
check("the small group finishes", ok(await call(A, "finishCategory", [await cardOf(small.id), R1], mod1, CURRENT1)));
check("a finished group takes nobody", refused((await late(small.id, { kind: "add", athleteId: spare }, "After the end")).result));

// ── A bye whose holder has fought on can't be filled ──
check("the full group starts", ok(await call(A, "startCategory", [await cardOf(full.id), R1], mod1, QUEUE1)));
let fb = await bouts(full.id);
const fReal = fb.find((b) => b.round_no === 0 && b.aka && b.ao);
await call(A, "confirmBoutResult", [fReal.id, fReal.aka, { side: "AKA", akaPoints: 3, aoPoints: 0, method: "POINTS" }], mod1, CURRENT1);
fb = await bouts(full.id);
const semi = fb.find((b) => b.round_no === 1 && b.aka && b.ao && b.status === "READY");
check("a semi-final with the bye-holder is ready", Boolean(semi));
await call(A, "confirmBoutResult", [semi.id, semi.aka, { side: "AKA", akaPoints: 2, aoPoints: 0, method: "POINTS" }], mod1, CURRENT1);
const fullWs = (await workspace(D9, admin, ADMIN_WS(D9))).events.find((e) => e.eventType === "kumite").groups.find((g) => g.id === full.id);
const byeOfFought = (await sql`select s.position, m.match_no from matches m join match_slots s on s.match_id=m.id
  where m.category_id=${full.id} and m.round_no=0 and s.slot_type='BYE'`).map((r) => (r.match_no - 1) * 2 + r.position);
const closed = byeOfFought.filter((p) => !fullWs.openByes.some((b) => b.place === p));
check("the workspace lists only the byes still open", closed.length >= 1 && fullWs.openByes.length >= 1);
check("filling a bye whose holder fought on is refused", refused((await late(full.id, { kind: "add", athleteId: spare, place: closed[0] }, "Into a closed bye")).result));
check("an open bye takes a late athlete", ok((await late(full.id, { kind: "add", athleteId: spare, place: fullWs.openByes[0].place }, "Into an open bye")).result));

// ── Under way: a late kata performer goes last ──
const QUEUE2 = `/moderator/ring/${R2}/queue`;
const CURRENT2 = `/moderator/ring/${R2}/current`;
await page(QUEUE2, mod2);
await page(CURRENT2, mod2);
A = loadActions();
const [kata10] = (await workspace(D10, admin, ADMIN_WS(D10))).events.find((e) => e.eventType === "kata").groups;
check("Blue 10 M's kata group starts on tatami 2", ok(await call(A, "startCategory", [await cardOf(kata10.id), R2], mod2, QUEUE2)));
let kb = await bouts(kata10.id);
const seats = (marks, side) => marks.map((m, i) => ({ seat: i + 1, [side]: m }));
await call(A, "submitModeratorManualKataMarks", [{ matchId: kb[0].id, seats: [...seats([7, 7, 7, 7, 7], "aka"), ...seats([7.2, 7.2, 7.2, 7.2, 7.2], "ao")], finalize: true }], mod2, CURRENT2);
check("three performers: a pair and a solo still to come", kb.length === 2 && kb[1].ao === null);
const append1 = await late(kata10.id, { kind: "add", athleteId: guesty }, "Back for kata");
check("a late performer joins the solo that hasn't started", ok(append1.result) && append1.preview.value.groups[0].mode === "append", JSON.stringify(append1.result.value));
kb = await bouts(kata10.id);
check("the solo becomes a pair; nothing else moves", kb.length === 2 && kb[1].ao === guesty && kb[0].status === "CONFIRMED");
await call(A, "submitModeratorManualKataMarks", [{ matchId: kb[1].id, seats: [...seats([6.8, 6.8, 6.8, 6.8, 6.8], "aka"), ...seats([6.9, 6.9, 6.9, 6.9, 6.9], "ao")], finalize: true }], mod2, CURRENT2);
const append2 = await late(kata10.id, { kind: "add", athleteId: spare }, "Turned up for kata");
check("once every pair has performed, a late performer goes on as a new solo", ok(append2.result));
kb = await bouts(kata10.id);
check("a third bout, with only them in it", kb.length === 3 && kb[2].aka === spare && kb[2].ao === null);
const standings = (await call(A, "getRankedStandings", [kata10.id], mod2, CURRENT2)).value;
check("the ranking waits for them", standings?.complete === false && standings.standings.find((s) => s.athleteId === spare)?.status === "waiting");

// ── Walk-ins: the admin's review and merge ──
await call(A, "takeDivision", [D11], st, DESK);
await page(WS(D11), st);
const real11 = await idOf("Real Eleven");
await call(A, "setAttendanceLocal", [D11, real11, "absent"], st, WS(D11));
const w1 = await call(A, "registerWalkIn", [D11, { name: "Reel Eleven", club: "Eleven Club 1" }, true], st, WS(D11));
const w2 = await call(A, "registerWalkIn", [D11, { name: "Kid Walkin", club: "Somewhere" }, true], st, WS(D11));
await call(A, "autoFillEvent", [D11, "kumite"], st, WS(D11));
const k11 = (await workspace(D11)).events.find((e) => e.eventType === "kumite").groups[0];
check("the walk-in is placed and the group locked", k11.members.includes(w1.value.athleteId) && ok(await call(A, "lockGroup", [k11.id, k11.checksum], st, WS(D11))));
await call(A, "handBackDivision", [D11], st, WS(D11));

const review = (await call(A, "getWalkInsToReview", [L], admin, STAGING)).value ?? [];
const reel = review.find((w) => w.id === w1.value.athleteId);
check("the admin sees the walk-ins to review", review.length === 2 && reel?.groups.length === 1);
check("with the registered athlete they may be", reel?.maybe[0]?.name === "Real Eleven", JSON.stringify(reel?.maybe));
check("the stager cannot review or merge walk-ins",
  refused(await call(A, "reviewWalkIn", [L, w2.value.athleteId], pastGate(st, "admin_session"), STAGING)) &&
  refused(await call(A, "mergeWalkIn", [L, w1.value.athleteId, real11], pastGate(st, "admin_session"), STAGING)) &&
  refused(await call(A, "getWalkInsToReview", [L], pastGate(st, "admin_session"), STAGING)));
const fought = [...(await firstRound(small.id)).keys()][0];
const intoFought = await call(A, "mergeWalkIn", [L, w2.value.athleteId, fought], admin, STAGING);
check("a merge into an athlete who has competed is refused", refused(intoFought) && /already competed/.test(intoFought.value?.error ?? ""));

const merged = await call(A, "mergeWalkIn", [L, w1.value.athleteId, real11], admin, STAGING);
check("the admin merges the walk-in into the registered athlete", ok(merged), JSON.stringify(merged.value));
check("the walk-in record is gone", (await sql`select count(*)::int as n from athletes where id=${w1.value.athleteId}`)[0].n === 0);
const slots11 = await sql`select s.athlete_id from matches m join match_slots s on s.match_id=m.id where m.category_id=${k11.id} and s.athlete_id is not null`;
check("the athlete takes the walk-in's place in the locked group", slots11.some((s) => s.athlete_id === real11) && (await sql`select count(*)::int as n from category_entries where category_id=${k11.id} and athlete_id=${real11}`)[0].n === 1);
const [realReg] = await sql`select attendance from tournament_registrations where athlete_id=${real11}`;
check("and is no longer marked absent", realReg.attendance === null);
const graphNow = (await sql`select v.graph from draw_versions v join draws d on d.id=v.draw_id where d.category_id=${k11.id} order by v.version desc limit 1`)[0].graph;
check("the stored draw names the athlete, not the walk-in", JSON.stringify(graphNow).includes(real11) && !JSON.stringify(graphNow).includes(w1.value.athleteId));
check("the merge is audited", (await lastAudit("WALK_IN_MERGED", null))?.after?.athlete?.name === "Real Eleven");

const reviewed = await call(A, "reviewWalkIn", [L, w2.value.athleteId, { name: "Kid Walk-In", age: 11, belt: "blue", sex: "M" }], admin, STAGING);
const [kid] = await sql`select name, age, belt, needs_review from athletes where id=${w2.value.athleteId}`;
check("the admin corrects and confirms a walk-in", ok(reviewed) && kid.name === "Kid Walk-In" && kid.age === "11" && kid.belt === "Blue" && kid.needs_review === false);
check("the review is audited with before and after", (await lastAudit("WALK_IN_REVIEWED", null))?.before?.name === "Kid Walkin");
check("nothing is left to review", ((await call(A, "getWalkInsToReview", [L], admin, STAGING)).value ?? []).length === 0);

// ── The record shows these with names ──
const labels = (await call(A, "getAuditFilterOptions", [L], admin, `/admin/event/${L}/record`)).value;
check("the audit viewer names the Local actions", JSON.stringify(labels ?? {}).includes("Group changed after lock"));

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
