// Local tournaments: the admin's setup — settings, categories (divisions), the roster import,
// participation, starting groups, tatamis — and who may do it.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const [T1] = process.argv.slice(2); // the seeded Official tournament
const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || r.value?.success === false || r.value === null;

const admin = new Jar();
let A = loadActions();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
A = loadActions();

// A Local tournament with two tatamis.
const L = (await call(A, "createTournament", [{ name: "Local setup check", categories: [], ringCount: 2, tournament_type: "LOCAL" }], admin)).value;
const ringRows = await sql`select id, name from rings where tournament_id=${L} order by ring_order`;
const [R1, R2] = ringRows.map((r) => r.id);
// Its pages compile the Local actions.
for (const p of ["categories", "athletes", "settings"]) await fetch(`${BASE}/admin/event/${L}/${p}`, { headers: { Cookie: admin.header() } });
A = loadActions();
const CAT = `/admin/event/${L}/categories`;
const ATH = `/admin/event/${L}/athletes`;

// ── Settings ──
check("a Local tournament starts with the default belt list", (await sql`select belt_levels from tournaments where id=${L}`)[0].belt_levels.length === 8);
const set = await call(A, "updateLocalSettings", [L, { localKataGroupSize: 4, localBronzeMedals: 2, beltLevels: ["White", "Yellow", "Blue", "blue", "Green"] }], admin, `/admin/event/${L}/settings`);
const [t] = await sql`select belt_levels, local_kata_group_size from tournaments where id=${L}`;
check("settings save, and the belt list drops a repeated belt", set.value?.success === true && t.belt_levels.join() === "White,Yellow,Blue,Green" && t.local_kata_group_size === 4);
check("a group size over 32 is refused", denied(await call(A, "updateLocalSettings", [L, { localKumiteGroupSize: 40 }], admin, `/admin/event/${L}/settings`)));

// ── Categories ──
const gen = await call(A, "generateDivisions", [L, { ages: [{ min: 8, max: 8 }, { min: 9, max: 9 }], beltBands: [["Blue"], ["Yellow"]], sexes: ["M", "F"] }], admin, CAT);
check("the generator creates every age, belt and sex", gen.value?.success === true && gen.value.created.length === 8);
const again = await call(A, "generateDivisions", [L, { ages: [{ min: 9, max: 9 }], beltBands: [["Blue"]], sexes: ["M"] }], admin, CAT);
check("running it again skips categories that exist", again.value?.created.length === 0 && again.value?.skipped.length === 1);
const [{ n: eventCount }] = await sql`select count(*)::int as n from division_events de join divisions d on d.id=de.division_id where d.tournament_id=${L}`;
check("every category holds a kumite and a kata event", eventCount === 16);
check("a belt outside the belt list is refused", denied(await call(A, "createDivision", [L, { sex: "M", ageMin: 9, ageMax: 9, belts: ["Purple"] }], admin, CAT)));
check("a duplicate name is refused", denied(await call(A, "createDivision", [L, { sex: "M", ageMin: 9, ageMax: 9, belts: ["Blue"] }], admin, CAT)));
const [D9M] = await sql`select id from divisions where tournament_id=${L} and name='Blue · 9 · M'`;
const [D8F] = await sql`select id from divisions where tournament_id=${L} and name='Yellow · 8 · F'`;

// ── Roster import ──
const clubs = ["Sakura", "Kaizen", "Tiger"];
const rows = [
  ...Array.from({ length: 13 }, (_, i) => ({ name: `Blue Boy ${i + 1}`, chestNumber: String(500 + i), club: clubs[i % 3], age: "9", belt: "blue", sex: "Male" })),
  { name: "Kata Only", chestNumber: "520", club: "Sakura", age: 9, belt: "Blue", sex: "M", kumite: "No", kata: "Yes" },
  { name: "No Age", club: "Tiger", belt: "Blue", sex: "M" },
  { name: "Odd Belt", club: "Tiger", age: 9, belt: "Purple", sex: "M" },
  { name: "Twin", club: "Kaizen", age: 8, belt: "Yellow", sex: "F" },
  { name: "Twin", club: "Kaizen", age: 8, belt: "Yellow", sex: "F" },
];
const imp = await call(A, "importLocalRoster", [L, rows], admin, ATH);
const rep = imp.value?.report;
check("the import reads every row", rep?.total === rows.length && rep.created === rows.length);
check("athletes are matched to a category by age, belt and sex", rep?.assigned === 16);
check("athletes with no age or an unknown belt are left without a category, with a reason",
  rep?.unassigned.length === 2 && rep.unassigned.some((u) => /belt "Purple"/.test(u.reason)) && rep.unassigned.some((u) => /no age/.test(u.reason)));
