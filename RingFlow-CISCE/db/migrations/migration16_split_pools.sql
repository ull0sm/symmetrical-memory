-- =========================================================================
-- RingFlow Migration 16 — run a category's pools on different tatamis
--
-- category_assignments.part  'ALL' (the whole category, the default)
--                            or, once split: 'POOL:n' for a pool, 'FINALS' for the rest
-- matches.part               NULL while the category is whole, else 'POOL:n' | 'FINALS'
--
-- A category used to have exactly one assignment (unique on category_id). It may now have one
-- per part, so the unique key becomes (category_id, part). A partial unique index keeps one
-- "primary" row (ALL, or FINALS once split) per category, which the balancing screen manages.
--
-- Existing assignments become part 'ALL' and behave exactly as before. Idempotent.
-- =========================================================================

BEGIN;

ALTER TABLE public.category_assignments ADD COLUMN IF NOT EXISTS part text NOT NULL DEFAULT 'ALL';
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS part text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_assignments_part_check') THEN
    ALTER TABLE public.category_assignments
      ADD CONSTRAINT category_assignments_part_check CHECK (part ~ '^(ALL|FINALS|POOL:[1-9][0-9]*)$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_part_check') THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_part_check CHECK (part IS NULL OR part ~ '^(FINALS|POOL:[1-9][0-9]*)$');
  END IF;

  -- One assignment per category becomes one per (category, part).
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_assignments_category_id_unique') THEN
    ALTER TABLE public.category_assignments DROP CONSTRAINT category_assignments_category_id_unique;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_assignments_category_id_part_unique') THEN
    ALTER TABLE public.category_assignments
      ADD CONSTRAINT category_assignments_category_id_part_unique UNIQUE (category_id, part);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS category_assignments_primary_unique
  ON public.category_assignments (category_id)
  WHERE part IN ('ALL', 'FINALS');

COMMIT;
