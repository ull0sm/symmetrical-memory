// Local tournaments: the tournament type at creation and in settings, and who may change it.
import { createRequire } from "node:module";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
let A = loadActions();
const [T1] = process.argv.slice(2);
const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || r.value?.success === false || r.value === null;
const SETTINGS = (t) => `/admin/event/${t}/settings`;

const admin = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
// The setup wizard only compiles for a signed-in admin, so open it before reading the action ids.
await fetch(BASE + "/admin/create", { headers: { Cookie: admin.header() } });
A = loadActions();
const created = [];

// ── Creating a tournament ──
const official = await call(
  A,
  "createTournament",
  [{ name: "Official type check", event_date: "", venue: "", city: "", categories: [], ringCount: 1 }],
  admin
);
created.push(official.value);
const [o] = await sql`select tournament_type, belt_levels from tournaments where id=${official.value}`;
check("a tournament is Official unless asked otherwise", o?.tournament_type === "OFFICIAL" && o.belt_levels.length === 0);

const local = await call(
  A,
  "createTournament",
  [
    {
      name: "Local type check",
      event_date: "",
      venue: "",
      city: "",
      categories: [{ name: "Should be ignored", age_bracket: "", weight_class: "", athletes_count: 4 }],
      ringCount: 2,
      tournament_type: "LOCAL",
    },
  ],
  admin
);
const L = local.value;
created.push(L);
const [l] = await sql`select tournament_type, belt_levels from tournaments where id=${L}`;
check("a Local tournament is stored as Local", l?.tournament_type === "LOCAL");
check("a Local tournament starts with the default belt list", Array.isArray(l?.belt_levels) && l.belt_levels[0] === "White" && l.belt_levels.length === 8);
const [{ n: localCats }] = await sql`select count(*)::int as n from categories where tournament_id=${L}`;
check("the wizard's category list is ignored for a Local tournament", localCats === 0);
const [{ n: localRings }] = await sql`select count(*)::int as n from rings where tournament_id=${L}`;
check("a Local tournament still gets its tatamis", localRings === 2);

check(
  "an unknown type is refused",
  denied(await call(A, "createTournament", [{ name: "Bad type", categories: [], ringCount: 1, tournament_type: "FESTIVAL" }], admin))
);

// ── Changing the type ──
check("anonymous cannot change the type", denied(await call(A, "setTournamentType", [L, "OFFICIAL"], new Jar(), SETTINGS(L))));
const toOfficial = await call(A, "setTournamentType", [L, "OFFICIAL"], admin, SETTINGS(L));
check("the admin can switch an empty tournament to Official", toOfficial.value?.success === true);
const back = await call(A, "setTournamentType", [L, "LOCAL"], admin, SETTINGS(L));
const [l2] = await sql`select tournament_type from tournaments where id=${L}`;
check("and back to Local", back.value?.success === true && l2?.tournament_type === "LOCAL");
const [aud] = await sql`select * from audit_log where tournament_id=${L} and action='TOURNAMENT_TYPE_CHANGED' order by created_at desc limit 1`;
check("a type change is audited", aud?.actor_role === "admin" && aud?.after?.tournamentType === "LOCAL");

const fixed = await call(A, "setTournamentType", [T1, "LOCAL"], admin, SETTINGS(T1));
const [t1] = await sql`select tournament_type from tournaments where id=${T1}`;
check("a tournament with categories keeps its type", fixed.value?.success === false && t1?.tournament_type === "OFFICIAL");

// Another admin's tournament.
const [other] = await sql`
  insert into admins (id, email, name, password_hash) values (gen_random_uuid(), ${`other-${Date.now()}@test.local`}, 'Other', null)
  returning id`;
const [foreign] = await sql`insert into tournaments (admin_id, name) values (${other.id}, 'Foreign') returning id`;
check("an admin cannot change another admin's tournament", denied(await call(A, "setTournamentType", [foreign.id, "LOCAL"], admin, SETTINGS(T1))));
const [f] = await sql`select tournament_type from tournaments where id=${foreign.id}`;
check("and it stays Official", f?.tournament_type === "OFFICIAL");

// ── Database rules ──
let rejected = false;
try {
  await sql`update tournaments set tournament_type='FESTIVAL' where id=${L}`;
} catch {
  rejected = true;
}
check("the database refuses an unknown tournament type", rejected);

await sql`delete from tournaments where id = any(${created.filter(Boolean)}) or id=${foreign.id}`;
await sql`delete from admins where id=${other.id}`;
await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
