-- =========================================================================
-- RingFlow Migration 13 — Optional call-area attendance (Phase 6)
--
-- One row per (category, athlete) once the stager has marked them present,
-- absent or withdrawn. No row = not taken. Never blocks anything; the
-- moderator only sees a hint. Idempotent.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.category_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'withdrawn')),
  set_by TEXT NOT NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT category_attendance_category_id_athlete_id_unique UNIQUE (category_id, athlete_id)
);

COMMIT;
