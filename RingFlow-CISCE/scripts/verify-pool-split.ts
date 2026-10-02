/**
 * Checks where a category runs, against a real database: splitting its pools across tatamis, moving a
 * pool or the finals later, putting it back together, what blocks a change (only a live bout), what does
 * not (fought bouts), the part of every bout, which tatami a bout belongs to, and the finals waiting for
 * the pools. Writes a throwaway tournament, so it refuses to run against anything but the isolated test
 * database on :55432.
 *
 *   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npx tsx scripts/verify-pool-split.ts
 */
import assert from "node:assert/strict";

if (!/:55432\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at the test database on :55432.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/db");
  const { admins, tournaments, rings, categories, categoryAssignments, athletes, matches } = await import("../src/db/schema");
  const { performCategoryDraw } = await import("../src/lib/draws/generateDraws");
  const { performSetRouting, poolsFinalsWaitFor, poolCountOf, healPartSizes } = await import("../src/lib/draws/partRouting");
  const { loadCategoryPools } = await import("../src/lib/draws/poolRosters");
  const { assembleCategoryDraw } = await import("../src/lib/draws/assembleDraw");
  const { scopeForMatch } = await import("../src/lib/auth/scope");
  const { eq, and, sql, inArray } = await import("drizzle-orm");

  const adminId = crypto.randomUUID();
  await db.insert(admins).values({ id: adminId, email: `split-${adminId}@test.local`, name: "Split test" });
  const [tournament] = await db.insert(tournaments).values({ adminId, name: "Pool routing check" }).returning();
  const [otherTournament] = await db.insert(tournaments).values({ adminId, name: "Other event" }).returning();

  try {
    const [ringA, ringB] = await db
      .insert(rings)
      .values([
        { tournamentId: tournament.id, name: "Tatami 1", ringOrder: 1, accessCode: `T1-${adminId.slice(0, 8)}` },
        { tournamentId: tournament.id, name: "Tatami 2", ringOrder: 2, accessCode: `T2-${adminId.slice(0, 8)}` },
      ])
      .returning();
    const [foreignRing] = await db
      .insert(rings)
      .values({ tournamentId: otherTournament.id, name: "Elsewhere", ringOrder: 1, accessCode: `T3-${adminId.slice(0, 8)}` })
      .returning();

    const makeCategory = async (name: string, count: number, extra: Partial<typeof categories.$inferInsert> = {}) => {
      const [category] = await db.insert(categories).values({ tournamentId: tournament.id, name, ...extra }).returning();
      await db.insert(athletes).values(
        Array.from({ length: count }, (_, i) => ({
          tournamentId: tournament.id,
          categoryId: category.id,
          name: `${name} ${String(i + 1).padStart(2, "0")}`,
          dojo: `Club ${i % 7}`,
        }))
      );
      return category;
    };
    const SPLIT = (pools: string[], finals: string) => ({ kind: "SPLIT" as const, poolRingIds: pools, finalsRingId: finals });
    const WHOLE = (ringId: string) => ({ kind: "WHOLE" as const, ringId });
    const cardsOf = async (categoryId: string) =>
      db.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, categoryId));
    const card = async (categoryId: string, part: string) => (await cardsOf(categoryId)).find((c) => c.part === part)!;
    const queuesAreClean = async () => {
      const all = await db.select().from(categoryAssignments).where(inArray(categoryAssignments.ringId, [ringA.id, ringB.id]));
      const seen = new Set<string>();
      for (const c of all) {
        const key = `${c.ringId}:${c.queueOrder}`;
        assert.ok(!seen.has(key), `tatami queues have no clash (${key})`);
        seen.add(key);
      }
    };
    /** Sets the status of the first `limit` ready first-round bouts of a part (or of the whole category). */
    const setBouts = (categoryId: string, part: string | null, status: string, limit: number) =>
      db.execute(sql`
        update matches set status = ${status}
        where id in (
          select id from matches
          where category_id = ${categoryId} and ${part === null ? sql`true` : sql`part = ${part}`}
            and round_no = 0
            and (select count(*) from match_slots s where s.match_id = matches.id and s.athlete_id is not null) = 2
          order by match_no limit ${limit})`);

    // ---- a 64-place kumite bracket: four pools of 16 ---------------------------------------
    const big = await makeCategory("Big Kumite", 64);
    assert.equal((await performCategoryDraw(big.id, { randomSeed: 5 })).success, true, "draw succeeds");
    assert.equal(await poolCountOf(big.id), 4, "a 64-place draw has four pools");

    // Assigning the whole category, then changing its tatami, are the same operation.
    const assigned = await performSetRouting(big.id, WHOLE(ringA.id));
    assert.ok(!("error" in assigned), "a category with no card is assigned");
    assert.equal((await cardsOf(big.id)).length, 1);
    const movedWhole = await performSetRouting(big.id, WHOLE(ringB.id));
    assert.ok(!("error" in movedWhole), "and moved to another tatami");
    assert.equal((await card(big.id, "ALL")).ringId, ringB.id);
    await performSetRouting(big.id, WHOLE(ringA.id));
    const noop = await performSetRouting(big.id, WHOLE(ringA.id));
    assert.ok(!("error" in noop) && noop.actions.length === 0, "asking for what already holds changes nothing");

    // Bad plans are refused and change nothing.
    for (const [label, plan] of [
      ["too few pool tatamis", SPLIT([ringA.id, ringB.id], ringA.id)],
      ["a tatami from another event", SPLIT([ringA.id, ringA.id, ringB.id, foreignRing.id], ringA.id)],
      ["a finals tatami from another event", SPLIT([ringA.id, ringA.id, ringB.id, ringB.id], foreignRing.id)],
    ] as const) {
      assert.ok("error" in (await performSetRouting(big.id, plan)), `${label} is refused`);
    }
    assert.equal((await cardsOf(big.id)).length, 1, "a refused plan leaves the single card alone");

    // Split: pools 1-2 on tatami 1, pools 3-4 on tatami 2, finals on tatami 1.
    const split = await performSetRouting(big.id, SPLIT([ringA.id, ringA.id, ringB.id, ringB.id], ringA.id));
    assert.ok(!("error" in split), "the split succeeds");
    let cards = await cardsOf(big.id);
    assert.deepEqual(cards.map((c) => c.part).sort(), ["FINALS", "POOL:1", "POOL:2", "POOL:3", "POOL:4"]);
    assert.equal((await card(big.id, "POOL:3")).ringId, ringB.id, "pool 3 runs on tatami 2");
    await queuesAreClean();

    const allMatches = await db.select().from(matches).where(eq(matches.categoryId, big.id));
    assert.ok(allMatches.every((m) => m.part !== null), "every bout has a part");
    for (const n of [1, 2, 3, 4]) assert.equal(allMatches.filter((m) => m.part === `POOL:${n}`).length, 15, `pool ${n} has 8+4+2+1 bouts`);
    assert.deepEqual(
      cards.filter((c) => c.part.startsWith("POOL")).map((c) => [c.partAthletes, c.partMatches]),
      [[16, 15], [16, 15], [16, 15], [16, 15]],
      "each pool holds 16 athletes and runs 15 bouts"
    );

    // A category split before sizes were stored gets them from its draw, not from the whole category.
    await db.update(categoryAssignments).set({ partAthletes: null, partMatches: null }).where(eq(categoryAssignments.categoryId, big.id));
    await healPartSizes([ringA.id, ringB.id]);
    assert.deepEqual(
      (await cardsOf(big.id)).map((c) => [c.part, c.partAthletes, c.partMatches]).sort(),
      [["FINALS", 4, (await card(big.id, "FINALS")).partMatches], ["POOL:1", 16, 15], ["POOL:2", 16, 15], ["POOL:3", 16, 15], ["POOL:4", 16, 15]],
      "missing part sizes are filled in from the draw"
    );

    // Who is in each pool, and the one-pool view of the draw.
    const pools = await loadCategoryPools(big.id);
    assert.equal(pools?.length, 4);
    assert.ok(pools!.every((p) => p.athletes.length === 16));
    assert.equal(new Set(pools!.flatMap((p) => p.athletes.map((a) => a.athleteId))).size, 64, "nobody is in two pools or none");
    const poolView = await assembleCategoryDraw(big.id, { part: "POOL:3" });
    assert.ok(poolView!.matches.length === 15 && poolView!.matches.every((m) => m.part === "POOL:3"), "one pool's view has only its bouts");
    const finalsView = await assembleCategoryDraw(big.id, { part: "FINALS" });
    const semis = finalsView!.matches.filter((m) => m.bracketType === "MAIN" && m.roundNo === 4);
    assert.ok(semis.length > 0 && semis.every((m) => m.aka.sourceLabel?.endsWith("winner")), "the finals name the pool winners");

    // Each bout is authorised on the tatami that runs its part.
    const poolThreeBout = allMatches.find((m) => m.part === "POOL:3" && m.roundNo === 0)!;
    const finalsBout = allMatches.find((m) => m.part === "FINALS" && m.bracketType === "MAIN")!;
    assert.equal((await scopeForMatch(poolThreeBout.id)).ringId, ringB.id);
    assert.equal((await scopeForMatch(finalsBout.id)).ringId, ringA.id);

    // Finals wait for the pools.
    assert.deepEqual(await poolsFinalsWaitFor(big.id), [1, 2, 3, 4]);
    await db
      .update(categoryAssignments)
      .set({ status: "completed" })
      .where(and(eq(categoryAssignments.categoryId, big.id), sql`${categoryAssignments.part} in ('POOL:1', 'POOL:2')`));
    assert.deepEqual(await poolsFinalsWaitFor(big.id), [3, 4]);
    await db.update(categoryAssignments).set({ status: "pending" }).where(eq(categoryAssignments.categoryId, big.id));

    // The one-primary-card rule holds in the database.
    await assert.rejects(db.insert(categoryAssignments).values({ ringId: ringB.id, categoryId: big.id, queueOrder: 99, part: "ALL" }));
    await assert.rejects(db.insert(categoryAssignments).values({ ringId: ringB.id, categoryId: big.id, queueOrder: 98, part: "POOLS" }));

    // ---- changing it later: only the parts that change move ----------------------------------
    const poolOneBefore = await card(big.id, "POOL:1");
    const moveOne = await performSetRouting(big.id, SPLIT([ringA.id, ringB.id, ringB.id, ringB.id], ringA.id));
    assert.ok(!("error" in moveOne) && moveOne.actions.length === 1, "moving pool 2 is one change");
    assert.equal((await card(big.id, "POOL:2")).ringId, ringB.id, "pool 2 is now on tatami 2");
    assert.equal((await card(big.id, "POOL:1")).id, poolOneBefore.id, "pool 1's card is untouched");
    assert.equal((await card(big.id, "POOL:2")).partAthletes, 16, "a moved pool keeps its size");
    await queuesAreClean();

    // Fought bouts do not block anything: results live on the bouts.
    await setBouts(big.id, "POOL:3", "CONFIRMED", 5);
    const moveFought = await performSetRouting(big.id, SPLIT([ringA.id, ringB.id, ringA.id, ringB.id], ringB.id));
    assert.ok(!("error" in moveFought), "a pool with fought bouts can move, and so can the finals");
    assert.equal((await card(big.id, "POOL:3")).ringId, ringA.id);
    assert.equal((await card(big.id, "FINALS")).ringId, ringB.id);
    assert.equal(
      (await db.select().from(matches).where(and(eq(matches.categoryId, big.id), eq(matches.status, "CONFIRMED")))).length,
      5,
      "the results stay on the bouts"
    );
    await queuesAreClean();

    // A live bout blocks its own pool, and only its pool.
    await setBouts(big.id, "POOL:4", "LIVE", 1);
    const setCard = (part: string, status: string) =>
      db.update(categoryAssignments).set({ status }).where(and(eq(categoryAssignments.categoryId, big.id), eq(categoryAssignments.part, part)));
    // A bout left LIVE on a card that went back to the queue is not running, so it does not block.
    const staleOk = await performSetRouting(big.id, SPLIT([ringA.id, ringB.id, ringA.id, ringB.id], ringB.id));
    assert.ok(!("error" in staleOk), "a stale live bout on a queued pool does not block moving it");
    assert.equal((await card(big.id, "POOL:4")).ringId, ringB.id);
    await performSetRouting(big.id, SPLIT([ringA.id, ringB.id, ringA.id, ringB.id], ringB.id));
    await setCard("POOL:4", "running");
    const liveBlocks = await performSetRouting(big.id, SPLIT([ringA.id, ringB.id, ringA.id, ringA.id], ringB.id));
    assert.ok("error" in liveBlocks && /live/i.test(liveBlocks.error) && /Pool 4/.test(liveBlocks.error), "pool 4 cannot move while its bout is live");
    assert.equal((await card(big.id, "POOL:4")).ringId, ringB.id, "and nothing moved");
    const otherWhileLive = await performSetRouting(big.id, SPLIT([ringB.id, ringB.id, ringA.id, ringB.id], ringB.id));
    assert.ok(!("error" in otherWhileLive), "other pools still move while one is live");
    assert.ok("error" in (await performSetRouting(big.id, WHOLE(ringA.id))), "and it cannot be merged while a bout is live");
    await setBouts(big.id, "POOL:4", "SCHEDULED", 1);
    await setCard("POOL:4", "pending");

    // A pool on a mat between bouts moves and returns to the queue.
    await db
      .update(categoryAssignments)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(categoryAssignments.categoryId, big.id), eq(categoryAssignments.part, "POOL:3")));
    const [bout] = await db.select().from(matches).where(and(eq(matches.categoryId, big.id), eq(matches.part, "POOL:3"))).limit(1);
    await db.update(rings).set({ currentMatchId: bout.id }).where(eq(rings.id, ringA.id));
    const moveRunning = await performSetRouting(big.id, SPLIT([ringB.id, ringB.id, ringB.id, ringB.id], ringB.id));
    assert.ok(!("error" in moveRunning), "a pool on a mat between bouts can move");
    assert.equal((await card(big.id, "POOL:3")).status, "pending", "and waits in the new tatami's queue");
    assert.equal((await db.select().from(rings).where(eq(rings.id, ringA.id)))[0].currentMatchId, null, "the old tatami no longer points at its bout");

    // A finished pool stays where it ran.
    await db
      .update(categoryAssignments)
      .set({ status: "completed" })
      .where(and(eq(categoryAssignments.categoryId, big.id), eq(categoryAssignments.part, "POOL:1")));
    assert.ok("error" in (await performSetRouting(big.id, SPLIT([ringA.id, ringB.id, ringB.id, ringB.id], ringB.id))), "a finished pool does not move");
    await db.update(categoryAssignments).set({ status: "pending" }).where(eq(categoryAssignments.categoryId, big.id));

    // ---- putting it back together keeps the results -------------------------------------------
    const merged = await performSetRouting(big.id, WHOLE(ringA.id));
    assert.ok(!("error" in merged), "a category with fought bouts is put back together");
    cards = await cardsOf(big.id);
    assert.deepEqual(cards.map((c) => [c.part, c.ringId]), [["ALL", ringA.id]], "one whole-category card on the chosen tatami");
    assert.equal(cards[0].matchesCompleted, 5, "its count is the bouts fought across the pools");
    assert.equal(
      (await db.select().from(matches).where(and(eq(matches.categoryId, big.id), sql`${matches.part} is not null`))).length,
      0,
      "no bout keeps a part"
    );

    // ---- splitting part-way through keeps what was fought -------------------------------------
    await setBouts(big.id, null, "CONFIRMED", 8);
    const confirmed = (await db.select().from(matches).where(and(eq(matches.categoryId, big.id), eq(matches.status, "CONFIRMED")))).length;
    const late = await performSetRouting(big.id, SPLIT([ringA.id, ringA.id, ringB.id, ringB.id], ringA.id));
    assert.ok(!("error" in late), "a category with fought bouts can be split");
    const progress = (await cardsOf(big.id)).reduce((sum, c) => sum + c.matchesCompleted, 0);
    assert.equal(progress, confirmed, "every fought bout is counted in its pool");
    await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.categoryId, big.id));
    await performSetRouting(big.id, WHOLE(ringA.id));

    // A live bout in a whole category blocks splitting it.
    await setBouts(big.id, null, "LIVE", 1);
    await db.update(categoryAssignments).set({ status: "running" }).where(eq(categoryAssignments.categoryId, big.id));
    assert.ok("error" in (await performSetRouting(big.id, SPLIT([ringA.id, ringA.id, ringB.id, ringB.id], ringA.id))), "a live bout blocks the split");
    await db.update(categoryAssignments).set({ status: "pending" }).where(eq(categoryAssignments.categoryId, big.id));
    await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.categoryId, big.id));

    // ---- a redraw keeps the routing when the pool count is unchanged --------------------------
    await performSetRouting(big.id, SPLIT([ringA.id, ringA.id, ringB.id, ringB.id], ringA.id));
    const redraw = await performCategoryDraw(big.id, { randomSeed: 6 });
    assert.equal(redraw.success, true, "a split category with nothing fought can be redrawn");
    cards = await cardsOf(big.id);
    assert.deepEqual(cards.map((c) => c.part).sort(), ["FINALS", "POOL:1", "POOL:2", "POOL:3", "POOL:4"], "its routing survived");
    assert.equal((await card(big.id, "POOL:3")).ringId, ringB.id, "on the same tatamis");
    assert.ok((await db.select().from(matches).where(eq(matches.categoryId, big.id))).every((m) => m.part !== null), "the new bouts carry their parts");

    // ...and falls back to one card when the pool count changes.
    await db.delete(athletes).where(and(eq(athletes.categoryId, big.id), sql`${athletes.name} > 'Big Kumite 20'`));
    const smaller = await performCategoryDraw(big.id, { randomSeed: 7 });
    assert.equal(smaller.success, true);
    cards = await cardsOf(big.id);
    assert.deepEqual(cards.map((c) => c.part), ["ALL"], "a draw with a different number of pools goes back to one card");
    assert.equal((await db.select().from(matches).where(and(eq(matches.categoryId, big.id), sql`${matches.part} is not null`))).length, 0);

    // ---- small draws cannot be split ---------------------------------------------------------
    const small = await makeCategory("Small Kumite", 12);
    await performCategoryDraw(small.id, { randomSeed: 1 });
    assert.equal(await poolCountOf(small.id), null, "a 16-place draw has a single pool");
    assert.ok("error" in (await performSetRouting(small.id, SPLIT([ringA.id, ringB.id], ringA.id))), "a single pool is not split");
    const none = await makeCategory("Undrawn", 20);
    assert.ok("error" in (await performSetRouting(none.id, SPLIT([ringA.id, ringB.id], ringA.id))), "no draw, no split");

    // ---- kata pools: Pool A and Pool B on different tatamis ---------------------------------
    const kata = await makeCategory("Kata Open", 17, { eventType: "kata", kataFormat: "GROUP_POOLS", poolSize: 8 });
    assert.equal((await performCategoryDraw(kata.id, { randomSeed: 9 })).success, true, "kata draw succeeds");
    assert.equal(await poolCountOf(kata.id), 2, "17 kata entrants make two pools");
    assert.ok(!("error" in (await performSetRouting(kata.id, SPLIT([ringA.id, ringB.id], ringA.id)))), "kata pools split");
    const kataMatches = await db.select().from(matches).where(eq(matches.categoryId, kata.id));
    for (const m of kataMatches) {
      const expected = m.poolGroup === "Pool A" ? "POOL:1" : m.poolGroup === "Pool B" ? "POOL:2" : "FINALS";
      assert.equal(m.part, expected, `kata bout "${m.roundName}" is in ${expected}`);
    }
    assert.equal((await scopeForMatch(kataMatches.find((m) => m.poolGroup === "Pool B")!.id)).ringId, ringB.id);
    assert.equal((await scopeForMatch(kataMatches.find((m) => m.poolGroup === "Final Flight")!.id)).ringId, ringA.id);
    // And swapped later: Pool A to tatami 2, Pool B to tatami 1.
    assert.ok(!("error" in (await performSetRouting(kata.id, SPLIT([ringB.id, ringA.id], ringA.id)))), "kata pools swap tatamis");
    assert.equal((await card(kata.id, "POOL:1")).ringId, ringB.id);

    console.log("pool routing: all checks passed");
  } finally {
    await db.delete(tournaments).where(eq(tournaments.id, tournament.id));
    await db.delete(tournaments).where(eq(tournaments.id, otherTournament.id));
    await db.delete(admins).where(eq(admins.id, adminId));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
