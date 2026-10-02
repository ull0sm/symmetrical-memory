import { getRuleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { generateDraw } from './generate';
import { ManualSwapError, swapFirstRoundAthletes } from './manualSwap';
import { generateKataDraw } from './kataDraw';
import { resolveDraw } from './resolution';
import type { DrawGraph, Participant } from './types';

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ registrationId: `p${i + 1}`, displayName: `P${i + 1}`, clubId: `c${i + 1}`, districtId: null }));

const bracket = (n: number): DrawGraph =>
  generateDraw(
    { categoryId: 'cat', format: 'SINGLE_ELIM_REPECHAGE', participants: people(n), seeding: { mode: 'RANDOM_SEEDED', randomSeed: 5 } },
    getRuleset('WKF_KUMITE_2026'),
  );

const firstRoundSlots = (graph: DrawGraph) => {
  const ids = new Set(graph.matches.filter((m) => m.roundNo === 0).map((m) => m.id));
  return graph.slots.filter((s) => ids.has(s.matchId) && s.slotType === 'ATHLETE');
};

describe('swapFirstRoundAthletes', () => {
  it('trades two athletes and gives a new checksum, leaving the original alone', () => {
    const graph = bracket(8);
    const [a, b] = firstRoundSlots(graph) as [ReturnType<typeof firstRoundSlots>[number], ReturnType<typeof firstRoundSlots>[number]];
    const result = swapFirstRoundAthletes(graph, a.id, b.id);

    const after = (id: string) => result.graph.slots.find((s) => s.id === id)?.registrationId;
    expect(after(a.id)).toBe(b.registrationId);
    expect(after(b.id)).toBe(a.registrationId);
    expect(result.swapped).toEqual([a.registrationId, b.registrationId]);
    expect(result.graph.checksum).not.toBe(graph.checksum);
    expect(graph.slots.find((s) => s.id === a.id)?.registrationId).toBe(a.registrationId);
  });

  it('still resolves to a full bracket with every athlete exactly once in round one', () => {
    const graph = bracket(11);
    const [a, , c] = firstRoundSlots(graph);
    const { graph: swapped } = swapFirstRoundAthletes(graph, (a as { id: string }).id, (c as { id: string }).id);

    const ids = firstRoundSlots(swapped).map((s) => s.registrationId);
    expect(new Set(ids).size).toBe(11);
    expect(() => resolveDraw(swapped, new Map())).not.toThrow();
  });

  it('refuses the same slot twice, unknown slots, later rounds and byes', () => {
    const graph = bracket(6);
    const slots = firstRoundSlots(graph);
    const a = slots[0] as { id: string };
    const later = graph.slots.find((s) => s.slotType === 'WINNER_OF') as { id: string };
    const bye = graph.slots.find((s) => s.slotType === 'BYE') as { id: string };

    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as ManualSwapError).code;
      }
      return null;
    };

    expect(code(() => swapFirstRoundAthletes(graph, a.id, a.id))).toBe('SAME_SLOT');
    expect(code(() => swapFirstRoundAthletes(graph, a.id, 'nope'))).toBe('UNKNOWN_SLOT');
    expect(code(() => swapFirstRoundAthletes(graph, a.id, later.id))).toBe('NOT_FIRST_ROUND');
    expect(code(() => swapFirstRoundAthletes(graph, a.id, bye.id))).toBe('NOT_AN_ATHLETE');
  });

  it('refuses a kata pool flight', () => {
    const kata = generateKataDraw(
      { categoryId: 'cat', participants: [1, 2, 3, 4].map((i) => ({ id: `a${i}`, name: `A${i}` })), randomSeed: 1 },
      getRuleset('WKF_KATA_2026'),
    );

    expect(() => swapFirstRoundAthletes(kata, 'x', 'y')).toThrow(ManualSwapError);
  });
});

describe('swapFirstRoundAthletes — club warnings', () => {
  const separation = (clubs: Record<string, string>) => ({
    participants: people(8).map((p) => ({ ...p, clubId: clubs[p.registrationId] ?? p.clubId })),
    options: { by: 'CLUB', rule: 'FIRST_ROUND' } as const,
  });

  it('adds a warning when the swap creates a same-club first-round bout, and drops it when fixed', () => {
    const graph = bracket(8);
    const slots = firstRoundSlots(graph);
    const first = slots[0] as { id: string; registrationId: string | null };
    const partner = slots[1] as { id: string; registrationId: string | null };
    const elsewhere = slots[2] as { id: string; registrationId: string | null };

    // Make the athlete in slot 0 and the one in slot 2 club-mates, then swap slot 2 into slot 0's bout.
    const clubs = { [first.registrationId as string]: 'same', [elsewhere.registrationId as string]: 'same' };
    const clash = swapFirstRoundAthletes(graph, partner.id, elsewhere.id, separation(clubs));
    expect(clash.graph.warnings.map((w) => w.code)).toContain('SEPARATION_IMPOSSIBLE');

    // Swapping back separates them again: the warning is gone.
    const fixed = swapFirstRoundAthletes(clash.graph, partner.id, elsewhere.id, separation(clubs));
    expect(fixed.graph.warnings.map((w) => w.code)).not.toContain('SEPARATION_IMPOSSIBLE');
  });

  it('drops an old clash warning rather than carrying it over when no club information is given', () => {
    const graph = { ...bracket(8), warnings: [{ code: 'SEPARATION_IMPOSSIBLE' as const, message: 'old' }] };
    const [a, b] = firstRoundSlots(graph) as [{ id: string }, { id: string }];

    expect(swapFirstRoundAthletes(graph, a.id, b.id).graph.warnings).toEqual([]);
  });
});
