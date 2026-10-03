import type { Ruleset } from '@event-suite/rules-engine';
import { checksumOf } from './canonical';
import { DrawInputError, issue, type DrawInputIssue } from './errors';
import { entrantWarnings } from './generate';
import { buildEliminationBracket } from './placement';
import { buildRepechage, REPECHAGE_ROUND_NAME } from './repechage';
import { createRng, deriveSeed, shuffle } from './seeding';
import { applySeparation, separationPenalty } from './separation';
import { nextPowerOfTwo, seedPositions, totalRounds } from './sizing';
import type { DrawGraph, DrawWarning, Participant, SeparationOptions } from './types';

/**
 * A Local tournament group drawn as a knockout bracket: the stager's layout
 * turned into the same graph a generated draw produces, so scoring, advancement
 * and the bronze bouts work unchanged.
 *
 * Athletes pinned by hand keep their places. Byes go where the standard bracket
 * puts them, and the rest of the group is shuffled into the free places from
 * the stored seed, with club-mates kept apart in the first round where the pins
 * allow. Pure and deterministic: the same members, pins and seed always give the
 * same graph and checksum, so the preview a stager sees is exactly what locks.
 */

/** The largest group a Local event allows: a bracket of 32 places. */
export const MAX_GROUP_SIZE = 32;

/** Candidate layouts tried when keeping club-mates apart; the best one wins. */
const SEPARATION_ATTEMPTS = 24;

export interface GroupDrawInput {
  categoryId: string;
  participants: readonly Participant[];
  /** Places fixed by hand: registration id to bracket place, 1 at the top. */
  pins?: Readonly<Record<string, number>>;
  /** Stored with the group, so the draw can be reproduced. */
  randomSeed: number;
  /** Keep club-mates apart in the first round. Pinned athletes are never moved to do it. */
  separation?: SeparationOptions;
  /** 3: both semi-final losers take bronze with no bout (the Local default). 1: one bronze bout. */
  bronzeMedals: 1 | 3;
}

/** Bracket size for a group of `count` athletes: the next power of two, at least 2. */
export function groupBracketSize(count: number): number {
  return nextPowerOfTwo(Math.max(1, count));
}

export function generateGroupDraw(input: GroupDrawInput, ruleset: Ruleset): DrawGraph {
  const count = input.participants.length;
  const size = groupBracketSize(count);
  const pinByPlace = validate(input, ruleset, size);

  const byes = chooseByePlaces(size, count, new Set(pinByPlace.keys()));
  if (byes === null) {
    throw new DrawInputError([
      issue(
        'PINS_LEAVE_EMPTY_BOUT',
        'pins',
        'the pinned places leave a first-round bout with nobody in it: move a pinned athlete',
      ),
    ]);
  }

  const attempts = input.separation === undefined ? 1 : SEPARATION_ATTEMPTS;
  let best: { graph: DrawGraph; penalty: number } | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const orderingSeed = attempt === 0 ? input.randomSeed : deriveSeed(input.randomSeed, attempt);
    const graph = buildLayout(input, ruleset, size, byes, pinByPlace, orderingSeed);
    const penalty = penaltyOf(graph, input);

    if (best === null || penalty < best.penalty) best = { graph, penalty };
    if (penalty === 0) break;
  }

  return (best as { graph: DrawGraph }).graph;
}

/** Each athlete's bracket place (1 at the top) in a group's first round. */
export function placesOf(graph: DrawGraph): Map<string, number> {
  const places = new Map<string, number>();
  const firstRound = graph.matches.filter((match) => match.roundNo === 0 && match.bracketType === 'MAIN');

  for (const match of firstRound) {
    for (const slot of graph.slots) {
      if (slot.matchId !== match.id || slot.registrationId === null || slot.slotType !== 'ATHLETE') continue;
      places.set(slot.registrationId, (match.matchNo - 1) * 2 + slot.position);
    }
  }
  return places;
}

/**
 * Where the byes go: the places the standard bracket gives its lowest seeds, so
 * byes spread across halves and quarters. A pin on one of those places moves its
 * bye to the next place in the same order. No bout ever gets two byes; null when
 * the pins make that impossible.
 */
export function chooseByePlaces(size: number, count: number, pinned: ReadonlySet<number>): Set<number> | null {
  const needed = size - count;
  const byes = new Set<number>();
  const boutsWithBye = new Set<number>();
  const positions = seedPositions(size);
  const placeOfSeed = new Map(positions.map((seed, index) => [seed, index + 1]));

  const consider = (seed: number) => {
    if (byes.size >= needed) return;
    const place = placeOfSeed.get(seed) as number;
    const bout = Math.ceil(place / 2);
    if (pinned.has(place) || boutsWithBye.has(bout)) return;
    byes.add(place);
    boutsWithBye.add(bout);
  };

  for (let seed = size; seed >= 1; seed -= 1) consider(seed);
  return byes.size === needed ? byes : null;
}

