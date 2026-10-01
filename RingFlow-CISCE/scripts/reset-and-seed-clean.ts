import { db } from "../src/db";
import {
  admins,
  tournaments,
  rings,
} from "../src/db/schema";
// Scripts run without a browser session, so they call the cores the guarded actions wrap.
import { writeCategoryDefinitions } from "../src/lib/roster/categoryDefinitions";
import { OFFICIAL_PRESETS } from "../src/lib/constants/categoryPresets";
import { importOfficialRosterCore } from "../src/lib/roster/officialImport";
import { hashPassword } from "../src/lib/auth/password";
import { sql } from "drizzle-orm";

async function resetAndSeed() {
  console.log("🧹 1. Truncating all existing data from database...");
  await db.execute(sql`
    TRUNCATE TABLE 
      match_events, 
      match_slots, 
      matches, 
      draw_versions, 
      draws, 
      category_entries, 
      tournament_registrations, 
      tournament_category_definitions, 
      category_assignments, 
      event_log, 
      moderator_requests, 
      athletes, 
      categories, 
      rings, 
      tournaments, 
      admins 
    CASCADE;
  `);
  console.log("✅ Database completely emptied.");

  // 2. Create Single Admin
  console.log("\n👤 2. Creating Administrator...");
  const adminId = "00000000-0000-0000-0000-000000000001";
  const passwordHash = await hashPassword("admin123");
  await db.insert(admins).values({
    id: adminId,
    email: "admin@ringflow.org",
    name: "Tournament Director",
    passwordHash,
  });
  console.log("✅ Admin ready: admin@ringflow.org (password: admin123)");

  // 3. Create Only ONE Tournament
  console.log("\n🏆 3. Creating Single Official Tournament...");
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
  console.log(`✅ Single tournament created: "${tournament.name}" (ID: ${tournament.id})`);
  console.log(`   Organiser access code: ${tournament.organiserCode}`);

  // 4. Create 4 Tatami Rings
  console.log("\n🥋 4. Setting up Tatami Rings...");
  const ringDefs = [
    { name: "Tatami 1 (Main Arena)", ringOrder: 1, accessCode: "RING01" },
    { name: "Tatami 2 (North Mat)", ringOrder: 2, accessCode: "RING02" },
    { name: "Tatami 3 (South Mat)", ringOrder: 3, accessCode: "RING03" },
    { name: "Tatami 4 (Junior Mat)", ringOrder: 4, accessCode: "RING04" },
  ];
  const createdRings = [];
  for (const r of ringDefs) {
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
  console.log(`✅ Created 4 Tatamis: ${createdRings.map(r => `${r.name} [${r.accessCode}]`).join(", ")}`);

  // 5. Configure Official Category Definitions (30 CISCE categories)
  console.log("\n📋 5. Configuring 30 Official Category Definitions...");
  await writeCategoryDefinitions(tournament.id, OFFICIAL_PRESETS.CISCE_OFFICIAL);
  console.log("✅ 30 Official Category Definitions saved & synced to categories table.");

  // 6. Import Multiple Athletes across Multiple Categories
  console.log("\n🥋 6. Registering athletes across multiple categories...");
  const athleteRoster = [
    // --- U14 Male 35-40kg (Kumite & Kata) ---
    {
      name: "Zaid Khan",
      school: "Delhi Public School, R.K. Puram",
      chestNumber: "101",
      belt: "Brown Belt",
      age: 13,
      sex: "Male",
      weight: 38.5,
      kata: true,
      kumite: true,
    },
    {
      name: "Aditya Roy",
      school: "Bishop Cotton School, Shimla",
      chestNumber: "102",
      belt: "Brown Belt",
      age: 13,
      sex: "Male",
      weight: 39.2,
      kata: false,
      kumite: true,
    },
    {
      name: "Kabir Mehta",
      school: "The Doon School, Dehradun",
      chestNumber: "103",
      belt: "Black Belt (1st Dan)",
      age: 12,
      sex: "Male",
      weight: 36.8,
      kata: true,
      kumite: true,
    },
    {
      name: "Neil Sengupta",
      school: "La Martiniere for Boys, Kolkata",
      chestNumber: "104",
      belt: "Brown Belt",
      age: 13,
      sex: "Male",
      weight: 37.4,
      kata: false,
      kumite: true,
    },

    // --- U14 Male 40-45kg (Kumite & Kata) ---
    {
      name: "Mohammed Izyan",
      school: "St. Xavier's High School, Mumbai",
      chestNumber: "105",
      belt: "Black Belt (1st Dan)",
      age: 13,
      sex: "Male",
      weight: 42.1,
      kata: true,
      kumite: true,
    },
    {
      name: "Aarav Sharma",
      school: "Modern School, Barakhamba",
      chestNumber: "106",
      belt: "Brown Belt",
      age: 12,
      sex: "Male",
      weight: 44.0,
      kata: false,
      kumite: true,
    },
    {
      name: "Rohan Verma",
      school: "Sherwood College, Nainital",
      chestNumber: "107",
      belt: "Blue Belt",
      age: 13,
      sex: "Male",
      weight: 41.5,
      kata: true,
      kumite: true,
    },
    {
      name: "Dhruv Patel",
      school: "The Cathedral & John Connon School",
      chestNumber: "108",
      belt: "Brown Belt",
      age: 13,
      sex: "Male",
      weight: 43.8,
      kata: false,
      kumite: true,
    },

    // --- U14 Female 35-40kg (Kumite & Kata) ---
    {
      name: "Ananya Deshmukh",
      school: "Welham Girls' School, Dehradun",
      chestNumber: "109",
      belt: "Brown Belt",
      age: 13,
      sex: "Female",
      weight: 37.0,
      kata: true,
      kumite: true,
    },
    {
      name: "Sara Ali",
      school: "La Martiniere for Girls, Kolkata",
      chestNumber: "110",
      belt: "Brown Belt",
      age: 12,
      sex: "Female",
      weight: 38.2,
      kata: true,
      kumite: true,
    },
    {
      name: "Diya Nair",
      school: "National Public School, Bangalore",
      chestNumber: "111",
      belt: "Blue Belt",
      age: 13,
      sex: "Female",
      weight: 39.5,
      kata: false,
      kumite: true,
    },
    {
      name: "Pooja Hegde",
      school: "St. Thomas School, Kolkata",
      chestNumber: "112",
      belt: "Brown Belt",
      age: 12,
      sex: "Female",
      weight: 36.5,
      kata: false,
      kumite: true,
    },

    // --- U17 Male 50-55kg (Kumite & Kata) ---
    {
      name: "Devansh Rathore",
      school: "Mayo College, Ajmer",
      chestNumber: "201",
      belt: "Black Belt (1st Dan)",
      age: 15,
      sex: "Male",
      weight: 52.3,
      kata: true,
      kumite: true,
    },
    {
      name: "Arjun Singhania",
      school: "The Scindia School, Gwalior",
      chestNumber: "202",
      belt: "Black Belt (1st Dan)",
      age: 16,
      sex: "Male",
      weight: 54.1,
      kata: false,
      kumite: true,
    },
    {
      name: "Krish Malhotra",
      school: "St. Paul's School, Darjeeling",
      chestNumber: "203",
      belt: "Brown Belt",
      age: 15,
      sex: "Male",
      weight: 51.0,
      kata: true,
      kumite: true,
    },
    {
      name: "Yuvraj Chauhan",
      school: "Daly College, Indore",
      chestNumber: "204",
      belt: "Brown Belt",
      age: 16,
      sex: "Male",
      weight: 53.7,
      kata: false,
      kumite: true,
    },

    // --- U17 Male 55-60kg (Kumite) ---
    {
      name: "Vikramaditya Rao",
      school: "Hyderabad Public School, Begumpet",
      chestNumber: "205",
      belt: "Black Belt (2nd Dan)",
      age: 16,
      sex: "Male",
      weight: 58.2,
      kata: false,
      kumite: true,
    },
    {
      name: "Rishi Kapoor",
      school: "Campion School, Mumbai",
      chestNumber: "206",
      belt: "Black Belt (1st Dan)",
      age: 15,
      sex: "Male",
      weight: 57.0,
      kata: true,
      kumite: true,
    },
    {
      name: "Siddharth Joshi",
      school: "Loyola School, Jamshedpur",
      chestNumber: "207",
      belt: "Brown Belt",
      age: 16,
      sex: "Male",
      weight: 59.4,
      kata: false,
      kumite: true,
    },
    {
      name: "Tenzing Norbu",
      school: "Dr. Graham's Homes, Kalimpong",
      chestNumber: "208",
      belt: "Black Belt (1st Dan)",
      age: 15,
      sex: "Male",
      weight: 56.5,
      kata: true,
      kumite: true,
    },

    // --- U17 Female 45-50kg (Kumite & Kata) ---
    {
      name: "Meera Sen",
      school: "Loreto House, Kolkata",
      chestNumber: "209",
      belt: "Black Belt (1st Dan)",
      age: 15,
      sex: "Female",
      weight: 48.0,
      kata: true,
      kumite: true,
    },
    {
      name: "Tanvi Kulkarni",
      school: "Bishop's School, Pune",
      chestNumber: "210",
      belt: "Brown Belt",
      age: 16,
      sex: "Female",
      weight: 49.5,
      kata: false,
      kumite: true,
    },
    {
      name: "Rhea Chhabra",
      school: "Carmel Convent, Chandigarh",
      chestNumber: "211",
      belt: "Black Belt (1st Dan)",
      age: 15,
      sex: "Female",
      weight: 47.2,
      kata: true,
      kumite: true,
    },
    {
      name: "Ishita Roy",
      school: "St. Mary's School, Pune",
      chestNumber: "212",
      belt: "Brown Belt",
      age: 16,
      sex: "Female",
      weight: 46.8,
      kata: false,
      kumite: true,
    },

    // --- U19 Male 60-67kg (Kumite & Kata) ---
    {
      name: "Karan Oberoi",
      school: "St. Columba's School, New Delhi",
      chestNumber: "301",
      belt: "Black Belt (2nd Dan)",
      age: 18,
      sex: "Male",
      weight: 64.5,
      kata: true,
      kumite: true,
    },
    {
      name: "Samarth Agarwal",
      school: "Don Bosco School, Park Circus",
      chestNumber: "302",
      belt: "Black Belt (1st Dan)",
      age: 17,
      sex: "Male",
      weight: 62.0,
      kata: false,
      kumite: true,
    },
    {
      name: "Pranav Pillai",
      school: "The Lawrence School, Sanawar",
      chestNumber: "303",
      belt: "Black Belt (1st Dan)",
      age: 18,
      sex: "Male",
      weight: 65.8,
      kata: true,
      kumite: true,
    },
    {
      name: "Farhan Qureshi",
      school: "St. Edmund's School, Shillong",
      chestNumber: "304",
      belt: "Black Belt (1st Dan)",
      age: 17,
      sex: "Male",
      weight: 66.2,
      kata: false,
      kumite: true,
    },
  ];

  const importResult = await importOfficialRosterCore(tournament.id, athleteRoster);
  console.log(`✅ Roster import complete:`);
  console.log(`   - Total athletes registered: ${importResult.totalAthletes}`);
  console.log(`   - Kumite entries assigned: ${importResult.kumiteEntriesCreated}`);
  console.log(`   - Kata entries assigned: ${importResult.kataEntriesCreated}`);
  console.log(`   - Uncategorized: ${importResult.uncategorized.length}`);

  console.log("\n=======================================================");
  console.log("🎉 CLEAN RESET & SETUP COMPLETED SUCCESSFULLY!");
  console.log("=======================================================");
  console.log(`📍 Tournament ID: ${tournament.id}`);
  console.log(`📍 Tournament Name: "${tournament.name}"`);
  console.log(`📍 Admin Email: admin@ringflow.org`);
  console.log(`📍 Admin Password: admin123`);
  console.log(`📍 Tatami 1 Access Code: RING01`);
  console.log(`📍 Tatami 2 Access Code: RING02`);
  console.log(`📍 Tatami 3 Access Code: RING03`);
  console.log(`📍 Tatami 4 Access Code: RING04`);
  console.log("\nReady for you to test draw creation, tatami balancing, moderator matches, and scoreboard!");
  process.exit(0);
}

resetAndSeed().catch((err) => {
  console.error("❌ Reset and seed failed:", err);
  process.exit(1);
});
