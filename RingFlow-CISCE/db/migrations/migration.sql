-- =========================================================================
-- RingFlow Production Migration
-- Run this migration in the Supabase SQL Editor on top of master.sql
-- Consolidated schema additions, table updates, indexes, realtime sync,
-- and hardened tenant isolation policies.
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. TOURNAMENTS TABLE UPDATES
-- =========================================================================

-- 1.1 Add organiser_code (6-character access code for organiser login & approval)
ALTER TABLE public.tournaments 
ADD COLUMN IF NOT EXISTS organiser_code TEXT;

-- Populate organiser_code for any existing tournaments without a code
UPDATE public.tournaments 
SET organiser_code = upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6))
WHERE organiser_code IS NULL OR organiser_code = '';

CREATE INDEX IF NOT EXISTS idx_tournaments_organiser_code 
ON public.tournaments (upper(organiser_code));

-- 1.2 Add stager_codes (JSONB array of {code, label} for stager access)
ALTER TABLE public.tournaments 
ADD COLUMN IF NOT EXISTS stager_codes JSONB DEFAULT '[]'::jsonb;

-- 1.3 Clean up obsolete organiser_email column and table if they exist
DROP INDEX IF EXISTS idx_tournaments_organiser_email;
ALTER TABLE public.tournaments DROP COLUMN IF EXISTS organiser_email;
DROP TABLE IF EXISTS public.organisers CASCADE;


-- =========================================================================
-- 2. RINGS TABLE UPDATES (SYNCHRONIZED TATAMI TIMERS)
-- =========================================================================

ALTER TABLE public.rings 
ADD COLUMN IF NOT EXISTS timer_status TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS timer_paused_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS timer_accumulated_seconds INTEGER NOT NULL DEFAULT 0;


-- =========================================================================
-- 3. CATEGORY ASSIGNMENTS UPDATES (TIMING & STAGING COLUMNS)
-- =========================================================================

-- 3.1 Timing columns
ALTER TABLE public.category_assignments 
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER NOT NULL DEFAULT 0;

-- Backfill started_at for already-started categories using event_log if available
DO $$
BEGIN
  UPDATE public.category_assignments ca
  SET started_at = el.created_at
  FROM (
    SELECT category_id, MIN(created_at) as created_at
    FROM public.event_log
    WHERE action = 'START_CATEGORY'
    GROUP BY category_id
  ) el
  WHERE ca.category_id = el.category_id
  AND ca.started_at IS NULL;
END $$;

-- 3.2 Stager status tracking columns
--     stager_status: 'calling' | 'ready' | NULL
--     stager_name:   name of the stager who acted
--     stager_action_at: timestamp of last stager action
ALTER TABLE public.category_assignments 
ADD COLUMN IF NOT EXISTS stager_status TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS stager_name TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS stager_action_at TIMESTAMPTZ DEFAULT NULL;


-- =========================================================================
-- 4. ORGANISER REQUESTS TABLE (ACCESS CODE APPROVAL QUEUE)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.organiser_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    access_code_used TEXT NOT NULL,
    status request_status NOT NULL DEFAULT 'pending',
    session_token UUID UNIQUE,
    device_info JSONB DEFAULT '{}'::jsonb,
    organiser_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organiser_requests_tournament 
ON public.organiser_requests(tournament_id);

CREATE INDEX IF NOT EXISTS idx_organiser_requests_session 
ON public.organiser_requests(session_token);

ALTER TABLE public.organiser_requests ENABLE ROW LEVEL SECURITY;


-- =========================================================================
-- 5. STAGER REQUESTS TABLE (STAGER APPROVAL QUEUE)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.stager_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    access_code_used TEXT NOT NULL,
    status request_status NOT NULL DEFAULT 'pending',
    session_token UUID UNIQUE,
    device_info JSONB DEFAULT '{}'::jsonb,
    stager_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stager_requests_tournament 
ON public.stager_requests(tournament_id);

CREATE INDEX IF NOT EXISTS idx_stager_requests_session 
ON public.stager_requests(session_token);

ALTER TABLE public.stager_requests ENABLE ROW LEVEL SECURITY;


