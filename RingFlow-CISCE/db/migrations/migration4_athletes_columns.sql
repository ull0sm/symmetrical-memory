-- =========================================================================
-- RingFlow Migration 4: Add School, School Code, and Sports ID to Athletes
-- Safe, idempotent column additions for Master Excel roster imports
-- =========================================================================

ALTER TABLE public.athletes 
  ADD COLUMN IF NOT EXISTS school TEXT,
  ADD COLUMN IF NOT EXISTS school_code TEXT,
  ADD COLUMN IF NOT EXISTS sports_id TEXT;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
