/** One card in a tatami's queue while the queue is being rewritten. */
export interface QueueItem {
  key: string;
  /** Where the card sits now, or where the admin dropped it. */
  queueOrder: number;
  /** A category on the mat (running or paused) always stays first. */
  onMat: boolean;
  /** True for a card the admin just placed; false for one the save did not mention. */
  placed: boolean;
}

/**
 * Gives a tatami's cards consecutive queue positions 0, 1, 2, ... in their intended order.
 *
 * A save from the balancing board only places whole categories. Cards it does not mention (the
 * pools of a split category that run on this tatami) keep their place relative to the others, so
 * neither side can collide with the other on the unique (tatami, position) key. A category on
 * the mat stays first; where a placed card and an untouched card claim the same position, the
 * placed card goes first.
 */
export function sequenceQueue(items: readonly QueueItem[]): Map<string, number> {
  const ordered = [...items].sort(
    (a, b) =>
      Number(b.onMat) - Number(a.onMat) ||
      a.queueOrder - b.queueOrder ||
      Number(b.placed) - Number(a.placed) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
  return new Map(ordered.map((item, index) => [item.key, index]));
}
