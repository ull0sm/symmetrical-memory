import { checksumOf } from './canonical';
import type { DrawGraph } from './types';

export type ManualSwapErrorCode =
  | 'SAME_SLOT'
  | 'UNKNOWN_SLOT'
  | 'NOT_FIRST_ROUND'
  | 'NOT_AN_ATHLETE'
  | 'NOT_A_BRACKET';

export class ManualSwapError extends Error {
  constructor(
    readonly code: ManualSwapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ManualSwapError';
  }
}

export interface SwapResult {
  graph: DrawGraph;
  /** The two registrations that traded places: [from slot A, from slot B]. */
  swapped: readonly [string, string];
}

/**
 * Trades two athletes' places in the first round of an elimination bracket.
 *
 * Only first-round athlete slots can be swapped: later rounds are wired by
 * `WINNER_OF` references and byes are positions, so moving those would change
 * the shape of the draw rather than who fills it. The graph is returned with a
 * fresh checksum, ready to be stored as the next version.
 */
export function swapFirstRoundAthletes(graph: DrawGraph, slotIdA: string, slotIdB: string): SwapResult {
  if (graph.pools.length > 0 || graph.flightDraw !== undefined) {
    throw new ManualSwapError('NOT_A_BRACKET', 'only an elimination bracket can be edited by hand');
  }

  if (slotIdA === slotIdB) {
    throw new ManualSwapError('SAME_SLOT', 'choose two different places to swap');
  }

  const slotA = graph.slots.find((slot) => slot.id === slotIdA);
  const slotB = graph.slots.find((slot) => slot.id === slotIdB);

  if (slotA === undefined || slotB === undefined) {
    throw new ManualSwapError('UNKNOWN_SLOT', 'a place to swap is not in this draw');
  }

  const firstRound = new Set(graph.matches.filter((m) => m.roundNo === 0 && m.bracketType === 'MAIN').map((m) => m.id));

  if (!firstRound.has(slotA.matchId) || !firstRound.has(slotB.matchId)) {
    throw new ManualSwapError('NOT_FIRST_ROUND', 'only first-round places can be swapped');
  }

  if (
    slotA.slotType !== 'ATHLETE' ||
    slotB.slotType !== 'ATHLETE' ||
    slotA.registrationId === null ||
    slotB.registrationId === null
  ) {
    throw new ManualSwapError('NOT_AN_ATHLETE', 'both places must hold an athlete (a bye cannot be swapped)');
  }

  const slots = graph.slots.map((slot) =>
    slot.id === slotIdA
      ? { ...slot, registrationId: slotB.registrationId }
      : slot.id === slotIdB
        ? { ...slot, registrationId: slotA.registrationId }
        : slot,
  );

  const { checksum: _previous, ...rest } = graph;
  const body = { ...rest, slots };

  return {
    graph: { ...body, checksum: checksumOf(body) },
    swapped: [slotA.registrationId, slotB.registrationId],
  };
}
