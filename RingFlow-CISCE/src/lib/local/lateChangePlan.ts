/**
 * The pure part of the admin's changes to a locked Local group: which places to
 * keep pinned when the draw is rebuilt, what the admin is shown about the change
 * before confirming, the byes a late athlete can still take, and a locked group's
 * places as they stand in its stored draw. No database here, so it is unit tested.
 */
import { GroupChangeError } from "@/engine/draw-engine/errors";
import { fillByeWithEntrant } from "@/engine/draw-engine/fillBye";
import { groupBracketSize, placesOf } from "@/engine/draw-engine/groupDraw";
import type { DrawGraph } from "@/engine/draw-engine/types";
import type { DivisionEventType } from "@/lib/statuses";

export interface PlacedAthlete {
  place: number;
  athleteId: string | null;
  pinned: boolean;
}

/**
 * Pin sets to try, best first, when a not-yet-started kumite group is rebuilt with
 * `members`: everyone where they were (plus a newcomer at a chosen bye place);
 * then, if that would leave a bout with nobody in it (someone who had a bye left),
 * everyone but one athlete, so the fewest bouts change; finally no pins at all.
 * A bracket that has to grow or shrink is drawn again from scratch: places in a
 * bracket of another size mean nothing.
 */
export function kumitePinCandidates(
  oldPlaces: ReadonlyMap<string, number>,
  members: readonly string[],
  oldSize: number,
  newcomer?: { athleteId: string; place?: number }
): Record<string, number>[] {
  if (groupBracketSize(members.length) !== oldSize) return [{}];
  const kept: Record<string, number> = {};
  for (const id of members) {
    const place = oldPlaces.get(id);
    if (place !== undefined) kept[id] = place;
  }
  if (newcomer?.place !== undefined) kept[newcomer.athleteId] = newcomer.place;

  const candidates: Record<string, number>[] = [kept];
  // Unpinning the athlete lowest in the bracket first keeps the top of the draw as it was.
  const byPlaceDesc = Object.entries(kept)
    .filter(([id]) => id !== newcomer?.athleteId)
    .sort((a, b) => b[1] - a[1]);
  for (const [id] of byPlaceDesc) {
    const fewer = { ...kept };
    delete fewer[id];
    candidates.push(fewer);
  }
  candidates.push({});
  return candidates;
}

/** A kata performance order as pins (place 1 performs first). */
export function orderPins(order: readonly string[]): Record<string, number> {
  return Object.fromEntries(order.map((id, i) => [id, i + 1]));
}

/** Each athlete's first-round bout in a kumite graph: its number and their opponent (null for a bye). */
export function firstRoundOf(graph: DrawGraph): Map<string, { bout: number; opponent: string | null }> {
  const out = new Map<string, { bout: number; opponent: string | null }>();
  const firstRound = graph.matches.filter((m) => m.roundNo === 0 && m.bracketType === "MAIN");
  for (const match of firstRound) {
    const sides = graph.slots
      .filter((s) => s.matchId === match.id && s.slotType === "ATHLETE" && s.registrationId !== null)
      .map((s) => s.registrationId as string);
    for (const id of sides) out.set(id, { bout: match.matchNo, opponent: sides.find((o) => o !== id) ?? null });
  }
  return out;
}

/** Each performer's bout (pair) in a ranked kata graph, with their partner (null for a solo). */
export function pairsOf(graph: DrawGraph): Map<string, { bout: number; partner: string | null; order: number }> {
  const out = new Map<string, { bout: number; partner: string | null; order: number }>();
  let order = 0;
  for (const match of [...graph.matches].sort((a, b) => a.matchNo - b.matchNo)) {
    const sides = [1, 2]
      .map((position) => graph.slots.find((s) => s.matchId === match.id && s.position === position)?.registrationId ?? null)
      .filter((id): id is string => id !== null);
    for (const id of sides) {
      order += 1;
      out.set(id, { bout: match.matchNo, partner: sides.find((o) => o !== id) ?? null, order });
    }
  }
  return out;
}

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
};

/**
 * What the admin is told about a change before confirming it: who joins or leaves,
 * and every athlete whose first bout (kumite) or pair (kata) is no longer the same.
 */
