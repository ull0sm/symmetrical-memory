import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rings, tournaments } from "@/db/schema";
import { generateAccessCode, generateUnambiguousCode } from "@/lib/utils";

/**
 * Access codes are looked up across every tournament on the server, so a
 * collision would send someone's request to the wrong event. Generate until
 * the code is unused (a handful of tries at most).
 */
export async function uniqueRingAccessCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateAccessCode();
    const [hit] = await db.select({ id: rings.id }).from(rings).where(eq(rings.accessCode, code)).limit(1);
    if (!hit) return code;
  }
  throw new Error("Could not generate a unique tatami access code");
}

export async function uniqueOrganiserCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateUnambiguousCode(6);
    const [hit] = await db
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(sql`upper(${tournaments.organiserCode}) = ${code}`)
      .limit(1);
    if (!hit) return code;
  }
  throw new Error("Could not generate a unique organiser code");
}
