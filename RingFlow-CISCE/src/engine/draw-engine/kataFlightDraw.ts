import { createRng, shuffle } from './seeding';
import type { DrawWarning } from './types';

export interface KataFlightParticipant {
  id: string;
  name: string;
  chestNumber?: string | null;
  school?: string | null;
  dojo?: string | null;
  seed?: number | null;
}

export interface KataPoolAthlete {
  orderNo: number;
  athleteId: string;
  name: string;
  chestNumber?: string | null;
  school?: string | null;
  dojo?: string | null;
  kataName?: string;
  scores?: number[];
  totalScore?: number | null;
  rank?: number | null;
  isQualified?: boolean;
}

export interface KataPool {
  poolId: string;
  poolName: string; // e.g. "Pool A", "Pool B"
  athletes: KataPoolAthlete[];
  matches: KataGeneratedMatch[];
}

export interface KataGeneratedMatch {
  id: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: 'POOL' | 'MAIN' | 'BRONZE';
  poolGroup: string;
  status: 'SCHEDULED' | 'READY' | 'COMPLETED';
  athleteId?: string; // Solo performance
  athleteName?: string;
  akaAthleteId?: string; // If 1v1 flags
  aoAthleteId?: string;
  kataScoringMode: 'FLAG' | 'POINTS';
}

export interface KataFlightDrawResult {
  categoryId: string;
  format: 'KATA_GROUP_POOLS';
  scoringMode: 'FLAG' | 'POINTS';
  poolSize: number;
  advancePerPool: number;
  bronzeMedals: 0 | 1 | 2;
  /** The seed this draw was made from; the same seed and roster give the same draw. */
  randomSeed: number;
  pools: KataPool[];
  finalFlight: {
    flightName: string;
    targetSlots: number;
    matches: KataGeneratedMatch[];
  };
  totalMatches: number;
  warnings: DrawWarning[];
}

export interface KataFlightParams {
  categoryId: string;
  participants: KataFlightParticipant[];
  poolSize?: number;
  advancePerPool?: number;
  scoringMode?: 'FLAG' | 'POINTS';
  bronzeMedals?: 0 | 1 | 2;
  /** Required: a kata draw must be reproducible from the seed stored with it. */
  randomSeed: number;
  /** Keep athletes from one club out of the same pool bout, and spread each club across the pools. Default true. */
  separateClubs?: boolean;
}

/** Candidate draws tried when separating clubs; the best (fewest club clashes) wins. */
const SEPARATION_ATTEMPTS = 24;

/** Club key for separation: case/space-insensitive, and an athlete with no club is their own club. */
function clubOf(p: KataFlightParticipant): string {
  const name = (p.school?.trim() || p.dojo?.trim() || '').toLowerCase();
  return name === '' ? `independent:${p.id}` : name;
}

function deriveSeed(base: number, attempt: number): number {
  return (base + Math.imul(attempt, 0x9e3779b1)) >>> 0;
}

/** Splits athletes into pool buckets, then orders each bucket (neighbours become a bout). */
function distribute(
  participants: readonly KataFlightParticipant[],
  numPools: number,
  seed: number,
  spreadClubs: boolean,
): KataFlightParticipant[][] {
  const rng = createRng(seed);
  const shuffled = shuffle(participants, rng);
  const buckets: KataFlightParticipant[][] = Array.from({ length: numPools }, () => []);

  if (numPools > 1 && spreadClubs) {
    const clubs = new Map<string, KataFlightParticipant[]>();
    for (const p of shuffled) {
      const key = clubOf(p);
      const list = clubs.get(key) ?? [];
      list.push(p);
      clubs.set(key, list);
    }

    // Biggest clubs first so they are spread across the pools before the small ones fill the gaps.
    const ordered = Array.from(clubs.values())
      .map((members) => ({ members, tie: rng() }))
      .sort((a, b) => b.members.length - a.members.length || a.tie - b.tie);

    let next = Math.floor(rng() * numPools);
    for (const { members } of ordered) {
      for (const member of members) {
        (buckets[next % numPools] as KataFlightParticipant[]).push(member);
        next += 1;
      }
    }
  } else if (numPools > 1) {
    shuffled.forEach((p, i) => (buckets[i % numPools] as KataFlightParticipant[]).push(p));
  } else {
    buckets[0] = shuffled;
  }

  return buckets.map((bucket) => shuffle(bucket, rng));
}

