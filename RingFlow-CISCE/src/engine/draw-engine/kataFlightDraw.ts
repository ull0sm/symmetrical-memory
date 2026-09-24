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
 * the preliminary flight and final elimination championship flight.
 */
export function generateKataFlightDraw(params: {
  categoryId: string;
  participants: KataFlightParticipant[];
  poolSize?: number;
  advancePerPool?: number;
  scoringMode?: 'FLAG' | 'POINTS';
}): KataFlightDrawResult {
  const {
    categoryId,
    participants,
    poolSize = 8,
    advancePerPool = 2,
    scoringMode = 'FLAG',
  } = params;

  const totalAthletes = participants.length;
  // Calculate number of pools needed
  const numPools = Math.max(1, Math.ceil(totalAthletes / poolSize));
  const poolLetters = ['Pool A', 'Pool B', 'Pool C', 'Pool D', 'Pool E', 'Pool F'];

  const pools: KataPool[] = [];
  let globalMatchCounter = 1;

  // Distribute athletes into pools (snake distribution or round-robin balance)
  for (let p = 0; p < numPools; p++) {
    const poolName = poolLetters[p] || `Pool ${p + 1}`;
    const poolId = `${categoryId}-p${p + 1}`;
    const poolAthletes: KataPoolAthlete[] = [];
    const poolMatches: KataGeneratedMatch[] = [];

    // Slice participants for this pool
    const startIndex = p * poolSize;
    const poolParticipants = participants.slice(startIndex, startIndex + poolSize);

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

      // Generate a match row for this performance
      poolMatches.push({
        id: `${categoryId}-m${globalMatchCounter}`,
        matchNo: globalMatchCounter,
        roundNo: 1,
        roundName: `${poolName} - Performance #${orderNo}`,
        bracketType: 'POOL',
        poolGroup: poolName,
        status: globalMatchCounter === 1 ? 'READY' : 'SCHEDULED',
        athleteId: athlete.id,
        athleteName: athlete.name,
        akaAthleteId: athlete.id, // Primary performer
        kataScoringMode: scoringMode,
      });

      globalMatchCounter++;
    });

    pools.push({
      poolId,
      poolName,
      athletes: poolAthletes,
      matches: poolMatches,
    });
  }

  // Generate Final Flight (Top advancePerPool from each pool)
  const finalSlotsCount = Math.min(totalAthletes, numPools * advancePerPool);
  const finalMatches: KataGeneratedMatch[] = [];

  for (let f = 1; f <= finalSlotsCount; f++) {
    finalMatches.push({
      id: `${categoryId}-m${globalMatchCounter}`,
      matchNo: globalMatchCounter,
      roundNo: 2,
      roundName: `Final Championship Flight - #${f}`,
      bracketType: 'MAIN',
      poolGroup: 'Final Flight',
      status: 'SCHEDULED',
      kataScoringMode: scoringMode,
    });
    globalMatchCounter++;
  }

  return {
    categoryId,
    format: 'KATA_GROUP_POOLS',
    scoringMode,
    poolSize,
    advancePerPool,
    pools,
    finalFlight: {
      flightName: 'Final Championship Flight',
      targetSlots: finalSlotsCount,
      matches: finalMatches,
    },
    totalMatches: globalMatchCounter - 1,
  };
}
