/**
 * Checks splitting a category's pools across tatamis against a real database: the split and
 * unsplit rules, the part of every bout, which tatami a bout belongs to, the finals waiting for
 * the pools, and that a redraw or a fought bout cannot be undone by accident. Writes a throwaway
 * tournament, so it refuses to run against anything but the isolated test database on :55432.
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
  const { performSplitCategory, performUnsplitCategory, poolsFinalsWaitFor, poolCountOf } = await import(
    "../src/lib/draws/splitPools"
  );
  const { scopeForMatch } = await import("../src/lib/auth/scope");
  const { eq, and, sql } = await import("drizzle-orm");

  const adminId = crypto.randomUUID();
  await db.insert(admins).values({ id: adminId, email: `split-${adminId}@test.local`, name: "Split test" });
  const [tournament] = await db.insert(tournaments).values({ adminId, name: "Pool split check" }).returning();
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

    // ---- a 64-place kumite bracket: four pools of 16 ---------------------------------------
    const big = await makeCategory("Big Kumite", 64);
    assert.equal((await performCategoryDraw(big.id, { randomSeed: 5 })).success, true, "draw succeeds");
    assert.equal(await poolCountOf(big.id), 4, "a 64-place draw has four pools");

    // It sits whole on tatami 1.
    await db.insert(categoryAssignments).values({ ringId: ringA.id, categoryId: big.id, queueOrder: 0 });
    const [whole] = await db.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, big.id));
    assert.equal(whole.part, "ALL", "an ordinary assignment is the whole category");

    // Bad plans are refused and change nothing.
    for (const [label, plan] of [
      ["too few pool tatamis", { poolRingIds: [ringA.id, ringB.id], finalsRingId: ringA.id }],
      ["a tatami from another event", { poolRingIds: [ringA.id, ringA.id, ringB.id, foreignRing.id], finalsRingId: ringA.id }],
      ["a finals tatami from another event", { poolRingIds: [ringA.id, ringA.id, ringB.id, ringB.id], finalsRingId: foreignRing.id }],
    ] as const) {
      const refused = await performSplitCategory(big.id, plan);
      assert.ok("error" in refused, `${label} is refused`);
    }
    assert.equal(
      (await db.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, big.id))).length,
      1,
      "a refused split leaves the single assignment alone"
    );

    // Pools 1-2 on tatami 1, pools 3-4 on tatami 2, finals on tatami 1.
    const split = await performSplitCategory(big.id, { poolRingIds: [ringA.id, ringA.id, ringB.id, ringB.id], finalsRingId: ringA.id });
    assert.ok(!("error" in split), "the split succeeds");

    const cards = await db.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, big.id));
    assert.deepEqual(cards.map((c) => c.part).sort(), ["FINALS", "POOL:1", "POOL:2", "POOL:3", "POOL:4"], "one card per part");
    const card = (part: string) => cards.find((c) => c.part === part)!;
    assert.equal(card("FINALS").id, whole.id, "the finals tatami keeps the original card");
    assert.equal(card("FINALS").queueOrder, 0, "and its place in the queue");
    assert.equal(card("POOL:3").ringId, ringB.id, "pool 3 runs on tatami 2");
    assert.equal(new Set(cards.filter((c) => c.ringId === ringA.id).map((c) => c.queueOrder)).size, 3, "tatami 1's queue has no clashes");

    const allMatches = await db.select().from(matches).where(eq(matches.categoryId, big.id));
    assert.ok(allMatches.every((m) => m.part !== null), "every bout has a part");
    for (const n of [1, 2, 3, 4]) {
      assert.equal(allMatches.filter((m) => m.part === `POOL:${n}`).length, 15, `pool ${n} has 8+4+2+1 bouts`);
    }
    assert.ok(allMatches.filter((m) => m.part === "FINALS").every((m) => m.roundNo >= 4 || m.bracketType !== "MAIN"), "finals are the bouts after the pools");

    // Each part knows how big it is, for its own progress bar.
    assert.deepEqual(
      cards.filter((c) => c.part.startsWith("POOL")).map((c) => [c.partAthletes, c.partMatches]),
      [[16, 15], [16, 15], [16, 15], [16, 15]],
      "each pool holds 16 athletes and runs 15 bouts"
    );
    assert.equal(card("FINALS").partAthletes, 4, "the finals start with the four pool winners");

    // Who is in each pool, and the one-pool view of the draw.
    const { loadCategoryPools } = await import("../src/lib/draws/poolRosters");
    const { assembleCategoryDraw } = await import("../src/lib/draws/assembleDraw");
    const pools = await loadCategoryPools(big.id);
    assert.equal(pools?.length, 4, "four pools are listed");
    assert.ok(pools!.every((p) => p.athletes.length === 16), "16 athletes in each");
    assert.equal(new Set(pools!.flatMap((p) => p.athletes.map((a) => a.athleteId))).size, 64, "nobody is in two pools or none");
    assert.equal(pools![2].tatami, ringB.name, "pool 3 says it runs on tatami 2");

    const poolView = await assembleCategoryDraw(big.id, { part: "POOL:3" });
    assert.equal(poolView?.matches.length, 15, "pool 3's view has only pool 3's bouts");
    assert.ok(poolView!.matches.every((m) => m.part === "POOL:3"), "and none from another pool");
    assert.equal(poolView?.athletes.length, 16, "with its 16 athletes");
    assert.equal(poolView?.podium, null, "a pool has no podium");
    assert.deepEqual(poolView?.partSummary.map((p) => p.part), ["POOL:1", "POOL:2", "POOL:3", "POOL:4", "FINALS"]);

    const finalsView = await assembleCategoryDraw(big.id, { part: "FINALS" });
    assert.ok(finalsView!.matches.every((m) => m.part === "FINALS"), "the finals view holds only finals bouts");
    const semis = finalsView!.matches.filter((m) => m.bracketType === "MAIN" && m.roundNo === 4);
    assert.ok(semis.length > 0 && semis.every((m) => m.aka.sourceLabel?.endsWith("winner") && m.ao.sourceLabel?.endsWith("winner")), "pool winners are named, not shown as TBD bouts");
    const wholeView = await assembleCategoryDraw(big.id);
    assert.equal(wholeView?.matches.length, allMatches.length, "no part asked for: the whole draw");

    // Each bout is authorised on the tatami that runs its part.
    const poolThreeBout = allMatches.find((m) => m.part === "POOL:3" && m.roundNo === 0)!;
    const finalsBout = allMatches.find((m) => m.part === "FINALS" && m.bracketType === "MAIN")!;
    assert.equal((await scopeForMatch(poolThreeBout.id)).ringId, ringB.id, "a pool 3 bout belongs to tatami 2");
    assert.equal((await scopeForMatch(finalsBout.id)).ringId, ringA.id, "a finals bout belongs to the finals tatami");

    // Finals wait for the pools.
    assert.deepEqual(await poolsFinalsWaitFor(big.id), [1, 2, 3, 4], "finals wait for all four pools");
    await db
      .update(categoryAssignments)
      .set({ status: "completed" })
      .where(and(eq(categoryAssignments.categoryId, big.id), sql`${categoryAssignments.part} in ('POOL:1', 'POOL:2')`));
    assert.deepEqual(await poolsFinalsWaitFor(big.id), [3, 4], "and then for the two that remain");
    await db.update(categoryAssignments).set({ status: "completed" }).where(eq(categoryAssignments.categoryId, big.id));
    assert.deepEqual(await poolsFinalsWaitFor(big.id), [], "nothing left to wait for");
    await db.update(categoryAssignments).set({ status: "pending" }).where(eq(categoryAssignments.categoryId, big.id));

    // The one-primary-card rule holds in the database.
    await assert.rejects(
      db.insert(categoryAssignments).values({ ringId: ringB.id, categoryId: big.id, queueOrder: 99, part: "ALL" }),
      "a split category cannot also have a whole-category card"
    );
    await assert.rejects(
      db.insert(categoryAssignments).values({ ringId: ringB.id, categoryId: big.id, queueOrder: 98, part: "POOLS" }),
      "a malformed part is refused by the database"
    );

    // A split category cannot be redrawn; it must be put back together first.
    const redraw = await performCategoryDraw(big.id, { randomSeed: 6 });
    assert.equal(redraw.success, false, "a redraw of a split category is refused");
    assert.match(String((redraw as { error?: string }).error), /unsplit/i);
    const twice = await performSplitCategory(big.id, { poolRingIds: [ringA.id, ringA.id, ringB.id, ringB.id], finalsRingId: ringA.id });
    assert.ok("error" in twice, "splitting twice is refused");

    // Unsplit puts it back on the finals tatami.
    const back = await performUnsplitCategory(big.id);
    assert.deepEqual(back, { ringId: ringA.id });
    const after = await db.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, big.id));
    assert.deepEqual(after.map((c) => c.part), ["ALL"], "one whole-category card again");
    assert.equal(
      (await db.select().from(matches).where(and(eq(matches.categoryId, big.id), sql`${matches.part} is not null`))).length,
      0,
      "no bout keeps a part"
    );
    assert.equal((await performCategoryDraw(big.id, { randomSeed: 6 })).success, true, "and it can be redrawn again");

    // ---- a started category cannot be split; a fought one cannot be changed -------------------
    await db.update(categoryAssignments).set({ status: "running" }).where(eq(categoryAssignments.categoryId, big.id));
    const running = await performSplitCategory(big.id, { poolRingIds: [ringA.id, ringA.id, ringB.id, ringB.id], finalsRingId: ringB.id });
    assert.ok("error" in running, "a category on a mat cannot be split");
    await db.update(categoryAssignments).set({ status: "pending" }).where(eq(categoryAssignments.categoryId, big.id));

    // Finals on the other tatami: the old card is replaced, not duplicated.
    const moved = await performSplitCategory(big.id, { poolRingIds: [ringA.id, ringA.id, ringA.id, ringA.id], finalsRingId: ringB.id });
    assert.ok(!("error" in moved), "all pools on one tatami and the finals on the other");
    const movedCards = await db.select().from(categoryAssignments).where(eq(categoryAssignments.categoryId, big.id));
    assert.equal(movedCards.length, 5);
    assert.equal(movedCards.find((c) => c.part === "FINALS")?.ringId, ringB.id);
    assert.equal(new Set(movedCards.filter((c) => c.ringId === ringA.id).map((c) => c.queueOrder)).size, 4);

    const [aBout] = await db.select().from(matches).where(and(eq(matches.categoryId, big.id), eq(matches.part, "POOL:1"))).limit(1);
    await db.update(matches).set({ status: "CONFIRMED" }).where(eq(matches.id, aBout.id));
    const fought = await performUnsplitCategory(big.id);
    assert.ok("error" in fought, "a category with a confirmed bout cannot be put back together");
    await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, aBout.id));
    assert.ok(!("error" in (await performUnsplitCategory(big.id))), "once nothing is fought it can");

    // ---- small draws cannot be split ---------------------------------------------------------
    const small = await makeCategory("Small Kumite", 12);
    await performCategoryDraw(small.id, { randomSeed: 1 });
    assert.equal(await poolCountOf(small.id), null, "a 16-place draw has a single pool");
    const refused = await performSplitCategory(small.id, { poolRingIds: [ringA.id, ringB.id], finalsRingId: ringA.id });
    assert.ok("error" in refused, "a single pool is not split");
    const none = await makeCategory("Undrawn", 20);
    assert.ok("error" in (await performSplitCategory(none.id, { poolRingIds: [ringA.id, ringB.id], finalsRingId: ringA.id })), "no draw, no split");

    // ---- kata pools: Pool A and Pool B on different tatamis ---------------------------------
    const kata = await makeCategory("Kata Open", 17, { eventType: "kata", kataFormat: "GROUP_POOLS", poolSize: 8 });
    assert.equal((await performCategoryDraw(kata.id, { randomSeed: 9 })).success, true, "kata draw succeeds");
    assert.equal(await poolCountOf(kata.id), 2, "17 kata entrants make two pools");
    const kataSplit = await performSplitCategory(kata.id, { poolRingIds: [ringA.id, ringB.id], finalsRingId: ringA.id });
    assert.ok(!("error" in kataSplit), "kata pools split");
    const kataMatches = await db.select().from(matches).where(eq(matches.categoryId, kata.id));
    for (const m of kataMatches) {
      const expected = m.poolGroup === "Pool A" ? "POOL:1" : m.poolGroup === "Pool B" ? "POOL:2" : "FINALS";
      assert.equal(m.part, expected, `kata bout "${m.roundName}" is in ${expected}`);
    }
    const poolB = kataMatches.find((m) => m.poolGroup === "Pool B")!;
    assert.equal((await scopeForMatch(poolB.id)).ringId, ringB.id, "a Pool B kata bout belongs to tatami 2");
    const medal = kataMatches.find((m) => m.poolGroup === "Final Flight")!;
    assert.equal((await scopeForMatch(medal.id)).ringId, ringA.id, "the medal flight belongs to the finals tatami");

    console.log("pool split: all checks passed");
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
