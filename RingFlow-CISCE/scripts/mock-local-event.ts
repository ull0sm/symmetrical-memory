/**
 * A full-day Local event for hands-on trials: 3 tatamis, 15 categories, about 100 children, starting
 * groups built and a tatami per category, nothing locked yet. Walk-ins, absentees and a late add into a
 * running group are done by hand on the stager desk and the admin screens.
 *
 *   npm run db:mock-local
 *
 * Adds one tournament next to whatever is there. Never run it against a real event database.
 */
import "./loadEnv";
import { db } from "../src/db";
import { admins } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { createLocalDemo } from "./localDemo";

async function main() {
  const adminId = "00000000-0000-0000-0000-000000000001";
  const passwordHash = await hashPassword("admin123");
  await db
    .insert(admins)
    .values({ id: adminId, email: "admin@ringflow.org", name: "Tournament Director", passwordHash })
    .onConflictDoNothing();

  const demo = await createLocalDemo({
    adminId,
    name: "Mock Local Event (3 tatamis)",
    codePrefix: "MK",
    ringCount: 3,
    ages: [7, 8, 9, 10, 11],
    belts: ["White", "Yellow", "Green"],
    sexes: ["M"],
    perCategory: 7,
  });
  console.log(`Mock Local event ready: ${demo.categories} categories, ${demo.athletes} children, ${demo.rings.length} tatamis.`);
  console.log(`  Tournament ID: ${demo.tournament.id}`);
  console.log(`  Admin: /admin/event/${demo.tournament.id}/staging   (admin@ringflow.org / admin123)`);
  console.log(`  Stager codes: MKSTG1, MKSTG2   Organiser code: MKORG1   Tatami codes: MKRNG1, MKRNG2, MKRNG3`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Mock event failed:", err);
  process.exit(1);
});
