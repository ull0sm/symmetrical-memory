import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { DrawInputError } from './errors';
import { chooseByePlaces, generateGroupDraw, MAX_GROUP_SIZE, placesOf, type GroupDrawInput } from './groupDraw';
import { resolveDraw, type MatchOutcome } from './resolution';
import { createRng, shuffle } from './seeding';
import type { DrawGraph, Participant } from './types';

const ruleset: Ruleset = getRuleset('WKF_KUMITE_2026');
const CLUB = { by: 'CLUB', rule: 'FIRST_ROUND' } as const;

function athlete(id: string, clubId = `club-${id}`): Participant {
  return { registrationId: id, displayName: id.toUpperCase(), clubId, districtId: null };
}

function group(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => athlete(`a${i + 1}`));
}

function draw(participants: readonly Participant[], overrides: Partial<GroupDrawInput> = {}): DrawGraph {
  return generateGroupDraw(
    { categoryId: 'g1', participants, randomSeed: 42, bronzeMedals: 3, ...overrides },
    ruleset,
  );
}

/** First-round bouts as [top, bottom] registration ids, null for a bye. */
function firstRound(graph: DrawGraph): Array<[string | null, string | null]> {
  return graph.matches
    .filter((m) => m.roundNo === 0 && m.bracketType === 'MAIN')
    .sort((a, b) => a.matchNo - b.matchNo)
    .map((m) => {
      const at = (position: 1 | 2) =>
        graph.slots.find((s) => s.matchId === m.id && s.position === position)?.registrationId ?? null;
      return [at(1), at(2)];
    });
}

function byePlaces(graph: DrawGraph): number[] {
  return firstRound(graph)
    .flatMap(([top, bottom], i) => [top === null ? i * 2 + 1 : null, bottom === null ? i * 2 + 2 : null])
    .filter((p): p is number => p !== null);
}

/** Plays a group to the end, the top line always winning. */
function playThrough(graph: DrawGraph): ReturnType<typeof resolveDraw> {
  const results = new Map<string, MatchOutcome>();
  for (let step = 0; step <= graph.matches.length; step += 1) {
    const next = resolveDraw(graph, results).readyMatchIds[0];
    if (next === undefined) break;
    results.set(next, { kind: 'WINNER', side: 'AKA' });
  }
  return resolveDraw(graph, results);
}

describe('generateGroupDraw: the layout', () => {
  it('is reproducible from its seed, and the input order does not matter', () => {
    const members = group(7);
    const a = draw(members);
    const b = draw(shuffle(members, createRng(9)));
    expect(b.checksum).toBe(a.checksum);
    expect(draw(members, { randomSeed: 43 }).checksum).not.toBe(a.checksum);
  });

  it('places byes where the standard bracket puts them', () => {
    // A bracket of 8 seeds [1,8,4,5,2,7,3,6] by place; seeds 6, 7 and 8 are the byes of five athletes.
    expect(byePlaces(draw(group(5)))).toEqual([2, 6, 8]);
    expect(chooseByePlaces(8, 5, new Set())).toEqual(new Set([2, 6, 8]));
  });

  it('moves a bye off a pinned place to the next place in the same order', () => {
    const graph = draw(group(5), { pins: { a1: 2 } });
    expect(placesOf(graph).get('a1')).toBe(2);
    expect(byePlaces(graph)).toEqual([4, 6, 8]);
  });

  it('keeps every pinned athlete exactly where they were pinned', () => {
    const pins = { a3: 1, a5: 4, a1: 7 };
    const graph = draw(group(6), { pins, separation: CLUB });
    const places = placesOf(graph);
    for (const [id, place] of Object.entries(pins)) expect(places.get(id)).toBe(place);
  });

  it('builds both bronze formats', () => {
    expect(draw(group(8), { bronzeMedals: 3 }).matches.some((m) => m.bracketType === 'BRONZE')).toBe(false);
    const single = draw(group(8), { bronzeMedals: 1 });
    expect(single.matches.filter((m) => m.bracketType === 'BRONZE')).toHaveLength(1);
    expect(single.bronzeMedals).toBe(1);
  });
});

describe('generateGroupDraw: every size and any pins', () => {
  it('never leaves a bout with two byes, and places everyone once', () => {
    const rng = createRng(2026);
    for (let n = 1; n <= MAX_GROUP_SIZE; n += 1) {
      for (let trial = 0; trial < 5; trial += 1) {
        const members = group(n);
        const size = Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
        // Pin a random few athletes to random free places.
        const places = shuffle(Array.from({ length: size }, (_, i) => i + 1), rng);
        const pinned = shuffle(members, rng).slice(0, Math.floor(rng() * Math.min(n, 4)));
        const pins = Object.fromEntries(pinned.map((p, i) => [p.registrationId, places[i] as number]));

        let graph: DrawGraph;
        try {
          graph = draw(members, { pins, randomSeed: trial, separation: CLUB });
        } catch (err) {
          // Only a pin layout that leaves an empty bout may be refused.
          expect((err as DrawInputError).issues.map((i) => i.code)).toEqual(['PINS_LEAVE_EMPTY_BOUT']);
          continue;
        }

        expect(graph.tournamentSize).toBe(size);
        expect(graph.byeCount).toBe(size - n);
        expect(firstRound(graph).some(([top, bottom]) => top === null && bottom === null)).toBe(false);
        expect([...placesOf(graph).keys()].sort()).toEqual(members.map((m) => m.registrationId).sort());
        for (const [id, place] of Object.entries(pins)) expect(placesOf(graph).get(id)).toBe(place);
      }
    }
  });
});