check("same name and club without a chest number is flagged", rep?.possibleDuplicates.length === 1);
const [{ n: in9M }] = await sql`select count(*)::int as n from tournament_registrations where division_id=${D9M.id}`;
check("Blue · 9 · M has its 14 athletes", in9M === 14);
const [kataOnly] = await sql`select r.kumite, r.kata from tournament_registrations r join athletes a on a.id=r.athlete_id where a.name='Kata Only' and a.tournament_id=${L}`;
check("the Kumite and Kata columns set participation", kataOnly?.kumite === false && kataOnly?.kata === true);
const reimp = await call(A, "importLocalRoster", [L, [{ name: "Blue Boy 1 (corrected)", chestNumber: "500", club: "Sakura", age: 9, belt: "Blue", sex: "M" }]], admin, ATH);
const [corrected] = await sql`select name from athletes where tournament_id=${L} and chest_number='500'`;
check("re-importing a chest number updates that athlete", reimp.value?.report.updated === 1 && corrected?.name === "Blue Boy 1 (corrected)");

const [{ top }] = await sql`select max(chest_number::int) as top from athletes where tournament_id=${L} and chest_number ~ '^[0-9]+$'`;
const add = await call(A, "addLocalAthlete", [L, { name: "Late Entry", club: "Tiger", age: "9", belt: "Blue", sex: "M", divisionId: "auto" }], admin, ATH);
check("adding an athlete matches the category and gives the next chest number", add.value?.divisionId === D9M.id && add.value?.chestNumber === String(top + 1));
check("a chest number already in use is refused", denied(await call(A, "addLocalAthlete", [L, { name: "Clash", chestNumber: "500" }], admin, ATH)));

// ── Starting groups ──
const [kumite9M] = await sql`select id from division_events where division_id=${D9M.id} and event_type='kumite'`;
const [kata9M] = await sql`select id from division_events where division_id=${D9M.id} and event_type='kata'`;
const build = await call(A, "buildDivisionStartingGroups", [D9M.id], admin, CAT);
check("starting groups build for both events", build.value?.success === true && build.value.built.length === 2);
const groupsOf = (eventId) => sql`select c.id, c.group_no, c.name, c.athletes_count, c.expected_matches, c.kata_format, c.bronze_medals,
  (select count(*)::int from category_entries e where e.category_id=c.id) as members,
  (select count(*)::int from group_drafts g where g.category_id=c.id) as drafts
  from categories c where c.division_event_id=${eventId} order by c.group_no`;
const kumiteGroups = await groupsOf(kumite9M.id);
const kataGroups = await groupsOf(kata9M.id);
// 14 doing kumite (13 + Late Entry), 15 doing kata (+ Kata Only).
check("kumite splits by the plan of 8: 7 + 7", kumiteGroups.map((g) => g.members).join("+") === "7+7");
check("kata splits by the plan of 4: 4 + 4 + 4 + 3", kataGroups.map((g) => g.members).join("+") === "4+4+4+3");
check("groups are named after the category", kumiteGroups[0]?.name === "Blue · 9 · M · Kumite · Group 1");
check("each group has a draft and no draw", [...kumiteGroups, ...kataGroups].every((g) => g.drafts === 1) && (await sql`select count(*)::int as n from draws where category_id = any(${kumiteGroups.map((g) => g.id)})`)[0].n === 0);
check("kata groups are ranked groups, kumite groups use two bronzes with no bout", kataGroups.every((g) => g.kata_format === "RANKED") && kumiteGroups.every((g) => g.bronze_medals === 3));
check("counts carry the expected bouts", kumiteGroups[0]?.expected_matches === 6 && kataGroups[0]?.expected_matches === 2);
const clubSpread = await sql`select e.category_id, a.school, count(*)::int as n from category_entries e join athletes a on a.id=e.athlete_id
  where e.category_id = any(${kumiteGroups.map((g) => g.id)}) group by 1, 2`;
check("clubs are spread across the groups", clubSpread.every((r) => r.n <= 3));
check("a member is in one group per event", (await sql`select count(*)::int as n from category_entries where division_event_id=${kumite9M.id}`)[0].n === 14);

// The counts sync must keep the Local formulas.
await fetch(`${BASE}/admin/event/${L}/categories`, { headers: { Cookie: admin.header() } });
await call(A, "getStartingGroupsPreflight", [L], admin, CAT);
const [kataAfter] = await sql`select expected_matches from categories where id=${kataGroups[0].id}`;
check("a ranked kata group's expected bouts are its pairs", kataAfter?.expected_matches === 2);

