// Phase 6: optional call-area attendance — who may mark it, who sees it, the desk hint.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const A = loadActions();
const [T1, R1] = process.argv.slice(2);
const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || r.value?.success === false || r.value === null;
const ST_PAGE = `/stager/event/${T1}/balance`;
const MOD_PAGE = `/moderator/ring/${R1}/current`;

const admin = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);

// Stager, organiser and moderator sessions for T1 / R1.
const codes = await call(A, "generateStagerCodes", [T1, 1], admin);
const st = new Jar();
const sreq = await call(A, "requestStagerAccess", [codes.value.stager_codes.at(-1).code, "Call Area", {}, "offline-bypass"], st);
await call(A, "approveStagerRequest", [sreq.value.requestId, T1], admin);
await call(A, "checkStagerStatus", [sreq.value.requestId], st);

const org = new Jar();
const regen = await call(A, "regenerateOrganiserCode", [T1], admin);
const oreq = await call(A, "requestOrganiserAccess", [regen.value.organiser_code, "Observer", {}, "offline-bypass"], org);
await call(A, "approveOrganiserRequest", [oreq.value.requestId, T1], admin);
await call(A, "checkOrganiserStatus", [oreq.value.requestId], org);

const code = String(100000 + Math.floor(Math.random() * 899999));
await sql`update rings set access_code=${code} where id=${R1}`;
const mod = new Jar();
const mreq = await call(A, "requestModeratorAccess", [code, "Desk", {}, "offline-bypass"], mod);
await call(A, "approveModeratorRequest", [mreq.value.requestId, R1, T1], admin, `/admin/event/${T1}/rings`);
await call(A, "checkModeratorStatus", [mreq.value.requestId], mod);

// The bout on R1's mat.
const bout = (await call(A, "getRingActiveBout", [R1], mod, MOD_PAGE)).value;
const C = bout?.currentMatch?.categoryId ?? bout?.currentMatch?.category_id;
const aoId = bout?.currentMatch?.ao?.id;
check("setup: a bout with an AO athlete is on the mat", Boolean(C && aoId));

// ── Who may read / mark ──
check("anonymous cannot read attendance", denied(await call(A, "getCategoryAttendance", [C], new Jar(), ST_PAGE)));
const list = await call(A, "getCategoryAttendance", [C], st, ST_PAGE);
check("stager reads the category's athletes", Array.isArray(list.value) && list.value.some((r) => r.athleteId === aoId && r.status === "unknown"));
check("organiser cannot read attendance (not in the role matrix)", denied(await call(A, "getCategoryAttendance", [C], org, ST_PAGE)) && denied(await call(A, "getCategoryAttendance", [C], org, "/")));
check("organiser cannot mark attendance (read-only)", denied(await call(A, "setAthleteAttendance", [{ categoryId: C, athleteId: aoId, status: "absent" }], org, ST_PAGE)));
check("moderator cannot mark attendance", denied(await call(A, "setAthleteAttendance", [{ categoryId: C, athleteId: aoId, status: "absent" }], mod, ST_PAGE)));
check("anonymous cannot mark attendance", denied(await call(A, "setAthleteAttendance", [{ categoryId: C, athleteId: aoId, status: "absent" }], new Jar(), ST_PAGE)));

const [outsider] = await sql`select id from athletes where tournament_id=${T1} and (category_id is distinct from ${C}) and id not in (select athlete_id from category_entries where category_id=${C}) limit 1`;
if (outsider) check("cannot mark an athlete from another category", denied(await call(A, "setAthleteAttendance", [{ categoryId: C, athleteId: outsider.id, status: "absent" }], st, ST_PAGE)));

const set = await call(A, "setAthleteAttendance", [{ categoryId: C, athleteId: aoId, status: "absent" }], st, ST_PAGE);
check("stager marks AO absent", set.value?.success === true);
const [row] = await sql`select status, set_by from category_attendance where category_id=${C} and athlete_id=${aoId}`;
check("mark records who set it", row?.status === "absent" && row?.set_by === "stager:Call Area");
const [aud] = await sql`select * from audit_log where tournament_id=${T1} and action='ATTENDANCE_SET' order by created_at desc limit 1`;
check("marking is audited", aud?.actor_role === "stager" && aud?.after?.status === "absent");
check("admin may mark attendance", (await call(A, "setAthleteAttendance", [{ categoryId: C, athleteId: aoId, status: "withdrawn" }], admin, ST_PAGE)).value?.success === true);

// ── The desk hint, staff only ──
const modBout = (await call(A, "getRingActiveBout", [R1], mod, MOD_PAGE)).value;
check("moderator's bout data carries the hint", modBout?.attendance?.[aoId]?.status === "withdrawn");
check("a withdrawn mark blocks nothing (bout still ready)", modBout?.currentMatch?.isReady === true);
await sql`update tournaments set show_public_scoreboard=true where id=${T1}`;
const pubBout = (await call(A, "getRingActiveBout", [R1], new Jar(), `/scoreboard/${R1}`)).value;
check("public scoreboard data has no attendance", pubBout && !("attendance" in pubBout));

// ── Clearing ──
await call(A, "setAthleteAttendance", [{ categoryId: C, athleteId: aoId, status: "unknown" }], st, ST_PAGE);
const [gone] = await sql`select count(*)::int as n from category_attendance where category_id=${C} and athlete_id=${aoId}`;
check("tapping again clears the mark", gone.n === 0);
check("nothing is blocked: the bout is still ready to score", (await call(A, "getRingActiveBout", [R1], mod, MOD_PAGE)).value?.currentMatch?.isReady === true);

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
