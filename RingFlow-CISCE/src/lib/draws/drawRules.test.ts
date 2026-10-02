import { describe, expect, it } from "vitest";
import { resolveDrawRules } from "./drawRules";

describe("resolveDrawRules", () => {
  it("defaults to a local draw with WKF's two bronzes and club separation", () => {
    expect(resolveDrawRules({})).toEqual({
      profile: "LOCAL",
      bronzeMedals: 2,
      separation: "CLUB",
      allowManualSwap: true,
    });
  });

  it("resolves bronze as override, then category, then tournament", () => {
    expect(resolveDrawRules({ bronzeOverride: 1, categoryBronze: 3, tournamentBronze: 0 }).bronzeMedals).toBe(1);
    expect(resolveDrawRules({ categoryBronze: 3, tournamentBronze: 0 }).bronzeMedals).toBe(3);
    expect(resolveDrawRules({ categoryBronze: null, tournamentBronze: 0 }).bronzeMedals).toBe(0);
  });

  it("lets local events turn club separation off", () => {
    expect(resolveDrawRules({ tournamentSeparation: "OFF" }).separation).toBe("OFF");
  });

  it("ignores every local tweak in an official event", () => {
    expect(
      resolveDrawRules({
        tournamentProfile: "OFFICIAL",
        bronzeOverride: 1,
        categoryBronze: 3,
        tournamentBronze: 0,
        tournamentSeparation: "OFF",
      }),
    ).toEqual({ profile: "OFFICIAL", bronzeMedals: 2, separation: "CLUB", allowManualSwap: false });
  });

  it("lets one category override the tournament's profile either way", () => {
    expect(resolveDrawRules({ tournamentProfile: "OFFICIAL", categoryProfile: "LOCAL", categoryBronze: 1 }).bronzeMedals).toBe(1);
    expect(resolveDrawRules({ tournamentProfile: "LOCAL", categoryProfile: "OFFICIAL", categoryBronze: 1 }).bronzeMedals).toBe(2);
  });

  it("falls back to the tournament profile for an unknown category profile", () => {
    expect(resolveDrawRules({ tournamentProfile: "OFFICIAL", categoryProfile: "bogus" }).profile).toBe("OFFICIAL");
  });
});
