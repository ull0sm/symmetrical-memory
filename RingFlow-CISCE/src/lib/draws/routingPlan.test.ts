import { describe, expect, it } from 'vitest';
import { planRouting, returnsToQueue, statusForNewPart, type RouteCard } from './routingPlan';

const card = (part: string, ringId: string, extra: Partial<RouteCard> = {}): RouteCard => ({
  part,
  ringId,
  status: 'pending',
  live: 0,
  liveBoutNos: [],
  fought: 0,
  total: 15,
  ...extra,
});

const whole = (ringId = 'A', extra: Partial<RouteCard> = {}) => [card('ALL', ringId, { total: 71, ...extra })];
const split = (extra: Record<string, Partial<RouteCard>> = {}) => [
  card('POOL:1', 'A', extra['POOL:1']),
  card('POOL:2', 'A', extra['POOL:2']),
  card('POOL:3', 'B', extra['POOL:3']),
  card('POOL:4', 'B', extra['POOL:4']),
  card('FINALS', 'A', { total: 11, ...extra['FINALS'] }),
];
const SPLIT = { kind: 'SPLIT', poolRingIds: ['A', 'A', 'B', 'B'], finalsRingId: 'A' } as const;

describe('planRouting: a whole category', () => {
  it('is split even after bouts have been fought', () => {
    const plan = planRouting(whole('A', { fought: 9 }), SPLIT, 4);
    expect(plan).toEqual({ ok: true, actions: [{ type: 'SPLIT', poolRingIds: ['A', 'A', 'B', 'B'], finalsRingId: 'A' }] });
  });

  it('is not split while a bout is live, and the message names the bout', () => {
    const plan = planRouting(whole('A', { live: 1, liveBoutNos: [12] }), SPLIT, 4);
    expect(plan.ok).toBe(false);
    expect(plan.ok === false && plan.error).toContain('#12');
  });

  it('cannot be split when finished, or when the draw has one pool, or with the wrong number of tatamis', () => {
    expect(planRouting(whole('A', { status: 'completed' }), SPLIT, 4).ok).toBe(false);
    expect(planRouting(whole(), SPLIT, null).ok).toBe(false);
    expect(planRouting(whole(), { kind: 'SPLIT', poolRingIds: ['A', 'B'], finalsRingId: 'A' }, 4).ok).toBe(false);
  });

  it('moves to another tatami between bouts, and not while a bout is live', () => {
    expect(planRouting(whole('A'), { kind: 'WHOLE', ringId: 'B' }, 4)).toEqual({ ok: true, actions: [{ type: 'MOVE', part: 'ALL', toRingId: 'B' }] });
    expect(planRouting(whole('A', { status: 'running' }), { kind: 'WHOLE', ringId: 'B' }, 4).ok).toBe(true);
    expect(planRouting(whole('A', { live: 1 }), { kind: 'WHOLE', ringId: 'B' }, 4).ok).toBe(false);
  });

  it('has nothing to do when it stays where it is, and is assigned when it had no card', () => {
    expect(planRouting(whole('A'), { kind: 'WHOLE', ringId: 'A' }, 4)).toEqual({ ok: true, actions: [] });
    expect(planRouting([], { kind: 'WHOLE', ringId: 'A' }, 4)).toEqual({ ok: true, actions: [{ type: 'ASSIGN', ringId: 'A' }] });
  });
});

describe('planRouting: a split category', () => {
  it('moves only the parts whose tatami changed', () => {
    const plan = planRouting(split(), { kind: 'SPLIT', poolRingIds: ['A', 'B', 'B', 'B'], finalsRingId: 'B' }, 4);
    expect(plan).toEqual({
      ok: true,
      actions: [
        { type: 'MOVE', part: 'POOL:2', toRingId: 'B' },
        { type: 'MOVE', part: 'FINALS', toRingId: 'B' },
      ],
    });
  });

  it('changes nothing when the routing is unchanged', () => {
    expect(planRouting(split(), SPLIT, 4)).toEqual({ ok: true, actions: [] });
  });

  it('lets fought pools move: results stay on the bouts', () => {
    const plan = planRouting(split({ 'POOL:3': { fought: 8 } }), { kind: 'SPLIT', poolRingIds: ['A', 'A', 'A', 'B'], finalsRingId: 'A' }, 4);
    expect(plan).toEqual({ ok: true, actions: [{ type: 'MOVE', part: 'POOL:3', toRingId: 'A' }] });
  });

  it('refuses to move a part with a live bout, but moves the others', () => {
    const state = split({ 'POOL:3': { live: 1, liveBoutNos: [40], status: 'running' } });
    const blocked = planRouting(state, { kind: 'SPLIT', poolRingIds: ['A', 'A', 'A', 'B'], finalsRingId: 'A' }, 4);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.error).toContain('Pool 3');
    const other = planRouting(state, { kind: 'SPLIT', poolRingIds: ['B', 'A', 'B', 'B'], finalsRingId: 'A' }, 4);
    expect(other.ok).toBe(true);
  });

  it('lets a part on a mat between bouts move (it goes back to the queue)', () => {
    const state = split({ 'POOL:3': { status: 'running' } });
    expect(planRouting(state, { kind: 'SPLIT', poolRingIds: ['A', 'A', 'A', 'B'], finalsRingId: 'A' }, 4).ok).toBe(true);
    expect(returnsToQueue({ status: 'running' })).toBe(true);
    expect(returnsToQueue({ status: 'pending' })).toBe(false);
  });

  it('keeps a finished pool on the tatami that ran it', () => {
    const plan = planRouting(split({ 'POOL:1': { status: 'completed' } }), { kind: 'SPLIT', poolRingIds: ['B', 'A', 'B', 'B'], finalsRingId: 'A' }, 4);
    expect(plan.ok).toBe(false);
  });

  it('is put back together when nothing is live, and not while something is', () => {
    expect(planRouting(split({ 'POOL:2': { fought: 15, status: 'completed' } }), { kind: 'WHOLE', ringId: 'A' }, 4)).toEqual({
      ok: true,
      actions: [{ type: 'MERGE', ringId: 'A' }],
    });
    expect(planRouting(split({ FINALS: { live: 1, liveBoutNos: [66] } }), { kind: 'WHOLE', ringId: 'A' }, 4).ok).toBe(false);
  });

  it('rejects a routing for a different number of pools', () => {
    expect(planRouting(split(), { kind: 'SPLIT', poolRingIds: ['A', 'B'], finalsRingId: 'A' }, 4).ok).toBe(false);
  });
});

describe('statusForNewPart', () => {
  it('marks a pool whose bouts were all fought as finished, and others as waiting', () => {
    expect(statusForNewPart({ fought: 15, total: 15 })).toBe('completed');
    expect(statusForNewPart({ fought: 9, total: 15 })).toBe('pending');
    expect(statusForNewPart({ fought: 0, total: 0 })).toBe('pending');
  });
});
