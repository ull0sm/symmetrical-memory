import type { Ruleset } from '@event-suite/rules-engine';
import { checksumOf } from './canonical';
import { generateKataFlightDraw, type KataFlightParams, type KataGeneratedMatch } from './kataFlightDraw';
import type { DrawFormat, DrawGraph, MatchNode, Pool, Round, SlotNode } from './types';

/**
 * A kata pool flight as a draw: the same graph, seed and checksum as a kumite
 * bracket, so it is stored, versioned and verified the same way.
 *
 * Pool bouts carry their athletes as `ENTRY` slots; medal-flight bouts have no
 * slots at all, because who fills them depends on the pool standings and is
 * decided once the pools are fought (see lib/kata/poolAdvancement.ts).
 */
export function generateKataDraw(params: KataFlightParams, ruleset: Ruleset): DrawGraph {
  const flight = generateKataFlightDraw(params);

  const matches: MatchNode[] = [];
  const slots: SlotNode[] = [];
  const pools: Pool[] = [];

  const toNode = (m: KataGeneratedMatch, poolId: string | null): MatchNode => {
    const slotIds: [string, string] = [`${m.id}-s1`, `${m.id}-s2`];
    return {
      id: m.id,
      matchNo: m.matchNo,
      roundNo: m.roundNo,
      roundName: m.roundName,
      bracketType: m.bracketType,
      poolId,
      slotIds,
      poolGroup: m.poolGroup,
      kataScoringMode: m.kataScoringMode,
      ...(m.status === 'READY' ? { startStatus: 'READY' as const } : {}),
    };
  };

  const entrySlot = (m: KataGeneratedMatch, position: 1 | 2, registrationId: string): SlotNode => ({
    id: `${m.id}-s${position}`,
    matchId: m.id,
    position,
    slotType: 'ENTRY',
    registrationId,
    sourceMatchId: null,
    repechageRule: null,
  });

  for (const pool of flight.pools) {
    for (const m of pool.matches) {
      matches.push(toNode(m, pool.poolId));
      if (m.akaAthleteId) slots.push(entrySlot(m, 1, m.akaAthleteId));
      if (m.aoAthleteId) slots.push(entrySlot(m, 2, m.aoAthleteId));
    }

    pools.push({
      id: pool.poolId,
      name: pool.poolName,
      matchIds: pool.matches.map((m) => m.id),
      registrationIds: pool.athletes.map((a) => a.athleteId),
    });
  }

  for (const m of flight.finalFlight.matches) {
    matches.push(toNode(m, null));
  }

  const rounds: Round[] = [];
  for (const roundNo of Array.from(new Set(matches.map((m) => m.roundNo))).sort((a, b) => a - b)) {
    const inRound = matches.filter((m) => m.roundNo === roundNo);
    rounds.push({
      roundNo,
      name: roundNo === 1 ? 'Pool bouts' : 'Medal flight',
      matchIds: inRound.map((m) => m.id),
    });
  }

  const body: Omit<DrawGraph, 'checksum'> = {
    categoryId: params.categoryId,
    format: 'POOLS_THEN_ELIM' satisfies DrawFormat,
    rulesetId: ruleset.id,
    // The athletes drawn; a pool flight has no bracket size or byes.
    tournamentSize: params.participants.length,
    byeCount: 0,
    bronzeMedals: flight.bronzeMedals,
    randomSeed: params.randomSeed,
    rounds,
    matches,
    slots,
    pools,
    flightDraw: flight,
    warnings: flight.warnings,
  };

  return { ...body, checksum: checksumOf(body) };
}
