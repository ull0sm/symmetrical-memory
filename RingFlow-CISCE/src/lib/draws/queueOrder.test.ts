import { describe, expect, it } from 'vitest';
import { sequenceQueue, type QueueItem } from './queueOrder';

const item = (key: string, queueOrder: number, extra: Partial<QueueItem> = {}): QueueItem => ({
  key,
  queueOrder,
  onMat: false,
  placed: true,
  ...extra,
});

const order = (items: QueueItem[]) => [...sequenceQueue(items)].sort((a, b) => a[1] - b[1]).map(([key]) => key);

describe('sequenceQueue', () => {
  it('numbers cards consecutively in their dropped order', () => {
    expect(order([item('b', 5), item('a', 2), item('c', 9)])).toEqual(['a', 'b', 'c']);
    expect([...sequenceQueue([item('b', 5), item('a', 2)]).values()].sort()).toEqual([0, 1]);
  });

  it('keeps an untouched pool card between the cards around it', () => {
    const result = order([item('x', 0), item('pool', 1, { placed: false }), item('y', 2)]);
    expect(result).toEqual(['x', 'pool', 'y']);
  });

  it('puts a placed card first when it claims the same position as an untouched one', () => {
    const result = order([item('pool', 0, { placed: false }), item('x', 0)]);
    expect(result).toEqual(['x', 'pool']);
  });

  it('keeps a category on the mat first, placed or not', () => {
    expect(order([item('x', 0), item('pool', 3, { placed: false, onMat: true })])).toEqual(['pool', 'x']);
    expect(order([item('x', 0), item('run', 5, { onMat: true })])).toEqual(['run', 'x']);
  });

  it('is deterministic for equal positions', () => {
    const a = order([item('b', 1), item('a', 1)]);
    const b = order([item('a', 1), item('b', 1)]);
    expect(a).toEqual(b);
  });

  it('handles an empty queue', () => {
    expect(sequenceQueue([]).size).toBe(0);
  });
});
