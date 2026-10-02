import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { checksumOf } from './canonical';
import { generateKataDraw } from './kataDraw';
import type { KataFlightParams, KataFlightParticipant } from './kataFlightDraw';

const ruleset: Ruleset = getRuleset('WKF_KATA_2026');

function athletes(n: number, club: (i: number) => string | null = (i) => `club-${i}`): KataFlightParticipant[] {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, name: `Athlete ${i + 1}`, school: club(i + 1) }));
}

function kata(participants: KataFlightParticipant[], overrides: Partial<KataFlightParams> = {}) {
  return generateKataDraw({ categoryId: 'cat', participants, randomSeed: 1234, ...overrides }, ruleset);
}

describe('generateKataDraw', () => {
  it('is reproducible from the seed and changes with it', () => {
    const roster = athletes(14, (i) => `club-${i % 3}`);

    expect(kata(roster).checksum).toBe(kata(roster).checksum);
    expect(kata(roster, { randomSeed: 99 }).checksum).not.toBe(kata(roster).checksum);
  });

  it('reports its seed and a checksum that matches what is stored', () => {
    const graph = kata(athletes(10));
    const { checksum, ...body } = graph;

    expect(graph.randomSeed).toBe(1234);
    expect(checksumOf(body)).toBe(checksum);
  });

  it('draws every athlete exactly once', () => {
    const graph = kata(athletes(21));
    const ids = graph.pools.flatMap((pool) => pool.registrationIds);

    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
  });

  it('splits a big category into two balanced pools', () => {
    const graph = kata(athletes(21));

    expect(graph.pools.map((pool) => pool.registrationIds.length).sort()).toEqual([10, 11]);
    expect(graph.warnings.map((w) => w.code)).toContain('POOL_LARGER_THAN_SETTING');
  });

  it('keeps a small category in a single pool', () => {
    const graph = kata(athletes(6));

    expect(graph.pools).toHaveLength(1);
    expect(graph.warnings).toEqual([]);
  });

  it('spreads a club across the pools and never pairs club-mates when it can avoid it', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const graph = kata(athletes(16, (i) => (i <= 4 ? 'big club' : `club-${i}`)), { randomSeed: seed });
      const clubOf = (id: string) => (Number(id.slice(1)) <= 4 ? 'big club' : id);

      for (const pool of graph.pools) {
        expect(pool.registrationIds.filter((id) => clubOf(id) === 'big club')).toHaveLength(2);
      }

      for (const slotPair of graph.matches.filter((m) => m.bracketType === 'POOL')) {
        const ids = graph.slots.filter((s) => s.matchId === slotPair.id).map((s) => s.registrationId as string);
        expect(new Set(ids.map(clubOf)).size).toBe(ids.length);
      }
    }
  });

  it('treats athletes with no club as separate clubs', () => {
    const graph = kata(athletes(8, () => null));

    expect(graph.warnings.map((w) => w.code)).not.toContain('SEPARATION_IMPOSSIBLE');
  });

  it('can switch separation off', () => {
    const graph = kata(athletes(8, () => 'one club'), { separateClubs: false });

    expect(graph.warnings.map((w) => w.code)).not.toContain('SEPARATION_IMPOSSIBLE');
  });

  it('keeps the round names pool advancement matches on, and the medal flight shape', () => {
    const graph = kata(athletes(16));
    const names = graph.matches.map((m) => m.roundName);

    expect(names.some((n) => n.includes('Pool A #2 vs Pool B #3'))).toBe(true);
    expect(names.some((n) => n.startsWith('Bronze Medal Bout 1'))).toBe(true);
    expect(names.some((n) => n.startsWith('Bronze Medal Bout 2'))).toBe(true);
    expect(graph.matches.filter((m) => m.bracketType === 'MAIN')).toHaveLength(1);
    expect(graph.matches.filter((m) => m.bracketType === 'BRONZE')).toHaveLength(2);
  });

  it('gives pool bouts entry slots and medal bouts none, and starts the first bout READY', () => {
    const graph = kata(athletes(10));
    const flight = graph.matches.filter((m) => m.poolGroup === 'Final Flight');

    expect(graph.slots.every((s) => s.slotType === 'ENTRY')).toBe(true);
    expect(flight.every((m) => graph.slots.every((s) => s.matchId !== m.id))).toBe(true);
    expect(graph.matches.find((m) => m.matchNo === 1)?.startStatus).toBe('READY');
    expect(graph.matches.filter((m) => m.startStatus === 'READY')).toHaveLength(1);
  });

  it('follows the bronze format', () => {
    const none = kata(athletes(16), { bronzeMedals: 0 });
    const one = kata(athletes(16), { bronzeMedals: 1 });

    expect(none.matches.filter((m) => m.bracketType === 'BRONZE')).toHaveLength(0);
    expect(one.matches.filter((m) => m.bracketType === 'BRONZE')).toHaveLength(1);
  });
});
