/**
 * Shared tunables. Anything a venue might reasonably ask to change lives here
 * rather than as a magic number in an action or component.
 */

/** Judge phone sessions end after this long even if nobody ends the panel. */
export const JUDGE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Seats on a kata panel. The desk and the phones both use seats 1..N. */
export const JUDGE_PANEL_SEATS = 5;

/** Pending judge requests one tatami will hold before refusing new ones. */
export const MAX_PENDING_JUDGE_REQUESTS = 20;

/** Kata marks run 5.0–10.0 in 0.1 steps (WKF). */
export const KATA_MARK_MIN = 5;
export const KATA_MARK_MAX = 10;

/** Session lifetimes, in seconds (docs/roles/README.md → Sessions). */
export const SESSION_TTL_SECONDS = {
  admin: 7 * 24 * 60 * 60,
  organiser: 48 * 60 * 60,
  stager: 48 * 60 * 60,
  moderator: 24 * 60 * 60,
  /** How long a waiting-room browser may take to collect an approved session. */
  claim: 48 * 60 * 60,
} as const;

/** How often a screen re-fetches while its live stream is down (hooks/useFallbackPoll). */
export const LIVE_FALLBACK_POLL_MS = 15_000;

/** Default kumite bout length (the column default in schema/index.ts must match). */
export const DEFAULT_BOUT_DURATION_MS = 180_000;

/** Belt list a new Local tournament starts with, lowest first. The admin can edit it. */
export const DEFAULT_BELT_LEVELS: readonly string[] = [
  "White",
  "Yellow",
  "Orange",
  "Green",
  "Blue",
  "Purple",
  "Brown",
  "Black",
];
