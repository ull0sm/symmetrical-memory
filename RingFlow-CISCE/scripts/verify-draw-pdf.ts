/**
 * Builds draw sheets for a spread of category sizes (and a kata pool category),
 * with accented, Hindi and Kannada names, and writes them to a folder so they
 * can be looked at. Uses a throwaway tournament on the isolated test database
 * on :55432 and refuses to run anywhere else.
 *
 *   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npx tsx scripts/verify-draw-pdf.ts <outDir>
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

if (!/:55432\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at the test database on :55432.");
  process.exit(1);
}

const NAMES = [
  "José Núñez", "अश्विन कुमार शर्मा", "ಅಶ್ವಿನ್ ಕುಮಾರ್ ಶೆಟ್ಟಿ", "Zoë Ångström", "Priya Nair", "ರಾಹುಲ್ ಗೌಡ",
  "Müller Straße", "Arjun Reddy", "Çelik Özgür", "सुनीता देवी", "Ananya Rao", "Mohammed Rafi",
  "Lakshmi Narayanan", "ಶ್ರೇಯಸ್ ಹೆಗ್ಡೆ", "Kavya Menon", "Rohan D'Souza",
];
const CLUBS = ["Shito Ryu Bengaluru", "ಕರ್ನಾಟಕ ಕರಾಟೆ ಸಂಘ", "Kyokushin Mysuru", "Wado Kai Hubballi", "श्री कराटे अकादमी", null];

async function main() {
  const outDir = process.argv[2];
  assert.ok(outDir, "pass an output folder");
  fs.mkdirSync(outDir, { recursive: true });

  const { db } = await import("../src/db");
  const { admins, tournaments, categories, athletes, draws } = await import("../src/db/schema");
  const { performCategoryDraw } = await import("../src/lib/draws/generateDraws");
  const { buildCategoryDrawPdf } = await import("../src/lib/pdf/drawSheetFiles");
  const { eq } = await import("drizzle-orm");

  const adminId = crypto.randomUUID();
  await db.insert(admins).values({ id: adminId, email: `pdf-${adminId}@test.local`, name: "PDF test" });
  const [tournament] = await db
    .insert(tournaments)
    .values({ adminId, name: "Dasara Karate Championship 2026 · ದಸರಾ", venue: "Kanteerava Indoor Stadium, Bengaluru", eventDate: "2026-10-12" })
    .returning();

  const plans: Array<{ label: string; count: number; kata?: boolean; lock?: boolean; bronze?: number }> = [
    { label: "kumite-06-draft", count: 6 },
    { label: "kumite-08-locked", count: 8, lock: true },
    { label: "kumite-12-draft", count: 12 },
    { label: "kumite-20-locked", count: 20, lock: true },
    { label: "kumite-40-draft", count: 40 },
    { label: "kumite-11-onebronze", count: 11, bronze: 1 },
    { label: "kata-10-draft", count: 10, kata: true },
    { label: "kata-21-locked", count: 21, kata: true, lock: true },
  ];

  try {
    for (const plan of plans) {
      const [category] = await db
        .insert(categories)
        .values({
          tournamentId: tournament.id,
          name: `${plan.label} · U21 ಪುರುಷ`,
          eventType: plan.kata ? "kata" : "kumite",
          bronzeMedals: plan.bronze ?? null,
        })
        .returning();
      await db.insert(athletes).values(
        Array.from({ length: plan.count }, (_, i) => ({
          tournamentId: tournament.id,
          categoryId: category.id,
          name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`,
          dojo: CLUBS[i % CLUBS.length],
          chestNumber: String(100 + i),
        }))
      );

      const drawn = await performCategoryDraw(category.id);
      assert.equal(drawn.success, true, `${plan.label}: draw succeeds (${(drawn as { error?: string }).error ?? ""})`);
      if (plan.lock) await db.update(draws).set({ state: "LOCKED" }).where(eq(draws.categoryId, category.id));

      const pdf = await buildCategoryDrawPdf(category.id);
      assert.equal(pdf.success, true);
      const file = path.join(outDir, `${plan.label}.pdf`);
      fs.writeFileSync(file, Buffer.from(pdf.base64, "base64"));
      console.log(`${plan.label}: ${fs.statSync(file).size} bytes`);
    }
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
