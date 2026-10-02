-- =========================================================================
-- RingFlow Migration 15 — draw profile (Official WKF vs Local) and separation
--
-- tournaments.draw_profile     'OFFICIAL' | 'LOCAL'   (default LOCAL)
-- tournaments.draw_separation  'CLUB' | 'OFF'         (default CLUB; Local only)
-- categories.draw_profile      NULL = inherit the tournament's profile
--
-- Existing events keep behaving as before: LOCAL with club separation on.
-- Idempotent.
-- =========================================================================

BEGIN;

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS draw_profile text NOT NULL DEFAULT 'LOCAL';
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS draw_separation text NOT NULL DEFAULT 'CLUB';
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS draw_profile text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_draw_profile_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_draw_profile_check CHECK (draw_profile IN ('OFFICIAL', 'LOCAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_draw_separation_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_draw_separation_check CHECK (draw_separation IN ('CLUB', 'OFF'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_draw_profile_check') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_draw_profile_check CHECK (draw_profile IS NULL OR draw_profile IN ('OFFICIAL', 'LOCAL'));
  END IF;
END $$;

COMMIT;
