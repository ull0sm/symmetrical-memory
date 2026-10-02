import { randomBytes, randomInt } from 'node:crypto';
import { sql, relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// =========================================================================
// 1. Core RingFlow Tables
// =========================================================================

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/** One row per signed-in admin browser. The cookie holds the token; only its hash is stored. */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('admin_sessions_admin_id_idx').on(table.adminId)]
);

export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  adminId: uuid('admin_id')
    .notNull()
    .references(() => admins.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  eventDate: date('event_date', { mode: 'string' }),
  venue: text('venue'),
  city: text('city'),
  status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'completed'
  organiserCode: text('organiser_code'),
  stagerCodes: jsonb('stager_codes').default([]),
  showPublicDraws: boolean('show_public_draws').default(true),
  showPublicScoreboard: boolean('show_public_scoreboard').notNull().default(false),
  // 0 = no bronze bout, 1 = single bronze, 2 = repechage with two bronzes (WKF).
  defaultBronzeMedals: integer('default_bronze_medals').notNull().default(2),
  tunnelUrl: text('tunnel_url'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const rings = pgTable(
  'rings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ringOrder: integer('ring_order').notNull(),
    accessCode: text('access_code').notNull(),
    timerStatus: text('timer_status').notNull().default('idle'),
    timerStartedAt: timestamp('timer_started_at', { withTimezone: true, mode: 'date' }),
    timerPausedAt: timestamp('timer_paused_at', { withTimezone: true, mode: 'date' }),
    timerAccumulatedSeconds: integer('timer_accumulated_seconds').notNull().default(0),
    // Authoritative match clock (millisecond precision).
    // timer_started_at = real UTC instant the CURRENT run segment began.
    // timer_accumulated_ms = elapsed ms accumulated BEFORE that segment.
    timerDurationMs: integer('timer_duration_ms').notNull().default(180000),
    timerAccumulatedMs: integer('timer_accumulated_ms').notNull().default(0),
    sidesSwapped: boolean('sides_swapped').notNull().default(false),
    currentMatchId: text('current_match_id'),
    matchDurationSeconds: integer('match_duration_seconds').notNull().default(180),
    // Random per tatami; there is no shared default PIN.
    judgePin: text('judge_pin').notNull().$defaultFn(() => String(randomInt(1000, 10000))),
    // Secret in the judge QR link (/judge/ring/<id>?k=...). Rotated with the PIN.
    judgePairingKey: text('judge_pairing_key')
      .notNull()
      .$defaultFn(() => randomBytes(24).toString('base64url')),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.tournamentId, table.name)]
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ageBracket: text('age_bracket'),
  weightClass: text('weight_class'),
  athletesCount: integer('athletes_count').notNull().default(0),
  expectedMatches: integer('expected_matches').notNull().default(0),
  hasFullRoster: boolean('has_full_roster').notNull().default(false),
  belt: text('belt'),
  ageMin: integer('age_min'),
  ageMax: integer('age_max'),
  sex: text('sex'),
  day: text('day'),
  docUrl: text('doc_url'),
  // Null means "inherit the tournament's default".
  bronzeMedals: integer('bronze_medals'),
  eventType: text('event_type').notNull().default('kumite'), // 'kumite' | 'kata' | 'team_kumite' | 'team_kata'
  kataFormat: text('kata_format').notNull().default('GROUP_POOLS'), // 'BRACKET' | 'GROUP_POOLS'
  kataScoringMode: text('kata_scoring_mode').notNull().default('FLAG'), // 'FLAG' | 'POINTS'
  poolSize: integer('pool_size').notNull().default(8),
  advancePerPool: integer('advance_per_pool').notNull().default(2),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Category athlete-list PDFs uploaded by the admin. Kept in Postgres so the
 * same build works on an offline venue server and a hosted one; served to
 * staff only through /api/category-docs/[categoryId].
 */
export const categoryDocuments = pgTable('category_documents', {
  categoryId: uuid('category_id')
    .primaryKey()
    .references(() => categories.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull().default('application/pdf'),
  sizeBytes: integer('size_bytes').notNull(),
  content: bytea('content').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const athletes = pgTable('athletes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  categoryId: uuid('category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  tournamentId: uuid('tournament_id').references(() => tournaments.id, {
    onDelete: 'cascade',
  }),
  name: text('name').notNull(),
  chestNumber: text('chest_number'),
  belt: text('belt'),
  age: text('age'),
  sex: text('sex'),
  day: text('day'),
  dojo: text('dojo'),
  school: text('school'),
  schoolCode: text('school_code'),
  sportsId: text('sports_id'),
  weight: numeric('weight', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const categoryAssignments = pgTable(
  'category_assignments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ringId: uuid('ring_id')
      .notNull()
      .references(() => rings.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    queueOrder: integer('queue_order').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'paused' | 'completed'
    matchesCompleted: integer('matches_completed').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    pausedAt: timestamp('paused_at', { withTimezone: true, mode: 'date' }),
    totalPausedSeconds: integer('total_paused_seconds').notNull().default(0),
    stagerStatus: text('stager_status'),
    stagerName: text('stager_name'),
    stagerActionAt: timestamp('stager_action_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.ringId, table.queueOrder),
    unique().on(table.categoryId),
  ]
);

export const moderatorRequests = pgTable('moderator_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ringId: uuid('ring_id')
    .notNull()
    .references(() => rings.id, { onDelete: 'cascade' }),
  accessCodeUsed: text('access_code_used').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked'
  // Legacy plaintext column, no longer written (sessions are looked up by hash).
  sessionToken: uuid('session_token').unique(),
  // sha256 of the session token the requesting browser holds in an httpOnly cookie.
  sessionTokenHash: text('session_token_hash').unique(),
  deviceInfo: jsonb('device_info').default({}),
  moderatorName: text('moderator_name'),
  // sha256 of the one-time secret held (httpOnly) by the browser that asked for access.
  claimHash: text('claim_hash'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
});

export const organiserRequests = pgTable('organiser_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  accessCodeUsed: text('access_code_used').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'expired' | 'revoked'
  // Legacy plaintext column, no longer written (sessions are looked up by hash).
  sessionToken: uuid('session_token').unique(),
  // sha256 of the session token the requesting browser holds in an httpOnly cookie.
  sessionTokenHash: text('session_token_hash').unique(),
  deviceInfo: jsonb('device_info').default({}),
  organiserName: text('organiser_name'),
  // sha256 of the one-time secret held (httpOnly) by the browser that asked for access.
  claimHash: text('claim_hash'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const stagerRequests = pgTable('stager_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  accessCodeUsed: text('access_code_used').notNull(),
  status: text('status').notNull().default('pending'),
  // Legacy plaintext column, no longer written (sessions are looked up by hash).
  sessionToken: uuid('session_token').unique(),
  // sha256 of the session token the requesting browser holds in an httpOnly cookie.
  sessionTokenHash: text('session_token_hash').unique(),
  deviceInfo: jsonb('device_info').default({}),
  stagerName: text('stager_name'),
  // sha256 of the one-time secret held (httpOnly) by the browser that asked for access.
  claimHash: text('claim_hash'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/**
 * A judge's phone on one tatami seat (PLAN Phase 4, docs/roles/judge.md).
 * The requesting browser holds a claim secret (hash in `claim_hash`); after
 * the moderator approves, that browser collects a session token (hash in
 * `token_hash`). One approved phone per seat, enforced by a partial index.
 */
export const judgeSessions = pgTable(
  'judge_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ringId: uuid('ring_id')
      .notNull()
      .references(() => rings.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(), // 1 to 7
    judgeName: text('judge_name').notNull(),
    claimHash: text('claim_hash'),
    tokenHash: text('token_hash'),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'ended'
    endReason: text('end_reason'), // 'kicked' | 'replaced' | 'panel_ended' | 'rotated' | 'left' | 'expired'
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('judge_sessions_ring_status_idx').on(table.ringId, table.status),
    uniqueIndex('judge_sessions_one_per_seat')
      .on(table.ringId, table.seat)
      .where(sql`status = 'approved'`),
  ]
);

export const eventLog = pgTable('event_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  ringId: uuid('ring_id')
    .notNull()
    .references(() => rings.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => categories.id, {
    onDelete: 'set null',
  }),
  moderatorSessionId: uuid('moderator_session_id'),
  action: text('action').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

/**
 * Official record of who did what. Append-only (a trigger refuses UPDATE);
 * rows only disappear when their tournament is deleted. Written through
 * `src/lib/audit.ts`, never directly.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    ringId: uuid('ring_id'),
    categoryId: uuid('category_id'),
    matchId: text('match_id'),
    actorRole: text('actor_role').notNull(), // 'admin' | 'organiser' | 'stager' | 'moderator' | 'judge' | 'system'
    actorId: text('actor_id'),
    actorName: text('actor_name'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_tournament_created_idx').on(table.tournamentId, table.createdAt),
    index('audit_log_match_idx').on(table.matchId),
  ]
);

// =========================================================================
// 2. Decoupled Registration & Category Setup (Official & Festival Support)
// =========================================================================

export const tournamentCategoryDefinitions = pgTable('tournament_category_definitions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  categoryName: text('category_name').notNull(),
  eventType: text('event_type').notNull(), // 'kumite' | 'kata' | 'team_kumite' | 'team_kata'
  gender: text('gender').notNull(), // 'M' | 'F' | 'any'
  minAge: integer('min_age'),
  maxAge: integer('max_age'),
  minWeight: numeric('min_weight', { precision: 5, scale: 2 }),
  maxWeight: numeric('max_weight', { precision: 5, scale: 2 }),
  rules: jsonb('rules').default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const tournamentRegistrations = pgTable(
  'tournament_registrations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    weight: numeric('weight', { precision: 5, scale: 2 }),
    kata: boolean('kata').notNull().default(false),
    kumite: boolean('kumite').notNull().default(false),
    teamKata: boolean('team_kata').notNull().default(false),
    teamKumite: boolean('team_kumite').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.tournamentId, table.athleteId)]
);

/**
 * Optional call-area attendance (PLAN Phase 6). A helper, never a gate: nothing
 * blocks on it; the moderator just sees a hint. No row means "not taken".
 * Keyed by (category, athlete) because athletes reach a category through
 * either `category_entries` or `athletes.category_id`.
 */
export const categoryAttendance = pgTable(
  'category_attendance',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // 'present' | 'absent' | 'withdrawn'
    setBy: text('set_by').notNull(), // "role:name"
    setAt: timestamp('set_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.categoryId, table.athleteId)]
);

export const categoryEntries = pgTable(
  'category_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    registrationId: uuid('registration_id').references(
      () => tournamentRegistrations.id,
      { onDelete: 'cascade' }
    ),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    seed: integer('seed'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.categoryId, table.athleteId)]
);

// =========================================================================
// 3. Tournament Draws & Match Execution (Silver-Meme Integration)
// =========================================================================

export const draws = pgTable('draws', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  categoryId: uuid('category_id')
    .notNull()
    .unique()
    .references(() => categories.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  format: text('format').notNull().default('SINGLE_ELIMINATION'),
  rulesetId: text('ruleset_id').notNull().default('WKF_KUMITE_2026'),
  tournamentSize: integer('tournament_size').notNull(),
  byeCount: integer('bye_count').notNull().default(0),
  checksum: text('checksum').notNull(),
  state: text('state').notNull().default('DRAFT'), // 'DRAFT' | 'LOCKED'
  // What this draw was actually generated with, so it can be re-read honestly.
  bronzeMedals: integer('bronze_medals').notNull().default(2),
  lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const drawVersions = pgTable(
  'draw_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    drawId: uuid('draw_id')
      .notNull()
      .references(() => draws.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    graph: jsonb('graph').notNull(),
    checksum: text('checksum').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.drawId, table.version)]
);

export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(), // formatted as e.g. "catId-m1"
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    matchNo: integer('match_no').notNull(),
    roundNo: integer('round_no').notNull(),
    roundName: text('round_name').notNull(),
    bracketType: text('bracket_type').notNull().default('MAIN'), // 'MAIN' | 'REPECHAGE_A' | 'REPECHAGE_B' | 'BRONZE'
    status: text('status').notNull().default('SCHEDULED'), // 'SCHEDULED' | 'READY' | 'LIVE' | 'COMPLETED' | 'CONFIRMED' | 'BYE'
    winnerId: uuid('winner_id').references(() => athletes.id, { onDelete: 'set null' }),
    akaScore: integer('aka_score').notNull().default(0),
    aoScore: integer('ao_score').notNull().default(0),
    akaPenalties: integer('aka_penalties').notNull().default(0),
    aoPenalties: integer('ao_penalties').notNull().default(0),
    senshu: text('senshu'),
    winnerSide: text('winner_side'),
    decisionMethod: text('decision_method'),
    kataScoringMode: text('kata_scoring_mode').default('FLAG'), // 'FLAG' | 'POINTS'
    // Judge phones may vote only while 'open'; 'closed' locks the votes.
    kataVoting: text('kata_voting').notNull().default('idle'), // 'idle' | 'open' | 'closed'
    poolGroup: text('pool_group'), // e.g. 'Pool A', 'Pool B', 'Final Flight'
    akaKataName: text('aka_kata_name'),
    aoKataName: text('ao_kata_name'),
    akaFlags: integer('aka_flags').notNull().default(0),
    aoFlags: integer('ao_flags').notNull().default(0),
    akaScoreTotal: numeric('aka_score_total', { precision: 5, scale: 2 }),
    aoScoreTotal: numeric('ao_score_total', { precision: 5, scale: 2 }),
  },
  (table) => [unique().on(table.categoryId, table.matchNo)]
);

export const kataScores = pgTable(
  'kata_scores',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id').references(() => athletes.id, { onDelete: 'set null' }),
    targetSide: text('target_side').notNull().default('AKA'), // 'AKA' | 'AO' | 'BOTH'
    judgeSeat: integer('judge_seat').notNull(), // 1 to 7
    judgeDeviceToken: text('judge_device_token'), // legacy desk markers only ('MODERATOR_MANUAL')
    judgeSessionId: uuid('judge_session_id').references(() => judgeSessions.id, { onDelete: 'set null' }),
    judgeName: text('judge_name'), // who gave this mark, as shown on the bout record
    scoreType: text('score_type').notNull().default('FLAG'), // 'FLAG' | 'POINT'
    flagVote: text('flag_vote'), // 'AKA' | 'AO'
    numericScore: numeric('numeric_score', { precision: 4, scale: 2 }),
    isDropped: boolean('is_dropped').notNull().default(false),
    isOverridden: boolean('is_overridden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.matchId, table.judgeSeat, table.targetSide)]
);

export const matchSlots = pgTable(
  'match_slots',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(), // 1 for AKA, 2 for AO
    slotType: text('slot_type').notNull(), // 'ENTRY' | 'WINNER_OF' | 'LOSER_OF' | 'BYE'
    athleteId: uuid('athlete_id').references(() => athletes.id, { onDelete: 'set null' }),
    sourceMatchId: text('source_match_id').references((): AnyPgColumn => matches.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => [unique().on(table.matchId, table.position)]
);

export const matchEvents = pgTable(
  'match_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    actor: text('actor'),
    deviceId: text('device_id'),
    commandId: text('command_id'),
    ts: timestamp('ts', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.matchId, table.seq)]
);

// =========================================================================
// 4. Relational Mappings
// =========================================================================

export const tournamentsRelations = relations(tournaments, ({ one, many }) => ({
  admin: one(admins, { fields: [tournaments.adminId], references: [admins.id] }),
  rings: many(rings),
  categories: many(categories),
  athletes: many(athletes),
  categoryDefinitions: many(tournamentCategoryDefinitions),
  registrations: many(tournamentRegistrations),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [categories.tournamentId], references: [tournaments.id] }),
  entries: many(categoryEntries),
  draw: one(draws, { fields: [categories.id], references: [draws.categoryId] }),
  matches: many(matches),
  assignment: one(categoryAssignments, { fields: [categories.id], references: [categoryAssignments.categoryId] }),
}));

export const athletesRelations = relations(athletes, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [athletes.tournamentId], references: [tournaments.id] }),
  category: one(categories, { fields: [athletes.categoryId], references: [categories.id] }),
  registrations: many(tournamentRegistrations),
  categoryEntries: many(categoryEntries),
}));

export const categoryEntriesRelations = relations(categoryEntries, ({ one }) => ({
  category: one(categories, { fields: [categoryEntries.categoryId], references: [categories.id] }),
  registration: one(tournamentRegistrations, { fields: [categoryEntries.registrationId], references: [tournamentRegistrations.id] }),
  athlete: one(athletes, { fields: [categoryEntries.athleteId], references: [athletes.id] }),
}));

export const drawsRelations = relations(draws, ({ one, many }) => ({
  category: one(categories, { fields: [draws.categoryId], references: [categories.id] }),
  versions: many(drawVersions),
}));

export const ringsRelations = relations(rings, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [rings.tournamentId], references: [tournaments.id] }),
  assignments: many(categoryAssignments),
  moderatorRequests: many(moderatorRequests),
}));

export const categoryAssignmentsRelations = relations(categoryAssignments, ({ one }) => ({
  ring: one(rings, { fields: [categoryAssignments.ringId], references: [rings.id] }),
  category: one(categories, { fields: [categoryAssignments.categoryId], references: [categories.id] }),
}));

export const tournamentCategoryDefinitionsRelations = relations(tournamentCategoryDefinitions, ({ one }) => ({
  tournament: one(tournaments, { fields: [tournamentCategoryDefinitions.tournamentId], references: [tournaments.id] }),
}));

export const tournamentRegistrationsRelations = relations(tournamentRegistrations, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [tournamentRegistrations.tournamentId], references: [tournaments.id] }),
  athlete: one(athletes, { fields: [tournamentRegistrations.athleteId], references: [athletes.id] }),
  entries: many(categoryEntries),
}));

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  tournament: one(tournaments, { fields: [eventLog.tournamentId], references: [tournaments.id] }),
  ring: one(rings, { fields: [eventLog.ringId], references: [rings.id] }),
  category: one(categories, { fields: [eventLog.categoryId], references: [categories.id] }),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  category: one(categories, { fields: [matches.categoryId], references: [categories.id] }),
  slots: many(matchSlots),
  events: many(matchEvents),
  kataScores: many(kataScores),
}));

export const kataScoresRelations = relations(kataScores, ({ one }) => ({
  match: one(matches, { fields: [kataScores.matchId], references: [matches.id] }),
  athlete: one(athletes, { fields: [kataScores.athleteId], references: [athletes.id] }),
}));

