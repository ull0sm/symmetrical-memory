import { getRuleset, type Ruleset } from '@event-suite/rules-engine';
import { describe, expect, it } from 'vitest';
import { DrawInputError } from './errors';
import { generateDraw } from './generate';
import type { DrawGraph, Participant } from './types';

const ruleset: Ruleset = getRuleset('WKF_KUMITE_2026');

function participant(id: string, clubId = 'club-a', districtId: string | null = 'd-1'): Participant {
  return { registrationId: id, displayName: id.toUpperCase(), clubId, districtId };
}

/** n entrants, each in its own club and district unless overridden. */
function entrants(n: number): Participant[] {
  return Array.from({ length: n }, (_, i) => participant(`p${i + 1}`, `club-${i + 1}`, `d-${i + 1}`));
}

function draw(participants: readonly Participant[], overrides: Partial<Parameters<typeof generateDraw>[0]> = {}): DrawGraph {
  return generateDraw(
    {
      categoryId: 'cat-1',
      format: 'SINGLE_ELIM_REPECHAGE',
      participants,
      seeding: { mode: 'NONE' },
      ...overrides,
    },
    ruleset,
  );
}

function firstRoundPairs(graph: DrawGraph): Array<{ matchId: string; registrations: string[] }> {
  const firstRoundMatches = graph.matches.filter((match) => match.roundNo === 0);

  return firstRoundMatches.map((match) => ({
    matchId: match.id,
    registrations: graph.slots
      .filter((slot) => slot.matchId === match.id && slot.registrationId !== null)
      .map((slot) => slot.registrationId as string),
  }));
}

