import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { GroupChangeError } from './errors';
import { fillByeWithEntrant } from './fillBye';
import { generateGroupDraw } from './groupDraw';
import { resolveDraw, type MatchOutcome } from './resolution';
import type { DrawGraph, Participant } from './types';

const ruleset: Ruleset = getRuleset('WKF_KUMITE_2026');

function group(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `a${i + 1}`,
    displayName: `A${i + 1}`,
    clubId: `club-${i + 1}`,
    districtId: null,
  }));
}

/** Five athletes in a bracket of eight: byes at places 2, 6 and 8 (see groupDraw.test.ts). */
const graph = generateGroupDraw({ categoryId: 'g1', participants: group(5), randomSeed: 1, bronzeMedals: 3 }, ruleset);
const byeSlot = (g: DrawGraph, place: number) => {
  const match = g.matches.find((m) => m.roundNo === 0 && m.matchNo === Math.ceil(place / 2));
  return g.slots.find((s) => s.matchId === match?.id && s.position === (place % 2 === 1 ? 1 : 2));
};
const nextBoutOf = (g: DrawGraph, matchId: string) =>
  g.slots.find((s) => s.slotType === 'WINNER_OF' && s.sourceMatchId === matchId)?.matchId as string;

describe('fillByeWithEntrant', () => {
  it('turns a bye into a bout against the athlete who had it', () => {
    const slot = byeSlot(graph, 2);
    expect(slot?.slotType).toBe('BYE');
    const next = fillByeWithEntrant(graph, slot?.id as string, 'late', new Set());

    const filled = next.slots.find((s) => s.id === slot?.id);
    expect(filled).toMatchObject({ slotType: 'ATHLETE', registrationId: 'late' });
    expect(next.byeCount).toBe(graph.byeCount - 1);
    expect(next.checksum).not.toBe(graph.checksum);
    expect(next.matches).toEqual(graph.matches);

    // The bout is now fought, not a walkover.
    const resolution = resolveDraw(next, new Map());
    expect(resolution.readyMatchIds).toContain(slot?.matchId);
  });

  it('works while the bye-holder has not fought on, even after other bouts', () => {
    const slot = byeSlot(graph, 6);
    // Bout 2 (places 3 and 4) is the only first-round bout without a bye.
    const otherFirstRound = graph.matches.find((m) => m.roundNo === 0 && m.matchNo === 2)?.id as string;
    const results = new Map<string, MatchOutcome>([[otherFirstRound, { kind: 'WINNER', side: 'AKA' }]]);
    expect(resolveDraw(graph, results).problems).toEqual([]);
    expect(() => fillByeWithEntrant(graph, slot?.id as string, 'late', new Set([otherFirstRound]))).not.toThrow();
  });

  it("refuses once the bye-holder's next bout has started", () => {
    const slot = byeSlot(graph, 2);
    const next = nextBoutOf(graph, slot?.matchId as string);
    expect(() => fillByeWithEntrant(graph, slot?.id as string, 'late', new Set([next]))).toThrow(/already fought/);
  });

  it('refuses a place that is not a first-round bye, and an athlete already drawn', () => {
    const athleteSlot = byeSlot(graph, 1);
    const err = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as GroupChangeError).code;
      }
      return null;
    };
    expect(err(() => fillByeWithEntrant(graph, athleteSlot?.id as string, 'late', new Set()))).toBe('NOT_A_BYE');
    expect(err(() => fillByeWithEntrant(graph, byeSlot(graph, 2)?.id as string, 'a1', new Set()))).toBe('ALREADY_IN_DRAW');
    expect(err(() => fillByeWithEntrant(graph, 'nope', 'late', new Set()))).toBe('UNKNOWN_SLOT');
  });
});
