/**
 * The rule that keeps a stager's half-built group off the mat: a Local group can
 * start only once it is locked. Also the bout length its event asks for.
 * No authorization here: `startCategory` checks the moderator first.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, divisionEvents, divisions, draws } from "@/db/schema";
import type { DivisionEventType } from "@/lib/statuses";
import { readLocalSettings } from "./divisions";
import { effectiveEventSettings } from "./rules";

/**
 * Null for a category that is not a Local group. For a Local group, throws unless it is locked,
 * and returns the kumite bout length its event sets (null: leave the tatami's clock as it is).
 */
export async function localGroupStartCheck(categoryId: string): Promise<{ boutDurationMs: number | null } | null> {
  const [row] = await db
    .select({
      eventType: divisionEvents.eventType,
      groupSize: divisionEvents.groupSize,
      bronzeMedals: divisionEvents.bronzeMedals,
      boutDurationMs: divisionEvents.boutDurationMs,
      tournamentId: divisions.tournamentId,
      drawState: draws.state,
    })
    .from(categories)
    .innerJoin(divisionEvents, eq(divisionEvents.id, categories.divisionEventId))
    .innerJoin(divisions, eq(divisions.id, divisionEvents.divisionId))
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(eq(categories.id, categoryId));
  if (!row) return null;
  if (row.drawState !== "LOCKED") throw new Error("This group hasn't been sent by the stager yet.");
  const eventType = row.eventType as DivisionEventType;
  if (eventType !== "kumite") return { boutDurationMs: null };
  return { boutDurationMs: effectiveEventSettings(eventType, row, await readLocalSettings(row.tournamentId)).boutDurationMs };
}
