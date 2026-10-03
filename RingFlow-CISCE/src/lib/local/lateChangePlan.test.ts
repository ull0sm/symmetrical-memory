import { getRuleset } from "@event-suite/rules-engine";
import { describe, expect, it } from "vitest";
import { DrawInputError } from "@/engine/draw-engine/errors";
import { fillByeWithEntrant } from "@/engine/draw-engine/fillBye";
import { generateGroupDraw, placesOf } from "@/engine/draw-engine/groupDraw";
import { appendRankedPerformer, generateRankedKataDraw } from "@/engine/draw-engine/rankedKataDraw";
import type { DrawGraph, Participant } from "@/engine/draw-engine/types";
import { describeChange, firstRoundOf, kumitePinCandidates, openByes, orderPins, placesInGraph, renameInGraph } from "./lateChangePlan";

const kumite = getRuleset("WKF_KUMITE_2026");
const kata = getRuleset("WKF_KATA_2026");

const people = (ids: string[]): Participant[] => ids.map((id) => ({ registrationId: id, displayName: id.toUpperCase(), clubId: `club-${id}`, districtId: null }));
const draw = (ids: string[], pins: Record<string, number> = {}) =>
  generateGroupDraw({ categoryId: "g", participants: people(ids), pins, randomSeed: 7, bronzeMedals: 3 }, kumite);
const name = (id: string) => id.toUpperCase();

/** The first pin set that draws: what a late change does. */
function rebuildWith(ids: string[], before: DrawGraph, newcomer?: { athleteId: string; place?: number }) {
  for (const pins of kumitePinCandidates(placesOf(before), ids, before.tournamentSize, newcomer)) {
    try {
      return draw(ids, pins);
    } catch (err) {
      if (!(err instanceof DrawInputError)) throw err;
    }
  }
  throw new Error("no layout");
}

describe("kumitePinCandidates", () => {
  const five = draw(["a", "b", "c", "d", "e"]);

  it("keeps everyone where they were first, then frees one athlete at a time, then nobody", () => {
    const candidates = kumitePinCandidates(placesOf(five), ["a", "b", "c", "d", "e", "f"], 8, { athleteId: "f" });
    expect(candidates[0]).toEqual(Object.fromEntries(placesOf(five)));
    expect(candidates).toHaveLength(1 + 5 + 1);
    expect(candidates.at(-1)).toEqual({});
  });

  it("pins a newcomer to the chosen bye", () => {
    const bye = [1, 2, 3, 4, 5, 6, 7, 8].find((p) => ![...placesOf(five).values()].includes(p)) as number;
    const [first] = kumitePinCandidates(placesOf(five), ["a", "b", "c", "d", "e", "f"], 8, { athleteId: "f", place: bye });
    expect(first?.f).toBe(bye);
  });

  it("draws again when the bracket has to grow or shrink", () => {
    const four = draw(["a", "b", "c", "d"]);
    expect(kumitePinCandidates(placesOf(four), ["a", "b", "c", "d", "e"], 4, { athleteId: "e" })).toEqual([{}]);
    expect(kumitePinCandidates(placesOf(five), ["a", "b", "c", "d"], 8)).toEqual([{}]);
  });
});

