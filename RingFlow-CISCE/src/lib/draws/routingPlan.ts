import { describePart } from "@/lib/draws/partFilter";

/**
 * Where a category's bouts run, as the admin wants it: the whole category on one tatami, or its pools each
 * on a tatami with the finals on another (or the same).
 */
export type Routing =
  | { kind: "WHOLE"; ringId: string }
  | { kind: "SPLIT"; poolRingIds: readonly string[]; finalsRingId: string };

/** One card (assignment) of the category as it stands, with what has happened in its bouts. */
export interface RouteCard {
  part: string;
  ringId: string;
  status: string;
  /** Bouts of this part running right now. */
  live: number;
  /** The bout numbers of those live bouts, for the message. */
  liveBoutNos: readonly number[];
  /** Bouts of this part that were fought and confirmed. */
  fought: number;
  /** Bouts this part actually runs (byes and walkovers excluded). */
  total: number;
}

/** A change to make, in the order given. */
export type RouteAction =
  /** Whole category -> its pools and finals. The whole card is reused for the finals when that tatami stays. */
  | { type: "SPLIT"; poolRingIds: readonly string[]; finalsRingId: string }
  /** Pools and finals -> one whole card on `ringId`. */
  | { type: "MERGE"; ringId: string }
  /** One card to another tatami; a card that was on a mat goes back to that tatami's queue. */
  | { type: "MOVE"; part: string; toRingId: string }
  /** A whole category that has no card yet gets one. */
  | { type: "ASSIGN"; ringId: string };

export type RoutePlan = { ok: true; actions: RouteAction[] } | { ok: false; error: string };

const onMat = (card: { status: string }) => card.status === "running" || card.status === "paused";

function liveMessage(card: RouteCard, what: string): string {
  const which = card.liveBoutNos.length > 0 ? `Bout #${card.liveBoutNos.join(", #")} is` : "A bout is";
  return `${which} live${card.part === "ALL" ? "" : ` in ${describePart(card.part) ?? card.part}`}, so ${what} yet. Finish or reset that bout first.`;
}

/**
 * Works out what has to change to get from the current cards to the wanted routing, or why it cannot be done.
 *
 * Fought bouts never block a change: results are stored on the bouts and stay put when a part moves. Only
 * a bout that is running right now blocks (finish it first), and a part that is already finished stays where
 * it ran. A part that is on a mat but between bouts can still move; it returns to the new tatami's queue.
 */
export function planRouting(current: readonly RouteCard[], wanted: Routing, poolCount: number | null): RoutePlan {
  const split = current.some((card) => card.part !== "ALL");
  const whole = current.find((card) => card.part === "ALL") ?? null;

  if (wanted.kind === "SPLIT") {
    if (poolCount === null) return { ok: false, error: "This draw has fewer than two pools, so there is nothing to split." };
    if (wanted.poolRingIds.length !== poolCount) {
      return { ok: false, error: `Choose a tatami for each of the ${poolCount} pools.` };
    }
  }

  if (!split) {
    if (wanted.kind === "WHOLE") {
      if (!whole) return { ok: true, actions: [{ type: "ASSIGN", ringId: wanted.ringId }] };
      if (whole.ringId === wanted.ringId) return { ok: true, actions: [] };
      if (whole.live > 0) return { ok: false, error: liveMessage(whole, "it cannot move to another tatami") };
      if (whole.status === "completed") return { ok: false, error: "This category is finished; return it to the queue before moving it." };
      return { ok: true, actions: [{ type: "MOVE", part: "ALL", toRingId: wanted.ringId }] };
    }

    if (whole?.live) return { ok: false, error: liveMessage(whole, "it cannot be split") };
    if (whole?.status === "completed") return { ok: false, error: "This category is finished; return it to the queue before splitting it." };
    return { ok: true, actions: [{ type: "SPLIT", poolRingIds: wanted.poolRingIds, finalsRingId: wanted.finalsRingId }] };
  }

  // Currently split.
  const blocked = current.find((card) => card.live > 0);

  if (wanted.kind === "WHOLE") {
    if (blocked) return { ok: false, error: liveMessage(blocked, "the category cannot be put back together") };
    return { ok: true, actions: [{ type: "MERGE", ringId: wanted.ringId }] };
  }

  const wantedRing = new Map<string, string>(wanted.poolRingIds.map((ringId, i) => [`POOL:${i + 1}`, ringId]));
  wantedRing.set("FINALS", wanted.finalsRingId);

  const actions: RouteAction[] = [];
  for (const [part, toRingId] of wantedRing) {
    const card = current.find((c) => c.part === part);
    if (!card) return { ok: false, error: `${describePart(part) ?? part} has no card; put the category back together and split it again.` };
    if (card.ringId === toRingId) continue;
    if (card.live > 0) return { ok: false, error: liveMessage(card, `${describePart(part) ?? part} cannot move to another tatami`) };
    if (card.status === "completed") {
      return { ok: false, error: `${describePart(part) ?? part} is finished and stays on the tatami that ran it.` };
    }
    actions.push({ type: "MOVE", part, toRingId });
  }
  return { ok: true, actions };
}

/** Whether a card that is on a mat (but has no live bout) goes back to the queue when it moves. */
export function returnsToQueue(card: Pick<RouteCard, "status">): boolean {
  return onMat(card);
}

/**
 * A part's status when a whole category is split part-way: a part whose bouts were all fought is finished,
 * otherwise it waits in its tatami's queue.
 */
export function statusForNewPart(card: Pick<RouteCard, "fought" | "total">): "completed" | "pending" {
  return card.total > 0 && card.fought >= card.total ? "completed" : "pending";
}
