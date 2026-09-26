/**
 * RingFlow-CISCE Kata Scoring Engine
 *
 * Implements official WKF and grassroots deduction algorithms:
 * - 5-Judge System: Drops 1 highest and 1 lowest mark; sums the 3 middle marks.
 * - 3-Judge System: Sums all 3 marks directly (no drops).
 * - 7-Judge System: Drops 2 highest and 2 lowest marks; sums the 3 middle marks.
 * - Flag System: Simple majority (3/5 or 2/3).
 */

export interface DeducingResult {
  total: number;
  hasSufficientMarks: boolean;
  droppedIndices: number[]; // Indices of dropped marks (e.g. [1, 3])
  keptScores: number[];
  judgeCount: number;
}

export function calculateKataScoreDeducing(
  scores: (number | string | null | undefined)[]
): DeducingResult {
  const validScores: { score: number; originalIndex: number }[] = [];

  scores.forEach((s, idx) => {
    const num = typeof s === "string" ? parseFloat(s) : s;
    if (typeof num === "number" && !isNaN(num) && num > 0) {
      validScores.push({ score: Number(num.toFixed(2)), originalIndex: idx });
    }
  });

  const count = validScores.length;
  // If fewer than 3 judges have entered scores, score cannot be calculated
  if (count < 3) {
    return {
      total: 0,
      hasSufficientMarks: false,
      droppedIndices: [],
      keptScores: validScores.map((v) => v.score),
      judgeCount: count,
    };
  }

  // Determine number of marks to drop from each extreme
  let dropEachSide = 0;
  if (count >= 7) {
    dropEachSide = 2; // Drop 2 highest, 2 lowest (WKF Premier League)
  } else if (count >= 5) {
    dropEachSide = 1; // Drop 1 highest, 1 lowest (WKF Standard 5-Judge)
  } else {
    dropEachSide = 0; // 3 or 4 judges: Sum all (grassroots/local)
  }

  if (dropEachSide === 0) {
    const total = validScores.reduce((acc, curr) => acc + curr.score, 0);
    return {
      total: Number(total.toFixed(2)),
      hasSufficientMarks: true,
      droppedIndices: [],
      keptScores: validScores.map((v) => v.score),
      judgeCount: count,
    };
  }

  // Sort by score ascending to accurately pick min and max
  const sorted = [...validScores].sort((a, b) => a.score - b.score);
  const droppedLow = sorted.slice(0, dropEachSide);
  const droppedHigh = sorted.slice(sorted.length - dropEachSide);

  const droppedIndicesSet = new Set<number>();
  droppedLow.forEach((d) => droppedIndicesSet.add(d.originalIndex));
  droppedHigh.forEach((d) => droppedIndicesSet.add(d.originalIndex));

  const kept = sorted.slice(dropEachSide, sorted.length - dropEachSide);
  const total = kept.reduce((acc, curr) => acc + curr.score, 0);

  return {
    total: Number(total.toFixed(2)),
    hasSufficientMarks: true,
    droppedIndices: Array.from(droppedIndicesSet),
    keptScores: kept.map((k) => k.score),
    judgeCount: count,
  };
}
