/**
 * Serializers bridging Drizzle database models to frontend components.
 * Provides both camelCase and snake_case properties to ensure 100% compatibility
 * across all existing UI components without regressions.
 */

import { DEFAULT_BOUT_DURATION_MS } from "@/lib/constants";
import type { AccessRequestStatus } from "@/lib/statuses";
import { asDrawProfile } from "@/lib/draws/drawRules";
import { describePart } from "@/lib/draws/partFilter";
import type { InferSelectModel } from "drizzle-orm";
import {
  tournaments,
  rings,
  categories,
  categoryAssignments,
  moderatorRequests,
  eventLog,
  athletes,
  organiserRequests,
  stagerRequests,
  matches,
  kataScores,
} from "@/db/schema";

/** An ISO timestamp from a Date or date-like value, or null when there is none. */
function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type TournamentRow = InferSelectModel<typeof tournaments>;
type RingRow = InferSelectModel<typeof rings>;
type CategoryRow = InferSelectModel<typeof categories>;
type CategoryAssignmentRow = InferSelectModel<typeof categoryAssignments>;
type ModeratorRequestRow = InferSelectModel<typeof moderatorRequests>;
type EventLogRow = InferSelectModel<typeof eventLog>;
type AthleteRow = InferSelectModel<typeof athletes>;
type OrganiserRequestRow = InferSelectModel<typeof organiserRequests>;
type StagerRequestRow = InferSelectModel<typeof stagerRequests>;
type MatchRow = InferSelectModel<typeof matches>;
type KataScoreRow = InferSelectModel<typeof kataScores>;

/**
 * Tournament shape for every screen. The organiser code and stager codes are
 * credentials and are left out; the admin settings screen uses
 * `serializeTournamentForAdmin`.
 */
function buildTournament(t: TournamentRow & Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { organiserCode, stagerCodes, organiser_code, stager_codes, ...rest } = t;
  return {
    ...rest,
    id: t.id,
    admin_id: t.adminId,
    name: t.name,
    event_date: t.eventDate ? String(t.eventDate) : null,
    eventDate: t.eventDate ? String(t.eventDate) : null,
    venue: t.venue,
    city: t.city,
    status: t.status,
    show_public_draws: t.showPublicDraws ?? true,
    show_public_scoreboard: t.showPublicScoreboard ?? false,
    default_bronze_medals: t.defaultBronzeMedals ?? 2,
    draw_profile: asDrawProfile(t.drawProfile) ?? "LOCAL",
    draw_separation: t.drawSeparation === "OFF" ? ("OFF" as const) : ("CLUB" as const),
    tunnel_url: t.tunnelUrl ?? null,
    tunnelUrl: t.tunnelUrl ?? null,
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
  };
}

/** Admin settings only: includes the organiser and stager access codes. */
function buildTournamentForAdmin(t: TournamentRow & Record<string, unknown>) {
  return {
    ...serializeTournament(t),
    organiser_code: t.organiserCode,
    stager_codes: t.stagerCodes || [],
  };
}

/**
 * Public-safe ring shape. The tatami access code and judge PIN are credentials:
 * they are never serialized here. Admin screens read them through their own
 * guarded queries.
 */
function buildRing(r: RingRow & Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accessCode, judgePin, judgePairingKey, access_code, judge_pin, judge_pairing_key, ...rest } = r;
  return {
    ...rest,
    id: r.id,
    tournament_id: r.tournamentId,
    name: r.name,
    ring_order: r.ringOrder,
    timer_status: r.timerStatus || 'idle',
    timer_started_at: iso(r.timerStartedAt),
    timer_paused_at: iso(r.timerPausedAt),
    timer_accumulated_seconds: r.timerAccumulatedSeconds ?? 0,
    timer_duration_ms: r.timerDurationMs ?? DEFAULT_BOUT_DURATION_MS,
    timer_accumulated_ms: r.timerAccumulatedMs ?? 0,
    sides_swapped: r.sidesSwapped ?? false,
    current_match_id: r.currentMatchId ?? null,
    match_duration_seconds: r.matchDurationSeconds ?? 180,
    mat_name: (r.matName as string | null | undefined) ?? null,
  };
}

