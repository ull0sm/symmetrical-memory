import type { Ruleset } from '@event-suite/rules-engine';
import { checksumOf } from './canonical';
import { DrawInputError, GroupChangeError, issue, type DrawInputIssue } from './errors';
import { entrantWarnings } from './generate';
import { MAX_GROUP_SIZE } from './groupDraw';
import { createRng, deriveSeed, shuffle } from './seeding';
import { groupKeyOf } from './separation';
import { matchIdFor, slotIdFor } from './sizing';
import type { DrawGraph, DrawWarning, MatchNode, Participant, SlotNode } from './types';

/**
 * A Local kata group: everyone performs once and is ranked by marks. The draw
 * is just the performance order, called to the mat in pairs (1 and 2, then 3 and
 * 4, a solo for an odd last athlete) the same way kata pool bouts are, and each
 * performance is scored on its own.
 *
 * Athletes pinned by hand keep their place in the order; the rest are shuffled
 * from the stored seed, keeping club-mates out of the same pair where the pins
 * allow. Pure and deterministic, like every draw.
 */

export const RANKED_POOL_NAME = 'Ranking';

/** Candidate orders tried when keeping club-mates apart; the one with the fewest shared pairs wins. */
const SEPARATION_ATTEMPTS = 24;

export interface RankedKataInput {
  categoryId: string;
  participants: readonly Participant[];
  /** Performance places fixed by hand: registration id to place, 1 performs first. */
  pins?: Readonly<Record<string, number>>;
  randomSeed: number;
  /** Keep club-mates out of the same pair. Pinned athletes are never moved to do it. Default true. */
  separateClubs?: boolean;
  /** Bronzes the ranking awards: 2 (ranks 3 and 4) or 1 (rank 3). */
  bronzeMedals: 1 | 2;
}

export function generateRankedKataDraw(input: RankedKataInput, ruleset: Ruleset): DrawGraph {
  const pinByPlace = validate(input);
  const separate = input.separateClubs !== false;
  const attempts = separate ? SEPARATION_ATTEMPTS : 1;

  let best: { order: Participant[]; clashes: number } | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const order = arrange(input, pinByPlace, attempt === 0 ? input.randomSeed : deriveSeed(input.randomSeed, attempt));
    const clashes = separate ? pairClashes(order) : 0;
    if (best === null || clashes < best.clashes) best = { order, clashes };
    if (clashes === 0) break;
  }

  const { order, clashes } = best as { order: Participant[]; clashes: number };
  const warnings: DrawWarning[] = [...entrantWarnings(order.length)];
  if (clashes > 0) {
    warnings.push({
      code: 'SEPARATION_IMPOSSIBLE',
      message: `${clashes} pair(s) put athletes from the same club on the mat together and could not be avoided`,
    });
  }

  return buildGraph(input.categoryId, ruleset.id, order.map((p) => p.registrationId), input.randomSeed, input.bronzeMedals, warnings);
}

/** The performance order of a ranked kata group, first to last. */
export function performanceOrder(graph: DrawGraph): string[] {
  return [...(graph.pools[0]?.registrationIds ?? [])];
}

/**
 * Adds a late athlete to the end of a ranked group's order: into the last pair
 * if it is a solo that has not started, otherwise as a new solo at the end.
 * `startedMatchIds` are the group's bouts that are live or already scored.
 */
export function appendRankedPerformer(
  graph: DrawGraph,
  registrationId: string,
  startedMatchIds: ReadonlySet<string>,
): DrawGraph {
  if (graph.format !== 'KATA_RANKED') {
    throw new GroupChangeError('NOT_A_GROUP_DRAW', 'only a ranked kata group takes a late performer');
  }
  const order = performanceOrder(graph);
  if (order.includes(registrationId)) {
    throw new GroupChangeError('ALREADY_IN_DRAW', 'this athlete is already in the group');
  }

  // Lay the group out bout by bout as it stands, so no earlier athlete's bout or side moves.
  const layout: (string | null)[] = [];
  const bouts = [...graph.matches].sort((a, b) => a.matchNo - b.matchNo);
  for (const bout of bouts) {
    for (const position of [1, 2] as const) {
      layout.push(graph.slots.find((s) => s.matchId === bout.id && s.position === position)?.registrationId ?? null);
    }
  }

  // The newcomer joins the last bout if it is a solo that has not started, otherwise opens a new bout.
  const last = bouts[bouts.length - 1];
  const lastIsOpenSolo = last !== undefined && layout[layout.length - 1] === null && !startedMatchIds.has(last.id);
  if (lastIsOpenSolo) layout[layout.length - 1] = registrationId;
  else layout.push(registrationId);
  while (layout.length > 0 && layout[layout.length - 1] === null) layout.pop();

  const performers = layout.filter((id): id is string => id !== null).length;
  const kept = graph.warnings.filter((w) => w.code !== 'SINGLE_ENTRANT' && w.code !== 'TWO_ENTRANTS');
  return buildGraph(
    graph.categoryId,
    graph.rulesetId,
    layout,
    graph.randomSeed ?? 0,
    graph.bronzeMedals === 1 ? 1 : 2,
    [...entrantWarnings(performers), ...kept],
  );
}

