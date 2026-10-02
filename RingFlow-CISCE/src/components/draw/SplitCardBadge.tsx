import React from "react";
import { poolsStillRunning } from "@/lib/draws/boardCards";

interface BoardCardLike {
  id: string;
  category_id?: string;
  part?: string;
}

interface Props {
  card: BoardCardLike;
  /** Every card on the board (the badge looks up the card's siblings). */
  cards: readonly BoardCardLike[];
  statusOf: (cardId: string) => string | undefined;
  /** The display name of the tatami a card is on. */
  tatamiOf: (cardId: string) => string;
}

/**
 * The one line on a pool or finals card that says how it fits with the rest of its category, the same on
 * every role's board: a pool says where the winner goes; the finals say which pools they wait for.
 */
export function SplitCardBadge({ card, cards, statusOf, tatamiOf }: Props) {
  if (!card.part || card.part === "ALL" || !card.category_id) return null;
  const siblings = cards.filter((c) => c.category_id === card.category_id) as { id: string; category_id: string; part: string }[];

  if (card.part === "FINALS") {
    const waiting = poolsStillRunning(siblings, card.category_id, statusOf);
    const done = waiting.length === 0;
    return (
      <div
        className={`mb-1.5 rounded-md border px-2 py-1 text-[10px] leading-snug ${
          done ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        {done ? (
          <span className="font-bold">All pools finished: ready to start</span>
        ) : (
          <>
            <span className="font-bold">
              Waiting for {waiting.length === 1 ? "pool" : "pools"} {waiting.join(", ")}
            </span>{" "}
            to finish
          </>
        )}
      </div>
    );
  }

  const finals = siblings.find((c) => c.part === "FINALS");
  if (!finals) return null;
  return (
    <div className="mb-1.5 rounded-md border border-outline-variant/60 bg-surface-container-low px-2 py-1 text-[10px] leading-snug text-[#68645A]">
      Winner goes to the finals on <span className="font-bold text-[#1B1815]">{tatamiOf(finals.id)}</span>
    </div>
  );
}
