import type { CompetitionFormat } from '@event-suite/rules-engine';
import type { KataFlightDrawResult } from './kataFlightDraw';

/** Bracket formats the engine can produce (blueprint §5). */
export type DrawFormat = CompetitionFormat;

/** Slot position within a match: 1 is the top line (AKA), 2 the bottom (AO). */
export type SlotPosition = 1 | 2;

/**
 * How a match slot gets filled.
 *
 * `REPECHAGE` slots are deliberately unresolved at generation time: their
 * entrants depend on who reaches the final (blueprint §5.3). `ENTRY` is a kata
 * pool entrant: the athlete is fixed at generation, like `ATHLETE`.
 */
export type SlotType = 'ATHLETE' | 'ENTRY' | 'WINNER_OF' | 'LOSER_OF' | 'BYE' | 'REPECHAGE';

export type BracketType = 'MAIN' | 'REPECHAGE' | 'BRONZE' | 'POOL';

/** One entrant in a category. */
export interface Participant {
  registrationId: string;
  displayName: string;
  clubId: string;
  districtId: string | null;
}

export interface SeedAssignment {
  registrationId: string;
  /** 1-based; 1 is the strongest. */
  seed: number;
}

export interface SeedingOptions {
  mode: 'NONE' | 'MANUAL' | 'RANKING' | 'RANDOM_SEEDED';
  seeds?: readonly SeedAssignment[];
  /** Required for RANDOM_SEEDED; makes a redraw reproducible. */
  randomSeed?: number;
}

export interface SeparationOptions {
  by: 'CLUB' | 'DISTRICT';
  rule: 'FIRST_ROUND' | 'SAME_HALF_BLOCKED';
}

export interface DrawOptions {
  /** When false, a category with fewer entrants than the bracket size is refused. */
  allowByes?: boolean;
  /**
   * How many bronze medals the category awards.
   *
   * 2 — Official WKF default: repechage ladders for everyone beaten by finalists (2 bronzes).
   * 1 — Local Official: the two semifinal losers meet once for a single bronze, no repechage (1 bronze).
   * 3 — Local Official: both semifinal losers awarded bronze without extra matches (2 bronzes).
   * 0 — no bronze bout at all (draw stops at the final).
   *
   * This is a decision the organiser makes before the draw, not after.
   */
  bronzeMedals?: 0 | 1 | 2 | 3;
}

export interface DrawInput {
  categoryId: string;
  format: DrawFormat;
  participants: readonly Participant[];
  seeding: SeedingOptions;
  separation?: SeparationOptions;
  options?: DrawOptions;
}

/**
 * A lazily-bound repechage slot.
 *
 * The ladder skeleton is created at generation time; the resolver fills it in
 * once the semifinals decide who the two finalists are.
 */
export interface RepechageRule {
  kind: 'LOSERS_TO_FINALIST';
  /** Which finalist's line this rung belongs to. */
  line: 'A' | 'B';
  /**
   * The round in that line whose loser fills this rung. Rung 0 is the earliest
   * loser; the highest rung is the semifinal loser.
   *
   * Keyed by round rather than by position so that a bye — which produces no
   * loser — leaves its rung empty and cascades, exactly as a bye does in the
   * main bracket.
   */
  roundNo: number;
}

export interface SlotNode {
  id: string;
  matchId: string;
  position: SlotPosition;
  slotType: SlotType;
  /** Set when slotType is ATHLETE. */
  registrationId: string | null;
  /** Set when slotType is WINNER_OF or LOSER_OF. */
  sourceMatchId: string | null;
  /** Set when slotType is REPECHAGE. */
  repechageRule: RepechageRule | null;
}

export interface MatchNode {
  id: string;
  /** Sequential within the category, starting at 1. */
  matchNo: number;
  /** 0-based; 0 is the first round fought. */
  roundNo: number;
  roundName: string;
  bracketType: BracketType;
  poolId: string | null;
  slotIds: readonly [string, string];
  /** Kata pool flights only: the pool this bout belongs to ("Pool A", "Final Flight"). */
  poolGroup?: string | null;
  /** Kata only: how the bout is scored. */
  kataScoringMode?: 'FLAG' | 'POINTS' | null;
  /** Status a bout is created with when it differs from SCHEDULED (the first kata bout starts READY). */
  startStatus?: 'READY';
}

export interface Round {
  roundNo: number;
  name: string;
  matchIds: readonly string[];
}

export interface Pool {
  id: string;
  name: string;
  matchIds: readonly string[];
  registrationIds: readonly string[];
}

export type DrawWarningCode =
  | 'SINGLE_ENTRANT'
  | 'TWO_ENTRANTS'
  | 'SEPARATION_IMPOSSIBLE'
  | 'MISSING_SEED'
  | 'SEED_OUT_OF_RANGE'
  | 'POOL_LARGER_THAN_SETTING';

export interface DrawWarning {
  code: DrawWarningCode;
  message: string;
  registrationIds?: readonly string[];
}

/** The engine's output: a complete, deterministic bracket description. */
export interface DrawGraph {
  categoryId: string;
  format: DrawFormat;
  rulesetId: string;
  /** Bracket size — the next power of two at or above the entrant count. */
  tournamentSize: number;
  byeCount: number;
  bronzeMedals?: 0 | 1 | 2 | 3;
  randomSeed: number | null;
  rounds: readonly Round[];
  matches: readonly MatchNode[];
  slots: readonly SlotNode[];
  pools: readonly Pool[];
  /** Kata pool flights only: the pool and medal-flight structure the screens render. */
  flightDraw?: KataFlightDrawResult;
  warnings: readonly DrawWarning[];
  /** SHA-256 over the canonical form of this graph, for change detection. */
  checksum: string;
}