function buildCategory(c: CategoryRow & Record<string, unknown>) {
  return {
    ...c,
    id: c.id,
    tournament_id: c.tournamentId,
    name: c.name,
    age_bracket: c.ageBracket,
    weight_class: c.weightClass,
    gender: c.gender,
    discipline: (c.discipline as string | null | undefined) || (c.eventType === 'kata' ? 'KATA' : 'KUMITE'),
    event_type: c.eventType || 'kumite',
    eventType: c.eventType || 'kumite',
    kata_format: c.kataFormat || 'GROUP_POOLS',
    kataFormat: c.kataFormat || 'GROUP_POOLS',
    kata_scoring_mode: c.kataScoringMode || 'FLAG',
    kataScoringMode: c.kataScoringMode || 'FLAG',
    pool_size: c.poolSize ?? 8,
    poolSize: c.poolSize ?? 8,
    advance_per_pool: c.advancePerPool ?? 2,
    advancePerPool: c.advancePerPool ?? 2,
    age_category: c.ageCategory,
    weight_category: c.weightCategory,
    sub_category: c.subCategory,
    status: c.status,
    athletes_count: c.athletesCount ?? 0,
    expected_matches: c.expectedMatches ?? 0,
    doc_url: c.docUrl,
    custom_rules: c.customRules,
    bronze_medals: c.bronzeMedals ?? (c.bronze_medals as number | null | undefined) ?? null,
    draw_state: (c.drawState ?? c.draw_state ?? null) as string | null,
    draw_version: (c.drawVersion ?? c.draw_version ?? (c.draw as { version?: number } | null | undefined)?.version ?? null) as number | null,
    drawVersion: (c.drawVersion ?? c.draw_version ?? (c.draw as { version?: number } | null | undefined)?.version ?? null) as number | null,
    is_locked: (c.drawState ?? c.draw_state) === "LOCKED",
    confirmed_matches: (c.confirmedMatches ?? c.confirmed_matches ?? 0) as number,
    live_matches: (c.liveMatches ?? c.live_matches ?? 0) as number,
    has_draw: (c.hasDraw ?? c.has_draw ?? false) as boolean,
    created_at: iso(c.createdAt),
  };
}

function buildCategoryAssignment(a: Omit<CategoryAssignmentRow, "stagerName"> & Record<string, unknown>, category?: Record<string, unknown> | null) {
  const serializedCat = category ? serializeCategory(category as CategoryRow) : a.categories ? serializeCategory(a.categories as CategoryRow) : null;
  // A split category's pool or finals card says which part it is wherever the name is shown.
  const partLabel = describePart(a.part);
  const named = serializedCat && partLabel ? { ...serializedCat, name: `${serializedCat.name} · ${partLabel}` } : serializedCat;
  return {
    ...a,
    id: a.id,
    ring_id: a.ringId,
    category_id: a.categoryId,
    part: a.part,
    part_label: partLabel,
    queue_order: a.queueOrder,
    status: a.status,
    matches_completed: a.matchesCompleted ?? 0,
    allocated_at: iso(a.allocatedAt),
    completed_at: iso(a.completedAt),
    paused_at: iso(a.pausedAt),
    pause_duration_seconds: a.pauseDurationSeconds ?? 0,
    categories: named,
  };
}

function buildModRequest(mr: ModeratorRequestRow & Record<string, unknown>, ring?: Record<string, unknown> | null) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sessionToken, session_token, claimHash, ...rest } = mr;
  return {
    ...rest,
    id: mr.id,
    ring_id: mr.ringId,
    tournament_id: mr.tournamentId,
    status: mr.status,
    device_info: mr.deviceInfo,
    moderator_name: mr.moderatorName,
    created_at: iso(mr.createdAt),
    updated_at: iso(mr.updatedAt),
    rings: ring ? { name: ring.name } : mr.ring ? { name: (mr.ring as { name: string }).name } : undefined,
  };
}

function buildEventLog(el: EventLogRow & Record<string, unknown>) {
  return {
    ...el,
    id: el.id,
    tournament_id: el.tournamentId,
    ring_id: el.ringId,
    category_id: el.categoryId,
    action: el.action,
    metadata: el.metadata,
    created_at: iso(el.createdAt),
  };
}

function buildAthlete(a: AthleteRow & Record<string, unknown>, categoryName?: string | null) {
  return {
    ...a,
    id: a.id,
    tournament_id: a.tournamentId,
    category_id: a.categoryId,
    name: a.name,
    school: a.school,
    dojo: a.dojo,
    belt: a.belt,
    weight: a.weight,
    gender: a.gender,
    chest_number: a.chestNumber,
    chestNumber: a.chestNumber,
    seed: a.seed,
    created_at: iso(a.createdAt),
    updated_at: iso(a.updatedAt),
    categories: categoryName ? { name: categoryName } : a.category ? { name: (a.category as { name: string }).name } : undefined,
  };
}

