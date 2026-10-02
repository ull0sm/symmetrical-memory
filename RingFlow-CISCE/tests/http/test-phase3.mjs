// Phase 3: audit trail, corrections with reasons, official record access, accountable exports.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const A = loadActions();
const [T1, R1] = process.argv.slice(2);
const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || r.value?.success === false || r.value === null;
const lastAudit = async (action) =>
  (await sql`select * from audit_log where tournament_id=${T1} and action=${action} order by created_at desc limit 1`)[0];

const admin = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);

// A fresh moderator for R1
const code = String(100000 + Math.floor(Math.random() * 899999));
await sql`update rings set access_code=${code} where id=${R1}`;
const mod = new Jar();
const req = await call(A, "requestModeratorAccess", [code, "Audit Moderator", {}, "offline-bypass"], mod);
await call(A, "approveModeratorRequest", [req.value.requestId, R1, T1], admin, `/admin/event/${T1}/rings`);
await call(A, "checkModeratorStatus", [req.value.requestId], mod);
const approved = await lastAudit("MODERATOR_APPROVED");
check("approval is audited with the admin's name", approved?.actor_role === "admin" && approved?.after?.moderator === "Audit Moderator");

// Find a kumite bout with two athletes in the running category
const [asg] = await sql`select * from category_assignments where ring_id=${R1} and status in ('running','paused') limit 1`;
const ms = await sql`select m.id, m.status from matches m where m.category_id=${asg.category_id} order by match_no`;
const slots = await sql`select match_id, position, athlete_id from match_slots where match_id = any(${ms.map((m) => m.id)})`;
const bout = ms.find((m) => m.status !== "CONFIRMED" && slots.filter((s) => s.match_id === m.id && s.athlete_id).length === 2);
const aka = slots.find((s) => s.match_id === bout.id && s.position === 1).athlete_id;
const ao = slots.find((s) => s.match_id === bout.id && s.position === 2).athlete_id;
const PAGE = `/moderator/ring/${R1}/current`;

await call(A, "updateLiveMatchState", [bout.id, R1, { akaScore: 3, aoScore: 1, akaPenalties: 0, aoPenalties: 1, senshu: "AKA" }], mod, PAGE);
const score = await lastAudit("BOUT_SCORE");
check("score change audited with before/after", score?.match_id === bout.id && score?.after?.akaScore === 3 && score?.actor_name === "Audit Moderator");

const conf = await call(A, "confirmBoutResult", [bout.id, aka, { side: "AKA", akaPoints: 3, aoPoints: 1, method: "POINTS" }], mod, PAGE);
check("moderator confirms result", conf.value?.success === true, JSON.stringify(conf.value));
const confirmed = await lastAudit("BOUT_CONFIRMED");
check("result confirmation audited", confirmed?.match_id === bout.id && confirmed?.after?.winnerId === aka);

const noReason = await call(A, "confirmBoutResult", [bout.id, ao, { side: "AO", akaPoints: 1, aoPoints: 2, method: "POINTS" }], mod, PAGE);
check("correction without a reason is refused", noReason.value?.success === false && noReason.value?.requiresReason === true, JSON.stringify(noReason.value));
const withReason = await call(A, "confirmBoutResult", [bout.id, ao, { side: "AO", akaPoints: 1, aoPoints: 2, method: "POINTS", reason: "Scorekeeper swapped the corners", allowRollback: true }], mod, PAGE);
check("correction with a reason succeeds", withReason.value?.success === true, JSON.stringify(withReason.value));
const corrected = await lastAudit("BOUT_CORRECTED");
check("correction audited with reason and before/after",
  corrected?.reason === "Scorekeeper swapped the corners" && corrected?.before?.winnerId === aka && corrected?.after?.winnerId === ao);

// Admin correction after the category leaves the mat
await call(A, "finishCategory", [asg.id, R1], mod, PAGE);
const modAfter = await call(A, "confirmBoutResult", [bout.id, aka, { side: "AKA", reason: "late appeal" }], mod, PAGE);
check("moderator cannot correct once the category is finished", denied(modAfter));
const adminNoReason = await call(A, "correctBoutResult", [bout.id, aka, "", { side: "AKA", akaPoints: 3, aoPoints: 1 }], admin, "/");
check("admin correction needs a reason", adminNoReason.value?.success === false, JSON.stringify(adminNoReason.value));
const adminFix = await call(A, "correctBoutResult", [bout.id, aka, "Appeal upheld by chief referee", { side: "AKA", akaPoints: 3, aoPoints: 1, allowRollback: true }], admin, "/");
check("admin corrects with a reason", adminFix.value?.success === true || adminFix.status === 200, JSON.stringify(adminFix.value)?.slice(0, 120));
const adminCorr = await lastAudit("BOUT_CORRECTED");
check("admin correction audited as admin", adminCorr?.actor_role === "admin" && adminCorr?.reason === "Appeal upheld by chief referee");
const modCorr = await call(A, "correctBoutResult", [bout.id, ao, "trying", {}], mod, "/");
check("moderator cannot use the admin correction", denied(modCorr));
// put the category back on the mat for other suites
await sql`update category_assignments set status='running', completed_at=null where id=${asg.id}`;

// Append-only
let blocked = false;
try {
  await sql`update audit_log set reason='tampered' where id=${corrected.id}`;
} catch {
  blocked = true;
}
check("audit rows cannot be edited", blocked);

// Record access
const rec = await call(A, "getAuditLog", [T1, {}], admin, `/admin/event/${T1}/record`);
check("admin reads the audit log", rec.raw.includes("BOUT_CORRECTED"), `HTTP ${rec.status}`);
const page = await fetch(`${BASE}/admin/event/${T1}/record`, { headers: { Cookie: admin.header() } });
const html = await page.text();
check("Official Record page renders for admin", page.status === 200 && html.includes("Audit log") && html.includes("Official results"));
const anonRec = await call(A, "getAuditLog", [T1, {}], new Jar(), "/");
check("anonymous cannot read the audit log", denied(anonRec));
const stagerCode = (await call(A, "generateStagerCodes", [T1, 1], admin, `/admin/event/${T1}/rings`)).value.stager_codes.at(-1).code;
const st = new Jar();
const sreq = await call(A, "requestStagerAccess", [stagerCode, "Audit Stager", {}, "offline-bypass"], st);
await call(A, "approveStagerRequest", [sreq.value.requestId, T1], admin, `/admin/event/${T1}/rings`);
await call(A, "checkStagerStatus", [sreq.value.requestId], st);
check("stager cannot read the audit log", denied(await call(A, "getAuditLog", [T1, {}], st, "/")));

// Accountable export
const csv = await call(A, "exportTournamentResultsCsv", [T1], admin, `/admin/event/${T1}/categories`);
const b64 = (csv.raw.match(/"base64":"([^"]+)"/) || [])[1];
let csvText = "";
if (b64 && !b64.startsWith("$")) csvText = Buffer.from(b64, "base64").toString("utf8");
else {
  const chunk = csv.raw.match(/T[0-9a-f]+,([A-Za-z0-9+/=]+)/);
  if (chunk) csvText = Buffer.from(chunk[1], "base64").toString("utf8");
}
check("results CSV has a Confirmed by column", csvText.includes("Confirmed by"), csvText ? "" : "could not decode CSV");
check("results CSV names the confirming official and the correction", csvText.includes("Chief") || csvText.includes("Tournament Director") || csvText.includes("Audit Moderator"));

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