describe('generateDraw — input rejection', () => {
  it('refuses a category with no entrants', () => {
    expect(() => draw([])).toThrow(DrawInputError);
  });

  it('refuses a duplicated registration', () => {
    try {
      draw([participant('p1'), participant('p1')]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrawInputError).issues.map((i) => i.code)).toContain('DUPLICATE_REGISTRATION');
    }
  });

  it('refuses a format the engine does not implement yet', () => {
    try {
      draw(entrants(8), { format: 'ROUND_ROBIN' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrawInputError).issues.map((i) => i.code)).toContain('UNSUPPORTED_FORMAT');
    }
  });

  it('refuses a format the ruleset does not permit', () => {
    try {
      draw(entrants(8), { format: 'DOUBLE_ELIM' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const codes = (error as DrawInputError).issues.map((i) => i.code);
      expect(codes).toContain('FORMAT_NOT_ALLOWED');
    }
  });

  it('refuses byes when the caller disallowed them', () => {
    try {
      draw(entrants(5), { options: { allowByes: false } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrawInputError).issues.map((i) => i.code)).toContain('BYES_NOT_ALLOWED');
    }
  });

  it('refuses the separation rule that is not implemented', () => {
    try {
      draw(entrants(8), { separation: { by: 'CLUB', rule: 'SAME_HALF_BLOCKED' } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrawInputError).issues.map((i) => i.code)).toContain(
        'UNSUPPORTED_SEPARATION_RULE',
      );
    }
  });

  it('reports every problem at once', () => {
    try {
      draw([participant('p1'), participant('p1')], { format: 'DOUBLE_ELIM' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrawInputError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('generateDraw — bracket shape', () => {
  it.each([2, 3, 4, 5, 7, 8, 9, 16, 17])('draws %i entrants into a valid bracket', (count) => {
    const graph = draw(entrants(count));
    const size = graph.tournamentSize;

    const mainMatches = graph.matches.filter((match) => match.bracketType === 'MAIN');
    const mainMatchIds = new Set(mainMatches.map((match) => match.id));

    // The main bracket is the same shape it always was; repechage matches are
    // extra, and live in their own round.
    expect(mainMatches).toHaveLength(size - 1);
    expect(graph.byeCount).toBe(size - count);

    // Entrants are only ever placed in the main bracket. Repechage slots draw
    // their athletes from losers, so they are never ATHLETE slots.
    const athletes = graph.slots.filter((slot) => slot.slotType === 'ATHLETE');
    expect(athletes).toHaveLength(count);

    const mainByes = graph.slots.filter(
      (slot) => slot.slotType === 'BYE' && mainMatchIds.has(slot.matchId),
    );
    expect(mainByes).toHaveLength(size - count);
  });

  it('places every entrant exactly once', () => {
    const graph = draw(entrants(13));

    const placed = graph.slots
      .filter((slot) => slot.slotType === 'ATHLETE')
      .map((slot) => slot.registrationId);

    expect(new Set(placed).size).toBe(13);
  });

  it('reports a single-entrant category as a warning, not an error', () => {
    const graph = draw([participant('p1')]);

    expect(graph.warnings.map((w) => w.code)).toContain('SINGLE_ENTRANT');
  });

  it('reports a two-entrant category as a warning', () => {
    const graph = draw(entrants(2));

    expect(graph.warnings.map((w) => w.code)).toContain('TWO_ENTRANTS');
  });

  it('leaves no pool data on an elimination draw', () => {
    expect(draw(entrants(8)).pools).toEqual([]);
  });
});

describe('generateDraw — determinism', () => {
  it('produces an identical checksum for identical input', () => {
    const first = draw(entrants(16));
    const second = draw(entrants(16));

    expect(first.checksum).toBe(second.checksum);
  });

  it('produces an identical graph, not merely the same checksum', () => {
    expect(JSON.stringify(draw(entrants(16)))).toEqual(JSON.stringify(draw(entrants(16))));
  });

  it('reproduces a seeded random draw exactly', () => {
    const first = draw(entrants(16), { seeding: { mode: 'RANDOM_SEEDED', randomSeed: 777 } });
    const second = draw(entrants(16), { seeding: { mode: 'RANDOM_SEEDED', randomSeed: 777 } });

    expect(first.checksum).toBe(second.checksum);
  });

  it('produces a different draw for a different random seed', () => {
    const first = draw(entrants(16), { seeding: { mode: 'RANDOM_SEEDED', randomSeed: 1 } });
    const second = draw(entrants(16), { seeding: { mode: 'RANDOM_SEEDED', randomSeed: 2 } });

    expect(first.checksum).not.toBe(second.checksum);
  });

  it('records the random seed so a redraw can be audited', () => {
    const graph = draw(entrants(8), { seeding: { mode: 'RANDOM_SEEDED', randomSeed: 4242 } });

    expect(graph.randomSeed).toBe(4242);
  });

  it('records no random seed when the draw was not randomised', () => {
    expect(draw(entrants(8)).randomSeed).toBeNull();
  });

  it('changes the checksum when the entrants change', () => {
    const first = draw(entrants(8));
    const second = draw([...entrants(7), participant('different')]);

    expect(first.checksum).not.toBe(second.checksum);
  });

  it('does not depend on key insertion order', () => {
    const original = draw(entrants(8));
    const reordered: Participant[] = entrants(8).map((p) => ({
      districtId: p.districtId,
      clubId: p.clubId,
      displayName: p.displayName,
      registrationId: p.registrationId,
    }));

    expect(draw(reordered).checksum).toBe(original.checksum);
  });
});

describe('generateDraw — separation', () => {
  it('separates club-mates who would otherwise meet in the first round', () => {
    // Seeds 1 and 8 meet first under the standard slotting, so putting them in
    // the same club must force a swap.
    const participants = entrants(8).map((p, index) =>
      index === 0 || index === 7 ? { ...p, clubId: 'same-club' } : p,
    );

    const graph = draw(participants, { separation: { by: 'CLUB', rule: 'FIRST_ROUND' } });

    const clashes = firstRoundPairs(graph).filter((pair) => {
      const clubs = pair.registrations.map(
        (id) => participants.find((p) => p.registrationId === id)?.clubId,
      );
      return clubs.length === 2 && clubs[0] === clubs[1];
    });

    expect(clashes).toEqual([]);
    expect(graph.warnings.map((w) => w.code)).not.toContain('SEPARATION_IMPOSSIBLE');
  });

  it('separates district-mates when asked to separate by district', () => {
    const participants = entrants(8).map((p, index) =>
      index === 0 || index === 7 ? { ...p, districtId: 'same-district' } : p,
    );

    const graph = draw(participants, { separation: { by: 'DISTRICT', rule: 'FIRST_ROUND' } });

    expect(graph.warnings.map((w) => w.code)).not.toContain('SEPARATION_IMPOSSIBLE');
  });

  it('reports honestly when separation is impossible', () => {
    // Every entrant in one club: there is no arrangement without a clash.
    const participants = entrants(8).map((p) => ({ ...p, clubId: 'one-club' }));

    const graph = draw(participants, { separation: { by: 'CLUB', rule: 'FIRST_ROUND' } });

    expect(graph.warnings.map((w) => w.code)).toContain('SEPARATION_IMPOSSIBLE');
  });

  it('still separates two seeded club-mates rather than giving up', () => {
    // Both clashing athletes are explicitly seeded. Respecting the seeds is
    // preferable, but not at the cost of an unseparated draw.
    const participants = entrants(8).map((p, index) =>
      index === 0 || index === 7 ? { ...p, clubId: 'same-club' } : p,
    );

    const graph = draw(participants, {
      seeding: {
        mode: 'MANUAL',
        seeds: participants.map((p, index) => ({ registrationId: p.registrationId, seed: index + 1 })),
      },
      separation: { by: 'CLUB', rule: 'FIRST_ROUND' },
    });

    expect(graph.warnings.map((w) => w.code)).not.toContain('SEPARATION_IMPOSSIBLE');
  });

  it('does nothing when separation is not requested', () => {
    const participants = entrants(8).map((p, index) =>
      index === 0 || index === 7 ? { ...p, clubId: 'same-club' } : p,
    );

    const graph = draw(participants);

    const clashes = firstRoundPairs(graph).filter((pair) => {
      const clubs = pair.registrations.map(
        (id) => participants.find((p) => p.registrationId === id)?.clubId,
      );
      return clubs.length === 2 && clubs[0] === clubs[1];
    });

    expect(clashes).toHaveLength(1);
    expect(graph.checksum).toBe(draw(participants).checksum);
  });

  it('preserves every entrant through the swapping', () => {
    const participants = entrants(8).map((p, index) =>
      index % 2 === 0 ? { ...p, clubId: 'same-club' } : p,
    );

    const graph = draw(participants, { separation: { by: 'CLUB', rule: 'FIRST_ROUND' } });

    const placed = graph.slots
      .filter((slot) => slot.slotType === 'ATHLETE')
      .map((slot) => slot.registrationId);

    expect(new Set(placed)).toEqual(new Set(participants.map((p) => p.registrationId)));
  });
});

describe('generateDraw — keeping club-mates apart', () => {
  const sep = { by: 'CLUB', rule: 'FIRST_ROUND' } as const;
  const random = (randomSeed: number) => ({ mode: 'RANDOM_SEEDED', randomSeed }) as const;

  /** Round in which two registrations would first share a match. */
  function meetingRound(graph: DrawGraph, a: string, b: string): number {
    const pairs = firstRoundPairs(graph);
    const indexOf = (id: string) => pairs.findIndex((pair) => pair.registrations.includes(id));
    const roundsTotal = Math.log2(graph.tournamentSize);
    let round = 0;
    while (indexOf(a) >> round !== indexOf(b) >> round && round < roundsTotal) round += 1;
    return round;
  }

  it('puts two club-mates in opposite halves whenever the bracket allows it', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const participants = entrants(16).map((p, i) => (i < 2 ? { ...p, clubId: 'same' } : p));
      const graph = draw(participants, { seeding: random(seed), separation: sep });

      // Opposite halves means they can only meet in the final (round 3 of 4).
      expect(meetingRound(graph, 'p1', 'p2')).toBe(3);
    }
  });

  it('treats club names that differ only by case and spacing as one club', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const participants = entrants(8).map((p, i) =>
        i === 0 ? { ...p, clubId: 'Shito Ryu' } : i === 1 ? { ...p, clubId: '  shito ryu ' } : p,
      );
      const graph = draw(participants, { seeding: random(seed), separation: sep });

      expect(meetingRound(graph, 'p1', 'p2')).toBe(2);
    }
  });

  it('does not treat entrants with no club as one club', () => {
    const participants = entrants(8).map((p) => ({ ...p, clubId: '' }));
    const graph = draw(participants, { seeding: random(7), separation: sep });

    expect(graph.warnings.map((w) => w.code)).not.toContain('SEPARATION_IMPOSSIBLE');
    // Same draw as with no separation asked for: nobody was moved on account of "" being shared.
    expect(graph.checksum).toBe(draw(participants, { seeding: random(7) }).checksum);
  });

  it('is reproducible from the stored seed and reports that seed', () => {
    const participants = entrants(12).map((p, i) => (i % 3 === 0 ? { ...p, clubId: 'big' } : p));
    const first = draw(participants, { seeding: random(2024), separation: sep });
    const second = draw(participants, { seeding: random(2024), separation: sep });

    expect(second.checksum).toBe(first.checksum);
    expect(first.randomSeed).toBe(2024);
  });

  it('draws unseeded entrants at random around explicit seeds, reproducibly', () => {
    const seeds = [
      { registrationId: 'p5', seed: 1 },
      { registrationId: 'p6', seed: 2 },
    ];
    const a = draw(entrants(8), { seeding: { mode: 'MANUAL', seeds, randomSeed: 11 } });
    const b = draw(entrants(8), { seeding: { mode: 'MANUAL', seeds, randomSeed: 11 } });
    const c = draw(entrants(8), { seeding: { mode: 'MANUAL', seeds, randomSeed: 12 } });

    expect(b.checksum).toBe(a.checksum);
    expect(c.checksum).not.toBe(a.checksum);
    // The seeded pair keep the top positions: seed 1 faces the last seed, seed 2 sits in the other half.
    const pairs = firstRoundPairs(a);
    expect(pairs[0]?.registrations).toContain('p5');
    expect(pairs[2]?.registrations).toContain('p6');
  });
});
