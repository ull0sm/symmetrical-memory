/**
 * Allowed values for every status-like text column (PLAN 7.6). The database
 * enforces the same lists with CHECK constraints (schema/index.ts and
 * migration14_status_checks.sql). Add a value here first, then in a migration.
 *
 * No imports: drizzle-kit loads this through the schema file.
 */

export const TOURNAMENT_STATUSES = ["draft", "active", "completed"] as const;
export const RING_TIMER_STATUSES = ["idle", "running", "paused", "finished"] as const;
export const EVENT_TYPES = ["kumite", "kata", "team_kumite", "team_kata"] as const;
export const KATA_SCORING_MODES = ["FLAG", "POINTS"] as const;
export const ASSIGNMENT_STATUSES = ["pending", "running", "paused", "completed"] as const;
export const STAGER_STATUSES = ["calling", "ready"] as const;
export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "rejected", "expired", "revoked"] as const;
export const JUDGE_SESSION_STATUSES = ["pending", "approved", "rejected", "ended"] as const;
export const ATTENDANCE_STATUSES = ["present", "absent", "withdrawn"] as const;
/**
 * Bout status. CONFIRMED is the only "finished, official" value. PENDING /
 * FINISHED / WALKOVER / UNRESOLVED come from the draw engine's resolution
 * (byes and walkovers); COMPLETED is legacy.
 */
export const MATCH_STATUSES = [
  "SCHEDULED",
  "PENDING",
  "READY",
  "LIVE",
  "COMPLETED",
  "FINISHED",
  "CONFIRMED",
  "BYE",
  "WALKOVER",
  "UNRESOLVED",
] as const;
export const BRACKET_TYPES = ["MAIN", "REPECHAGE", "REPECHAGE_A", "REPECHAGE_B", "BRONZE", "POOL"] as const;
export const SIDES = ["AKA", "AO"] as const;
export const KATA_VOTING_STATES = ["idle", "open", "closed"] as const;
export const KATA_TARGET_SIDES = ["AKA", "AO", "BOTH"] as const;
export const KATA_SCORE_TYPES = ["FLAG", "POINT"] as const;
export const DRAW_STATES = ["DRAFT", "LOCKED"] as const;
export const DRAW_PROFILES = ["OFFICIAL", "LOCAL"] as const;
export const DRAW_SEPARATIONS = ["CLUB", "OFF"] as const;

export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];
export type RingTimerStatus = (typeof RING_TIMER_STATUSES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type KataScoringMode = (typeof KATA_SCORING_MODES)[number];
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export type StagerStatus = (typeof STAGER_STATUSES)[number];
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];
export type JudgeSessionStatus = (typeof JUDGE_SESSION_STATUSES)[number];
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export type BracketType = (typeof BRACKET_TYPES)[number];
export type Side = (typeof SIDES)[number];
export type KataVotingState = (typeof KATA_VOTING_STATES)[number];
export type KataTargetSide = (typeof KATA_TARGET_SIDES)[number];
export type KataScoreType = (typeof KATA_SCORE_TYPES)[number];
export type DrawState = (typeof DRAW_STATES)[number];

/** SQL list for a CHECK constraint: ('a', 'b'). Values are fixed literals above, never input. */
export function sqlList(values: readonly string[]): string {
  return `(${values.map((v) => `'${v}'`).join(", ")})`;
}

/** Every CHECK constraint: [name, table, column, values, nullable]. Used by the schema and the test. */
export const STATUS_CHECKS: ReadonlyArray<readonly [string, string, string, readonly string[], boolean]> = [
  ["tournaments_status_check", "tournaments", "status", TOURNAMENT_STATUSES, false],
  ["rings_timer_status_check", "rings", "timer_status", RING_TIMER_STATUSES, false],
  ["categories_event_type_check", "categories", "event_type", EVENT_TYPES, false],
  ["categories_kata_scoring_mode_check", "categories", "kata_scoring_mode", KATA_SCORING_MODES, false],
  ["category_assignments_status_check", "category_assignments", "status", ASSIGNMENT_STATUSES, false],
  ["category_assignments_stager_status_check", "category_assignments", "stager_status", STAGER_STATUSES, true],
  ["moderator_requests_status_check", "moderator_requests", "status", ACCESS_REQUEST_STATUSES, false],
  ["organiser_requests_status_check", "organiser_requests", "status", ACCESS_REQUEST_STATUSES, false],
  ["stager_requests_status_check", "stager_requests", "status", ACCESS_REQUEST_STATUSES, false],
  ["judge_sessions_status_check", "judge_sessions", "status", JUDGE_SESSION_STATUSES, false],
  ["matches_status_check", "matches", "status", MATCH_STATUSES, false],
  ["matches_bracket_type_check", "matches", "bracket_type", BRACKET_TYPES, false],
  ["matches_winner_side_check", "matches", "winner_side", SIDES, true],
  ["matches_kata_scoring_mode_check", "matches", "kata_scoring_mode", KATA_SCORING_MODES, true],
  ["matches_kata_voting_check", "matches", "kata_voting", KATA_VOTING_STATES, false],
  ["kata_scores_target_side_check", "kata_scores", "target_side", KATA_TARGET_SIDES, false],
  ["kata_scores_score_type_check", "kata_scores", "score_type", KATA_SCORE_TYPES, false],
  ["draws_state_check", "draws", "state", DRAW_STATES, false],
  ["category_attendance_status_check", "category_attendance", "status", ATTENDANCE_STATUSES, false],
  ["tournaments_draw_profile_check", "tournaments", "draw_profile", DRAW_PROFILES, false],
  ["tournaments_draw_separation_check", "tournaments", "draw_separation", DRAW_SEPARATIONS, false],
  ["categories_draw_profile_check", "categories", "draw_profile", DRAW_PROFILES, true],
];
