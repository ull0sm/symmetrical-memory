-- =========================================================================
-- RingFlow Migration 2
-- Run this migration in the Supabase SQL Editor on top of migration.sql
-- Consolidated additions:
-- 1. Category PDF storage document URL (doc_url column)
-- 2. Performance indexes for high-concurrency tournament operations
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. CATEGORIES TABLE UPDATES (PDF STUDENT LIST SUPPORT)
-- =========================================================================

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS doc_url TEXT DEFAULT NULL;

COMMENT ON COLUMN public.categories.doc_url IS 'Supabase Storage public CDN URL for this category''s student-list PDF. Null if no PDF uploaded.';


-- =========================================================================
-- 2. PERFORMANCE INDEXES (NON-BLOCKING & HIGH CONCURRENCY OPTIMIZATION)
-- =========================================================================

-- 2.1 Rings: Fast moderator access code lookup & ring queue order
CREATE INDEX IF NOT EXISTS idx_rings_access_code 
ON public.rings (access_code);

CREATE INDEX IF NOT EXISTS idx_rings_tournament_ring_order 
ON public.rings (tournament_id, ring_order ASC);


-- 2.2 Categories: Fast load for tatami balancing & category name matching
CREATE INDEX IF NOT EXISTS idx_categories_tournament_created_at 
ON public.categories (tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_categories_tournament_name 
ON public.categories (tournament_id, name);


-- 2.3 Category Assignments: Queue order sorting & active status filters
CREATE INDEX IF NOT EXISTS idx_assignments_ring_queue_order 
ON public.category_assignments (ring_id, queue_order ASC);

CREATE INDEX IF NOT EXISTS idx_assignments_ring_status 
ON public.category_assignments (ring_id, status);


-- 2.4 Event Log: Fast completed category check & category history
CREATE INDEX IF NOT EXISTS idx_event_log_ring_action 
ON public.event_log (ring_id, action);

CREATE INDEX IF NOT EXISTS idx_event_log_category_id 
ON public.event_log (category_id);


-- 2.5 Athletes: Fast listing and RLS policy checks by tournament
CREATE INDEX IF NOT EXISTS idx_athletes_tournament_id 
ON public.athletes (tournament_id);


-- 2.6 Moderator Requests: Fast session checks, approvals, and revokes
CREATE INDEX IF NOT EXISTS idx_moderator_requests_ring_status 
ON public.moderator_requests (ring_id, status);


-- 2.7 Organiser & Stager Requests: Fast approval queue status filters
CREATE INDEX IF NOT EXISTS idx_organiser_requests_tournament_status 
ON public.organiser_requests (tournament_id, status);

CREATE INDEX IF NOT EXISTS idx_stager_requests_tournament_status 
ON public.stager_requests (tournament_id, status);

COMMIT;