export function describeChange(
  eventType: DivisionEventType,
  before: DrawGraph,
  after: DrawGraph,
  nameOf: (id: string) => string,
  change: { added?: string; removed?: string }
): string[] {
  const lines: string[] = [];
  if (eventType === "kata") {
    const was = pairsOf(before);
    const now = pairsOf(after);
    const where = (p: { partner: string | null; order: number }) =>
      `performs ${ordinal(p.order)}${p.partner ? ` with ${nameOf(p.partner)}` : " as a solo"}`;
    if (change.removed) lines.push(`${nameOf(change.removed)} leaves the group.`);
    if (change.added) {
      const p = now.get(change.added);
      if (p) lines.push(`${nameOf(change.added)} joins and ${where(p)}.`);
    }
    for (const [id, p] of now) {
      if (id === change.added) continue;
      const q = was.get(id);
      if (q && (q.partner !== p.partner || q.order !== p.order)) lines.push(`${nameOf(id)} now ${where(p)} (was ${ordinal(q.order)}).`);
    }
    return lines;
  }

  if (before.tournamentSize !== after.tournamentSize) {
    lines.push(
      `The bracket ${after.tournamentSize > before.tournamentSize ? "grows" : "shrinks"} from ${before.tournamentSize} to ${after.tournamentSize} places, so every bout is drawn again.`
    );
  }
  const was = firstRoundOf(before);
  const now = firstRoundOf(after);
  const where = (b: { bout: number; opponent: string | null }) => (b.opponent ? `meets ${nameOf(b.opponent)} in bout ${b.bout}` : `has a bye in bout ${b.bout}`);
  if (change.removed) {
    const b = was.get(change.removed);
    lines.push(`${nameOf(change.removed)} leaves the group${b ? ` (was in bout ${b.bout})` : ""}.`);
  }
  if (change.added) {
    const b = now.get(change.added);
    if (b) lines.push(`${nameOf(change.added)} joins and ${where(b)}.`);
  }
  for (const [id, b] of now) {
    if (id === change.added) continue;
    const a = was.get(id);
    if (a && (a.opponent !== b.opponent || a.bout !== b.bout)) lines.push(`${nameOf(id)} now ${where(b)}.`);
  }
  return lines;
}

/** First-round byes a late athlete can still take: the bout and its next bout haven't started. */
export function openByes(graph: DrawGraph, started: ReadonlySet<string>) {
  if (graph.format !== "SINGLE_ELIM_REPECHAGE") return [];
  const out: { place: number; slotId: string; bout: number; athleteId: string }[] = [];
  for (const match of graph.matches.filter((m) => m.roundNo === 0 && m.bracketType === "MAIN")) {
    for (const slot of graph.slots.filter((s) => s.matchId === match.id && s.slotType === "BYE")) {
      try {
        fillByeWithEntrant(graph, slot.id, "\u0000probe", started);
      } catch (err) {
        if (err instanceof GroupChangeError) continue;
        throw err;
      }
      const partner = graph.slots.find((s) => s.matchId === match.id && s.id !== slot.id);
      out.push({ place: (match.matchNo - 1) * 2 + slot.position, slotId: slot.id, bout: match.matchNo, athleteId: partner?.registrationId as string });
    }
  }
  return out.sort((a, b) => a.place - b.place);
}

/**
 * A locked group's places as its stored draw has them: every place of the bracket
 * (a null athlete is a bye), or the performance order bout by bout, where a null
 * is the empty side of a solo.
 */
export function placesInGraph(graph: DrawGraph, eventType: DivisionEventType): PlacedAthlete[] {
  if (eventType === "kata") {
    const out: PlacedAthlete[] = [];
    const bouts = [...graph.matches].sort((a, b) => a.matchNo - b.matchNo);
    for (const bout of bouts) {
      const sides = [1, 2].map((position) => graph.slots.find((s) => s.matchId === bout.id && s.position === position)?.registrationId ?? null);
      // A solo's empty side only matters when a bout follows it (a performer appended after it started).
      const last = bout === bouts[bouts.length - 1];
      for (const [i, athleteId] of sides.entries()) {
        if (athleteId === null && (i === 0 || last)) continue;
        out.push({ place: (bout.matchNo - 1) * 2 + i + 1, athleteId, pinned: false });
      }
    }
    return out;
  }
  const byPlace = new Map([...placesOf(graph)].map(([athleteId, place]) => [place, athleteId]));
  const out: PlacedAthlete[] = [];
  for (let place = 1; place <= graph.tournamentSize; place += 1) out.push({ place, athleteId: byPlace.get(place) ?? null, pinned: false });
  return out;
}

/** Every registration id in a graph replaced: the stored draw of a group whose walk-in was merged into the real athlete. */
export function renameInGraph(graph: DrawGraph, from: string, to: string): Omit<DrawGraph, "checksum"> {
  const swap = (id: string | null) => (id === from ? to : id);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { checksum, ...body } = graph;
  return {
    ...body,
    slots: graph.slots.map((s) => ({ ...s, registrationId: swap(s.registrationId) })),
    pools: graph.pools.map((p) => ({ ...p, registrationIds: p.registrationIds.map((id) => swap(id) as string) })),
    warnings: graph.warnings.map((w) => (w.registrationIds ? { ...w, registrationIds: w.registrationIds.map((id) => swap(id) as string) } : w)),
  };
}
