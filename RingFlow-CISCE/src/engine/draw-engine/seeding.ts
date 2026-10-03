import type { DrawInputIssue } from './errors';
import type { DrawWarning, Participant, SeedingOptions } from './types';

export interface OrderedParticipant {
  participant: Participant;
  /** 1-based bracket seed number. Seeds beyond the entrant count are byes. */
  seed: number;
  /** True when the caller named this seed explicitly. */
  explicitSeed: boolean;
}

/**
 * mulberry32 — a small, fast, seeded PRNG.
 *
 * A redraw must be reproducible from its stored seed, so `Math.random` is never
 * used anywhere in this package.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seed for the n-th candidate draw, derived from the stored one. Generators that
 * try several candidates (to keep club-mates apart) stay reproducible from the one
 * stored seed this way.
 */
export function deriveSeed(base: number, attempt: number): number {
  return (base + Math.imul(attempt, 0x9e3779b1)) >>> 0;
}

/** Fisher-Yates, driven by a seeded PRNG. */
export function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const result = [...values];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i];
    const b = result[j];

    if (a === undefined || b === undefined) {
      continue;
    }

    result[i] = b;
    result[j] = a;
  }

  return result;
}

/**
 * Assigns every participant a bracket seed number (blueprint §5.1 step 3).
 *
 * Explicit seeds are preserved exactly as given rather than renumbered. If an
 * organiser seeds two athletes and leaves the rest unseeded, the seeded pair
 * keep their places and the remaining seed numbers are drawn at random from the
 * stored `randomSeed` (or, with none given, handed out in input order) — which
 * is what an organiser means by "these two are my top seeds".
 */
export function orderParticipants(
  participants: readonly Participant[],
  seeding: SeedingOptions,
  issues: DrawInputIssue[],
  warnings: DrawWarning[],
): OrderedParticipant[] {
  const total = participants.length;

  if (seeding.mode === 'RANDOM_SEEDED') {
    if (seeding.randomSeed === undefined) {
      issues.push({
        code: 'MISSING_RANDOM_SEED',
        path: 'seeding.randomSeed',
        message: 'RANDOM_SEEDED requires a randomSeed so the draw can be reproduced',
      });
      return [];
    }

    const shuffled = shuffle(participants, createRng(seeding.randomSeed));
    return shuffled.map((participant, index) => ({
      participant,
      seed: index + 1,
      explicitSeed: false,
    }));
  }

  if (seeding.mode === 'NONE') {
    return participants.map((participant, index) => ({
      participant,
      seed: index + 1,
      explicitSeed: false,
    }));
  }

  // MANUAL and RANKING both arrive as an explicit seed list; the difference is
  // only where that list came from.
  const assignments = seeding.seeds ?? [];
  const participantByRegistration = new Map(
    participants.map((participant) => [participant.registrationId, participant]),
  );

  const seedByRegistration = new Map<string, number>();
  const usedSeeds = new Set<number>();

  for (const assignment of assignments) {
    const { registrationId, seed } = assignment;
    const path = `seeding.seeds[${registrationId}]`;

    if (!Number.isInteger(seed) || seed < 1) {
      issues.push({
        code: 'INVALID_SEED',
        path,
        message: `seed must be a positive integer, received ${String(seed)}`,
      });
      continue;
    }

    if (seed > total) {
      issues.push({
        code: 'SEED_OUT_OF_RANGE',
        path,
        message: `seed ${seed} is outside 1..${total}`,
      });
      continue;
    }

    if (usedSeeds.has(seed)) {
      issues.push({
        code: 'DUPLICATE_SEED',
        path,
        message: `seed ${seed} is assigned more than once`,
      });
      continue;
    }

    if (!participantByRegistration.has(registrationId)) {
      issues.push({
        code: 'UNKNOWN_SEED_REGISTRATION',
        path,
        message: `seed references registration "${registrationId}", which is not in this category`,
      });
      continue;
    }

    usedSeeds.add(seed);
    seedByRegistration.set(registrationId, seed);
  }

  const unseeded = participants.filter(
    (participant) => !seedByRegistration.has(participant.registrationId),
  );

  if (seedByRegistration.size > 0 && unseeded.length > 0) {
    warnings.push({
      code: 'MISSING_SEED',
      message: `${unseeded.length} of ${total} entrants have no seed; remaining seed numbers were ${
        seeding.randomSeed === undefined ? 'assigned in entry order' : 'drawn at random'
      }`,
      registrationIds: unseeded.map((participant) => participant.registrationId),
    });
  }

  // Remaining seed numbers go to the unseeded entrants, in entry order.
  const freeSeeds: number[] = [];
  for (let seed = 1; seed <= total; seed += 1) {
    if (!usedSeeds.has(seed)) {
      freeSeeds.push(seed);
    }
  }

  const ordered: OrderedParticipant[] = participants
    .filter((participant) => seedByRegistration.has(participant.registrationId))
    .map((participant) => {
      const seed = seedByRegistration.get(participant.registrationId);
      if (seed === undefined) {
        throw new Error(`Internal error: seed missing for ${participant.registrationId}`);
      }
      return { participant, seed, explicitSeed: true };
    })
    .sort((a, b) => a.seed - b.seed);

  // With a randomSeed the unseeded entrants are drawn into the free seed numbers
  // (an organiser who seeds the top few means "and draw the rest"); without one,
  // entry order is kept so the result stays predictable.
  const unseededOrder =
    seeding.randomSeed === undefined ? unseeded : shuffle(unseeded, createRng(seeding.randomSeed));

  unseededOrder.forEach((participant, index) => {
    const seed = freeSeeds[index];
    if (seed === undefined) {
      throw new Error('Internal error: ran out of free seed numbers');
    }
    ordered.push({ participant, seed, explicitSeed: false });
  });

  return ordered;
}
