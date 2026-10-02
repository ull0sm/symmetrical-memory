-- =========================================================================
-- RingFlow Migration 7 — Draw options (bronze / repechage) and results records
--
-- Safe to run more than once, and safe on both a local Postgres created from
-- the Drizzle schema and a hosted Supabase project.
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. TOURNAMENT DEFAULT — how many bronze medals a category awards
--    0 = no bronze bout, 1 = single bronze, 2 = repechage with two (WKF)
-- =========================================================================

ALTER TABLE public.tournaments
ADD COLUMN IF NOT EXISTS default_bronze_medals INTEGER NOT NULL DEFAULT 2;

-- =========================================================================
-- 2. PER-CATEGORY OVERRIDE — NULL inherits the tournament default
-- =========================================================================

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS bronze_medals INTEGER;

-- =========================================================================
-- 3. DRAW RECORD — what each generated draw was actually built with
-- =========================================================================

ALTER TABLE public.draws
ADD COLUMN IF NOT EXISTS bronze_medals INTEGER NOT NULL DEFAULT 2;

-- Existing draws were all generated with the WKF default, so the default value
-- is already the honest answer for them.

-- =========================================================================
-- 4. RESULTS EXPORT SUPPORT
--    The tournament-wide results record is built by joining matches to
--    athletes through match_slots; make that read cheap.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_matches_category_match_no
ON public.matches (category_id, match_no);

CREATE INDEX IF NOT EXISTS idx_match_slots_match_position
ON public.match_slots (match_id, position);

CREATE INDEX IF NOT EXISTS idx_categories_tournament
ON public.categories (tournament_id);

COMMIT;
