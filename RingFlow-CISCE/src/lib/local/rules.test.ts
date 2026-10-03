import { describe, expect, it } from "vitest";
import {
  canonicalBelt,
  distributeIntoGroups,
  divisionName,
  effectiveEventSettings,
  engineBronze,
  expectedBouts,
  generateDivisionShapes,
  matchDivision,
  normalizeAge,
  normalizeSex,
  planGroupSizes,
} from "./rules";

const BELTS = ["White", "Yellow", "Orange", "Green", "Blue"];

describe("divisionName", () => {
  it("names a category by belt, age and sex", () => {
    expect(divisionName({ belts: ["Blue"], ageMin: 9, ageMax: 9, sex: "M" })).toBe("Blue · 9 · M");
    expect(divisionName({ belts: ["White", "Yellow"], ageMin: 6, ageMax: 7, sex: "F" })).toBe("White + Yellow · 6–7 · F");
    expect(divisionName({ belts: [], ageMin: 12, ageMax: null, sex: "any" })).toBe("Any belt · 12+ · Mixed");
    expect(divisionName({ belts: [], ageMin: null, ageMax: 8, sex: "M" })).toBe("Any belt · 8 and under · M");
  });
});

describe("normalizing roster cells", () => {
  it("reads sex, age and belt the way sheets write them", () => {
    expect([normalizeSex("Boy"), normalizeSex("F"), normalizeSex("female"), normalizeSex("x")]).toEqual(["M", "F", "F", null]);
    expect([normalizeAge("9 yrs"), normalizeAge(9.6), normalizeAge(""), normalizeAge("abc")]).toEqual([9, 9, null, null]);
    expect([canonicalBelt(" blue ", BELTS), canonicalBelt("Purple", BELTS), canonicalBelt("", BELTS)]).toEqual([
      "Blue",
      null,
      null,
    ]);
  });
});

describe("matchDivision", () => {
  const divisions = [
    { id: "d1", belts: ["Blue"], ageMin: 9, ageMax: 9, sex: "M" },
    { id: "d2", belts: ["Blue"], ageMin: 9, ageMax: 10, sex: "any" },
    { id: "d3", belts: [], ageMin: 11, ageMax: null, sex: "F" },
  ];

  it("finds the first category an athlete fits and counts the others", () => {
    expect(matchDivision(divisions, { age: 9, belt: "blue", sex: "M" })).toMatchObject({ division: { id: "d1" }, matches: 2 });
    expect(matchDivision(divisions, { age: 10, belt: "Blue", sex: "F" })).toMatchObject({ division: { id: "d2" }, matches: 1 });
    expect(matchDivision(divisions, { age: 14, belt: "Green", sex: "F" })).toMatchObject({ division: { id: "d3" }, matches: 1 });
  });

  it("does not guess when the age, belt or sex is missing or does not fit", () => {
    expect(matchDivision(divisions, { age: null, belt: "Blue", sex: "M" }).division).toBeNull();
    expect(matchDivision(divisions, { age: 9, belt: null, sex: "M" }).division).toBeNull();
    expect(matchDivision(divisions, { age: 12, belt: "Blue", sex: null }).division).toBeNull();
  });
});

describe("planGroupSizes", () => {
  it("makes as few groups as fit, with sizes within one of each other", () => {
    expect(planGroupSizes(16, 8)).toEqual([8, 8]);
    expect(planGroupSizes(7, 4)).toEqual([4, 3]);
    expect(planGroupSizes(13, 8)).toEqual([7, 6]);
    expect(planGroupSizes(10, 10)).toEqual([10]);
    expect(planGroupSizes(17, 4)).toEqual([4, 4, 3, 3, 3]);
    expect(planGroupSizes(0, 8)).toEqual([]);
  });
});

describe("distributeIntoGroups", () => {
  const members = [
    ...["s1", "s2", "s3", "s4"].map((id) => ({ id, club: "Sakura" })),
    ...["k1", "k2"].map((id) => ({ id, club: "Kaizen" })),
    { id: "t1", club: "Tiger" },
    { id: "n1", club: null },
  ];

  it("fills each group to its size and places everyone once", () => {
    const groups = distributeIntoGroups(members, [4, 4], 1);
    expect(groups.map((g) => g.length)).toEqual([4, 4]);
    expect(groups.flat().sort()).toEqual(members.map((m) => m.id).sort());
  });

  it("spreads each club across the groups", () => {
    const groups = distributeIntoGroups(members, [4, 4], 1);
    for (const g of groups) {
      expect(g.filter((id) => id.startsWith("s"))).toHaveLength(2);
      expect(g.filter((id) => id.startsWith("k"))).toHaveLength(1);
    }
  });

  it("is reproducible from the seed whatever the input order", () => {
    expect(distributeIntoGroups([...members].reverse(), [4, 4], 5)).toEqual(distributeIntoGroups(members, [4, 4], 5));
  });
});

describe("bronze and bout counts", () => {
  it("maps the bronze setting onto the engine's options", () => {
    expect([engineBronze("kumite", 2), engineBronze("kumite", 1), engineBronze("kata", 2), engineBronze("kata", 1)]).toEqual([
      3, 1, 2, 1,
    ]);
  });

  it("counts the bouts a group runs", () => {
    expect([expectedBouts("kumite", 1, 2), expectedBouts("kumite", 8, 2), expectedBouts("kumite", 8, 1)]).toEqual([0, 7, 8]);
    expect(expectedBouts("kumite", 3, 1)).toBe(2); // the bronze bout is a walkover with one semi-final loser
    expect([expectedBouts("kata", 7, 2), expectedBouts("kata", 4, 2), expectedBouts("kata", 0, 2)]).toEqual([4, 2, 0]);
  });

  it("fills an event's plan from the tournament defaults", () => {
    const t = { localBronzeMedals: 2, localKumiteGroupSize: 8, localKataGroupSize: 4, localBoutDurationMs: 90000 };
    expect(effectiveEventSettings("kata", { groupSize: null, bronzeMedals: null, boutDurationMs: null }, t)).toEqual({
      groupSize: 4,
      bronzeMedals: 2,
      boutDurationMs: 90000,
    });
    expect(effectiveEventSettings("kumite", { groupSize: 10, bronzeMedals: 1, boutDurationMs: 60000 }, t)).toEqual({
      groupSize: 10,
      bronzeMedals: 1,
      boutDurationMs: 60000,
    });
  });
});

describe("generateDivisionShapes", () => {
  it("makes every age, belt and sex combination", () => {
    const shapes = generateDivisionShapes({
      ages: [
        { min: 8, max: 8 },
        { min: 9, max: 9 },
      ],
      beltBands: [["White", "Yellow"], ["Blue"]],
      sexes: ["M", "F"],
    });
    expect(shapes).toHaveLength(8);
    expect(divisionName(shapes[0]!)).toBe("White + Yellow · 8 · M");
  });
});
