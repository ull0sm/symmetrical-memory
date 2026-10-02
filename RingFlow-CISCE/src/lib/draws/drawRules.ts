/**
 * What a draw is allowed to do, decided once from the event's draw profile.
 *
 * OFFICIAL follows WKF procedure and ignores local tweaks: repechage with two
 * bronzes, club-mates kept apart, no hand edits to the drawn bracket.
 * LOCAL uses the same rules as a base but lets the organiser choose the bronze
 * format, switch club separation off, and fix up a drawn bracket by hand.
 */

export type DrawProfile = "OFFICIAL" | "LOCAL";
export type DrawSeparationSetting = "CLUB" | "OFF";
export type BronzeMedals = 0 | 1 | 2 | 3;

export const DRAW_PROFILES: readonly DrawProfile[] = ["OFFICIAL", "LOCAL"];

export interface DrawRules {
  profile: DrawProfile;
  bronzeMedals: BronzeMedals;
  separation: DrawSeparationSetting;
  /** Whether an admin may swap athletes by hand in a draft bracket. */
  allowManualSwap: boolean;
}

export function asDrawProfile(value: unknown): DrawProfile | null {
  return value === "OFFICIAL" || value === "LOCAL" ? value : null;
}

function asBronze(value: unknown): BronzeMedals | null {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : null;
}

export function resolveDrawRules(input: {
  tournamentProfile?: unknown;
  categoryProfile?: unknown;
  tournamentSeparation?: unknown;
  /** An explicit request for this draw only. */
  bronzeOverride?: unknown;
  categoryBronze?: unknown;
  tournamentBronze?: unknown;
}): DrawRules {
  const profile = asDrawProfile(input.categoryProfile) ?? asDrawProfile(input.tournamentProfile) ?? "LOCAL";

  if (profile === "OFFICIAL") {
    return { profile, bronzeMedals: 2, separation: "CLUB", allowManualSwap: false };
  }

  // Explicit override, then this category's setting, then the tournament default, then WKF's two.
  const bronzeMedals =
    asBronze(input.bronzeOverride) ?? asBronze(input.categoryBronze) ?? asBronze(input.tournamentBronze) ?? 2;

  return {
    profile,
    bronzeMedals,
    separation: input.tournamentSeparation === "OFF" ? "OFF" : "CLUB",
    allowManualSwap: true,
  };
}
