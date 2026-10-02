import { describePart } from "@/lib/draws/partFilter";

/**
 * The balancing board and the stager's call area list CARDS, not categories: a whole category is one card,
 * a split category is one card per pool plus one for its finals, each on the tatami that runs it. Everything
 * on those screens (queues, counts, progress, workload) then works the same for every card.
 *
 * A card's `id` is its key: the category id for a whole category, `<category id>::<part>` for a part. The real
 * category id and the part stay on the card as `category_id` and `part` for anything that talks to the server.
 */

export const cardKey = (categoryId: string, part?: string | null): string =>
  !part || part === "ALL" ? categoryId : `${categoryId}::${part}`;

export interface CardCategory {
  id: string;
  name: string;
  athletes_count: number;
  expected_matches: number;
}

export interface CardAssignment {
  category_id: string;
  part?: string | null;
  part_athletes?: number | null;
  partAthletes?: number | null;
  part_matches?: number | null;
  partMatches?: number | null;
}

export type BoardCard<C> = Omit<C, "id"> & {
  /** The card key. */
  id: string;
  /** The category this card belongs to. */
  category_id: string;
  /** 'ALL', 'POOL:n' or 'FINALS'. */
  part: string;
  /** What `athletes_count` counts on this card: athletes, or pool winners for a finals card. */
  athletes_unit: "athletes" | "pool winners";
};

export type BoardAssignment<A> = Omit<A, "category_id"> & {
  /** The card key, so a card finds its own assignment the way a category used to. */
  category_id: string;
  real_category_id: string;
  part: string;
};

const partOf = (part?: string | null) => part || "ALL";

/** Cards of the categories that have been assigned, and the categories themselves when they have not. */
export function projectBoard<C extends CardCategory, A extends CardAssignment>(
  categories: readonly C[],
  assignments: readonly A[]
): { cards: BoardCard<C>[]; assignments: BoardAssignment<A>[] } {
  const byCategory = new Map<string, A[]>();
  for (const a of assignments) {
    const list = byCategory.get(a.category_id) ?? [];
    list.push(a);
    byCategory.set(a.category_id, list);
  }

  const cards: BoardCard<C>[] = [];
  const projected: BoardAssignment<A>[] = [];

  for (const category of categories) {
    const rows = byCategory.get(category.id) ?? [];
    const parts = rows.filter((row) => partOf(row.part) !== "ALL");

    if (parts.length === 0) {
      cards.push({ ...category, category_id: category.id, part: "ALL", athletes_unit: "athletes" });
      for (const row of rows) projected.push({ ...row, category_id: category.id, real_category_id: category.id, part: "ALL" });
      continue;
    }

    // Pools in order, the finals last.
    const ordered = [...parts].sort((a, b) => {
      const rank = (p: string) => (p === "FINALS" ? Number.MAX_SAFE_INTEGER : Number(p.split(":")[1]) || 0);
      return rank(partOf(a.part)) - rank(partOf(b.part));
    });
    for (const row of ordered) {
      const part = partOf(row.part);
      const key = cardKey(category.id, part);
      const athletes = row.part_athletes ?? row.partAthletes;
      const matches = row.part_matches ?? row.partMatches;
      cards.push({
        ...category,
        id: key,
        category_id: category.id,
        part,
        name: `${category.name} · ${describePart(part) ?? part}`,
        athletes_count: athletes ?? 0,
        expected_matches: matches ?? 0,
        athletes_unit: part === "FINALS" ? "pool winners" : "athletes",
      });
      projected.push({ ...row, category_id: key, real_category_id: category.id, part });
    }
  }

  return { cards, assignments: projected };
}

/**
 * What the board must agree on to show the right cards: which cards exist and which tatami each is on.
 * When this differs between the screen and the server, the screen reloads its layout.
 */
export function layoutSignature(rows: readonly { category_id: string; part?: string | null; ring_id: string }[]): string {
  return rows
    .map((row) => `${cardKey(row.category_id, row.part)}@${row.ring_id}`)
    .sort()
    .join("|");
}

/** Pool numbers that still have to finish before a category's finals can start. */
export function poolsStillRunning(
  cards: readonly { category_id: string; part: string; id: string }[],
  categoryId: string,
  statusOf: (cardId: string) => string | undefined
): number[] {
  return cards
    .filter((card) => card.category_id === categoryId && card.part.startsWith("POOL:") && statusOf(card.id) !== "completed")
    .map((card) => Number(card.part.split(":")[1]))
    .sort((a, b) => a - b);
}

/**
 * What a card's draw button opens. A whole category and a category's Pool 1 card (the card that manages the
 * category) open the full draw, with tabs for all pools together and each pool; any other pool or the finals
 * opens just its own part.
 */
export function bracketTarget(card: { id: string; name: string; category_id?: string; part?: string }): {
  id: string;
  name: string;
  part: string | null;
} {
  const manages = !card.part || card.part === "ALL" || card.part === "POOL:1";
  return {
    id: card.category_id ?? card.id,
    name: manages ? card.name.replace(/ · Pool 1$/, "") : card.name,
    part: manages ? null : (card.part as string),
  };
}