describe('generateGroupDraw: club separation', () => {
  it('keeps club-mates apart in the first round when it can', () => {
    const members = [
      athlete('a1', 'sakura'),
      athlete('a2', 'sakura'),
      athlete('a3', 'sakura'),
      athlete('a4', 'kaizen'),
      athlete('a5', 'kaizen'),
      athlete('a6', 'tiger'),
      athlete('a7', 'tiger'),
      athlete('a8', 'bushido'),
    ];
    const club = new Map(members.map((m) => [m.registrationId, m.clubId]));
    for (let seed = 0; seed < 20; seed += 1) {
      const graph = draw(members, { randomSeed: seed, separation: CLUB });
      for (const [top, bottom] of firstRound(graph)) {
        if (top && bottom) expect(club.get(top)).not.toBe(club.get(bottom));
      }
    }
  });

  it('never moves a pinned athlete to separate clubs, and says so', () => {
    const members = [athlete('a1', 'sakura'), athlete('a2', 'sakura'), athlete('a3', 'kaizen'), athlete('a4', 'tiger')];
    const graph = draw(members, { pins: { a1: 1, a2: 2 }, separation: CLUB });
    expect(firstRound(graph)[0]).toEqual(['a1', 'a2']);
    expect(graph.warnings.some((w) => w.code === 'SEPARATION_IMPOSSIBLE')).toBe(true);
  });
});

describe('generateGroupDraw: small groups and medals', () => {
  it('gives a lone athlete gold by walkover', () => {
    const graph = draw(group(1));
    expect(graph.tournamentSize).toBe(2);
    expect(graph.warnings.map((w) => w.code)).toContain('SINGLE_ENTRANT');
    expect(playThrough(graph).podium).toMatchObject({ goldRegistrationId: 'a1', silverRegistrationId: null });
  });

  it('makes two athletes a single final', () => {
    const podium = playThrough(draw(group(2))).podium;
    expect(podium?.silverRegistrationId).not.toBeNull();
    expect(podium?.bronzeRegistrationIds).toEqual([]);
  });

  it('gives a group of three gold, silver and one bronze', () => {
    for (const bronzeMedals of [1, 3] as const) {
      const podium = playThrough(draw(group(3), { bronzeMedals })).podium;
      expect(podium?.bronzeRegistrationIds).toHaveLength(1);
    }
  });

  it('gives a group of four or more two bronzes, or one through a bronze bout', () => {
    expect(playThrough(draw(group(8), { bronzeMedals: 3 })).podium?.bronzeRegistrationIds).toHaveLength(2);
    expect(playThrough(draw(group(8), { bronzeMedals: 1 })).podium?.bronzeRegistrationIds).toHaveLength(1);
    expect(playThrough(draw(group(5), { bronzeMedals: 3 })).podium?.bronzeRegistrationIds).toHaveLength(2);
  });
});

describe('generateGroupDraw: refusals', () => {
  const codes = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return (err as DrawInputError).issues.map((i) => i.code);
    }
    return [];
  };

  it('reports every bad pin at once', () => {
    expect(
      codes(() => draw(group(5), { pins: { nobody: 1, a1: 0, a2: 9, a3: 3, a4: 3, a5: 1.5 } })),
    ).toEqual(['PIN_NOT_A_MEMBER', 'PIN_OUT_OF_RANGE', 'PIN_OUT_OF_RANGE', 'PIN_PLACE_TAKEN', 'PIN_OUT_OF_RANGE']);
  });

  it('refuses pins that leave a bout empty', () => {
    // Four of five athletes pinned into bouts 1 and 2 leave one athlete for bouts 3 and 4.
    expect(codes(() => draw(group(5), { pins: { a1: 1, a2: 2, a3: 3, a4: 4 } }))).toEqual(['PINS_LEAVE_EMPTY_BOUT']);
  });

  it('refuses an empty group, a group over the limit, and duplicates', () => {
    expect(codes(() => draw([]))).toContain('NO_PARTICIPANTS');
    expect(codes(() => draw(group(MAX_GROUP_SIZE + 1)))).toContain('GROUP_TOO_LARGE');
    expect(codes(() => draw([athlete('a1'), athlete('a1')]))).toContain('DUPLICATE_REGISTRATION');
  });
});
