"use server";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { categories, categoryAssignments, rings, tournaments } from "@/db/schema";
import { serializeCategoryAssignment, serializeRing } from "@/lib/serializers";
import { isValidUuid } from "@/lib/utils";

/**
 * Floor state for the public spectator page: which category is on each tatami
 * and what is queued. Read-only and credential-free; a draft tournament is not
 * public yet.
 */
export async function getPublicFloorData(tournamentId: string) {
  if (!isValidUuid(tournamentId)) return null;

  const [tournament] = await db
    .select({ status: tournaments.status })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament || tournament.status === "draft") return null;

  const ringRows = await db
    .select()
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId))
    .orderBy(asc(rings.ringOrder));

  const ringIds = ringRows.map((r) => r.id);
  if (ringIds.length === 0) return { rings: [], assignments: [] };

  const rawAssignments = await db
    .select()
    .from(categoryAssignments)
    .where(inArray(categoryAssignments.ringId, ringIds))
    .orderBy(asc(categoryAssignments.queueOrder));

  const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId)));
  const catRows =
    categoryIds.length > 0 ? await db.select().from(categories).where(inArray(categories.id, categoryIds)) : [];
  const catMap = new Map(catRows.map((c) => [c.id, c]));

  return {
    rings: ringRows.map((row) => serializeRing(row)),
    assignments: rawAssignments.map((a) => {
      // Stager names are staff details, not spectator information.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stagerName, ...rest } = a;
      return serializeCategoryAssignment(rest, catMap.get(a.categoryId));
    }),
  };
}