// ── Tatamis ──
const assign = await call(A, "assignDivisionToRing", [D9M.id, R1], admin, CAT);
const queue = await sql`select c.name, a.queue_order from category_assignments a join categories c on c.id=a.category_id where a.ring_id=${R1} order by a.queue_order`;
check("a category goes onto a tatami, kumite groups first", assign.value?.moved === 6 && queue[0]?.name.includes("Kumite · Group 1") && queue[2]?.name.includes("Kata · Group 1"));
const toEmpty = await call(A, "assignDivisionToRing", [D8F.id, R2], admin, CAT);
check("a category without groups gets them when assigned (or none if nobody takes part)", toEmpty.value?.success === true);
const rebuild = await call(A, "buildDivisionStartingGroups", [D9M.id], admin, CAT);
const queueAfter = await sql`select count(*)::int as n from category_assignments where ring_id=${R1}`;
check("rebuilt groups keep their tatami", rebuild.value?.success === true && queueAfter[0].n === 6);

// ── Only a locked group can start ──
const modCode = String(100000 + Math.floor(Math.random() * 899999));
await sql`update rings set access_code=${modCode} where id=${R1}`;
const mod = new Jar();
const mreq = await call(A, "requestModeratorAccess", [modCode, "Desk", {}, "offline-bypass"], mod);
await call(A, "approveModeratorRequest", [mreq.value.requestId, R1, L], admin, `/admin/event/${L}/rings`);
await call(A, "checkModeratorStatus", [mreq.value.requestId], mod);
await sql`update division_events set bout_duration_ms=90000 where id=${kumite9M.id}`;
const [firstCard] = await sql`select a.id, a.category_id from category_assignments a where a.ring_id=${R1} order by a.queue_order limit 1`;
const QUEUE = `/moderator/ring/${R1}/queue`;
check("a group the stager hasn't sent can't start", denied(await call(A, "startCategory", [firstCard.id, R1], mod, QUEUE)));
const [{ status: stillPending }] = await sql`select status from category_assignments where id=${firstCard.id}`;
check("and stays in the queue", stillPending === "pending");
await sql`insert into draws (category_id, tournament_size, checksum, state) values (${firstCard.category_id}, 8, 'x', 'LOCKED')`;
const started = await call(A, "startCategory", [firstCard.id, R1], mod, QUEUE);
const [clock] = await sql`select timer_duration_ms from rings where id=${R1}`;
check("a locked group starts, and the tatami clock takes its bout length", started.value?.success === true && clock.timer_duration_ms === 90000);
await sql`update category_assignments set status='pending' where id=${firstCard.id}`;
await sql`delete from draws where category_id=${firstCard.category_id}`;

// ── Moving athletes and participation ──
const [boy2] = await sql`select id from athletes where tournament_id=${L} and name='Blue Boy 2'`;
const move = await call(A, "assignAthleteDivision", [L, boy2.id, D8F.id], admin, ATH);
const [{ n: stillIn }] = await sql`select count(*)::int as n from category_entries where athlete_id=${boy2.id}`;
check("moving an athlete takes them out of the old category's groups", move.value?.success === true && stillIn === 0);
const [boy3] = await sql`select id from athletes where tournament_id=${L} and name='Blue Boy 3'`;
const off = await call(A, "setAthleteParticipationAdmin", [L, boy3.id, "kata", false], admin, ATH);
const [{ n: kataEntries }] = await sql`select count(*)::int as n from category_entries where athlete_id=${boy3.id} and division_event_id=${kata9M.id}`;
const [{ n: kumiteEntries }] = await sql`select count(*)::int as n from category_entries where athlete_id=${boy3.id} and division_event_id=${kumite9M.id}`;
check("switching kata off takes them out of the kata group only", off.value?.success === true && kataEntries === 0 && kumiteEntries === 1);

// A locked group protects its members and its category.
const [lockedGroup] = await groupsOf(kumite9M.id);
const [member] = await sql`select athlete_id from category_entries where category_id=${lockedGroup.id} limit 1`;
await sql`insert into draws (category_id, tournament_size, checksum, state) values (${lockedGroup.id}, 8, 'x', 'LOCKED')`;
check("a member of a locked group cannot be moved", denied(await call(A, "assignAthleteDivision", [L, member.athlete_id, null], admin, ATH)));
check("starting groups can't be rebuilt once a group is locked", denied(await call(A, "buildDivisionStartingGroups", [D9M.id], admin, CAT)));
check("a category with a locked group can't be deleted", denied(await call(A, "deleteDivision", [D9M.id], admin, CAT)));
await sql`delete from draws where category_id=${lockedGroup.id}`;
const [anAdmin] = await sql`select id from admins limit 1`;
await sql`insert into division_holds (division_id, tournament_id, holder_kind, admin_id, holder_name) values (${D9M.id}, ${L}, 'admin', ${anAdmin.id}, 'Someone')`;
check("starting groups can't be rebuilt while someone holds the category", denied(await call(A, "buildDivisionStartingGroups", [D9M.id], admin, CAT)));
await sql`delete from division_holds where division_id=${D9M.id}`;