function validate(input: RankedKataInput): Map<number, string> {
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

  const pinByPlace = new Map<number, string>();
  for (const [registrationId, place] of Object.entries(input.pins ?? {})) {
    if (!members.has(registrationId)) {
      issues.push(issue('PIN_NOT_A_MEMBER', `pins.${registrationId}`, `"${registrationId}" is pinned but not in the group`));
      continue;
    }
    if (!Number.isInteger(place) || place < 1 || place > count) {
      issues.push(issue('PIN_OUT_OF_RANGE', `pins.${registrationId}`, `place ${place} is outside the order of ${count}`));
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

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function arrange(input: RankedKataInput, pinByPlace: ReadonlyMap<number, string>, seed: number): Participant[] {
  const byRegistration = new Map(input.participants.map((p) => [p.registrationId, p]));
  const pinned = new Set(pinByPlace.values());
  const shuffled = shuffle(
    input.participants.filter((p) => !pinned.has(p.registrationId)).sort((a, b) => compareText(a.registrationId, b.registrationId)),
    createRng(seed),
  );

  const order: Participant[] = [];
  for (let place = 1; place <= input.participants.length; place += 1) {
    const pin = pinByPlace.get(place);
    order.push(pin !== undefined ? (byRegistration.get(pin) as Participant) : (shuffled.shift() as Participant));
  }
  return order;
}

/** Pairs (1 and 2, 3 and 4, ...) whose two athletes share a club. Athletes with no club never clash. */
function pairClashes(order: readonly Participant[]): number {
  let clashes = 0;
  for (let i = 0; i + 1 < order.length; i += 2) {
    const a = groupKeyOf(order[i], { by: 'CLUB', rule: 'FIRST_ROUND' });
    const b = groupKeyOf(order[i + 1], { by: 'CLUB', rule: 'FIRST_ROUND' });
    if (a !== null && a === b) clashes += 1;
  }
  return clashes;
}

/** `order` may hold a null: an empty side of a pair, kept so earlier bouts never shift. */
function buildGraph(
  categoryId: string,
  rulesetId: string,
  order: readonly (string | null)[],
  randomSeed: number,
  bronzeMedals: 1 | 2,
  warnings: readonly DrawWarning[],
): DrawGraph {
  const poolId = `${categoryId}:ranking`;
  const matches: MatchNode[] = [];
  const slots: SlotNode[] = [];

  for (let bout = 0; bout * 2 < order.length; bout += 1) {
    const matchNo = bout + 1;
    const matchId = matchIdFor(categoryId, matchNo);
    matches.push({
      id: matchId,
      matchNo,
      roundNo: 1,
      roundName: `${RANKED_POOL_NAME} · Bout ${matchNo}`,
      bracketType: 'POOL',
      poolId,
      slotIds: [slotIdFor(matchId, 1), slotIdFor(matchId, 2)],
      poolGroup: RANKED_POOL_NAME,
      kataScoringMode: 'POINTS',
      ...(matchNo === 1 ? { startStatus: 'READY' as const } : {}),
    });

    for (const position of [1, 2] as const) {
      const registrationId = order[bout * 2 + position - 1] ?? null;
      if (registrationId === null) continue;
      slots.push({
        id: slotIdFor(matchId, position),
        matchId,
        position,
        slotType: 'ENTRY',
        registrationId,
        sourceMatchId: null,
        repechageRule: null,
      });
    }
  }

  const performers = order.filter((id): id is string => id !== null);
  const body: Omit<DrawGraph, 'checksum'> = {
    categoryId,
    format: 'KATA_RANKED',
    rulesetId,
    tournamentSize: performers.length,
    byeCount: 0,
    bronzeMedals,
    randomSeed,
    rounds: [{ roundNo: 1, name: 'Performances', matchIds: matches.map((m) => m.id) }],
    matches,
    slots,
    pools: [{ id: poolId, name: RANKED_POOL_NAME, matchIds: matches.map((m) => m.id), registrationIds: performers }],
    warnings: [...warnings],
  };
  return { ...body, checksum: checksumOf(body) };
}
