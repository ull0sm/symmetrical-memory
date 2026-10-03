import { resolveDraw } from "@/engine/draw-engine/resolution";
import type { DrawGraph } from "@/engine/draw-engine/types";

/**
 * How many bouts a draw actually asks anyone to run.
 *
 * A walkover (one athlete, the other side a bye) and an empty match are decided
 * without a contest, so counting them would leave every progress bar short of
 * 100%. This is the number written to `categories.expected_matches`, and it is
 * deliberately computable from the stored graph alone so the generation path
 * and the backfill path can never drift.
 */
export function foughtBoutCount(graph: DrawGraph): number {
  // A kata pool flight or a ranked kata group is not an elimination tree and has no walkovers: every bout is run.
  if (graph.flightDraw || graph.format === "KATA_RANKED") return graph.matches.length;
  const neverRun = neverRunMatchIds(graph);
  return graph.matches.filter((m) => !neverRun.has(m.id)).length;
}

function neverRunMatchIds(graph: DrawGraph): Set<string> {
  const resolution = resolveDraw(graph, new Map());
  return new Set<string>([
    ...resolution.walkoverMatchIds,
    ...resolution.matches.filter((m) => m.status === "UNRESOLVED").map((m) => m.matchId),
  ]);
}

/**
 * The same count, split by part of a draw with pools: how many bouts each pool (and the finals)
 * actually runs. A kata flight has no walkovers, so every bout counts.
 */
export function foughtBoutCountByPart(graph: DrawGraph, partOf: ReadonlyMap<string, string>): Map<string, number> {
  const neverRun = graph.flightDraw ? new Set<string>() : neverRunMatchIds(graph);
  const counts = new Map<string, number>();
  for (const match of graph.matches) {
    if (neverRun.has(match.id)) continue;
    const part = partOf.get(match.id);
    if (part !== undefined) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  return counts;
}