// ── Who may do this ──
const regen = await call(A, "regenerateOrganiserCode", [L], admin, `/admin/event/${L}/settings`);
const org = new Jar();
const oreq = await call(A, "requestOrganiserAccess", [regen.value.organiser_code, "Observer", {}, "offline-bypass"], org);
await call(A, "approveOrganiserRequest", [oreq.value.requestId, L], admin);
await call(A, "checkOrganiserStatus", [oreq.value.requestId], org);
const orgPage = await fetch(`${BASE}/organiser/event/${L}/categories`, { headers: { Cookie: org.header() }, redirect: "manual" });
const orgHtml = await orgPage.text();
check("the organiser sees the categories, read only", orgPage.status === 200 && orgHtml.includes("Yellow · 8 · F") && !orgHtml.includes("Generate categories"));
check("the organiser cannot change it", denied(await call(A, "createDivision", [L, { sex: "F", ageMin: 10, ageMax: 10, belts: [] }], org, CAT)));
check("anonymous cannot read or change it", denied(await call(A, "getLocalSetup", [L], new Jar(), CAT)) && denied(await call(A, "buildAllStartingGroups", [L], new Jar(), CAT)));
const codes = await call(A, "generateStagerCodes", [L, 1], admin, `/admin/event/${L}/rings`);
const st = new Jar();
const sreq = await call(A, "requestStagerAccess", [codes.value.stager_codes.at(-1).code, "Desk", {}, "offline-bypass"], st);
await call(A, "approveStagerRequest", [sreq.value.requestId, L], admin);
await call(A, "checkStagerStatus", [sreq.value.requestId], st);
check("a stager cannot change the setup", denied(await call(A, "importLocalRoster", [L, [{ name: "Sneaky" }]], st, ATH)) && denied(await call(A, "assignDivisionToRing", [D9M.id, R2], st, CAT)));

const [other] = await sql`insert into admins (id, email, name) values (gen_random_uuid(), ${`other-${Date.now()}@test.local`}, 'Other') returning id`;
const [foreignLocal] = await sql`insert into tournaments (admin_id, name, tournament_type) values (${other.id}, 'Foreign Local', 'LOCAL') returning id`;
check("an admin cannot set up another admin's Local tournament", denied(await call(A, "generateDivisions", [foreignLocal.id, { ages: [{ min: 9, max: 9 }], beltBands: [[]], sexes: ["M"] }], admin, CAT)));
check("Local setup is refused on an Official tournament", denied(await call(A, "generateDivisions", [T1, { ages: [{ min: 9, max: 9 }], beltBands: [[]], sexes: ["M"] }], admin, CAT)));
const [{ before: catsBefore }] = await sql`select count(*)::int as before from categories where tournament_id=${L}`;
check("Official tools are refused in a Local tournament", denied(await call(A, "addCategory", [L, { name: "Official style", athletes_count: 0 }], admin, CAT)) && denied(await call(A, "importOfficialRoster", [L, []], admin, ATH)) && denied(await call(A, "generateAllTournamentDraws", [L], admin, CAT)));
const [{ after: catsAfter }] = await sql`select count(*)::int as after from categories where tournament_id=${L}`;
check("and they leave nothing behind", catsBefore === catsAfter);

// ── Audit ──
const actions = (await sql`select distinct action from audit_log where tournament_id=${L}`).map((r) => r.action);
check("setup is audited", ["LOCAL_SETTINGS_UPDATED", "DIVISIONS_GENERATED", "ATHLETES_IMPORTED", "STARTING_GROUPS_BUILT", "DIVISION_ASSIGNED", "ATHLETE_DIVISION_SET", "ATHLETE_PARTICIPATION_SET"].every((a) => actions.includes(a)), actions.join(","));

// ── Deleting ──
const del = await call(A, "deleteDivision", [D9M.id], admin, CAT);
const [{ n: orphans }] = await sql`select count(*)::int as n from tournament_registrations where tournament_id=${L} and division_id is null`;
check("deleting a category keeps its athletes, now without one", del.value?.success === true && orphans >= 14);

await sql`delete from tournaments where id in (${L}, ${foreignLocal.id})`;
await sql`delete from admins where id=${other.id}`;
await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
