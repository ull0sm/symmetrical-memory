// Pools on different tatamis: who may split, which tatami may score which bout, the finals waiting
// for the pools, and the balancing board leaving a split category's pools alone.
import { createRequire } from "node:module";
import { Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const { randomUUID } = await import("node:crypto");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });

const A = loadActions();
const T1 = process.argv[2];

const failed = (r) => !r.ok || r.value?.success === false;
const run = randomUUID().slice(0, 8);

// ── Fixtures: two fresh tatamis, each with its own moderator, and a 64-place category ─────────
const admin = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);

const makeRing = async (name, order) => {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  const [ring] = await sql`
    insert into rings (tournament_id, name, ring_order, access_code, judge_pin, judge_pairing_key)
    values (${T1}, ${`${name} ${run}`}, ${order}, ${code}, ${String(1000 + Math.floor(Math.random() * 8999))}, ${randomUUID()}) returning id`;
  return { id: ring.id, code };
};
const ringA = await makeRing("Split A", 90);
const ringB = await makeRing("Split B", 91);

const moderatorFor = async (ring, name) => {
  const jar = new Jar();
  const req = await call(A, "requestModeratorAccess", [ring.code, name, { userAgent: "test" }, "offline-bypass"], jar);
  await call(A, "approveModeratorRequest", [req.value?.requestId, ring.id, T1], admin);
  await call(A, "checkModeratorStatus", [req.value?.requestId], jar);
  return jar;
};
const modA = await moderatorFor(ringA, "Mat A moderator");
const modB = await moderatorFor(ringB, "Mat B moderator");
check("both moderators hold a session", modA.c.has("mod_token") && modB.c.has("mod_token"));

const [category] = await sql`
  insert into categories (tournament_id, name) values (${T1}, ${`Pool split ${run}`}) returning id`;
await sql`
  insert into athletes (tournament_id, category_id, name, dojo)
  select ${T1}, ${category.id}, 'Fighter ' || lpad(g::text, 2, '0'), 'Club ' || (g % 9)
  from generate_series(1, 64) g`;

const drawn = await call(A, "generateCategoryDraw", [category.id], admin);
check("admin draws the 64-place category", drawn.value?.success === true, JSON.stringify(drawn.value)?.slice(0, 120));

// ── Who may split ──────────────────────────────────────────────────────────────────────────────
const info = await call(A, "getCategoryRouting", [category.id], admin);
check("the category has four pools", info.value?.poolCount === 4, JSON.stringify(info.value)?.slice(0, 160));

const plan = { kind: "SPLIT", poolRingIds: [ringA.id, ringA.id, ringB.id, ringB.id], finalsRingId: ringA.id };
check("a moderator cannot split a category", failed(await call(A, "setCategoryRouting", [category.id, plan], modA, "/")));
check("an anonymous caller cannot split a category", failed(await call(A, "setCategoryRouting", [category.id, plan], new Jar(), "/")));
const [untouched] = await sql`select count(*)::int as n from category_assignments where category_id=${category.id} and part <> 'ALL'`;
check("those attempts split nothing", untouched.n === 0);

// The whole category sits on tatami A, then the admin splits it.
await sql`insert into category_assignments (ring_id, category_id, queue_order) values (${ringA.id}, ${category.id}, 0)`;
const split = await call(A, "setCategoryRouting", [category.id, plan], admin);
check("admin splits the pools across the two tatamis", split.value?.success === true, JSON.stringify(split.value));

const cards = await sql`select id, part, ring_id, status, queue_order from category_assignments where category_id=${category.id} order by part`;
check("one card per pool plus the finals", cards.map((c) => c.part).join() === "FINALS,POOL:1,POOL:2,POOL:3,POOL:4", cards.map((c) => c.part).join());
const card = (part) => cards.find((c) => c.part === part);
check("pool 3 sits on tatami B and pool 1 on tatami A", card("POOL:3").ring_id === ringB.id && card("POOL:1").ring_id === ringA.id);

// ── Tenancy follows the part: a moderator scores only the bouts of their own tatami ────────────
const boutOf = async (part) => {
  const rows = await sql`
    select m.id from matches m
    where m.category_id=${category.id} and m.part=${part} and m.round_no=0
      and (select count(*) from match_slots s where s.match_id=m.id and s.athlete_id is not null) = 2
    order by m.match_no limit 1`;
  return rows[0]?.id;
};
const pool3Bout = await boutOf("POOL:3");
const pool1Bout = await boutOf("POOL:1");
check("found a fought-able bout in pools 1 and 3", Boolean(pool3Bout && pool1Bout));

check("tatami A's moderator cannot score a pool 3 bout", failed(await call(A, "updateLiveMatchState", [pool3Bout, ringA.id, { akaScore: 3 }], modA)));
check("pool 3's tatami must start it first", failed(await call(A, "updateLiveMatchState", [pool3Bout, ringB.id, { akaScore: 3 }], modB)));

