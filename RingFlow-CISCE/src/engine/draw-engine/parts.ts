import type { DrawGraph, MatchNode } from './types';

/**
 * Parts of a draw that different tatamis can run.
 *
 * - `POOL:n`: a block of 16 first-round places with every bout down to its winner (kumite), or
 *   one kata pool's bouts. A pool's winner then waits for the other pools' winners.
 * - `FINALS`: everything after the pools: semi-finals and final, repechage, bronze bouts, and
 *   the kata medal flight.
 *
 * Pools are numbered in bracket order, the same order the draw sheet prints them in.
 */
export type DrawPart = `POOL:${number}` | 'FINALS';

/** The bracket round (0-based) whose winners are the pool winners: a pool is 16 places, so 4 rounds deep. */
const KUMITE_POOL_ROOT_ROUND = 3;

export interface DrawParts {
  /** Part of every bout in the draw. */
  byMatch: ReadonlyMap<string, DrawPart>;
  poolCount: number;
}

export function isDrawPart(value: string): value is DrawPart {
  return value === 'FINALS' || /^POOL:[1-9][0-9]*$/.test(value);
}

export function poolNumber(part: string): number | null {
  const found = /^POOL:([1-9][0-9]*)$/.exec(part);
  return found ? Number(found[1]) : null;
}

/**
 * The parts of a draw, or null when it cannot be split: fewer than two pools (a bracket under
 * 32 places, a single kata pool) or a draw shape this does not know.
 */
export function computeDrawParts(graph: DrawGraph): DrawParts | null {
  const parts = graph.flightDraw !== undefined ? kataParts(graph) : kumiteParts(graph);
  return parts !== null && parts.poolCount >= 2 ? parts : null;
}

function kumiteParts(graph: DrawGraph): DrawParts | null {
  const main = graph.matches.filter((m) => m.bracketType === 'MAIN');
  const roots = main.filter((m) => m.roundNo === KUMITE_POOL_ROOT_ROUND).sort((a, b) => a.matchNo - b.matchNo);
  if (roots.length < 2) return null;

  const matchById = new Map(graph.matches.map((m) => [m.id, m]));
  const slotsByMatch = new Map<string, DrawGraph['slots'][number][]>();
  for (const slot of graph.slots) {
    const list = slotsByMatch.get(slot.matchId) ?? [];
    list.push(slot);
    slotsByMatch.set(slot.matchId, list);
  }

  const byMatch = new Map<string, DrawPart>();
  const visit = (match: MatchNode, part: DrawPart) => {
    if (match.bracketType !== 'MAIN' || byMatch.has(match.id)) return;
    byMatch.set(match.id, part);
    for (const slot of slotsByMatch.get(match.id) ?? []) {
      const source = slot.sourceMatchId === null ? undefined : matchById.get(slot.sourceMatchId);
      if (slot.slotType === 'WINNER_OF' && source !== undefined) visit(source, part);
    }
  };
  roots.forEach((root, index) => visit(root, `POOL:${index + 1}`));

  for (const match of graph.matches) {
    if (!byMatch.has(match.id)) byMatch.set(match.id, 'FINALS');
  }
  return { byMatch, poolCount: roots.length };
}

function kataParts(graph: DrawGraph): DrawParts | null {
  const byMatch = new Map<string, DrawPart>();
  const names: string[] = [];

  for (const match of graph.matches) {
    const group = match.poolGroup ?? null;
    if (group === null || !/^Pool [A-Z]$/.test(group)) {
      byMatch.set(match.id, 'FINALS');
      continue;
    }
    if (!names.includes(group)) names.push(group);
  }
  names.sort();
  for (const match of graph.matches) {
    const group = match.poolGroup ?? null;
    if (group !== null && names.includes(group)) byMatch.set(match.id, `POOL:${names.indexOf(group) + 1}`);
  }
  return { byMatch, poolCount: names.length };
}

/**
 * Who is drawn into each pool, in bracket order (first bout first, top line before bottom). Only
 * athletes fixed at draw time count: a bye holds nobody, and bouts after the first round (or a
 * kata medal flight) are filled by results, not by the draw.
 */
export function rosterByPart(graph: DrawGraph, parts: DrawParts): Map<DrawPart, string[]> {
  const roster = new Map<DrawPart, string[]>();
  const matchOrder = new Map(graph.matches.map((m) => [m.id, m.matchNo]));

  const slots = graph.slots
    .filter((slot) => slot.registrationId !== null && (slot.slotType === 'ATHLETE' || slot.slotType === 'ENTRY'))
    .sort(
      (a, b) =>
        (matchOrder.get(a.matchId) ?? 0) - (matchOrder.get(b.matchId) ?? 0) || a.position - b.position,
    );

  for (const slot of slots) {
    const part = parts.byMatch.get(slot.matchId);
    if (part === undefined || part === 'FINALS') continue;
    const list = roster.get(part) ?? [];
    if (!list.includes(slot.registrationId as string)) list.push(slot.registrationId as string);
    roster.set(part, list);
  }
  return roster;
}