-- =========================================================================
-- 6. REALTIME REPLICATION PUBLICATION
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'rings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'category_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.category_assignments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'event_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_log;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'moderator_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.moderator_requests;
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
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

-- 7.0 Drop legacy / overly permissive policies
DROP POLICY IF EXISTS "Public can manage mod requests" ON public.moderator_requests;
DROP POLICY IF EXISTS "Public can manage rings" ON public.rings;
DROP POLICY IF EXISTS "Public can manage categories" ON public.categories;
DROP POLICY IF EXISTS "Public can manage tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Public can manage assignments" ON public.category_assignments;
DROP POLICY IF EXISTS "Public can manage admins" ON public.admins;
DROP POLICY IF EXISTS "Admins can manage tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Admins can view all tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Organisers can view all tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Organisers can view assigned tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Organisers can view rings" ON public.rings;
DROP POLICY IF EXISTS "Organisers can view categories" ON public.categories;
DROP POLICY IF EXISTS "Organisers can view athletes" ON public.athletes;

-- 7.1 Admins Table Policies
DROP POLICY IF EXISTS "Admins can view own record" ON public.admins;
DROP POLICY IF EXISTS "Admins can insert own record" ON public.admins;
DROP POLICY IF EXISTS "Admins can update own record" ON public.admins;
CREATE POLICY "Admins can view own record" ON public.admins 
    FOR SELECT TO authenticated 
    USING (auth.uid() = id);
CREATE POLICY "Admins can insert own record" ON public.admins 
    FOR INSERT TO authenticated 
    WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins can update own record" ON public.admins 
    FOR UPDATE TO authenticated 
    USING (auth.uid() = id);

-- 7.2 Tournaments Table Policies (Strict Admin Tenant Isolation)
DROP POLICY IF EXISTS "Admins can manage their tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Public can view active tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Public can view tournaments" ON public.tournaments;

CREATE POLICY "Admins can manage their tournaments" ON public.tournaments 
    FOR ALL TO authenticated 
    USING (admin_id = auth.uid())
    WITH CHECK (admin_id = auth.uid());

CREATE POLICY "Public can view active tournaments" ON public.tournaments 
    FOR SELECT 
    USING (status = 'active' OR status = 'completed' OR organiser_code IS NOT NULL);

-- 7.3 Rings Table Policies (Strict Admin Tenant Isolation)
DROP POLICY IF EXISTS "Admins can manage rings" ON public.rings;
DROP POLICY IF EXISTS "Public can view rings" ON public.rings;

CREATE POLICY "Admins can manage rings" ON public.rings 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = rings.tournament_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = rings.tournament_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can view rings" ON public.rings 
    FOR SELECT 
    USING (true);

-- 7.4 Categories Table Policies (Strict Admin Tenant Isolation)
DROP POLICY IF EXISTS "Admins can manage categories" ON public.categories;
DROP POLICY IF EXISTS "Public can view categories" ON public.categories;

CREATE POLICY "Admins can manage categories" ON public.categories 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = categories.tournament_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = categories.tournament_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can view categories" ON public.categories 
    FOR SELECT 
    USING (true);

-- 7.5 Athletes Table Policies (Strict Admin Tenant Isolation)
DROP POLICY IF EXISTS "Admins can manage athletes" ON public.athletes;
DROP POLICY IF EXISTS "Public can view athletes" ON public.athletes;

CREATE POLICY "Admins can manage athletes" ON public.athletes 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = athletes.tournament_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = athletes.tournament_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can view athletes" ON public.athletes 
    FOR SELECT 
    USING (true);

-- 7.6 Category Assignments Table Policies (Strict Admin Tenant Isolation)
DROP POLICY IF EXISTS "Admins can manage assignments" ON public.category_assignments;
DROP POLICY IF EXISTS "Public can view assignments" ON public.category_assignments;
DROP POLICY IF EXISTS "Public can update assignments" ON public.category_assignments;

CREATE POLICY "Admins can manage assignments" ON public.category_assignments 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.rings r
            JOIN public.tournaments t ON t.id = r.tournament_id 
            WHERE r.id = category_assignments.ring_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.rings r
            JOIN public.tournaments t ON t.id = r.tournament_id 
            WHERE r.id = category_assignments.ring_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can view assignments" ON public.category_assignments 
    FOR SELECT 
    USING (true);

