-- =========================================================================
-- RingFlow Migration 17 — size of each part of a split category
--
-- category_assignments.part_athletes  athletes drawn into this pool (the pool winners for FINALS)
-- category_assignments.part_matches   bouts this part actually runs (byes and walkovers excluded)
--
-- Written when the admin splits a category; NULL for a whole-category assignment. Screens show a
-- pool as "N athletes, M bouts" and measure its progress against its own bouts, not the category's.
-- Idempotent.
-- =========================================================================

BEGIN;

ALTER TABLE public.category_assignments ADD COLUMN IF NOT EXISTS part_athletes integer;
ALTER TABLE public.category_assignments ADD COLUMN IF NOT EXISTS part_matches integer;

COMMIT;
