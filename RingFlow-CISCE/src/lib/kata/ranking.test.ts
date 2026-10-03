import { describe, expect, it } from "vitest";
import { medalsByPosition, rankPerformances, tieKeyOf, type Performance } from "./ranking";

/** A performance with judge marks; the total is what the tally would give. */
function perf(athleteId: string, marks: number[], done = true): Performance {
  const sorted = [...marks].sort((a, b) => a - b);
  const drop = marks.length >= 7 ? 2 : marks.length >= 5 ? 1 : 0;
  const kept = sorted.slice(drop, sorted.length - drop);
  return { athleteId, marks, total: Math.round(kept.reduce((s, m) => s + m, 0) * 100) / 100, done };
}
const typed = (athleteId: string, total: number | null, done = true): Performance => ({ athleteId, marks: [], total, done });
const view = (r: ReturnType<typeof rankPerformances>) => r.standings.map((s) => `${s.athleteId}:${s.label}:${s.medal ?? "-"}`);

describe("medals by position", () => {
  it("follow the group size and the bronze setting", () => {
    expect(medalsByPosition(1, 2)).toEqual(["gold"]);
    expect(medalsByPosition(2, 2)).toEqual(["gold", "silver"]);
    expect(medalsByPosition(3, 2)).toEqual(["gold", "silver", "bronze"]);
    expect(medalsByPosition(4, 2)).toEqual(["gold", "silver", "bronze", "bronze"]);
    expect(medalsByPosition(7, 1)).toEqual(["gold", "silver", "bronze"]);
  });
});

describe("ranked kata group", () => {
  it("ranks by total and gives two bronzes to ranks 3 and 4", () => {
    const r = rankPerformances([typed("a", 22), typed("b", 24), typed("c", 23), typed("d", 21), typed("e", 20)], { bronzeMedals: 2 });
    expect(view(r)).toEqual(["b:1:gold", "c:2:silver", "a:3:bronze", "d:4:bronze", "e:5:-"]);
    expect(r.final).toBe(true);
  });

  it("gives one bronze to rank 3 under the one-bronze setting", () => {
    const r = rankPerformances([typed("a", 22), typed("b", 24), typed("c", 23), typed("d", 21)], { bronzeMedals: 1 });
    expect(view(r)).toEqual(["b:1:gold", "c:2:silver", "a:3:bronze", "d:4:-"]);
  });

  it("everyone in a group of three medals; a group of one is gold", () => {
    expect(view(rankPerformances([typed("a", 20), typed("b", 21), typed("c", 22)], { bronzeMedals: 2 }))).toEqual(["c:1:gold", "b:2:silver", "a:3:bronze"]);
    expect(view(rankPerformances([typed("a", 20)], { bronzeMedals: 2 }))).toEqual(["a:1:gold"]);
  });

  it("breaks a tie on total with the higher lowest dropped mark (5 judges)", () => {
    // Both keep 7.0 + 7.0 + 7.0 = 21.0; a dropped 6.8 low, b dropped 6.6.
    const a = perf("a", [7.0, 7.0, 7.0, 6.8, 7.4]);
    const b = perf("b", [7.0, 7.0, 7.0, 6.6, 7.8]);
    const r = rankPerformances([b, a], { bronzeMedals: 2 });
    expect(view(r)).toEqual(["a:1:gold", "b:2:silver"]);
    expect(r.standings[0]?.separatedBy).toBe("lowest dropped mark");
    expect(r.final).toBe(true);
  });

  it("then with the higher highest dropped mark", () => {
    const a = perf("a", [7.0, 7.0, 7.0, 6.6, 7.4]);
    const b = perf("b", [7.0, 7.0, 7.0, 6.6, 7.8]);
    const r = rankPerformances([a, b], { bronzeMedals: 2 });
    expect(view(r)).toEqual(["b:1:gold", "a:2:silver"]);
    expect(r.standings[0]?.separatedBy).toBe("highest dropped mark");
  });

  it("with seven judges compares the two lowest dropped marks, lowest first", () => {
    const a = perf("a", [7.0, 7.0, 7.0, 6.5, 6.9, 7.5, 7.6]);
    const b = perf("b", [7.0, 7.0, 7.0, 6.6, 6.7, 7.5, 7.6]);
    expect(view(rankPerformances([a, b], { bronzeMedals: 2 }))).toEqual(["b:1:gold", "a:2:silver"]);
  });

  it("a tie the marks can't break, for a medal, waits for the desk", () => {
    const r = rankPerformances([typed("a", 23), typed("b", 23), typed("c", 21)], { bronzeMedals: 2 });
    expect(view(r)).toEqual(["a:1=:-", "b:1=:-", "c:3:bronze"]);
    expect(r.medalTies).toEqual([{ athleteIds: ["a", "b"], position: 1, medals: ["gold", "silver"], decided: false }]);
    expect(r.complete).toBe(true);
    expect(r.final).toBe(false);
  });

  it("the desk decision orders the tie and the podium stands", () => {
    const r = rankPerformances([typed("a", 23), typed("b", 23), typed("c", 21)], { bronzeMedals: 2, decisions: [{ athleteIds: ["b", "a"] }] });
    expect(view(r)).toEqual(["b:1:gold", "a:2:silver", "c:3:bronze"]);
    expect(r.standings[0]?.separatedBy).toBe("desk decision");
    expect(r.final).toBe(true);
  });

  it("a decision about other athletes is not used", () => {
    const r = rankPerformances([typed("a", 23), typed("b", 23), typed("c", 23)], { bronzeMedals: 2, decisions: [{ athleteIds: ["b", "a"] }] });
    expect(r.final).toBe(false);
    expect(r.medalTies[0]?.athleteIds).toEqual(["a", "b", "c"]);
  });

  it("two bronzes: a tie for 3rd and 4th shares bronze and needs no decision", () => {
    const r = rankPerformances([typed("a", 24), typed("b", 23), typed("c", 21), typed("d", 21), typed("e", 19)], { bronzeMedals: 2 });
    expect(view(r)).toEqual(["a:1:gold", "b:2:silver", "c:3=:bronze", "d:3=:bronze", "e:5:-"]);
    expect(r.final).toBe(true);
  });

  it("one bronze: the same tie decides the bronze", () => {
    const r = rankPerformances([typed("a", 24), typed("b", 23), typed("c", 21), typed("d", 21)], { bronzeMedals: 1 });
    expect(r.medalTies).toHaveLength(1);
    expect(r.final).toBe(false);
  });

  it("ties below the medals stay shared", () => {
    const r = rankPerformances([typed("a", 24), typed("b", 23), typed("c", 22), typed("d", 21), typed("e", 19), typed("f", 19)], { bronzeMedals: 2 });
    expect(view(r).slice(4)).toEqual(["e:5=:-", "f:5=:-"]);
    expect(r.final).toBe(true);
  });

  it("an athlete who didn't perform ranks last with no medal; one still to perform keeps it open", () => {
    const r = rankPerformances([typed("a", 22), typed("b", null), typed("c", 21), typed("d", null, false)], { bronzeMedals: 2 });
    expect(view(r)).toEqual(["a:1:gold", "c:2:silver", "b:DNP:-", "d::-"]);
    expect(r.complete).toBe(false);
    expect(r.final).toBe(false);
  });

  it("a tie key ignores order", () => {
    expect(tieKeyOf(["b", "a"])).toBe(tieKeyOf(["a", "b"]));
  });
});
