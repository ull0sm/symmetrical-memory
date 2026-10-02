-- =========================================================================
-- RingFlow Migration 5: Public Category Draws Visibility Toggle
-- Run this migration in the Supabase SQL Editor
-- =========================================================================

BEGIN;

-- Add show_public_draws to tournaments table (defaults to false)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS show_public_draws BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tournaments.show_public_draws IS 
  'Controls whether category draw sheet PDFs are publicly accessible in the public spectator event view.';

COMMIT;
