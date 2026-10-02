import { describe, expect, it } from 'vitest';
import { WKF_KATA_2026, WKF_KUMITE_2026 } from '../rules-engine';
import { generateDraw } from './generate';
import { generateKataDraw } from './kataDraw';
import { computeDrawParts, isDrawPart, poolNumber } from './parts';
import type { Participant } from './types';

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ registrationId: `a${i}`, displayName: `A${i}`, clubId: `c${i % 5}`, districtId: null }));

const kumite = (n: number, bronzeMedals: 0 | 1 | 2 = 2) =>
  generateDraw(
    {
      categoryId: 'c',
      format: 'SINGLE_ELIM_REPECHAGE',
      participants: people(n),
      seeding: { mode: 'RANDOM_SEEDED', randomSeed: 11 },
      options: { bronzeMedals },
    },
    WKF_KUMITE_2026,
  );

describe('computeDrawParts (kumite)', () => {
  it('cannot split a bracket under 32 places', () => {
    expect(computeDrawParts(kumite(16))).toBeNull();
    expect(computeDrawParts(kumite(9))).toBeNull();
  });

  it('splits 64 places into four pools of 16 and a finals part', () => {
    const graph = kumite(64);
    const parts = computeDrawParts(graph);
    expect(parts?.poolCount).toBe(4);

    const count = (part: string) => [...(parts?.byMatch.values() ?? [])].filter((p) => p === part).length;
    // 8 + 4 + 2 + 1 bouts per pool
    for (const n of [1, 2, 3, 4]) expect(count(`POOL:${n}`)).toBe(15);
    // semi-finals (2) + final (1) + repechage + bronze
    const finals = graph.matches.filter((m) => parts?.byMatch.get(m.id) === 'FINALS');
    expect(finals.some((m) => m.bracketType === 'REPECHAGE')).toBe(true);
    expect(finals.some((m) => m.bracketType === 'BRONZE')).toBe(true);
    expect(finals.filter((m) => m.bracketType === 'MAIN')).toHaveLength(3);
  });

  it('gives every bout exactly one part and keeps first-round bouts inside their pool', () => {
    const graph = kumite(40); // a 64-place bracket with byes
    const parts = computeDrawParts(graph);
    expect(parts?.poolCount).toBe(4);
    expect(parts?.byMatch.size).toBe(graph.matches.length);
    for (const m of graph.matches.filter((x) => x.roundNo === 0)) expect(parts?.byMatch.get(m.id)).toMatch(/^POOL:/);
  });

  it('splits a 32-place bracket into two pools whose winners meet in the final', () => {
    const graph = kumite(20);
    const parts = computeDrawParts(graph);
    expect(parts?.poolCount).toBe(2);
    const final = graph.matches.find((m) => m.bracketType === 'MAIN' && m.roundNo === 4);
    expect(final && parts?.byMatch.get(final.id)).toBe('FINALS');
  });

  it('numbers pools in bracket order, so pool 1 holds the first bout', () => {
    const graph = kumite(64);
    const parts = computeDrawParts(graph);
    const first = graph.matches.reduce((a, b) => (a.matchNo < b.matchNo ? a : b));
    expect(parts?.byMatch.get(first.id)).toBe('POOL:1');
  });

  it('is the same every time for the same draw', () => {
    const a = computeDrawParts(kumite(64));
    const b = computeDrawParts(kumite(64));
    expect([...(a?.byMatch ?? [])]).toEqual([...(b?.byMatch ?? [])]);
  });

  it('works with no bronze bouts', () => {
    expect(computeDrawParts(kumite(64, 0))?.poolCount).toBe(4);
  });
});

describe('computeDrawParts (kata pools)', () => {
  const kata = (n: number) =>
    generateKataDraw(
      {
        categoryId: 'k',
        participants: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `A${i}`, school: null, dojo: null })),
        poolSize: 8,
        advancePerPool: 2,
        scoringMode: 'POINTS',
        bronzeMedals: 2,
        randomSeed: 3,
        separateClubs: false,
      },
      WKF_KATA_2026,
    );

  it('puts Pool A and Pool B on their own parts and the medal flight on FINALS', () => {
    const graph = kata(17);
    const parts = computeDrawParts(graph);
    expect(parts?.poolCount).toBe(2);
    for (const m of graph.matches) {
      const expected = m.poolGroup === 'Pool A' ? 'POOL:1' : m.poolGroup === 'Pool B' ? 'POOL:2' : 'FINALS';
      expect(parts?.byMatch.get(m.id)).toBe(expected);
    }
  });

  it('cannot split a single pool', () => {
    expect(computeDrawParts(kata(5))).toBeNull();
    expect(computeDrawParts(kata(2))).toBeNull();
  });
});

describe('part names', () => {
  it('recognises valid parts only', () => {
    expect(isDrawPart('POOL:1')).toBe(true);
    expect(isDrawPart('POOL:12')).toBe(true);
    expect(isDrawPart('FINALS')).toBe(true);
    for (const bad of ['ALL', 'POOL:0', 'POOL:', 'pool:1', 'POOL:01', 'FINALS ', '']) expect(isDrawPart(bad)).toBe(false);
    expect(poolNumber('POOL:3')).toBe(3);
    expect(poolNumber('FINALS')).toBeNull();
  });
});
