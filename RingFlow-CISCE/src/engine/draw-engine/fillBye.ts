import { checksumOf } from './canonical';
import { GroupChangeError } from './errors';
import { entrantWarnings } from './generate';
import type { DrawGraph, SlotNode } from './types';

/**
 * Puts a late athlete into a first-round bye of a knockout group that is already
 * running: the athlete who had the bye now fights them instead of walking over.
 *
 * Allowed only while that athlete's next bout has not started, because their
 * walkover win would otherwise have to be undone after they fought on.
 * `startedMatchIds` are the group's bouts that are live or already decided by a
 * result. The bracket's shape never changes, so the repechage or bronze bouts
 * stay as they were; the caller stores the result as the next draw version.
 */
export function fillByeWithEntrant(
  graph: DrawGraph,
  slotId: string,
  registrationId: string,
  startedMatchIds: ReadonlySet<string>,
): DrawGraph {
  if (graph.format !== 'SINGLE_ELIM_REPECHAGE' || graph.pools.length > 0 || graph.flightDraw !== undefined) {
    throw new GroupChangeError('NOT_A_GROUP_DRAW', 'only a knockout bracket has byes to fill');
  }

  const slot = graph.slots.find((s) => s.id === slotId);
  const match = slot ? graph.matches.find((m) => m.id === slot.matchId) : undefined;
  if (slot === undefined || match === undefined) {
    throw new GroupChangeError('UNKNOWN_SLOT', 'that place is not in this bracket');
  }
  if (match.roundNo !== 0 || match.bracketType !== 'MAIN' || slot.slotType !== 'BYE') {
    throw new GroupChangeError('NOT_A_BYE', 'only a first-round bye can take a late athlete');
  }

  const inDraw = graph.slots.some(
    (s) => s.registrationId === registrationId && (s.slotType === 'ATHLETE' || s.slotType === 'ENTRY'),
  );
  if (inDraw) throw new GroupChangeError('ALREADY_IN_DRAW', 'this athlete is already in the bracket');

  const partner = graph.slots.find((s) => s.matchId === match.id && s.id !== slot.id);
  if (partner === undefined || partner.slotType !== 'ATHLETE' || partner.registrationId === null) {
    throw new GroupChangeError('NOT_A_BYE', 'that bout has nobody in it to fight');
  }

  if (startedMatchIds.has(match.id)) {
    throw new GroupChangeError('BOUT_STARTED', 'that bout has already started');
  }
  const next = graph.slots.find((s) => s.slotType === 'WINNER_OF' && s.sourceMatchId === match.id);
  if (next !== undefined && startedMatchIds.has(next.matchId)) {
    throw new GroupChangeError(
      'NEXT_BOUT_STARTED',
      'the athlete who had this bye has already fought their next bout',
    );
  }

  const slots: SlotNode[] = graph.slots.map((s) =>
    s.id === slot.id ? { ...s, slotType: 'ATHLETE', registrationId } : s,
  );

  const athletes = slots.filter((s) => s.slotType === 'ATHLETE' && s.registrationId !== null).length;
  const warnings = [
    ...entrantWarnings(athletes),
    ...graph.warnings.filter((w) => w.code !== 'SINGLE_ENTRANT' && w.code !== 'TWO_ENTRANTS'),
  ];

  const { checksum: _previous, ...rest } = graph;
  const body = { ...rest, slots, byeCount: graph.byeCount - 1, warnings };
  return { ...body, checksum: checksumOf(body) };
}