function buildOrganiserRequest(or: OrganiserRequestRow & Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sessionToken, session_token, claimHash, ...rest } = or;
  return {
    ...rest,
    id: or.id,
    tournament_id: or.tournamentId,
    access_code_used: or.accessCodeUsed,
    status: or.status as AccessRequestStatus,
    device_info: or.deviceInfo,
    organiser_name: or.organiserName,
    expires_at: iso(or.expiresAt) ?? (or.expires_at as string | null) ?? null,
    created_at: iso(or.createdAt) ?? (or.created_at as string | null) ?? null,
    updated_at: iso(or.updatedAt) ?? (or.updated_at as string | null) ?? null,
  };
}

function buildStagerRequest(sr: StagerRequestRow & Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sessionToken, session_token, claimHash, ...rest } = sr;
  return {
    ...rest,
    id: sr.id,
    tournament_id: sr.tournamentId,
    access_code_used: sr.accessCodeUsed || sr.access_code_used,
    stager_name: sr.stagerName || sr.stager_name,
    status: sr.status,
    device_info: sr.deviceInfo || sr.device_info,
    expires_at: iso(sr.expiresAt) ?? (sr.expires_at as string | null) ?? null,
    created_at: iso(sr.createdAt) ?? (sr.created_at as string | null) ?? null,
    updated_at: iso(sr.updatedAt) ?? (sr.updated_at as string | null) ?? null,
  };
}

function buildMatch(m: MatchRow & Record<string, unknown>) {
  return {
    ...m,
    id: m.id,
    category_id: m.categoryId || m.category_id,
    match_no: m.matchNo ?? m.match_no,
    round_no: m.roundNo ?? m.round_no,
    round_name: m.roundName || m.round_name,
    bracket_type: m.bracketType || m.bracket_type || 'MAIN',
    status: m.status,
    winner_id: m.winnerId || m.winner_id,
    aka_score: m.akaScore ?? m.aka_score ?? 0,
    ao_score: m.aoScore ?? m.ao_score ?? 0,
    aka_penalties: m.akaPenalties ?? m.aka_penalties ?? 0,
    ao_penalties: m.aoPenalties ?? m.ao_penalties ?? 0,
    senshu: m.senshu,
    winner_side: m.winnerSide || m.winner_side,
    decision_method: m.decisionMethod || m.decision_method,
    kata_scoring_mode: m.kataScoringMode || m.kata_scoring_mode || 'FLAG',
    pool_group: m.poolGroup || m.pool_group,
    aka_kata_name: m.akaKataName || m.aka_kata_name,
    ao_kata_name: m.aoKataName || m.ao_kata_name,
    aka_flags: m.akaFlags ?? m.aka_flags ?? 0,
    ao_flags: m.aoFlags ?? m.ao_flags ?? 0,
    aka_score_total: m.akaScoreTotal ? String(m.akaScoreTotal) : (m.aka_score_total ? String(m.aka_score_total) : null),
    ao_score_total: m.aoScoreTotal ? String(m.aoScoreTotal) : (m.ao_score_total ? String(m.ao_score_total) : null),
  };
}

function buildKataScore(ks: KataScoreRow & Record<string, unknown>) {
  return {
    ...ks,
    id: ks.id,
    match_id: ks.matchId || ks.match_id,
    athlete_id: ks.athleteId || ks.athlete_id,
    target_side: ks.targetSide || ks.target_side,
    judge_seat: ks.judgeSeat ?? ks.judge_seat,
    score_type: ks.scoreType || ks.score_type,
    flag_vote: ks.flagVote || ks.flag_vote,
    numeric_score: ks.numericScore ? Number(ks.numericScore) : (ks.numeric_score ? Number(ks.numeric_score) : null),
    is_dropped: ks.isDropped ?? ks.is_dropped ?? false,
    is_overridden: ks.isOverridden ?? ks.is_overridden ?? false,
    created_at: iso(ks.createdAt),
  };
}