/** Bouts that put two athletes from one club against each other, summed over the pools. */
function clubClashes(buckets: readonly KataFlightParticipant[][]): number {
  let clashes = 0;
  for (const bucket of buckets) {
    for (let i = 0; i + 1 < bucket.length; i += 2) {
      if (clubOf(bucket[i] as KataFlightParticipant) === clubOf(bucket[i + 1] as KataFlightParticipant)) clashes += 1;
    }
  }
  return clashes;
}

/**
 * Generates a local/school Group Flight tournament draw for Kata.
 * Splits athletes across balanced groups (Pool A, Pool B, etc.) and schedules
 * paired AKA vs AO preliminary bouts and medal flight bouts (Gold + Bronze).
 *
 * Pure and deterministic: the same participants, options and `randomSeed` always
 * give the same draw. Round names are load-bearing (pool advancement matches on
 * "Pool A #2", "Bout 1" and so on), so they are kept exactly as they are.
 */
export function generateKataFlightDraw(params: KataFlightParams): KataFlightDrawResult {
  const {
    categoryId,
    participants,
    poolSize = 8,
    advancePerPool = 2,
    scoringMode = 'POINTS',
    bronzeMedals = 2,
    randomSeed,
    separateClubs = true,
  } = params;

  const totalAthletes = participants.length;
  // The medal flight pairs Pool A against Pool B, so a category is split into
  // at most two pools; a large category just gets larger pools.
  const numPools = Math.min(2, Math.max(1, Math.ceil(totalAthletes / poolSize)));
  const poolLetters = ['Pool A', 'Pool B', 'Pool C', 'Pool D', 'Pool E', 'Pool F', 'Pool G', 'Pool H'];

  const warnings: DrawWarning[] = [];

  if (Math.ceil(totalAthletes / numPools) > poolSize) {
    warnings.push({
      code: 'POOL_LARGER_THAN_SETTING',
      message: `${totalAthletes} athletes need pools of ${Math.ceil(totalAthletes / numPools)}, more than the pool size of ${poolSize}: a kata flight is split into two pools at most`,
    });
  }

  // Candidate draws from seeds derived from the stored one; keep the one with the fewest club clashes.
  const attempts = separateClubs ? SEPARATION_ATTEMPTS : 1;
  let poolBuckets: KataFlightParticipant[][] = [];
  let bestClashes = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = distribute(
      participants,
      numPools,
      attempt === 0 ? randomSeed : deriveSeed(randomSeed, attempt),
      separateClubs,
    );
    const clashes = separateClubs ? clubClashes(candidate) : 0;

    if (clashes < bestClashes) {
      bestClashes = clashes;
      poolBuckets = candidate;
    }

    if (clashes === 0) break;
  }

  if (separateClubs && bestClashes > 0) {
    warnings.push({
      code: 'SEPARATION_IMPOSSIBLE',
      message: `${bestClashes} pool bout(s) put athletes from the same club against each other and could not be avoided`,
    });
  }

  // Build pools from balanced buckets
  const pools: KataPool[] = [];
  let globalMatchCounter = 1;

  for (let p = 0; p < numPools; p++) {
    const poolName = poolLetters[p] || `Pool ${p + 1}`;
    const poolId = `${categoryId}-p${p + 1}`;
    const poolAthletes: KataPoolAthlete[] = [];
    const poolMatches: KataGeneratedMatch[] = [];
    const poolParticipants = poolBuckets[p] ?? [];

    poolParticipants.forEach((athlete, index) => {
      const orderNo = index + 1;
      poolAthletes.push({
        orderNo,
        athleteId: athlete.id,
        name: athlete.name,
        chestNumber: athlete.chestNumber,
        school: athlete.school,
        dojo: athlete.dojo,
      });
    });

    // Pair athletes within this pool into AKA (Red) vs AO (Blue) bouts
    for (let i = 0; i < poolParticipants.length; i += 2) {
      const aka = poolParticipants[i] as KataFlightParticipant;
      const ao = poolParticipants[i + 1] || null;
      const boutNoInPool = Math.floor(i / 2) + 1;

      poolMatches.push({
        id: `${categoryId}-m${globalMatchCounter}`,
        matchNo: globalMatchCounter,
        roundNo: 1,
        roundName: ao
          ? `${poolName} · Bout #${boutNoInPool}: ${aka.name} vs ${ao.name}`
          : `${poolName} · Bout #${boutNoInPool}: ${aka.name} (Solo / Bye)`,
        bracketType: 'POOL',
        poolGroup: poolName,
        status: globalMatchCounter === 1 ? 'READY' : 'SCHEDULED',
        athleteId: aka.id,
        athleteName: aka.name,
        akaAthleteId: aka.id,
        aoAthleteId: ao ? ao.id : undefined,
        kataScoringMode: scoringMode,
      });

      globalMatchCounter++;
    }

    pools.push({
      poolId,
      poolName,
      athletes: poolAthletes,
      matches: poolMatches,
    });
  }

  // Generate Medal Flight (Gold & Bronze matches)
  const finalMatches: KataGeneratedMatch[] = [];

  if (numPools >= 2) {
    // 1. Bronze Medal Matches (contested before final)
    if (bronzeMedals === 1) {
      finalMatches.push({
        id: `${categoryId}-m${globalMatchCounter}`,
        matchNo: globalMatchCounter,
        roundNo: 2,
        roundName: `Bronze Medal Match: Pool A #2 vs Pool B #2`,
        bracketType: 'BRONZE',
        poolGroup: 'Final Flight',
        status: 'SCHEDULED',
        kataScoringMode: scoringMode,
      });
      globalMatchCounter++;
    } else if (bronzeMedals === 2) {
      finalMatches.push({
        id: `${categoryId}-m${globalMatchCounter}`,
        matchNo: globalMatchCounter,
        roundNo: 2,
        roundName: `Bronze Medal Bout 1: Pool A #2 vs Pool B #3`,
        bracketType: 'BRONZE',
        poolGroup: 'Final Flight',
        status: 'SCHEDULED',
        kataScoringMode: scoringMode,
      });
      globalMatchCounter++;

      finalMatches.push({
        id: `${categoryId}-m${globalMatchCounter}`,
        matchNo: globalMatchCounter,
        roundNo: 2,
        roundName: `Bronze Medal Bout 2: Pool B #2 vs Pool A #3`,
        bracketType: 'BRONZE',
        poolGroup: 'Final Flight',
        status: 'SCHEDULED',
        kataScoringMode: scoringMode,
      });
      globalMatchCounter++;
    }

    // 2. Gold Medal Final (Pool A #1 vs Pool B #1)
    finalMatches.push({
      id: `${categoryId}-m${globalMatchCounter}`,
      matchNo: globalMatchCounter,
      roundNo: 3,
      roundName: `Final Championship Match (Gold / Silver): Pool A #1 vs Pool B #1`,
      bracketType: 'MAIN',
      poolGroup: 'Final Flight',
      status: 'SCHEDULED',
      kataScoringMode: scoringMode,
    });
    globalMatchCounter++;
  } else if (totalAthletes >= 2) {
    // Single pool with 2+ athletes
    finalMatches.push({
      id: `${categoryId}-m${globalMatchCounter}`,
      matchNo: globalMatchCounter,
      roundNo: 2,
      roundName: `Final Championship Match: Pool Rank 1 vs Pool Rank 2`,
      bracketType: 'MAIN',
      poolGroup: 'Final Flight',
      status: 'SCHEDULED',
      kataScoringMode: scoringMode,
    });
    globalMatchCounter++;

    if (bronzeMedals >= 1 && totalAthletes >= 4) {
      finalMatches.push({
        id: `${categoryId}-m${globalMatchCounter}`,
        matchNo: globalMatchCounter,
        roundNo: 2,
        roundName: `Bronze Medal Match: Pool Rank 3 vs Pool Rank 4`,
        bracketType: 'BRONZE',
        poolGroup: 'Final Flight',
        status: 'SCHEDULED',
        kataScoringMode: scoringMode,
      });
      globalMatchCounter++;
    }
  }

  return {
    categoryId,
    format: 'KATA_GROUP_POOLS',
    scoringMode,
    poolSize,
    advancePerPool,
    bronzeMedals,
    randomSeed,
    pools,
    finalFlight: {
      flightName: 'Final Championship Flight',
      targetSlots: finalMatches.length,
      matches: finalMatches,
    },
    totalMatches: globalMatchCounter - 1,
    warnings,
  };
}