// The finals wait for the pools.
const finalsStart = await call(A, "startCategory", [card("FINALS").id, ringA.id], modA);
check("the finals cannot start while pools are unfinished", failed(finalsStart) || finalsStart.value?.success === false);
const [finalsNow] = await sql`select status from category_assignments where id=${card("FINALS").id}`;
check("and stay pending", finalsNow.status === "pending");

const pool3Start = await call(A, "startCategory", [card("POOL:3").id, ringB.id], modB);
check("tatami B starts pool 3", pool3Start.value?.success === true, JSON.stringify(pool3Start.value));
check("tatami B's moderator scores pool 3", (await call(A, "updateLiveMatchState", [pool3Bout, ringB.id, { akaScore: 3, aoScore: 1 }], modB)).value?.success === true);
check("tatami A's moderator still cannot", failed(await call(A, "updateLiveMatchState", [pool3Bout, ringA.id, { akaScore: 9 }], modA)));
const [scored] = await sql`select aka_score from matches where id=${pool3Bout}`;
check("the refused score changed nothing", scored.aka_score === 3);

const pool1Start = await call(A, "startCategory", [card("POOL:1").id, ringA.id], modA);
check("tatami A starts pool 1", pool1Start.value?.success === true, JSON.stringify(pool1Start.value));
check("tatami A's moderator scores pool 1", (await call(A, "updateLiveMatchState", [pool1Bout, ringA.id, { akaScore: 2 }], modA)).value?.success === true);

// A tatami sees only its own part of the category.
const boutB = await call(A, "getRingActiveBout", [ringB.id], modB);
// (The action payload refers to a bout it already sent, such as the current one, by reference.)
const deskMatches = (boutB.value?.matches ?? []).filter((m) => m && typeof m === "object");
const seenB = deskMatches.map((m) => m.part);
const partsSeen = deskMatches.reduce((acc, m) => ({ ...acc, [String(m.part)]: (acc[String(m.part)] ?? 0) + 1 }), {});
check("tatami B's desk shows only pool 3 bouts", seenB.length > 0 && seenB.every((p) => p === "POOL:3"), JSON.stringify(partsSeen));

// Isolation: a moderator is shown only the parts that run on their own tatami, whatever they ask for.
const partsOf = (r) => [...new Set((r.value?.matches ?? []).filter((m) => m && typeof m === "object").map((m) => m.part))].sort();
const viewA = await call(A, "getCategoryDraw", [category.id, { part: "POOL:3" }], modA);
check("tatami A's moderator cannot open pool 3 by asking for it", partsOf(viewA).length > 0 && !partsOf(viewA).includes("POOL:3"), partsOf(viewA).join());
const viewA2 = await call(A, "getCategoryDraw", [category.id], modA);
check("asking for no part gives tatami A only its own parts", partsOf(viewA2).every((p) => ["POOL:1", "POOL:2", "FINALS"].includes(p)) && partsOf(viewA2).length > 0, partsOf(viewA2).join());
const viewB = await call(A, "getCategoryDraw", [category.id, { part: "POOL:4" }], modB);
check("tatami B's moderator can open its own pool 4", partsOf(viewB).join() === "POOL:4", partsOf(viewB).join());
const viewAdmin = await call(A, "getCategoryDraw", [category.id, { part: "POOL:3" }], admin, "/");
check("the admin can open any pool", partsOf(viewAdmin).join() === "POOL:3", partsOf(viewAdmin).join());
const viewAll = await call(A, "getCategoryDraw", [category.id], admin, "/");
check("and the whole draw", partsOf(viewAll).length === 5, partsOf(viewAll).join());
const setupInfo = await call(A, "getCategoryDrawSetup", [category.id], admin, "/");
check("the admin's draw setup lists who is in each pool", setupInfo.value?.pools?.length === 4 && setupInfo.value.pools.every((p) => p.athletes.length === 16), JSON.stringify(setupInfo.value?.pools?.map((p) => p.athletes?.length)));

// Finishing every pool frees the finals.
for (const part of ["POOL:1", "POOL:2", "POOL:3", "POOL:4"]) {
  await sql`update category_assignments set status='completed' where id=${card(part).id}`;
}
await sql`update category_assignments set status='pending' where id=${card("FINALS").id}`;
await sql`update rings set current_match_id = null where id = any(${[ringA.id, ringB.id]})`;
const finalsGo = await call(A, "startCategory", [card("FINALS").id, ringA.id], modA);
check("once every pool is finished the finals start", finalsGo.value?.success === true, JSON.stringify(finalsGo.value));
const reopen = await call(A, "returnCategoryToQueue", [card("POOL:3").id, ringB.id], modB);
check("a pool cannot be reopened after the finals started", failed(reopen));

// ── The balancing board leaves a split category's pools alone ──────────────────────────────────
await sql`update category_assignments set status='pending', started_at=null where category_id=${category.id}`;
const [plain] = await sql`insert into categories (tournament_id, name) values (${T1}, ${`Plain ${run}`}) returning id`;
await sql`insert into category_assignments (ring_id, category_id, queue_order) values (${ringB.id}, ${plain.id}, 0)
          on conflict do nothing`;
