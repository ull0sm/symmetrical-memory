import type { DrawWarning, MatchNode, Participant, SeparationOptions, SlotNode } from './types';

/**
 * Separates entrants who share a club or district in the first round.
 *
 * Local categories are frequently dominated by one or two clubs, so without
 * this two team-mates can meet in the first bout. Swapping is deliberately
 * restricted to entrants who were *not* explicitly seeded: moving a seed to fix
 * a clash would silently contradict the organiser's own seeding.
 *
 * If the constraint cannot be satisfied the function reports it rather than
 * quietly producing a bad draw.
 */
export function applySeparation(
  slots: SlotNode[],
  matches: readonly MatchNode[],
  participantByRegistration: ReadonlyMap<string, Participant>,
  options: SeparationOptions,
  protectedRegistrations: ReadonlySet<string>,
  warnings: DrawWarning[],
): void {
  const firstRound = matches.filter((match) => match.roundNo === 0);
  const slotByMatchAndPosition = new Map<string, SlotNode>();

  for (const slot of slots) {
    slotByMatchAndPosition.set(`${slot.matchId}:${slot.position}`, slot);
  }

  const groupOf = (registrationId: string): string | null =>
    groupKeyOf(participantByRegistration.get(registrationId), options);

  const athletesOf = (match: MatchNode): [SlotNode, SlotNode] | null => {
    const first = slotByMatchAndPosition.get(`${match.id}:1`);
    const second = slotByMatchAndPosition.get(`${match.id}:2`);

    if (first === undefined || second === undefined) return null;
    if (first.slotType !== 'ATHLETE' || second.slotType !== 'ATHLETE') return null;
    if (first.registrationId === null || second.registrationId === null) return null;

    return [first, second];
  };

  const isConflict = (match: MatchNode): boolean => {
    const pair = athletesOf(match);
    if (pair === null) return false;

    const [first, second] = pair;
    const groupA = groupOf(mustRegistration(first));
    const groupB = groupOf(mustRegistration(second));

    return groupA !== null && groupA === groupB;
  };

  const isSwappable = (slot: SlotNode, allowProtected: boolean): boolean =>
    slot.slotType === 'ATHLETE' &&
    slot.registrationId !== null &&
    (allowProtected || !protectedRegistrations.has(slot.registrationId));

  // Each pass fixes at most one clash; the cap stops a pathological input from
  // looping forever.
  const maxPasses = firstRound.length * 2;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const conflicted = firstRound.find((match) => isConflict(match));
    if (conflicted === undefined) return;

    // Prefer a swap that leaves the organiser's seeds untouched. Only if no
    // such swap exists do we consider moving a seeded athlete — which is the
    // only way to separate two seeds that were drawn against each other.
    const fixed = tryFix(conflicted, false) || tryFix(conflicted, true);
    if (!fixed) break;
  }

  const remaining = firstRound.filter((match) => isConflict(match));

  if (remaining.length > 0) {
    warnings.push({
      code: 'SEPARATION_IMPOSSIBLE',
      message: `${remaining.length} first-round ${options.by === 'CLUB' ? 'club' : 'district'} clash(es) could not be separated`,
      registrationIds: remaining.flatMap((match) =>
        athletesOf(match)?.map(mustRegistration) ?? [],
      ),
    });
  }

  function tryFix(conflicted: MatchNode, allowProtected: boolean): boolean {
    const pair = athletesOf(conflicted);
    if (pair === null) return false;

    for (const sourceSlot of pair) {
      if (!isSwappable(sourceSlot, allowProtected)) continue;

      for (const other of firstRound) {
        if (other.id === conflicted.id) continue;

        const otherPair = athletesOf(other);
        if (otherPair === null) continue;

        for (const targetSlot of otherPair) {
          if (!isSwappable(targetSlot, allowProtected)) continue;

          const sourceRegistration = mustRegistration(sourceSlot);
          const targetRegistration = mustRegistration(targetSlot);

          const sourceGroup = groupOf(sourceRegistration);
          const targetGroup = groupOf(targetRegistration);

          // Would the swap merely move the clash into the other match?
          const partnerOfSource = pair.find((slot) => slot !== sourceSlot);
          const partnerOfTarget = otherPair.find((slot) => slot !== targetSlot);

          const sourcePartnerGroup =
            partnerOfSource === undefined ? null : groupOf(mustRegistration(partnerOfSource));
          const targetPartnerGroup =
            partnerOfTarget === undefined ? null : groupOf(mustRegistration(partnerOfTarget));

          const fixesHere = sourcePartnerGroup === null || sourcePartnerGroup !== targetGroup;
          const fixesThere = targetPartnerGroup === null || targetPartnerGroup !== sourceGroup;

          if (!fixesHere || !fixesThere) continue;

          sourceSlot.registrationId = targetRegistration;
          targetSlot.registrationId = sourceRegistration;
          return true;
        }
      }
    }

    return false;
  }
}

/**
 * The separation group of a participant. Names are compared ignoring case and
 * surrounding space, and an empty name is "no group" rather than a group of its
 * own, so unattached athletes are never kept apart from one another.
 */
export function groupKeyOf(
  participant: Participant | undefined,
  options: SeparationOptions,
): string | null {
  if (participant === undefined) return null;
  const raw = options.by === 'CLUB' ? participant.clubId : participant.districtId;
  const key = raw?.trim().toLowerCase() ?? '';
  return key === '' ? null : key;
}

/**
 * How badly a bracket treats group-mates: every pair from the same group adds a
 * penalty that grows the earlier they would meet (first round worst), and a pair
 * that can only meet in the final adds none. Lower is better; 0 is ideal.
 *
 * Used to compare candidate draws, since the best a bracket can do is get
 * group-mates into opposite halves, not merely out of round one.
 */
export function separationPenalty(
  slots: readonly SlotNode[],
  matches: readonly MatchNode[],
  participantByRegistration: ReadonlyMap<string, Participant>,
  options: SeparationOptions,
  roundsTotal: number,
): number {
  const firstRound = matches.filter((match) => match.roundNo === 0);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  const positionsByGroup = new Map<string, number[]>();

  firstRound.forEach((match, matchIndex) => {
    match.slotIds.forEach((slotId, slotIndex) => {
      const slot = slotById.get(slotId);
      if (slot === undefined || slot.slotType !== 'ATHLETE' || slot.registrationId === null) return;

      const group = groupKeyOf(participantByRegistration.get(slot.registrationId), options);
      if (group === null) return;

      const list = positionsByGroup.get(group) ?? [];
      list.push(matchIndex * 2 + slotIndex);
      positionsByGroup.set(group, list);
    });
  });

  let penalty = 0;

  for (const positions of positionsByGroup.values()) {
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const a = positions[i] as number;
        const b = positions[j] as number;

        // The round (0 = first) in which these two positions share a match.
        let round = 0;
        while (a >> (round + 1) !== b >> (round + 1)) round += 1;

        if (round < roundsTotal - 1) {
          penalty += 4 ** (roundsTotal - 1 - round);
        }
      }
    }
  }

  return penalty;
}

function mustRegistration(slot: SlotNode): string {
  const value = slot.registrationId;
  if (value === null) {
    throw new Error(`Internal error: slot ${slot.id} has no registration`);
  }
  return value;
}
