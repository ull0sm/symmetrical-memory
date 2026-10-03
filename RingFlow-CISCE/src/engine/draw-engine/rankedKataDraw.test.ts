import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { DrawInputError, GroupChangeError } from './errors';
import { appendRankedPerformer, generateRankedKataDraw, performanceOrder, type RankedKataInput } from './rankedKataDraw';
import { createRng, shuffle } from './seeding';
import type { DrawGraph, Participant } from './types';

const ruleset: Ruleset = getRuleset('WKF_KATA_2026');

function athlete(id: string, clubId = `club-${id}`): Participant {
  return { registrationId: id, displayName: id.toUpperCase(), clubId, districtId: null };
}

function group(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => athlete(`a${i + 1}`));
}

function draw(participants: readonly Participant[], overrides: Partial<RankedKataInput> = {}): DrawGraph {
  return generateRankedKataDraw({ categoryId: 'k1', participants, randomSeed: 7, bronzeMedals: 2, ...overrides }, ruleset);
}

/** Bouts as [first, second] performer, null for an empty side. */
function bouts(graph: DrawGraph): Array<[string | null, string | null]> {
  return [...graph.matches]
    .sort((a, b) => a.matchNo - b.matchNo)
    .map((m) => {
      const at = (position: 1 | 2) =>
        graph.slots.find((s) => s.matchId === m.id && s.position === position)?.registrationId ?? null;
      return [at(1), at(2)];
    });
}

describe('generateRankedKataDraw', () => {
  it('calls everyone once, in pairs, with a solo for an odd last athlete', () => {
    const graph = draw(group(5));
    expect(graph.format).toBe('KATA_RANKED');
    expect(graph.matches).toHaveLength(3);
    expect(bouts(graph)[2]?.[1]).toBeNull();
    expect(performanceOrder(graph).sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(graph.matches.every((m) => m.bracketType === 'POOL' && m.kataScoringMode === 'POINTS')).toBe(true);
    expect(graph.matches[0]?.startStatus).toBe('READY');
  });

  it('is reproducible from its seed whatever the input order', () => {
    const members = group(6);
    expect(draw(shuffle(members, createRng(3))).checksum).toBe(draw(members).checksum);
    expect(draw(members, { randomSeed: 8 }).checksum).not.toBe(draw(members).checksum);
  });

  it('keeps pinned athletes in their places', () => {
    const order = performanceOrder(draw(group(6), { pins: { a4: 1, a2: 6 } }));
    expect(order[0]).toBe('a4');
    expect(order[5]).toBe('a2');
  });

  it('keeps club-mates out of the same pair when it can', () => {
    const members = [athlete('a1', 's'), athlete('a2', 's'), athlete('a3', 'k'), athlete('a4', 'k')];
    for (let seed = 0; seed < 20; seed += 1) {
      const club = (id: string | null) => members.find((m) => m.registrationId === id)?.clubId;
      for (const [x, y] of bouts(draw(members, { randomSeed: seed }))) {
        if (x && y) expect(club(x)).not.toBe(club(y));
      }
    }
  });

  it('records the bronze setting', () => {
    expect(draw(group(4), { bronzeMedals: 1 }).bronzeMedals).toBe(1);
    expect(draw(group(4)).bronzeMedals).toBe(2);
  });

  it('refuses bad pins and empty groups', () => {
    const codes = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return (err as DrawInputError).issues.map((i) => i.code);
      }
      return [];
    };
    expect(codes(() => draw(group(3), { pins: { a1: 4, nobody: 1, a2: 2, a3: 2 } }))).toEqual([
      'PIN_OUT_OF_RANGE',
      'PIN_NOT_A_MEMBER',
      'PIN_PLACE_TAKEN',
    ]);
    expect(codes(() => draw([]))).toContain('NO_PARTICIPANTS');
  });
});

describe('appendRankedPerformer', () => {
  it('fills an open solo at the end', () => {
    const graph = draw(group(3));
    const next = appendRankedPerformer(graph, 'late', new Set());
    expect(next.matches).toHaveLength(2);
    expect(bouts(next)[1]?.[1]).toBe('late');
    expect(bouts(next)[0]).toEqual(bouts(graph)[0]);
  });

  it('opens a new bout when the last one is full or has started, and never moves anyone', () => {
    const even = draw(group(4));
    const afterEven = appendRankedPerformer(even, 'late', new Set());
    expect(bouts(afterEven).slice(0, 2)).toEqual(bouts(even));
    expect(bouts(afterEven)[2]).toEqual(['late', null]);

    const odd = draw(group(3));
    const started = new Set([odd.matches[1]?.id as string]);
    const once = appendRankedPerformer(odd, 'late1', started);
    expect(bouts(once)[1]).toEqual(bouts(odd)[1]);
    expect(bouts(once)[2]).toEqual(['late1', null]);

    // A second late athlete joins the new solo, and the started solo still stands alone.
    const twice = appendRankedPerformer(once, 'late2', started);
    expect(bouts(twice)[1]).toEqual(bouts(odd)[1]);
    expect(bouts(twice)[2]).toEqual(['late1', 'late2']);
    expect(performanceOrder(twice)).toHaveLength(5);
  });

  it('refuses an athlete already in the group, and a bracket', () => {
    const graph = draw(group(3));
    expect(() => appendRankedPerformer(graph, 'a1', new Set())).toThrow(GroupChangeError);
    expect(() => appendRankedPerformer({ ...graph, format: 'SINGLE_ELIM_REPECHAGE' }, 'x', new Set())).toThrow(
      /only a ranked kata group/,
    );
  });
});
