-- =========================================================================
-- RingFlow Migration 6 — Authoritative match clock, TV display flags,
-- and the missing organiser/stager request tables.
--
-- Safe to run more than once (every statement is idempotent) and safe on
-- both a local Postgres started from the Drizzle schema and a hosted
-- Supabase project that already ran migration.sql.
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. RINGS — MILLISECOND MATCH CLOCK + DISPLAY MIRROR
-- =========================================================================

ALTER TABLE public.rings
ADD COLUMN IF NOT EXISTS timer_duration_ms INTEGER NOT NULL DEFAULT 180000,
ADD COLUMN IF NOT EXISTS timer_accumulated_ms INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS sides_swapped BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the legacy second-precision columns without clobbering
-- values that are already set.
UPDATE public.rings
SET timer_duration_ms = match_duration_seconds * 1000
WHERE timer_duration_ms = 180000
  AND match_duration_seconds IS NOT NULL
  AND match_duration_seconds <> 180;

UPDATE public.rings
SET timer_accumulated_ms = timer_accumulated_seconds * 1000
WHERE timer_accumulated_ms = 0
  AND timer_accumulated_seconds <> 0;

-- =========================================================================
-- 2. TOURNAMENTS — PUBLIC TV SCOREBOARD FLAG
-- =========================================================================

ALTER TABLE public.tournaments
ADD COLUMN IF NOT EXISTS show_public_scoreboard BOOLEAN NOT NULL DEFAULT false;

-- =========================================================================
-- 3. ORGANISER REQUEST TABLES
--    Missing from db:push because they were never declared in the Drizzle
--    schema, which is why organiser login failed with
--    "Failed to submit access request".
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.organiser_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    access_code_used TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    session_token UUID UNIQUE,
    device_info JSONB DEFAULT '{}'::jsonb,
    organiser_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stager_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    access_code_used TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    session_token UUID UNIQUE,
    device_info JSONB DEFAULT '{}'::jsonb,
    stager_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organiser_requests_tournament
ON public.organiser_requests(tournament_id, status);

CREATE INDEX IF NOT EXISTS idx_organiser_requests_session
ON public.organiser_requests(session_token);

CREATE INDEX IF NOT EXISTS idx_stager_requests_tournament
ON public.stager_requests(tournament_id, status);

CREATE INDEX IF NOT EXISTS idx_stager_requests_session
ON public.stager_requests(session_token);

ALTER TABLE public.organiser_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stager_requests ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 4. ORGANISER CODE — BACKFILL, LOOKUP INDEX, SAFE UNIQUENESS
-- =========================================================================

ALTER TABLE public.tournaments
ADD COLUMN IF NOT EXISTS organiser_code TEXT;

UPDATE public.tournaments
SET organiser_code = upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6))
WHERE organiser_code IS NULL OR organiser_code = '';

CREATE INDEX IF NOT EXISTS idx_tournaments_organiser_code
ON public.tournaments (upper(organiser_code));

-- Only add the unique index when no duplicate codes exist, so an existing
-- deployment with collisions does not fail the migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.tournaments
    WHERE organiser_code IS NOT NULL AND organiser_code <> ''
    GROUP BY upper(organiser_code)
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_organiser_code_unique
    ON public.tournaments (upper(organiser_code))
    WHERE organiser_code IS NOT NULL AND organiser_code <> '';
  END IF;
END $$;

-- =========================================================================
-- 5. REALTIME PUBLICATION
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'organiser_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.organiser_requests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stager_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stager_requests;
  END IF;
END $$;

-- =========================================================================
-- 6. ROW LEVEL SECURITY POLICIES FOR THE REQUEST TABLES
-- =========================================================================

DROP POLICY IF EXISTS "Admins can manage organiser requests" ON public.organiser_requests;
DROP POLICY IF EXISTS "Public can insert organiser requests" ON public.organiser_requests;
DROP POLICY IF EXISTS "Public can read organiser requests" ON public.organiser_requests;
DROP POLICY IF EXISTS "Organisers can update own request" ON public.organiser_requests;
DROP POLICY IF EXISTS "Admins can manage stager requests" ON public.stager_requests;
DROP POLICY IF EXISTS "Public can insert stager requests" ON public.stager_requests;
DROP POLICY IF EXISTS "Public can read stager requests" ON public.stager_requests;
DROP POLICY IF EXISTS "Stagers can update own request" ON public.stager_requests;

-- RLS policies reference the Supabase `authenticated` role, which does not
-- exist on a plain local Postgres. Skip them there; the app talks to the
-- database as the table owner, so RLS is not what enforces access locally.
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'Skipping RLS policies: Supabase roles are not present on this database.';
    RETURN;
  END IF;

  EXECUTE $sql$
    CREATE POLICY "Admins can manage organiser requests" ON public.organiser_requests
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = organiser_requests.tournament_id AND t.admin_id = auth.uid()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = organiser_requests.tournament_id AND t.admin_id = auth.uid()
      ))
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Public can insert organiser requests" ON public.organiser_requests
      FOR INSERT WITH CHECK (true)
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Public can read organiser requests" ON public.organiser_requests
      FOR SELECT USING (true)
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Organisers can update own request" ON public.organiser_requests
      FOR UPDATE USING (session_token IS NOT NULL) WITH CHECK (session_token IS NOT NULL)
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Admins can manage stager requests" ON public.stager_requests
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = stager_requests.tournament_id AND t.admin_id = auth.uid()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.tournaments t
        WHERE t.id = stager_requests.tournament_id AND t.admin_id = auth.uid()
      ))
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Public can insert stager requests" ON public.stager_requests
      FOR INSERT WITH CHECK (true)
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Public can read stager requests" ON public.stager_requests
      FOR SELECT USING (true)
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Stagers can update own request" ON public.stager_requests
      FOR UPDATE USING (session_token IS NOT NULL) WITH CHECK (session_token IS NOT NULL)
  $sql$;
END $policy$;

COMMIT;
