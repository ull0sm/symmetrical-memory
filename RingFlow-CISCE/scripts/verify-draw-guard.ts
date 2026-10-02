/**
 * Checks that a draw cannot be regenerated over a lock or fought bouts.
 * Writes a throwaway tournament, so it refuses to run against anything but the
 * isolated test database on port 55432.
 *
 *   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npx tsx scripts/verify-draw-guard.ts
 */
import assert from "node:assert/strict";

if (!/:55432\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at the test database on :55432.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../src/db");
  const { admins, tournaments, categories, athletes, matches, draws } = await import("../src/db/schema");
  const { performCategoryDraw } = await import("../src/lib/draws/generateDraws");
  const { eq } = await import("drizzle-orm");

  const adminId = crypto.randomUUID();
  await db.insert(admins).values({ id: adminId, email: `guard-${adminId}@test.local`, name: "Guard test" });
  const [tournament] = await db.insert(tournaments).values({ adminId, name: "Draw guard check" }).returning();
  const [category] = await db
    .insert(categories)
    .values({ tournamentId: tournament.id, name: "Guard U18 Kumite" })
    .returning();
  await db.insert(athletes).values(
    Array.from({ length: 6 }, (_, i) => ({
      tournamentId: tournament.id,
      categoryId: category.id,
      name: `Athlete ${i + 1}`,
      dojo: i % 2 === 0 ? "Club A" : "Club B",
    }))
  );

  try {
    const first = await performCategoryDraw(category.id);
    assert.equal(first.success, true, "first draw succeeds");

    const again = await performCategoryDraw(category.id);
    assert.equal(again.success, true, "an unlocked, unfought draw can be redrawn");

    await db.update(draws).set({ state: "LOCKED" }).where(eq(draws.categoryId, category.id));
    const locked = await performCategoryDraw(category.id);
    assert.equal(locked.success, false, "a locked draw is refused");
    assert.match(String((locked as { error?: string }).error), /LOCKED/);

    await db.update(draws).set({ state: "DRAFT" }).where(eq(draws.categoryId, category.id));
    const [bout] = await db.select().from(matches).where(eq(matches.categoryId, category.id)).limit(1);
    await db.update(matches).set({ status: "CONFIRMED" }).where(eq(matches.id, bout.id));

    const fought = await performCategoryDraw(category.id);
    assert.equal(fought.success, false, "a category with a confirmed bout is refused even when unlocked");
    assert.match(String((fought as { error?: string }).error), /confirmed/);

    const [still] = await db.select().from(matches).where(eq(matches.id, bout.id));
    assert.equal(still?.status, "CONFIRMED", "the confirmed bout survived the refused redraw");

    console.log("draw guard: all checks passed");
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