CREATE POLICY "Public can update assignments" ON public.category_assignments 
    FOR UPDATE 
    USING (true)
    WITH CHECK (true);

-- 7.7 Moderator Requests Table Policies
DROP POLICY IF EXISTS "Admins can manage mod requests" ON public.moderator_requests;
DROP POLICY IF EXISTS "Public can insert mod requests" ON public.moderator_requests;
DROP POLICY IF EXISTS "Public can read mod requests" ON public.moderator_requests;
DROP POLICY IF EXISTS "Moderators can update own request" ON public.moderator_requests;

CREATE POLICY "Admins can manage mod requests" ON public.moderator_requests 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.rings r
            JOIN public.tournaments t ON t.id = r.tournament_id 
            WHERE r.id = moderator_requests.ring_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.rings r
            JOIN public.tournaments t ON t.id = r.tournament_id 
            WHERE r.id = moderator_requests.ring_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can insert mod requests" ON public.moderator_requests 
    FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Public can read mod requests" ON public.moderator_requests 
    FOR SELECT 
    USING (true);

CREATE POLICY "Moderators can update own request" ON public.moderator_requests 
    FOR UPDATE 
    USING (session_token IS NOT NULL)
    WITH CHECK (session_token IS NOT NULL);

-- 7.8 Organiser Requests Table Policies
DROP POLICY IF EXISTS "Admins can manage organiser requests" ON public.organiser_requests;
DROP POLICY IF EXISTS "Public can insert organiser requests" ON public.organiser_requests;
DROP POLICY IF EXISTS "Public can read organiser requests" ON public.organiser_requests;
DROP POLICY IF EXISTS "Organisers can update own request" ON public.organiser_requests;

CREATE POLICY "Admins can manage organiser requests" ON public.organiser_requests 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = organiser_requests.tournament_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = organiser_requests.tournament_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can insert organiser requests" ON public.organiser_requests 
    FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Public can read organiser requests" ON public.organiser_requests 
    FOR SELECT 
    USING (true);

CREATE POLICY "Organisers can update own request" ON public.organiser_requests 
    FOR UPDATE 
    USING (session_token IS NOT NULL)
    WITH CHECK (session_token IS NOT NULL);

-- 7.9 Stager Requests Table Policies
DROP POLICY IF EXISTS "Admins can manage stager requests" ON public.stager_requests;
DROP POLICY IF EXISTS "Public can insert stager requests" ON public.stager_requests;
DROP POLICY IF EXISTS "Public can read stager requests" ON public.stager_requests;
DROP POLICY IF EXISTS "Stagers can update own request" ON public.stager_requests;

CREATE POLICY "Admins can manage stager requests" ON public.stager_requests 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = stager_requests.tournament_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = stager_requests.tournament_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can insert stager requests" ON public.stager_requests 
    FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Public can read stager requests" ON public.stager_requests 
    FOR SELECT 
    USING (true);

CREATE POLICY "Stagers can update own request" ON public.stager_requests 
    FOR UPDATE 
    USING (session_token IS NOT NULL)
    WITH CHECK (session_token IS NOT NULL);

-- 7.10 Event Log Table Policies (Strict Admin Tenant Isolation)
DROP POLICY IF EXISTS "Admins can manage event log" ON public.event_log;
DROP POLICY IF EXISTS "Public can view event log" ON public.event_log;
DROP POLICY IF EXISTS "Public can insert event logs" ON public.event_log;

CREATE POLICY "Admins can manage event log" ON public.event_log 
    FOR ALL TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = event_log.tournament_id 
            AND t.admin_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tournaments t 
            WHERE t.id = event_log.tournament_id 
            AND t.admin_id = auth.uid()
        )
    );

CREATE POLICY "Public can view event log" ON public.event_log 
    FOR SELECT 
    USING (true);

CREATE POLICY "Public can insert event logs" ON public.event_log 
    FOR INSERT 
    WITH CHECK (true);

COMMIT;