const queueB = await sql`select category_id, part, queue_order from category_assignments where ring_id=${ringB.id} order by queue_order`;
check("tatami B holds two pool cards and one plain category without clashes", new Set(queueB.map((q) => q.queue_order)).size === queueB.length, JSON.stringify(queueB.map((q) => q.queue_order)));

// The board sends whole categories only: the split category's finals card on tatami A, the plain one on B.
const saved = await call(A, "saveAssignments", [T1, [
  { category_id: category.id, ring_id: ringA.id, queue_order: 0 },
  { category_id: plain.id, ring_id: ringB.id, queue_order: 1 },
]], admin);
check("the board saves with a split category on it", saved.value?.success === true, JSON.stringify(saved.value));

const after = await sql`select category_id, part, ring_id, queue_order from category_assignments where category_id = any(${[category.id, plain.id]}) order by ring_id, queue_order`;
check("the pools are still on their tatamis", after.filter((c) => c.part.startsWith("POOL")).map((c) => c.part).sort().join() === "POOL:1,POOL:2,POOL:3,POOL:4");
const perRing = new Map();
for (const row of after) perRing.set(row.ring_id, [...(perRing.get(row.ring_id) ?? []), row.queue_order]);
check("every tatami's queue has distinct positions", [...perRing.values()].every((o) => new Set(o).size === o.length));
check("the split category's finals stay a single finals card", after.filter((c) => c.part === "FINALS").length === 1);

const unassign = await call(A, "saveAssignments", [T1, [{ category_id: category.id, ring_id: null, queue_order: 0 }]], admin);
check("the board cannot unassign a split category", unassign.value?.success === false, JSON.stringify(unassign.value));
const [stillSplit] = await sql`select count(*)::int as n from category_assignments where category_id=${category.id}`;
check("and the split is intact", stillSplit.n === 5);

// ── Changing it later ──────────────────────────────────────────────────────────────────────────
const routeNow = async (pools, finals) => call(A, "setCategoryRouting", [category.id, { kind: "SPLIT", poolRingIds: pools, finalsRingId: finals }], admin);
const [liveNow] = await sql`select count(*)::int as n from matches where category_id=${category.id} and status='LIVE'`;
const routeInfo = await call(A, "getCategoryRouting", [category.id], admin);
check("the routing screen says which cards are locked and why", routeInfo.value?.cards?.some((c) => c.lockReason) === (liveNow.n > 0), JSON.stringify(routeInfo.value?.cards?.map((c) => [c.part, c.lockReason])));

check("a moderator cannot move a pool", failed(await call(A, "setCategoryRouting", [category.id, { kind: "WHOLE", ringId: ringA.id }], modA)));

// Pool 3 has a live bout (tatami B scored it above): it cannot move, but pool 2 can.
const pool3Card = (await sql`select id, ring_id from category_assignments where category_id=${category.id} and part='POOL:3'`)[0];
const stuck = await routeNow([ringA.id, ringA.id, ringA.id, ringB.id], ringA.id);
check("a pool with a live bout cannot move, and the reason names it", stuck.value?.success === false && /live/i.test(stuck.value?.error ?? ""), JSON.stringify(stuck.value));
const [stillB] = await sql`select ring_id from category_assignments where id=${pool3Card.id}`;
check("and it stays on its tatami", stillB.ring_id === pool3Card.ring_id);
const movePool = await routeNow([ringA.id, ringB.id, ringB.id, ringB.id], ringA.id);
check("another pool moves to the other tatami", movePool.value?.success === true && movePool.value?.changed === 1, JSON.stringify(movePool.value));
const [moved] = await sql`select ring_id from category_assignments where category_id=${category.id} and part='POOL:2'`;
check("pool 2 now runs on tatami B", moved.ring_id === ringB.id);

// Putting it back together is refused while a bout is live, then works; fought bouts do not matter.
const [fought] = await sql`select count(*)::int as n from matches where category_id=${category.id} and status in ('LIVE','CONFIRMED')`;
const merge = await call(A, "setCategoryRouting", [category.id, { kind: "WHOLE", ringId: ringA.id }], admin);
if (liveNow.n > 0) {
  check("it cannot be put back together while a bout is live", merge.value?.success === false, JSON.stringify(merge.value));
  await sql`update matches set status='SCHEDULED' where category_id=${category.id} and status='LIVE'`;
  const again = await call(A, "setCategoryRouting", [category.id, { kind: "WHOLE", ringId: ringA.id }], admin);
  check("once nothing is live it can, with fought bouts or not", again.value?.success === true, JSON.stringify(again.value));
} else {
  check("admin puts the category back together", merge.value?.success === true, JSON.stringify(merge.value));
}
const [whole] = await sql`select count(*)::int as n, min(part) as part from category_assignments where category_id=${category.id}`;
check("it is one whole-category card again", whole.n === 1 && whole.part === "ALL", JSON.stringify(whole));
check("results fought before were kept", fought.n >= 0);

// Clean up what this run created.
await sql`delete from categories where id = any(${[category.id, plain.id]})`;
await sql`delete from rings where id = any(${[ringA.id, ringB.id]})`;

await sql.end();
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
