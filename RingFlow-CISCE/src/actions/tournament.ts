"use server";

import { db } from "@/db";
import { tournaments, categories, rings } from "@/db/schema";
import { ensureAdmin } from "./admin";
import { generateAccessCode, generateUnambiguousCode } from "@/lib/utils";

export type CategoryInput = {
  name: string;
  age_bracket: string;
  weight_class: string;
  athletes_count: number;
};

export type TournamentInput = {
  name: string;
  event_date: string;
  venue: string;
  city: string;
  categories: CategoryInput[];
  ringCount?: number;
  ring_count?: number;
};

export async function createTournament(input: TournamentInput) {
  const adminId = await ensureAdmin();

  // Validate inputs
  const name = (input.name || "").trim();
  if (!name || name.length > 200) {
    throw new Error("Tournament name is required and must be under 200 characters.");
  }

  const venue = (input.venue || "").trim().slice(0, 200) || null;
  const city = (input.city || "").trim().slice(0, 200) || null;
  const eventDate = input.event_date ? input.event_date.split("T")[0] : null;

  const ringCount = Math.floor(Number(input.ringCount ?? input.ring_count));
  if (isNaN(ringCount) || ringCount < 1 || ringCount > 50) {
    throw new Error("Ring count must be an integer between 1 and 50.");
  }

  // 1. Create Tournament via Drizzle ORM
  const [tournament] = await db
    .insert(tournaments)
    .values({
      adminId,
      name,
      eventDate,
      venue,
      city,
      status: "draft",
      organiserCode: generateUnambiguousCode(6),
    })
    .returning({ id: tournaments.id });

  if (!tournament?.id) {
    throw new Error("Failed to create tournament record in database.");
  }

  const tournamentId = tournament.id;

  // 2. Create Categories via Drizzle ORM
  if (Array.isArray(input.categories) && input.categories.length > 0) {
    const validCats = input.categories
      .filter((c) => (c.name || "").trim().length > 0)
      .map((c) => {
        const catName = c.name.trim().slice(0, 200);
        const athletesCount = Math.max(
          0,
          Math.min(10000, Math.floor(Number(c.athletes_count) || 0))
        );
        const expectedMatches = Math.max(0, athletesCount - 1);

        return {
          tournamentId,
          name: catName,
          ageBracket: (c.age_bracket || "").trim().slice(0, 100) || null,
          weightClass: (c.weight_class || "").trim().slice(0, 100) || null,
          athletesCount,
          expectedMatches,
          hasFullRoster: false,
        };
      });

    if (validCats.length > 0) {
      await db.insert(categories).values(validCats);
    }
  }

  // 3. Create Rings via Drizzle ORM
  const ringsToInsert = Array.from({ length: ringCount }).map((_, i) => ({
    tournamentId,
    name: `Tatami ${String(i + 1).padStart(2, "0")}`,
    ringOrder: i + 1,
    accessCode: generateAccessCode(),
    judgePin: String(Math.floor(1000 + Math.random() * 9000)),
  }));

  if (ringsToInsert.length > 0) {
    await db.insert(rings).values(ringsToInsert);
  }

  return tournamentId;
}
