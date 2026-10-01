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
  pools: KataPool[];
  finalFlight: {
    flightName: string;
    targetSlots: number;
    matches: KataGeneratedMatch[];
  };
  totalMatches: number;
}

/**
 * Generates a local/school Group Flight tournament draw for Kata.
 * Splits athletes across balanced groups (Pool A, Pool B, etc.) and schedules
 * paired AKA vs AO preliminary bouts and medal flight bouts (Gold + Bronze).
 */
export function generateKataFlightDraw(params: {
  categoryId: string;
  participants: KataFlightParticipant[];
  poolSize?: number;
  advancePerPool?: number;
  scoringMode?: 'FLAG' | 'POINTS';
  bronzeMedals?: 0 | 1 | 2;
}): KataFlightDrawResult {
  const {
    categoryId,
    participants,
    poolSize = 8,
    advancePerPool = 2,
    scoringMode = 'POINTS',
    bronzeMedals = 2,
  } = params;

  const totalAthletes = participants.length;
  // Calculate number of pools needed
  const numPools = Math.max(1, Math.ceil(totalAthletes / poolSize));
  const poolLetters = ['Pool A', 'Pool B', 'Pool C', 'Pool D', 'Pool E', 'Pool F', 'Pool G', 'Pool H'];

  // Fisher-Yates shuffle to ensure every regeneration produces a fresh, fair draw
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const poolBuckets: KataFlightParticipant[][] = Array.from({ length: numPools }, () => []);

  if (numPools > 1) {
    const clubMap = new Map<string, KataFlightParticipant[]>();
    shuffled.forEach((p) => {
      const club = p.school?.trim() || p.dojo?.trim() || `indep_${p.id}`;
      if (!clubMap.has(club)) clubMap.set(club, []);
      clubMap.get(club)!.push(p);
    });

    let roundRobinIdx = Math.floor(Math.random() * numPools);
    // Distribute sorted by club size so larger clubs are distributed across pools first
    const sortedClubs = Array.from(clubMap.values()).sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return Math.random() - 0.5;
    });
    sortedClubs.forEach((clubMembers) => {
      clubMembers.forEach((member) => {
        poolBuckets[roundRobinIdx % numPools].push(member);
        roundRobinIdx++;
      });
    });
  } else {
    poolBuckets[0] = shuffled;
  }

  // Shuffle within each pool bucket to randomize pairing
  poolBuckets.forEach((bucket) => {
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
    }
  });

  // Build pools from balanced buckets
  const pools: KataPool[] = [];
  let globalMatchCounter = 1;

  for (let p = 0; p < numPools; p++) {
    const poolName = poolLetters[p] || `Pool ${p + 1}`;
    const poolId = `${categoryId}-p${p + 1}`;
    const poolAthletes: KataPoolAthlete[] = [];
    const poolMatches: KataGeneratedMatch[] = [];
    const poolParticipants = poolBuckets[p];

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
      const aka = poolParticipants[i];
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
    pools,
    finalFlight: {
      flightName: 'Final Championship Flight',
      targetSlots: finalMatches.length,
      matches: finalMatches,
    },
    totalMatches: globalMatchCounter - 1,
  };
}