// A row in gives a serialized row out; only a missing row gives null.
export function serializeTournament(t: TournamentRow & Record<string, unknown>): ReturnType<typeof buildTournament>;
export function serializeTournament(t: TournamentRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildTournament> | null;
export function serializeTournament(t: TournamentRow & Record<string, unknown> | null | undefined) {
  return t ? buildTournament(t) : null;
}

export function serializeTournamentForAdmin(t: TournamentRow & Record<string, unknown>): ReturnType<typeof buildTournamentForAdmin>;
export function serializeTournamentForAdmin(t: TournamentRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildTournamentForAdmin> | null;
export function serializeTournamentForAdmin(t: TournamentRow & Record<string, unknown> | null | undefined) {
  return t ? buildTournamentForAdmin(t) : null;
}

export function serializeRing(r: RingRow & Record<string, unknown>): ReturnType<typeof buildRing>;
export function serializeRing(r: RingRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildRing> | null;
export function serializeRing(r: RingRow & Record<string, unknown> | null | undefined) {
  return r ? buildRing(r) : null;
}

export function serializeCategory(c: CategoryRow & Record<string, unknown>): ReturnType<typeof buildCategory>;
export function serializeCategory(c: CategoryRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildCategory> | null;
export function serializeCategory(c: CategoryRow & Record<string, unknown> | null | undefined) {
  return c ? buildCategory(c) : null;
}

export function serializeCategoryAssignment(a: Omit<CategoryAssignmentRow, "stagerName"> & Record<string, unknown>, category?: Record<string, unknown> | null): ReturnType<typeof buildCategoryAssignment>;
export function serializeCategoryAssignment(a: Omit<CategoryAssignmentRow, "stagerName"> & Record<string, unknown> | null | undefined, category?: Record<string, unknown> | null): ReturnType<typeof buildCategoryAssignment> | null;
export function serializeCategoryAssignment(a: Omit<CategoryAssignmentRow, "stagerName"> & Record<string, unknown> | null | undefined, category?: Record<string, unknown> | null) {
  return a ? buildCategoryAssignment(a, category) : null;
}

export function serializeModRequest(mr: ModeratorRequestRow & Record<string, unknown>, ring?: Record<string, unknown> | null): ReturnType<typeof buildModRequest>;
export function serializeModRequest(mr: ModeratorRequestRow & Record<string, unknown> | null | undefined, ring?: Record<string, unknown> | null): ReturnType<typeof buildModRequest> | null;
export function serializeModRequest(mr: ModeratorRequestRow & Record<string, unknown> | null | undefined, ring?: Record<string, unknown> | null) {
  return mr ? buildModRequest(mr, ring) : null;
}

export function serializeEventLog(el: EventLogRow & Record<string, unknown>): ReturnType<typeof buildEventLog>;
export function serializeEventLog(el: EventLogRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildEventLog> | null;
export function serializeEventLog(el: EventLogRow & Record<string, unknown> | null | undefined) {
  return el ? buildEventLog(el) : null;
}

export function serializeAthlete(a: AthleteRow & Record<string, unknown>, categoryName?: string | null): ReturnType<typeof buildAthlete>;
export function serializeAthlete(a: AthleteRow & Record<string, unknown> | null | undefined, categoryName?: string | null): ReturnType<typeof buildAthlete> | null;
export function serializeAthlete(a: AthleteRow & Record<string, unknown> | null | undefined, categoryName?: string | null) {
  return a ? buildAthlete(a, categoryName) : null;
}

export function serializeOrganiserRequest(or: OrganiserRequestRow & Record<string, unknown>): ReturnType<typeof buildOrganiserRequest>;
export function serializeOrganiserRequest(or: OrganiserRequestRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildOrganiserRequest> | null;
export function serializeOrganiserRequest(or: OrganiserRequestRow & Record<string, unknown> | null | undefined) {
  return or ? buildOrganiserRequest(or) : null;
}

export function serializeStagerRequest(sr: StagerRequestRow & Record<string, unknown>): ReturnType<typeof buildStagerRequest>;
export function serializeStagerRequest(sr: StagerRequestRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildStagerRequest> | null;
export function serializeStagerRequest(sr: StagerRequestRow & Record<string, unknown> | null | undefined) {
  return sr ? buildStagerRequest(sr) : null;
}

export function serializeMatch(m: MatchRow & Record<string, unknown>): ReturnType<typeof buildMatch>;
export function serializeMatch(m: MatchRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildMatch> | null;
export function serializeMatch(m: MatchRow & Record<string, unknown> | null | undefined) {
  return m ? buildMatch(m) : null;
}

export function serializeKataScore(ks: KataScoreRow & Record<string, unknown>): ReturnType<typeof buildKataScore>;
export function serializeKataScore(ks: KataScoreRow & Record<string, unknown> | null | undefined): ReturnType<typeof buildKataScore> | null;
export function serializeKataScore(ks: KataScoreRow & Record<string, unknown> | null | undefined) {
  return ks ? buildKataScore(ks) : null;
}

