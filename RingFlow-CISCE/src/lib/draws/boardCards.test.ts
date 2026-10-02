import { describe, expect, it } from "vitest";
import { cardKey, layoutSignature, poolsStillRunning, projectBoard } from "./boardCards";

const category = (id: string, name = id) => ({ id, name, athletes_count: 64, expected_matches: 63 });

describe("cardKey", () => {
  it("is the category id for a whole category and carries the part otherwise", () => {
    expect(cardKey("c1")).toBe("c1");
    expect(cardKey("c1", "ALL")).toBe("c1");
    expect(cardKey("c1", "POOL:3")).toBe("c1::POOL:3");
  });
});

describe("projectBoard", () => {
  const split = [
    { category_id: "c1", part: "FINALS", ring_id: "r1", partAthletes: 4, partMatches: 3 },
    { category_id: "c1", part: "POOL:2", ring_id: "r2", part_athletes: 16, part_matches: 15 },
    { category_id: "c1", part: "POOL:1", ring_id: "r1", part_athletes: 16, part_matches: 15 },
  ];

  it("keeps an unassigned category and a whole category as one card each", () => {
    const { cards, assignments } = projectBoard(
      [category("c1"), category("c2")],
      [{ category_id: "c1", part: "ALL", ring_id: "r1" }]
    );
    expect(cards.map((c) => [c.id, c.part])).toEqual([["c1", "ALL"], ["c2", "ALL"]]);
    expect(assignments.map((a) => a.category_id)).toEqual(["c1"]);
  });

  it("turns a split category into its pools in order, then its finals, each with its own size", () => {
    const { cards, assignments } = projectBoard([category("c1", "Kumite")], split);
    expect(cards.map((c) => c.id)).toEqual(["c1::POOL:1", "c1::POOL:2", "c1::FINALS"]);
    expect(cards.map((c) => c.name)).toEqual(["Kumite · Pool 1", "Kumite · Pool 2", "Kumite · Finals"]);
    expect(cards.map((c) => [c.athletes_count, c.expected_matches])).toEqual([[16, 15], [16, 15], [4, 3]]);
    expect(cards[2].athletes_unit).toBe("pool winners");
    expect(cards.every((c) => c.category_id === "c1")).toBe(true);
    expect(assignments.map((a) => [a.category_id, a.real_category_id, a.part])).toEqual([
      ["c1::POOL:1", "c1", "POOL:1"],
      ["c1::POOL:2", "c1", "POOL:2"],
      ["c1::FINALS", "c1", "FINALS"],
    ]);
  });

  it("ignores assignments of categories it was not given", () => {
    const { cards, assignments } = projectBoard([category("c9")], split);
    expect(cards.map((c) => c.id)).toEqual(["c9"]);
    expect(assignments).toEqual([]);
  });
});

describe("layoutSignature", () => {
  it("changes when a card moves tatami or the category is split, and not with row order", () => {
    const a = layoutSignature([{ category_id: "c1", part: "ALL", ring_id: "r1" }]);
    expect(layoutSignature([{ category_id: "c1", ring_id: "r1" }])).toBe(a);
    expect(layoutSignature([{ category_id: "c1", part: "ALL", ring_id: "r2" }])).not.toBe(a);
    const rows = [
      { category_id: "c1", part: "POOL:1", ring_id: "r1" },
      { category_id: "c1", part: "FINALS", ring_id: "r2" },
    ];
    expect(layoutSignature(rows)).toBe(layoutSignature([...rows].reverse()));
    expect(layoutSignature(rows)).not.toBe(a);
  });
});

describe("poolsStillRunning", () => {
  const cards = [
    { id: "c1::POOL:1", category_id: "c1", part: "POOL:1" },
    { id: "c1::POOL:2", category_id: "c1", part: "POOL:2" },
    { id: "c1::FINALS", category_id: "c1", part: "FINALS" },
    { id: "c2::POOL:1", category_id: "c2", part: "POOL:1" },
  ];
  it("lists the unfinished pools of that category only", () => {
    const statuses: Record<string, string> = { "c1::POOL:1": "completed", "c1::POOL:2": "running", "c2::POOL:1": "pending" };
    expect(poolsStillRunning(cards, "c1", (id) => statuses[id])).toEqual([2]);
    statuses["c1::POOL:2"] = "completed";
    expect(poolsStillRunning(cards, "c1", (id) => statuses[id])).toEqual([]);
  });
});
