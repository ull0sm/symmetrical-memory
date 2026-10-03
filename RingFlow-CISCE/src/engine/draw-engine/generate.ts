import type { Ruleset } from '@event-suite/rules-engine';
import { checksumOf } from './canonical';
import { DrawInputError, type DrawInputIssue } from './errors';
import { buildEliminationBracket } from './placement';
import { buildRepechage, REPECHAGE_ROUND_NAME } from './repechage';
import { deriveSeed, orderParticipants } from './seeding';
import { applySeparation, separationPenalty } from './separation';
import { byeCount, nextPowerOfTwo, totalRounds } from './sizing';
import type { DrawGraph, DrawInput, DrawWarning, Participant } from './types';
import { collectInputIssues } from './validation';

/**
 * Generates a locked-ready draw for one category.
 *
 * Pure and deterministic: the same input, ruleset and `randomSeed` always
 * produce the same graph, and therefore the same checksum. Nothing here reads a
 * clock, a random source or the filesystem, and IDs are derived from the
 * category and match number rather than generated.
 */
export function generateDraw(input: DrawInput, ruleset: Ruleset): DrawGraph {
  const issues: DrawInputIssue[] = collectInputIssues(input, ruleset);

  if (issues.length > 0) {
    throw new DrawInputError(issues);
  }

  const baseSeed = input.seeding.randomSeed;
  const canVary = input.separation !== undefined && baseSeed !== undefined && input.seeding.mode !== 'NONE';

  if (!canVary || baseSeed === undefined) {
    return buildOnce(input, ruleset, baseSeed);
  }

  // Random draws are tried from a few seeds derived from the stored one, and the
  // one that keeps group-mates apart longest wins. The attempts are a pure
  // function of the stored seed, so the draw is still reproducible from it.
  let best: { graph: DrawGraph; penalty: number } | null = null;

  for (let attempt = 0; attempt < SEPARATION_ATTEMPTS; attempt += 1) {
    const candidate = buildOnce(input, ruleset, attempt === 0 ? baseSeed : deriveSeed(baseSeed, attempt), baseSeed);
    const penalty = penaltyOf(candidate, input);

    if (best === null || penalty < best.penalty) {
      best = { graph: candidate, penalty };
    }

    if (penalty === 0) break;
  }

  return (best as { graph: DrawGraph }).graph;
}

/** Candidate draws tried per generation when separating groups. */
const SEPARATION_ATTEMPTS = 24;

function penaltyOf(graph: DrawGraph, input: DrawInput): number {
  if (input.separation === undefined) return 0;

  const participantByRegistration = new Map(
    input.participants.map((participant) => [participant.registrationId, participant]),
  );

  return separationPenalty(
    graph.slots,
    graph.matches.filter((match) => match.bracketType === 'MAIN'),
    participantByRegistration,
    input.separation,
    totalRounds(graph.tournamentSize),
  );
}

/**
 * One complete draw. `orderingSeed` drives the shuffle; `reportedSeed` is the
 * seed stored on the graph (the caller's own, even when an attempt derived another).
 */
function buildOnce(
  input: DrawInput,
  ruleset: Ruleset,
  orderingSeed: number | undefined,
  reportedSeed: number | undefined = orderingSeed,
): DrawGraph {
  const issues: DrawInputIssue[] = [];
  const seeding =
    orderingSeed === undefined ? input.seeding : { ...input.seeding, randomSeed: orderingSeed };

  const warnings: DrawWarning[] = [];
  const ordered = orderParticipants(input.participants, seeding, issues, warnings);

  if (issues.length > 0) {
    throw new DrawInputError(issues);
  }

  const entrantCount = input.participants.length;
  const size = nextPowerOfTwo(entrantCount);
  const byes = byeCount(entrantCount);

  warnings.push(...entrantWarnings(entrantCount));

  const participantBySeed = new Map<number, Participant>();
  for (const item of ordered) {
    participantBySeed.set(item.seed, item.participant);
  }

  const build = buildEliminationBracket(input.categoryId, participantBySeed, size);

  // Repechage is what makes a karate category award two bronzes. A format
  // without it, or an organiser who asked for no bronze at all, gets neither
  // the ladder nor the bronze bouts.
  const roundsTotal = totalRounds(size);
  const bronzeMedals = input.options?.bronzeMedals ?? 2;
  const awardsBronze = bronzeMedals === 1 || bronzeMedals === 2 || bronzeMedals === 3;
  const repechage =
    input.format === 'SINGLE_ELIM_REPECHAGE' && awardsBronze
      ? buildRepechage(input.categoryId, {
          roundsTotal,
          bronzeMedals,
          firstMatchNo: build.matches.length + 1,
        })
      : { matches: [], slots: [] };

  const matches = [...build.matches, ...repechage.matches];
  const slots = [...build.slots, ...repechage.slots];

  const rounds =
    repechage.matches.length === 0
      ? build.rounds
      : [
          ...build.rounds,
          {
            roundNo: roundsTotal,
            name: REPECHAGE_ROUND_NAME,
            matchIds: repechage.matches.map((match) => match.id),
          },
        ];

  if (input.separation !== undefined) {
    const participantByRegistration = new Map(
      ordered.map((item) => [item.participant.registrationId, item.participant]),
    );
    const protectedRegistrations = new Set(
      ordered
        .filter((item) => item.explicitSeed)
        .map((item) => item.participant.registrationId),
    );

    applySeparation(
      build.slots,
      build.matches,
      participantByRegistration,
      input.separation,
      protectedRegistrations,
      warnings,
    );
  }

  const body: Omit<DrawGraph, 'checksum'> = {
    categoryId: input.categoryId,
    format: input.format,
    rulesetId: ruleset.id,
    tournamentSize: size,
    byeCount: byes,
    bronzeMedals,
    randomSeed: input.seeding.mode === 'NONE' ? null : (reportedSeed ?? null),
    rounds,
    matches,
    slots,
    pools: [],
    warnings,
  };

  return { ...body, checksum: checksumOf(body) };
}

export function entrantWarnings(entrantCount: number): DrawWarning[] {
  if (entrantCount === 1) {
    return [
      {
        code: 'SINGLE_ENTRANT',
        message: 'only one entrant: the category has no contest and should be reviewed',
      },
    ];
  }

  if (entrantCount === 2) {
    return [
      {
        code: 'TWO_ENTRANTS',
        message: 'only two entrants: the category is a single bout between them',
      },
    ];
  }

  return [];
}
