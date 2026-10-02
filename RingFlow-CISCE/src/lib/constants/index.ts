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
