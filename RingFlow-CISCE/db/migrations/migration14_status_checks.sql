-- =========================================================================
-- RingFlow Migration 14 — CHECK constraints on status columns (PLAN 7.6)
--
-- Generated from src/lib/statuses.ts (keep them in sync; the Drizzle schema
-- declares the same constraints). Each is added NOT VALID, so existing rows
-- never make this migration fail, then validated where the data already
-- complies. A constraint left unvalidated still guards every new write;
-- the NOTICE names it so the odd rows can be fixed and VALIDATE re-run.
-- Idempotent.
-- =========================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tournaments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_status_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check CHECK (status IN ('draft', 'active', 'completed')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.tournaments VALIDATE CONSTRAINT tournaments_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'tournaments_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.rings') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rings_timer_status_check') THEN
    ALTER TABLE public.rings ADD CONSTRAINT rings_timer_status_check CHECK (timer_status IN ('idle', 'running', 'paused', 'finished')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.rings VALIDATE CONSTRAINT rings_timer_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'rings_timer_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.categories') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_event_type_check') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_event_type_check CHECK (event_type IN ('kumite', 'kata', 'team_kumite', 'team_kata')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.categories VALIDATE CONSTRAINT categories_event_type_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'categories_event_type_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.categories') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_kata_scoring_mode_check') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_kata_scoring_mode_check CHECK (kata_scoring_mode IN ('FLAG', 'POINTS')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.categories VALIDATE CONSTRAINT categories_kata_scoring_mode_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'categories_kata_scoring_mode_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.category_assignments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_assignments_status_check') THEN
    ALTER TABLE public.category_assignments ADD CONSTRAINT category_assignments_status_check CHECK (status IN ('pending', 'running', 'paused', 'completed')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.category_assignments VALIDATE CONSTRAINT category_assignments_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'category_assignments_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.category_assignments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_assignments_stager_status_check') THEN
    ALTER TABLE public.category_assignments ADD CONSTRAINT category_assignments_stager_status_check CHECK (stager_status IS NULL OR stager_status IN ('calling', 'ready')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.category_assignments VALIDATE CONSTRAINT category_assignments_stager_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'category_assignments_stager_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.moderator_requests') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'moderator_requests_status_check') THEN
    ALTER TABLE public.moderator_requests ADD CONSTRAINT moderator_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.moderator_requests VALIDATE CONSTRAINT moderator_requests_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'moderator_requests_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.organiser_requests') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organiser_requests_status_check') THEN
    ALTER TABLE public.organiser_requests ADD CONSTRAINT organiser_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.organiser_requests VALIDATE CONSTRAINT organiser_requests_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'organiser_requests_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.stager_requests') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stager_requests_status_check') THEN
    ALTER TABLE public.stager_requests ADD CONSTRAINT stager_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.stager_requests VALIDATE CONSTRAINT stager_requests_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'stager_requests_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.judge_sessions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'judge_sessions_status_check') THEN
    ALTER TABLE public.judge_sessions ADD CONSTRAINT judge_sessions_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'ended')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.judge_sessions VALIDATE CONSTRAINT judge_sessions_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'judge_sessions_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.matches') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_status_check') THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_status_check CHECK (status IN ('SCHEDULED', 'PENDING', 'READY', 'LIVE', 'COMPLETED', 'FINISHED', 'CONFIRMED', 'BYE', 'WALKOVER', 'UNRESOLVED')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.matches VALIDATE CONSTRAINT matches_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'matches_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.matches') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_bracket_type_check') THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_bracket_type_check CHECK (bracket_type IN ('MAIN', 'REPECHAGE', 'REPECHAGE_A', 'REPECHAGE_B', 'BRONZE', 'POOL')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.matches VALIDATE CONSTRAINT matches_bracket_type_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'matches_bracket_type_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.matches') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_winner_side_check') THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_winner_side_check CHECK (winner_side IS NULL OR winner_side IN ('AKA', 'AO')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.matches VALIDATE CONSTRAINT matches_winner_side_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'matches_winner_side_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.matches') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_kata_scoring_mode_check') THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_kata_scoring_mode_check CHECK (kata_scoring_mode IS NULL OR kata_scoring_mode IN ('FLAG', 'POINTS')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.matches VALIDATE CONSTRAINT matches_kata_scoring_mode_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'matches_kata_scoring_mode_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.matches') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_kata_voting_check') THEN
    ALTER TABLE public.matches ADD CONSTRAINT matches_kata_voting_check CHECK (kata_voting IN ('idle', 'open', 'closed')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.matches VALIDATE CONSTRAINT matches_kata_voting_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'matches_kata_voting_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.kata_scores') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kata_scores_target_side_check') THEN
    ALTER TABLE public.kata_scores ADD CONSTRAINT kata_scores_target_side_check CHECK (target_side IN ('AKA', 'AO', 'BOTH')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.kata_scores VALIDATE CONSTRAINT kata_scores_target_side_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'kata_scores_target_side_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.kata_scores') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kata_scores_score_type_check') THEN
    ALTER TABLE public.kata_scores ADD CONSTRAINT kata_scores_score_type_check CHECK (score_type IN ('FLAG', 'POINT')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.kata_scores VALIDATE CONSTRAINT kata_scores_score_type_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'kata_scores_score_type_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.draws') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draws_state_check') THEN
    ALTER TABLE public.draws ADD CONSTRAINT draws_state_check CHECK (state IN ('DRAFT', 'LOCKED')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.draws VALIDATE CONSTRAINT draws_state_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'draws_state_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

DO $$
BEGIN
  IF to_regclass('public.category_attendance') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_attendance_status_check') THEN
    ALTER TABLE public.category_attendance ADD CONSTRAINT category_attendance_status_check CHECK (status IN ('present', 'absent', 'withdrawn')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.category_attendance VALIDATE CONSTRAINT category_attendance_status_check;
  EXCEPTION
    WHEN undefined_table OR undefined_object THEN NULL;
    WHEN check_violation THEN
    RAISE NOTICE 'category_attendance_status_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

COMMIT;
