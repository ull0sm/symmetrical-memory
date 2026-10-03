import { describe, expect, it } from "vitest";
import { buildMedalTally, type MedalWinner } from "./medalTally";

const w = (athleteId: string, club: string | null, medal: MedalWinner["medal"]): MedalWinner => ({
  athleteId,
  name: `Athlete ${athleteId}`,
  club,
  medal,
});

describe("buildMedalTally", () => {
  it("sorts by gold, then silver, then bronze", () => {
    const rows = buildMedalTally([
      w("1", "Alpha", "silver"),
      w("2", "Alpha", "silver"),
      w("3", "Beta", "gold"),
      w("4", "Gamma", "bronze"),
      w("5", "Gamma", "bronze"),
      w("6", "Gamma", "silver"),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(rows[1]).toMatchObject({ gold: 0, silver: 2, bronze: 0, total: 2 });
  });

  it("gives equal medal counts the same rank", () => {
    const rows = buildMedalTally([w("1", "A", "gold"), w("2", "B", "gold"), w("3", "C", "silver")]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("merges a club written in different cases", () => {
    const rows = buildMedalTally([w("1", "Shotokan ", "gold"), w("2", "shotokan", "bronze")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gold: 1, bronze: 1, total: 2 });
  });

  it("lists athletes with no club one by one, never pooled", () => {
    const rows = buildMedalTally([w("1", null, "gold"), w("2", " ", "gold"), w("3", "Club", "gold")]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.independent).map((r) => r.label).sort()).toEqual(["Athlete 1", "Athlete 2"]);
  });

  it("is empty without medals", () => {
    expect(buildMedalTally([])).toEqual([]);
  });
});
