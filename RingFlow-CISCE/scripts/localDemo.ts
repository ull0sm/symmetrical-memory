/**
 * Builds a Local tournament for demos and hands-on trials: categories (age x belt x sex), a roster
 * of children, starting groups and a tatami per category. It stops before the stager locks anything,
 * so the stager desk has real work to do. Shared by `npm run db:seed` (a small event) and
 * `npm run db:mock-local` (a full-day event). Scripts call the request-free cores, never the actions.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { rings, tournaments } from "../src/db/schema";
import { generateDivisionsCore } from "../src/lib/local/divisions";
import { importLocalRosterCore, type LocalImportRow } from "../src/lib/local/localRoster";
import { buildAllStartingGroupsCore } from "../src/lib/local/startingGroups";
import { assignDivisionCore } from "../src/lib/local/tatami";
import { divisions } from "../src/db/schema";
import { DEFAULT_BELT_LEVELS } from "../src/lib/constants";

export interface LocalDemoOptions {
  adminId: string;
  name: string;
  /** Unique across the server: organiser, tatami and stager codes are matched across tournaments. */
  codePrefix: string;
  ringCount: number;
  ages: number[];
  belts: string[];
  sexes: ("M" | "F")[];
  /** Athletes per category (roughly: the last few categories get one fewer). */
  perCategory: number;
  eventDate?: string;
  venue?: string;
  city?: string;
}

const CLUBS = ["Sakura Dojo", "Kaizen Karate", "Tiger Club", "Lotus Academy", "Crane School", "Samurai Kai", "Budokan", "Shito-Ryu Hall"];
const GIVEN = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Anaya", "Vivaan", "Isha", "Arjun", "Tara", "Reyansh", "Nisha", "Dev", "Saanvi", "Ishan", "Kiara", "Yash", "Myra", "Neel", "Zara"];
const FAMILY = ["Sharma", "Verma", "Iyer", "Nair", "Das", "Khan", "Gill", "Rao", "Mehta", "Bose", "Joshi", "Kapoor", "Reddy", "Singh", "Menon"];

export async function createLocalDemo(opts: LocalDemoOptions) {
  // Codes are matched across every tournament, so a re-run replaces its own earlier copy.
  await db.delete(tournaments).where(eq(tournaments.organiserCode, `${opts.codePrefix}ORG1`));
  const [tournament] = await db
    .insert(tournaments)
    .values({
      adminId: opts.adminId,
      name: opts.name,
      tournamentType: "LOCAL",
      beltLevels: [...DEFAULT_BELT_LEVELS],
      eventDate: opts.eventDate ?? "2026-10-18",
      venue: opts.venue ?? "Community Sports Hall",
      city: opts.city ?? "Pune",
      status: "active",
      organiserCode: `${opts.codePrefix}ORG1`,
      stagerCodes: [{ code: `${opts.codePrefix}STG1`, label: "Stager 1" }, { code: `${opts.codePrefix}STG2`, label: "Stager 2" }],
    })
    .returning();

  const ringRows = [];
  for (let i = 1; i <= opts.ringCount; i += 1) {
    const [ring] = await db
      .insert(rings)
      .values({ tournamentId: tournament.id, name: `Tatami ${i}`, ringOrder: i, accessCode: `${opts.codePrefix}RNG${i}` })
      .returning();
    ringRows.push(ring);
  }

  await generateDivisionsCore(tournament.id, {
    ages: opts.ages.map((a) => ({ min: a, max: a })),
    beltBands: opts.belts.map((b) => [b]),
    sexes: opts.sexes,
  });

  // A varied roster: each category gets perCategory children, clubs spread, most do both events.
  const rows: LocalImportRow[] = [];
  let n = 0;
  for (const age of opts.ages) {
    for (const belt of opts.belts) {
      for (const sex of opts.sexes) {
        for (let k = 0; k < opts.perCategory; k += 1) {
          n += 1;
          rows.push({
            name: `${GIVEN[(n * 7) % GIVEN.length]} ${FAMILY[(n * 3 + age) % FAMILY.length]} ${n}`,
            club: CLUBS[(n + k) % CLUBS.length],
            age,
            belt,
            sex,
            kumite: n % 6 === 0 ? "No" : "Yes",
            kata: n % 3 === 0 && n % 6 !== 0 ? "No" : "Yes",
          });
        }
      }
    }
  }
  const report = await importLocalRosterCore(tournament.id, rows);
  await buildAllStartingGroupsCore(tournament.id);

  const cats = await db.select({ id: divisions.id }).from(divisions).where(eq(divisions.tournamentId, tournament.id)).orderBy(divisions.sortOrder);
  for (let i = 0; i < cats.length; i += 1) await assignDivisionCore(cats[i].id, ringRows[i % ringRows.length].id);

  return { tournament, rings: ringRows, categories: cats.length, athletes: report.total, report };
}
