/**
 * Checks seeds, the stored draw seed, club separation and the Official/Local
 * profile end to end against a real database. Writes a throwaway tournament, so
 * it refuses to run against anything but the isolated test database on :55432.
 *
 *   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npx tsx scripts/verify-draw-setup.ts
 */
import assert from "node:assert/strict";

if (!/:55432\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at the test database on :55432.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/db");
  const { admins, tournaments, categories, categoryEntries, athletes, draws, drawVersions, matchSlots, matches } =
    await import("../src/db/schema");
  const { performCategoryDraw } = await import("../src/lib/draws/generateDraws");
  const { eq, and, inArray } = await import("drizzle-orm");

  const adminId = crypto.randomUUID();
  await db.insert(admins).values({ id: adminId, email: `setup-${adminId}@test.local`, name: "Setup test" });
  const [tournament] = await db.insert(tournaments).values({ adminId, name: "Draw setup check" }).returning();

  try {
    const [category] = await db
      .insert(categories)
      .values({ tournamentId: tournament.id, name: "Setup Senior Kumite", bronzeMedals: 1 })
      .returning();

    // Eight athletes; two share a club, written two different ways.
    const rows = await db
      .insert(athletes)
      .values(
        Array.from({ length: 8 }, (_, i) => ({
          tournamentId: tournament.id,
          categoryId: category.id,
          name: `Athlete ${i + 1}`,
          dojo: i === 0 ? "Shito Ryu" : i === 1 ? " shito ryu " : i < 5 ? `Club ${i}` : null,
        }))
      )
      .returning();
    const byName = new Map(rows.map((r) => [r.name, r.id]));

    // Seed two athletes.
    await db.insert(categoryEntries).values([
      { categoryId: category.id, athleteId: byName.get("Athlete 7")!, seed: 1 },
      { categoryId: category.id, athleteId: byName.get("Athlete 8")!, seed: 2 },
    ]);

    const result = await performCategoryDraw(category.id);
    assert.equal(result.success, true, "draw succeeds");

    const [draw] = await db.select().from(draws).where(eq(draws.categoryId, category.id));
    const [version] = await db.select().from(drawVersions).where(eq(drawVersions.drawId, draw.id));
    const graph = version.graph as { randomSeed: number | null };
    assert.equal(typeof graph.randomSeed, "number", "the draw seed is stored with the draw");
    assert.match(String(version.reason), new RegExp(`seed ${graph.randomSeed}`), "and named in the history");
    assert.match(String(version.reason), /2 seeded/, "seeds were used");

    // LOCAL profile honours the category's bronze override.
    assert.equal(draw.bronzeMedals, 1, "local profile uses the category's bronze format");

    // Seeds 1 and 2 sit in opposite halves, and the two Shito Ryu athletes only meet in the final.
    const matchRows = await db.select().from(matches).where(eq(matches.categoryId, category.id));
    const slots = await db
      .select()
      .from(matchSlots)
      .where(inArray(matchSlots.matchId, matchRows.map((m) => m.id)));
    const first = matchRows.filter((m) => m.roundNo === 0).sort((a, b) => a.matchNo - b.matchNo);
    const pairIndex = (athleteId: string) =>
      first.findIndex((m) => slots.some((s) => s.matchId === m.id && s.athleteId === athleteId));

    assert.notEqual(pairIndex(byName.get("Athlete 7")!) >> 1, pairIndex(byName.get("Athlete 8")!) >> 1, "seeds 1 and 2 in opposite halves");
    assert.notEqual(
      pairIndex(byName.get("Athlete 1")!) >> 1,
      pairIndex(byName.get("Athlete 2")!) >> 1,
      "club-mates (case/space differences) in opposite halves"
    );

    // Official profile ignores local tweaks.
    await db.update(tournaments).set({ drawProfile: "OFFICIAL" }).where(eq(tournaments.id, tournament.id));
    const official = await performCategoryDraw(category.id, { bronzeMedals: 0 });
    assert.equal(official.success, true);
    const [after] = await db.select().from(draws).where(eq(draws.categoryId, category.id));
    assert.equal(after.bronzeMedals, 2, "official profile forces WKF's two bronzes");
    assert.equal(after.version, 2, "the redraw is a new version");

    // A bad seed is reported, not thrown.
    await db.update(tournaments).set({ drawProfile: "LOCAL" }).where(eq(tournaments.id, tournament.id));
    await db
      .update(categoryEntries)
      .set({ seed: 99 })
      .where(and(eq(categoryEntries.categoryId, category.id), eq(categoryEntries.athleteId, byName.get("Athlete 7")!)));
    const bad = await performCategoryDraw(category.id);
    assert.equal(bad.success, false, "an out-of-range seed is refused with a message");
    assert.match(String((bad as { error?: string }).error), /outside 1\.\.8/);

    // ---- Manual swap: local profile only, draft only, recorded as a new version.
    const { performDrawSwap } = await import("../src/lib/draws/manualSwap");
    await db.update(categoryEntries).set({ seed: null }).where(eq(categoryEntries.categoryId, category.id));
    await db.update(tournaments).set({ drawProfile: "LOCAL" }).where(eq(tournaments.id, tournament.id));
    assert.equal((await performCategoryDraw(category.id)).success, true, "redraw under local rules");
    const swapSlots = await db.select().from(matchSlots).where(inArray(matchSlots.matchId, (await db.select().from(matches).where(eq(matches.categoryId, category.id))).filter((m) => m.roundNo === 0).map((m) => m.id)));
    const [slotA, slotB] = swapSlots.filter((sl) => sl.slotType === "ATHLETE" && sl.athleteId);
    const swapped = await performDrawSwap(category.id, slotA.id, slotB.id, "club clash");
    assert.ok(!("error" in swapped), `swap succeeds (${(swapped as { error?: string }).error ?? ""})`);
    const [slotAAfter] = await db.select().from(matchSlots).where(eq(matchSlots.id, slotA.id));
    assert.equal(slotAAfter.athleteId, slotB.athleteId, "the database slot moved");
    const versions = await db.select().from(drawVersions).where(eq(drawVersions.drawId, (await db.select().from(draws).where(eq(draws.categoryId, category.id)))[0].id));
    assert.equal(versions.length >= 2, true, "the history keeps the pre-swap draw");
    assert.match(String(versions.sort((x, y) => y.version - x.version)[0].reason), /Manual swap.*club clash/);

    await db.update(tournaments).set({ drawProfile: "OFFICIAL" }).where(eq(tournaments.id, tournament.id));
    assert.ok("error" in (await performDrawSwap(category.id, slotA.id, slotB.id)), "official draws cannot be swapped");
    await db.update(tournaments).set({ drawProfile: "LOCAL" }).where(eq(tournaments.id, tournament.id));
    const [oneBout] = await db.select().from(matches).where(eq(matches.categoryId, category.id)).limit(1);
    await db.update(matches).set({ status: "CONFIRMED" }).where(eq(matches.id, oneBout.id));
    assert.ok("error" in (await performDrawSwap(category.id, slotA.id, slotB.id)), "a fought category cannot be swapped");
    await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, oneBout.id));

    // ---- Kata pool flight: same graph, seed and checksum; advancement still works on top of it.
    const { checksumOf } = await import("../src/engine/draw-engine/canonical");
    const { advanceKataPoolFinalists } = await import("../src/lib/kata/poolAdvancement");

    const [kataCat] = await db
      .insert(categories)
      .values({ tournamentId: tournament.id, name: "Setup Kata", eventType: "kata", kataFormat: "GROUP_POOLS", poolSize: 5 })
      .returning();
    await db.insert(athletes).values(
      Array.from({ length: 10 }, (_, i) => ({
        tournamentId: tournament.id,
        categoryId: kataCat.id,
        name: `Kata ${i + 1}`,
        dojo: `Club ${i % 4}`,
      }))
    );

    const kataDraw = await performCategoryDraw(kataCat.id);
    assert.equal(kataDraw.success, true, "kata draw succeeds");

    const [kd] = await db.select().from(draws).where(eq(draws.categoryId, kataCat.id));
    const [kv] = await db.select().from(drawVersions).where(eq(drawVersions.drawId, kd.id));
    const { checksum: storedChecksum, ...body } = kv.graph as { checksum: string; randomSeed: number | null };
    assert.equal(typeof body.randomSeed, "number", "the kata draw seed is stored");
    assert.equal(checksumOf(body), storedChecksum, "the stored kata graph matches its checksum");
    assert.equal(storedChecksum, kd.checksum, "and the draw row");
    assert.equal(kd.format, "KATA_GROUP_POOLS");

    const kataMatches = await db.select().from(matches).where(eq(matches.categoryId, kataCat.id));
    const poolBouts = kataMatches.filter((m) => m.bracketType === "POOL");
    assert.equal(kataMatches.filter((m) => m.status === "READY").length, 1, "the first bout starts READY");
    assert.ok(poolBouts.every((m) => m.poolGroup === "Pool A" || m.poolGroup === "Pool B"));
    const kataCategoryRow = (await db.select().from(categories).where(eq(categories.id, kataCat.id)))[0];
    assert.equal(kataCategoryRow.expectedMatches, kataMatches.length, "expected bouts match the flight");

    // Fight every pool bout, then check the medal flight fills.
    for (const [i, m] of poolBouts.entries()) {
      await db
        .update(matches)
        .set({ status: "CONFIRMED", akaScoreTotal: String(8 + (i % 3) * 0.1), aoScoreTotal: "7.0", winnerSide: "AKA" })
        .where(eq(matches.id, m.id));
    }
    const advanced = await advanceKataPoolFinalists(kataCat.id);
    assert.equal(advanced.success, true, "pool advancement runs on the new draw");

    const finalMatch = (await db.select().from(matches).where(eq(matches.categoryId, kataCat.id))).find((m) => m.bracketType === "MAIN");
    const finalSlots = await db.select().from(matchSlots).where(eq(matchSlots.matchId, finalMatch!.id));
    assert.equal(finalSlots.filter((sl) => sl.athleteId).length, 2, "the gold bout gets its two finalists");

    console.log("draw setup: all checks passed");
  } finally {
    await db.delete(tournaments).where(eq(tournaments.id, tournament.id));
    await db.delete(admins).where(eq(admins.id, adminId));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
