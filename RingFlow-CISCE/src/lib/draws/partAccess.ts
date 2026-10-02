import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { categoryAssignments } from "@/db/schema";
import { getTournamentStaff } from "@/lib/auth/guards";
import { tournamentIdForCategory } from "@/lib/auth/scope";

/**
 * Which part of a split category's draw the caller may see.
 *
 * A tatami's moderator sees only the pools (or finals) that run on their own tatami; showing the
 * whole tree to someone who runs one pool is confusing, and it is not theirs to run. Admin,
 * organiser and stager may look at any part, or the whole draw. Everyone else (the public) gets
 * what they ask for, as before.
 *
 * `part` is what the caller asked for ('POOL:n', 'FINALS', or null for the whole draw). The answer
 * is the part to show, or `allowed: false` when this moderator has no part of the category.
 */
export async function resolveViewerPart(
  categoryId: string,
  requested: string | null
): Promise<{ allowed: true; part: string | null } | { allowed: false }> {
  let tournamentId: string;
  try {
    tournamentId = await tournamentIdForCategory(categoryId);
  } catch {
    return { allowed: true, part: requested };
  }

  if (await getTournamentStaff(tournamentId, ["admin", "organiser", "stager"])) return { allowed: true, part: requested };

  const moderator = await getTournamentStaff(tournamentId, ["moderator"]);
  if (!moderator || moderator.role !== "moderator") return { allowed: true, part: requested };

  const cards = await db
    .select({ part: categoryAssignments.part, status: categoryAssignments.status })
    .from(categoryAssignments)
    .where(and(eq(categoryAssignments.categoryId, categoryId), eq(categoryAssignments.ringId, moderator.ringId)))
    .orderBy(asc(categoryAssignments.queueOrder));

  // A category that is not split is whole on one tatami: nothing to hide.
  const [anySplit] = await db
    .select({ id: categoryAssignments.id })
    .from(categoryAssignments)
    .where(and(eq(categoryAssignments.categoryId, categoryId), eq(categoryAssignments.part, "FINALS")))
    .limit(1);
  if (!anySplit) return { allowed: true, part: requested };

  if (cards.length === 0) return { allowed: false };
  if (requested && cards.some((c) => c.part === requested)) return { allowed: true, part: requested };

  const onMat = cards.find((c) => c.status === "running" || c.status === "paused");
  return { allowed: true, part: (onMat ?? cards[0]).part };
}
