import { describe, expect, it, vi } from "vitest";

// tally.ts imports the database for its DB-backed helpers; the pure tally doesn't use it.
vi.mock("@/db", () => ({ db: {} }));

const { tallyKataScores } = await import("./tally");

type Row = { judgeSeat: number; targetSide: string; flagVote: string | null; numericScore: string | null };
const flag = (seat: number, vote: "AKA" | "AO", side = "BOTH"): Row => ({ judgeSeat: seat, targetSide: side, flagVote: vote, numericScore: null });
const mark = (seat: number, side: "AKA" | "AO", score: number): Row => ({ judgeSeat: seat, targetSide: side, flagVote: null, numericScore: score.toFixed(2) });

describe("tallyKataScores — flags", () => {
  it("gives the bout to the majority once three flags are up", () => {
    const t = tallyKataScores([flag(1, "AKA"), flag(2, "AKA"), flag(3, "AO")], "FLAG", false);
    expect(t).toMatchObject({ akaFlags: 2, aoFlags: 1, winner: "AKA" });
  });

  it("does not decide with fewer than three flags", () => {
    expect(tallyKataScores([flag(1, "AO"), flag(2, "AO")], "FLAG", false).winner).toBeNull();
  });

  it("counts one flag per seat even when older desk rows repeat it on AKA and AO", () => {
    const rows = [flag(1, "AO", "AKA"), flag(1, "AO", "AO"), flag(2, "AKA"), flag(3, "AKA")];
    expect(tallyKataScores(rows, "FLAG", false)).toMatchObject({ akaFlags: 2, aoFlags: 1, winner: "AKA" });
  });

  it("reports a tie on an even split", () => {
    const rows = [flag(1, "AKA"), flag(2, "AKA"), flag(3, "AO"), flag(4, "AO")];
    expect(tallyKataScores(rows, "FLAG", false).winner).toBe("TIE");
  });

  it("ignores seats outside 1..7", () => {
    expect(tallyKataScores([flag(0, "AO"), flag(8, "AO"), flag(1, "AKA")], "FLAG", false).aoFlags).toBe(0);
  });

  it("awards a solo performance to AKA", () => {
    expect(tallyKataScores([], "FLAG", true).winner).toBe("AKA");
  });
});

describe("tallyKataScores — points", () => {
  it("sums all marks with three judges", () => {
    const rows = [mark(1, "AKA", 8.3), mark(2, "AKA", 8.1), mark(3, "AKA", 7.7), mark(1, "AO", 7.9), mark(2, "AO", 8.0), mark(3, "AO", 8.0)];
    const t = tallyKataScores(rows, "POINTS", false);
    expect(t.akaTotal).toBeCloseTo(24.1);
    expect(t.aoTotal).toBeCloseTo(23.9);
    expect(t.winner).toBe("AKA");
  });

  it("drops the highest and lowest of five and reports which seats", () => {
    const rows = [8.0, 9.5, 7.0, 8.2, 8.4].map((m, i) => mark(i + 1, "AKA", m));
    const t = tallyKataScores(rows, "POINTS", true);
    expect(t.akaTotal).toBeCloseTo(24.6);
    expect(t.akaDropped.sort()).toEqual([2, 3]);
    expect(t.winner).toBe("AKA");
  });

  it("has no total and no winner until three marks per side", () => {
    const t = tallyKataScores([mark(1, "AKA", 8), mark(2, "AKA", 8), mark(1, "AO", 8), mark(2, "AO", 8), mark(3, "AO", 8)], "POINTS", false);
    expect(t.akaTotal).toBeNull();
    expect(t.winner).toBeNull();
  });

  it("reports a tie on equal totals", () => {
    const rows = [1, 2, 3].flatMap((s) => [mark(s, "AKA", 8), mark(s, "AO", 8)]);
    expect(tallyKataScores(rows, "POINTS", false).winner).toBe("TIE");
  });
});