describe("rebuilding a locked kumite group", () => {
  const five = draw(["a", "b", "c", "d", "e"]);

  it("adds a late athlete into a bye without moving anyone else", () => {
    const after = rebuildWith(["a", "b", "c", "d", "e", "f"], five, { athleteId: "f" });
    const before = placesOf(five);
    for (const [id, place] of before) expect(placesOf(after).get(id)).toBe(place);
    expect([...before.values()]).not.toContain(placesOf(after).get("f"));
    const lines = describeChange("kumite", five, after, name, { added: "f" });
    expect(lines[0]).toMatch(/^F joins and meets [A-E] in bout \d\.$/);
    expect(lines).toHaveLength(2); // the bye-holder now has an opponent
  });

  // Six in a bracket of eight: two byes, and five still need eight places after one leaves.
  const sixIds = ["a", "b", "c", "d", "e", "f"];
  const six = draw(sixIds);

  it("takes an athlete out: their opponent gets a bye and nobody else moves", () => {
    const fought = [...firstRoundOf(six)].find(([, b]) => b.opponent !== null) as [string, { opponent: string }];
    const [leaving, { opponent }] = fought;
    const after = rebuildWith(sixIds.filter((id) => id !== leaving), six);
    expect(firstRoundOf(after).get(opponent)?.opponent).toBeNull();
    const moved = [...placesOf(after)].filter(([id, place]) => placesOf(six).get(id) !== place);
    expect(moved).toEqual([]);
  });

  it("when the leaver had a bye, one athlete moves into the empty bout rather than everyone", () => {
    const leaving = [...firstRoundOf(six)].find(([, b]) => b.opponent === null)?.[0] as string;
    const rest = sixIds.filter((id) => id !== leaving);
    expect(() => draw(rest, Object.fromEntries([...placesOf(six)].filter(([id]) => id !== leaving)))).toThrow(DrawInputError);
    const after = rebuildWith(rest, six);
    const moved = [...placesOf(after)].filter(([id, place]) => placesOf(six).get(id) !== place);
    expect(moved).toHaveLength(1);
  });

  it("says so when the bracket shrinks", () => {
    const after = rebuildWith(["a", "b", "c", "d"], five);
    expect(describeChange("kumite", five, after, name, { removed: "e" })[0]).toBe("The bracket shrinks from 8 to 4 places, so every bout is drawn again.");
  });

  it("says so when the bracket grows", () => {
    const four = draw(["a", "b", "c", "d"]);
    const after = rebuildWith(["a", "b", "c", "d", "e"], four, { athleteId: "e" });
    expect(after.tournamentSize).toBe(8);
    expect(describeChange("kumite", four, after, name, { added: "e" })[0]).toBe("The bracket grows from 4 to 8 places, so every bout is drawn again.");
  });
});

describe("openByes", () => {
  it("lists byes a late athlete can take, and drops one once its holder has fought on", () => {
    const three = draw(["a", "b", "c"]);
    const byes = openByes(three, new Set());
    expect(byes).toHaveLength(1);
    const bye = byes[0] as { slotId: string; athleteId: string };
    const holdersBout = three.matches.find((m) => three.slots.some((s) => s.id === bye.slotId && s.matchId === m.id))?.id as string;
    const next = three.slots.find((s) => s.slotType === "WINNER_OF" && s.sourceMatchId === holdersBout)?.matchId as string;
    expect(openByes(three, new Set([next]))).toEqual([]);
    expect(fillByeWithEntrant(three, bye.slotId, "late", new Set()).byeCount).toBe(0);
  });

  it("has nothing for a full bracket or a kata group", () => {
    expect(openByes(draw(["a", "b", "c", "d"]), new Set())).toEqual([]);
    const k = generateRankedKataDraw({ categoryId: "k", participants: people(["a", "b", "c"]), randomSeed: 1, bronzeMedals: 2 }, kata);
    expect(openByes(k, new Set())).toEqual([]);
  });
});

describe("kata changes", () => {
  const order = ["a", "b", "c", "d", "e"];
  const k = generateRankedKataDraw({ categoryId: "k", participants: people(order), pins: orderPins(order), randomSeed: 1, bronzeMedals: 2 }, kata);

  it("a late performer joins the last solo, and nobody else moves", () => {
    const after = appendRankedPerformer(k, "f", new Set());
    expect(describeChange("kata", k, after, name, { added: "f" })).toEqual(["F joins and performs 6th with E.", "E now performs 5th with F (was 5th)."]);
  });

  it("an appended performer after a started solo leaves that solo's empty side in place", () => {
    const soloBout = k.matches.find((m) => m.matchNo === 3)?.id as string;
    const after = appendRankedPerformer(k, "f", new Set([soloBout]));
    const places = placesInGraph(after, "kata");
    expect(places.map((p) => p.athleteId)).toEqual(["a", "b", "c", "d", "e", null, "f"]);
    expect(placesInGraph(k, "kata").map((p) => p.athleteId)).toEqual(order);
  });
});

describe("renameInGraph", () => {
  it("puts the real athlete wherever the walk-in was", () => {
    const k = generateRankedKataDraw({ categoryId: "k", participants: people(["a", "walkin", "c"]), randomSeed: 1, bronzeMedals: 2 }, kata);
    const renamed = renameInGraph(k, "walkin", "real");
    expect(renamed.slots.some((s) => s.registrationId === "walkin")).toBe(false);
    expect(renamed.slots.filter((s) => s.registrationId === "real")).toHaveLength(1);
    expect(renamed.pools[0]?.registrationIds).toContain("real");
    expect("checksum" in renamed).toBe(false);
  });
});
