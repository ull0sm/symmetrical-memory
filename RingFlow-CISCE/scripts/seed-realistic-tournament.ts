import { db } from "../src/db";
import {
  admins,
  tournaments,
  rings,
  categories,
  athletes,
  tournamentCategoryDefinitions,
  tournamentRegistrations,
  categoryEntries,
  categoryAssignments,
  moderatorRequests,
} from "../src/db/schema";
// Scripts run without a browser session, so they call the cores the guarded actions wrap.
import { writeCategoryDefinitions } from "../src/lib/roster/categoryDefinitions";
import { OFFICIAL_PRESETS } from "../src/lib/constants/categoryPresets";
import { importOfficialRosterCore } from "../src/lib/roster/officialImport";
import { assembleCategoryDraw } from "../src/lib/draws/assembleDraw";
// The guarded server action checks the caller's admin session; a seed script has
// no request context, so it uses the same core the action wraps.
import { performGenerateAllTournamentDraws } from "../src/lib/draws/generateDraws";
import { commitBoutResult } from "../src/lib/bouts/results";
import { buildAllCategoryDrawPdfs } from "../src/lib/pdf/drawSheetFiles";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/lib/auth/password";

async function runSeed() {
  console.log("🥋 Starting comprehensive RingFlow database seed...");

  // 1. Create Admin
  const adminId = "00000000-0000-0000-0000-000000000001";
  const passwordHash = await hashPassword("admin123");
  await db
    .insert(admins)
    .values({
      id: adminId,
      email: "admin@ringflow.org",
      name: "Tournament Director",
      passwordHash,
    })
    .onConflictDoUpdate({
      target: admins.id,
      set: {
        email: "admin@ringflow.org",
        name: "Tournament Director",
        passwordHash,
      },
    });
  console.log("✅ Admin verified: admin@ringflow.org (password: admin123)");

  // 2. Create Tournament
  const [tournament] = await db
    .insert(tournaments)
    .values({
      adminId,
      name: "CISCE National Karate Championship 2026",
      eventDate: "2026-10-15",
      venue: "Indira Gandhi Indoor Stadium",
      city: "New Delhi",
      status: "active",
      // Without a code, organiser login can never match this tournament.
      organiserCode: "ORG001",
    })
    .returning();
  console.log(`✅ Tournament created: "${tournament.name}" (${tournament.id})`);
  console.log(`   Organiser access code: ${tournament.organiserCode}`);

  // 3. Create Rings
  const ringList = [
    { name: "Tatami 1 - Main Arena", ringOrder: 1, accessCode: "RING01" },
    { name: "Tatami 2 - North Floor", ringOrder: 2, accessCode: "RING02" },
    { name: "Tatami 3 - South Floor", ringOrder: 3, accessCode: "RING03" },
    { name: "Tatami 4 - East Floor", ringOrder: 4, accessCode: "RING04" },
  ];

  const createdRings = [];
  for (const r of ringList) {
    const [ring] = await db
      .insert(rings)
      .values({
        tournamentId: tournament.id,
        name: r.name,
        ringOrder: r.ringOrder,
        accessCode: r.accessCode,
      })
      .returning();
    createdRings.push(ring);
  }
  console.log(`✅ Created ${createdRings.length} rings (RING01, RING02, etc.)`);

  // 4. Configure Official Category Definitions
  console.log("⚙️ Configuring Official Category Definitions from CISCE preset...");
  await writeCategoryDefinitions(tournament.id, OFFICIAL_PRESETS.CISCE_OFFICIAL);
  console.log(`✅ Configured ${OFFICIAL_PRESETS.CISCE_OFFICIAL.length} official category definitions.`);

  // 5. Import Multi-Event Athletes with Weight, Kata, and Kumite
  console.log("📋 Importing realistic multi-event athlete roster...");
  const sampleAthletes = [
    // U14 Boys Kumite (40-45KG) + Kata
    { name: "Mohammed Izyan", school: "St. Mary's Academy", chestNumber: "101", age: 13, sex: "M", weight: 42.5, kata: true, kumite: true },
    { name: "Rohan Sharma", school: "Delhi Public School", chestNumber: "102", age: 13, sex: "M", weight: 43.0, kata: false, kumite: true },
    { name: "Aarav Patel", school: "Bombay Scottish School", chestNumber: "103", age: 13, sex: "M", weight: 41.2, kata: true, kumite: true },
    { name: "Vikramaditya Rao", school: "Loyola High School", chestNumber: "104", age: 13, sex: "M", weight: 44.1, kata: false, kumite: true },
    { name: "Kabir Mehta", school: "St. Xavier's Collegiate", chestNumber: "105", age: 12, sex: "M", weight: 42.0, kata: true, kumite: true },
    { name: "Devansh Joshi", school: "The Doon School", chestNumber: "106", age: 13, sex: "M", weight: 43.8, kata: false, kumite: true },
    { name: "Arjun Singhania", school: "Cathedral & John Connon", chestNumber: "107", age: 12, sex: "M", weight: 40.5, kata: true, kumite: true },
    { name: "Siddharth Verma", school: "Modern School Barakhamba", chestNumber: "108", age: 13, sex: "M", weight: 44.7, kata: false, kumite: true },

    // U14 Boys Kumite (35-40KG)
    { name: "Zaid Khan", school: "St. Paul's School", chestNumber: "109", age: 12, sex: "M", weight: 37.5, kata: false, kumite: true },
    { name: "Neil Sengupta", school: "La Martiniere for Boys", chestNumber: "110", age: 13, sex: "M", weight: 38.2, kata: false, kumite: true },
    { name: "Aditya Roy", school: "South Point High", chestNumber: "111", age: 12, sex: "M", weight: 36.9, kata: false, kumite: true },
    { name: "Armaan Malik", school: "Welham Boys' School", chestNumber: "112", age: 13, sex: "M", weight: 39.1, kata: false, kumite: true },

    // U14 Girls Kumite (30-35KG) + Kata
    { name: "Ananya Iyer", school: "National Public School", chestNumber: "201", age: 13, sex: "F", weight: 33.5, kata: true, kumite: true },
    { name: "Diya Sen", school: "Modern High School for Girls", chestNumber: "202", age: 13, sex: "F", weight: 34.0, kata: false, kumite: true },
    { name: "Priya Nair", school: "Bishop Cotton Girls'", chestNumber: "203", age: 12, sex: "F", weight: 32.1, kata: true, kumite: true },
    { name: "Sneha Kulkarni", school: "Army Public School", chestNumber: "204", age: 13, sex: "F", weight: 31.8, kata: false, kumite: true },
    { name: "Rhea Chawla", school: "Vasant Valley School", chestNumber: "205", age: 12, sex: "F", weight: 34.5, kata: true, kumite: true },
    { name: "Tanvi Deshmukh", school: "Sanskriti School", chestNumber: "206", age: 13, sex: "F", weight: 32.9, kata: false, kumite: true },
    { name: "Kavya Menon", school: "Loreto House", chestNumber: "207", age: 12, sex: "F", weight: 30.8, kata: true, kumite: true },
    { name: "Meera Bannerjee", school: "Mahadevi Birla World Academy", chestNumber: "208", age: 13, sex: "F", weight: 33.0, kata: false, kumite: true },
  ];

  const importReport = await importOfficialRosterCore(tournament.id, sampleAthletes);
  console.log(`✅ Import finished:
     - Total athletes: ${importReport.totalAthletes}
     - Kumite entries created: ${importReport.kumiteEntriesCreated}
     - Kata entries created: ${importReport.kataEntriesCreated}
     - Uncategorized: ${importReport.uncategorized.length}`);

  // 6. Generate All Draws in One Go!
  console.log("🌳 Generating digital tournament draws for all categories...");
  const drawGenResult = await performGenerateAllTournamentDraws(tournament.id);
  console.log(`✅ Draw Generation Result:
     - Categories processed: ${drawGenResult.totalCategories}
     - Draws successfully generated: ${drawGenResult.generatedCount}
     - Skipped (empty categories): ${drawGenResult.skippedCount}`);

  // 7. Assign Categories to Rings
  console.log("🎯 Assigning populated categories to Rings...");
  const allCats = await db.select().from(categories).where(eq(categories.tournamentId, tournament.id));
  const populatedCats = allCats.filter((c) => c.athletesCount >= 2);

  for (let i = 0; i < populatedCats.length; i++) {
    const targetRing = createdRings[i % createdRings.length];
    await db.insert(categoryAssignments).values({
      ringId: targetRing.id,
      categoryId: populatedCats[i].id,
      queueOrder: Math.floor(i / createdRings.length) + 1,
      status: i === 0 ? "running" : "pending",
      matchesCompleted: 0,
    });
  }
  console.log(`✅ Assigned ${populatedCats.length} categories across ${createdRings.length} rings.`);

  // 8. Create Approved Moderator Session for Ring 1
  const sessionToken = "11111111-2222-3333-4444-555555555555";
  await db.delete(moderatorRequests).where(eq(moderatorRequests.sessionToken, sessionToken));
  await db.insert(moderatorRequests).values({
    ringId: createdRings[0].id,
    accessCodeUsed: createdRings[0].accessCode,
    status: "approved",
    sessionToken,
    moderatorName: "Official Tatami Judge (Test)",
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });
  console.log(`✅ Created approved moderator session token for Ring 1.`);

  // 9. Simulate Running a Bout & Advancing the Bracket
  const activeCat = populatedCats[0];
  const drawData = await assembleCategoryDraw(activeCat.id);
  if (drawData && drawData.matches.length > 0) {
    const firstMatch = drawData.matches[0];
    console.log(`🥊 Simulating Bout #${firstMatch.matchNo} in category "${activeCat.name}":
       AKA: ${firstMatch.aka.displayName} vs AO: ${firstMatch.ao.displayName}`);

    if (firstMatch.aka.id) {
      await commitBoutResult(firstMatch.matchId, firstMatch.aka.id, {
        side: "AKA",
        akaPoints: 3,
        aoPoints: 1,
        method: "POINTS",
      });
      console.log(`🏆 Confirmed Winner: ${firstMatch.aka.displayName} (3 - 1). Winner advanced in bracket!`);
    }
  }

  // 10. Test Bulk PDF Generation
  console.log("📄 Testing bulk draw PDF package generation...");
  const pdfPackage = await buildAllCategoryDrawPdfs(tournament.id);
  if (pdfPackage.success) {
    console.log(`✅ Bulk PDF package generated successfully! Includes ${pdfPackage.includedCount} category draw PDFs.`);
  }

  console.log("\n🎉 DATABASE SEED COMPLETED SUCCESSFULLY!");
  console.log(`📍 Tournament ID: ${tournament.id}`);
  console.log(`📍 Ring 1 Access Code: RING01 (ID: ${createdRings[0].id})`);
  console.log(`📍 Public Event URL: /public/event/${tournament.id}`);
  console.log(`📍 Arena Scoreboard URL: /scoreboard/${createdRings[0].id}`);
  console.log(`📍 Moderator URL: /moderator/ring/${createdRings[0].id}`);
  process.exit(0);
}

runSeed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
