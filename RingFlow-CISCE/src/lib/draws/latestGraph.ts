import { draws, drawVersions } from "@/db/schema";
import type { DrawGraph } from "@/engine/draw-engine/types";
import type { DbExecutor } from "@/lib/draws/generateDraws";
import { eq, sql } from "drizzle-orm";

/** A category's draw as a graph, from its latest stored version. */
export async function latestGraph(executor: DbExecutor, categoryId: string): Promise<DrawGraph | null> {
  const [draw] = await executor.select().from(draws).where(eq(draws.categoryId, categoryId));
  if (!draw) return null;
  const [latest] = await executor
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);
  return (latest?.graph as unknown as DrawGraph | undefined) ?? null;
}