function validate(input: GroupDrawInput, ruleset: Ruleset, size: number): Map<number, string> {
  const issues: DrawInputIssue[] = [];
  const count = input.participants.length;

  if (count === 0) issues.push(issue('NO_PARTICIPANTS', 'participants', 'a group needs at least one athlete'));
  if (count > MAX_GROUP_SIZE) {
    issues.push(
      issue('GROUP_TOO_LARGE', 'participants', `a group holds at most ${MAX_GROUP_SIZE} athletes; this one has ${count}`),
    );
  }

  const members = new Set<string>();
  input.participants.forEach((participant, index) => {
    if (members.has(participant.registrationId)) {
      issues.push(
        issue('DUPLICATE_REGISTRATION', `participants[${index}]`, `"${participant.registrationId}" appears more than once`),
      );
    }
    members.add(participant.registrationId);
  });

  if (!ruleset.formats.includes('SINGLE_ELIM_REPECHAGE')) {
    issues.push(issue('FORMAT_NOT_ALLOWED', 'format', `ruleset "${ruleset.id}" does not permit a knockout bracket`));
  }

  const pinByPlace = new Map<number, string>();
  for (const [registrationId, place] of Object.entries(input.pins ?? {})) {
    if (!members.has(registrationId)) {
      issues.push(issue('PIN_NOT_A_MEMBER', `pins.${registrationId}`, `"${registrationId}" is pinned but not in the group`));
      continue;
    }
    if (!Number.isInteger(place) || place < 1 || place > size) {
      issues.push(issue('PIN_OUT_OF_RANGE', `pins.${registrationId}`, `place ${place} is outside the bracket of ${size}`));
      continue;
    }
    const holder = pinByPlace.get(place);
    if (holder !== undefined) {
      issues.push(issue('PIN_PLACE_TAKEN', `pins.${registrationId}`, `place ${place} is already pinned to "${holder}"`));
      continue;
    }
    pinByPlace.set(place, registrationId);
  }

  if (issues.length > 0) throw new DrawInputError(issues);
  return pinByPlace;
}

/** Code-unit order: the same on every machine, so input order never changes the draw. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildLayout(
  input: GroupDrawInput,
  ruleset: Ruleset,
  size: number,
  byes: ReadonlySet<number>,
  pinByPlace: ReadonlyMap<number, string>,
  orderingSeed: number,
): DrawGraph {
  const byRegistration = new Map(input.participants.map((p) => [p.registrationId, p]));
  const pinned = new Set(pinByPlace.values());

  const unpinned = input.participants
    .filter((p) => !pinned.has(p.registrationId))
    .sort((a, b) => compareText(a.registrationId, b.registrationId));
  const order = shuffle(unpinned, createRng(orderingSeed));

  const freePlaces: number[] = [];
  for (let place = 1; place <= size; place += 1) {
    if (!byes.has(place) && !pinByPlace.has(place)) freePlaces.push(place);
  }

  // buildEliminationBracket fills place i with the participant of seed positions[i]:
  // giving each place's seed number its athlete reproduces this exact layout.
  const positions = seedPositions(size);
  const participantBySeed = new Map<number, Participant>();
  const put = (place: number, participant: Participant) => {
    participantBySeed.set(positions[place - 1] as number, participant);
  };
  for (const [place, registrationId] of pinByPlace) put(place, byRegistration.get(registrationId) as Participant);
  order.forEach((participant, index) => put(freePlaces[index] as number, participant));

  const build = buildEliminationBracket(input.categoryId, participantBySeed, size);
  const warnings: DrawWarning[] = [...entrantWarnings(input.participants.length)];

  if (input.separation !== undefined) {
    applySeparation(build.slots, build.matches, byRegistration, input.separation, pinned, warnings, {
      allowMovingProtected: false,
    });
  }

  const roundsTotal = totalRounds(size);
  const repechage = buildRepechage(input.categoryId, {
    roundsTotal,
    bronzeMedals: input.bronzeMedals,
    firstMatchNo: build.matches.length + 1,
  });

  const rounds =
    repechage.matches.length === 0
      ? build.rounds
      : [
          ...build.rounds,
          { roundNo: roundsTotal, name: REPECHAGE_ROUND_NAME, matchIds: repechage.matches.map((m) => m.id) },
        ];

  const body: Omit<DrawGraph, 'checksum'> = {
    categoryId: input.categoryId,
    format: 'SINGLE_ELIM_REPECHAGE',
    rulesetId: ruleset.id,
    tournamentSize: size,
    byeCount: size - input.participants.length,
    bronzeMedals: input.bronzeMedals,
    randomSeed: input.randomSeed,
    rounds,
    matches: [...build.matches, ...repechage.matches],
    slots: [...build.slots, ...repechage.slots],
    pools: [],
    warnings,
  };

  return { ...body, checksum: checksumOf(body) };
}

function penaltyOf(graph: DrawGraph, input: GroupDrawInput): number {
  if (input.separation === undefined) return 0;
  return separationPenalty(
    graph.slots,
    graph.matches.filter((match) => match.bracketType === 'MAIN'),
    new Map(input.participants.map((p) => [p.registrationId, p])),
    input.separation,
    totalRounds(graph.tournamentSize),
  );
}
