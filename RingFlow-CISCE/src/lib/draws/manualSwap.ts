import { db } from "@/db";
import { athletes, categories, draws, drawVersions, matchSlots, tournaments } from "@/db/schema";
import { ManualSwapError, swapFirstRoundAthletes } from "@/engine/draw-engine/manualSwap";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { resolveDrawRules } from "@/lib/draws/drawRules";
import { readProtection, refusalFor } from "@/lib/draws/generateDraws";
import { eq, inArray, sql } from "drizzle-orm";

/**
 * The database work behind a hand swap, with no request context: the admin
 * action guards and audits it, and scripts can call it directly.
 *
 * Refuses an official-profile draw, a locked draw, and a category with fought
 * bouts. The new graph is stored as the next version, so the history keeps what
 * the draw was before the swap.
 */
export async function performDrawSwap(categoryId: string, slotIdA: string, slotIdB: string, reason?: string) {
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId));
  if (!cat) return { error: "Category not found" };

  const [tournament] = await db
    .select({ drawProfile: tournaments.drawProfile })
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));

  const rules = resolveDrawRules({ tournamentProfile: tournament?.drawProfile, categoryProfile: cat.drawProfile });
  if (!rules.allowManualSwap) {
    return { error: "This draw follows official WKF procedure and cannot be adjusted by hand." };
  }

  const note = reason?.trim() ?? "";

  return db.transaction(async (tx) => {
    await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).for("update");

    const refusal = refusalFor(cat.name, await readProtection(tx, categoryId));
    if (refusal) return { error: refusal.error };

    const [draw] = await tx.select().from(draws).where(eq(draws.categoryId, categoryId));
    if (!draw) return { error: "No draw has been generated for this category yet." };

    const [latest] = await tx
      .select()
      .from(drawVersions)
      .where(eq(drawVersions.drawId, draw.id))
      .orderBy(sql`${drawVersions.version} desc`)
      .limit(1);
    if (!latest) return { error: "No draw has been generated for this category yet." };

    let swap;
    try {
      swap = swapFirstRoundAthletes(latest.graph as unknown as DrawGraph, slotIdA, slotIdB);
    } catch (err) {
      if (err instanceof ManualSwapError) return { error: `Cannot swap: ${err.message}.` };
      throw err;
    }

    const people = await tx
      .select({ id: athletes.id, name: athletes.name })
      .from(athletes)
      .where(inArray(athletes.id, [...swap.swapped]));
    const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;

    const [first, second] = swap.swapped;
    await tx.update(matchSlots).set({ athleteId: second }).where(eq(matchSlots.id, slotIdA));
    await tx.update(matchSlots).set({ athleteId: first }).where(eq(matchSlots.id, slotIdB));

    const version = draw.version + 1;
    await tx.insert(drawVersions).values({
      drawId: draw.id,
      version,
      graph: swap.graph,
      checksum: swap.graph.checksum,
      reason: `Manual swap: ${nameOf(first)} <-> ${nameOf(second)}${note ? ` (${note})` : ""}`,
    });
    await tx.update(draws).set({ version, checksum: swap.graph.checksum }).where(eq(draws.id, draw.id));

    return { version, a: { id: first, name: nameOf(first) }, b: { id: second, name: nameOf(second) } };
  });
}
