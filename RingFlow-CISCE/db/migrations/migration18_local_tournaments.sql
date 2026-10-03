-- =========================================================================
-- RingFlow Migration 18 — Local tournaments
--
-- tournaments.tournament_type   'OFFICIAL' (default, today's flow) | 'LOCAL'
-- tournaments.belt_levels, local_* defaults each Local division event inherits
-- divisions                     an age · belt · sex block ("Category" in the Local UI)
-- division_events               kumite / kata inside a division, with its plan
-- categories.division_event_id  a Local group is an ordinary category of one division event
-- category_entries.division_event_id / guest   one group per athlete per event; admin guest entries
-- tournament_registrations.division_id / attendance   the athlete's one division and call-desk mark
-- athletes.walk_in / needs_review                       stager walk-ins awaiting the admin
-- group_drafts                  a group's layout before it is locked (seed + pins)
-- division_holds                who is preparing a division right now
--
-- Every existing tournament becomes OFFICIAL through the column default and
-- behaves exactly as before. Status CHECKs mirror src/lib/statuses.ts.
-- Idempotent: safe to run more than once, after db:push or on its own.
-- =========================================================================

BEGIN;

-- ---------------------------------------------------------------- tables
CREATE TABLE IF NOT EXISTS public.divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  name TEXT NOT NULL,
  sex TEXT NOT NULL DEFAULT 'any',
  age_min INTEGER,
  age_max INTEGER,
  belts JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT divisions_tournament_id_tournaments_id_fk FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE,
  CONSTRAINT divisions_tournament_id_name_unique UNIQUE (tournament_id, name),
  CONSTRAINT divisions_sex_check CHECK (sex IN ('M', 'F', 'any')),
  CONSTRAINT divisions_age_range_check CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max)
);

CREATE TABLE IF NOT EXISTS public.division_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  group_size INTEGER,
  bronze_medals INTEGER,
  bout_duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT division_events_division_id_divisions_id_fk FOREIGN KEY (division_id) REFERENCES public.divisions(id) ON DELETE CASCADE,
  CONSTRAINT division_events_division_id_event_type_unique UNIQUE (division_id, event_type),
  CONSTRAINT division_events_event_type_check CHECK (event_type IN ('kumite', 'kata')),
  CONSTRAINT division_events_group_size_check CHECK (group_size IS NULL OR group_size BETWEEN 1 AND 32),
  CONSTRAINT division_events_bronze_medals_check CHECK (bronze_medals IS NULL OR bronze_medals IN (1, 2)),
  CONSTRAINT division_events_bout_duration_check CHECK (bout_duration_ms IS NULL OR bout_duration_ms BETWEEN 10000 AND 600000)
);

-- ------------------------------------------------- columns on existing tables
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS tournament_type TEXT NOT NULL DEFAULT 'OFFICIAL';
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS belt_levels JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS local_bronze_medals INTEGER NOT NULL DEFAULT 2;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS local_kumite_group_size INTEGER NOT NULL DEFAULT 8;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS local_kata_group_size INTEGER NOT NULL DEFAULT 4;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS local_bout_duration_ms INTEGER;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS local_event_order TEXT NOT NULL DEFAULT 'KUMITE_FIRST';

ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS walk_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.tournament_registrations ADD COLUMN IF NOT EXISTS division_id UUID;
ALTER TABLE public.tournament_registrations ADD COLUMN IF NOT EXISTS attendance TEXT;
ALTER TABLE public.tournament_registrations ADD COLUMN IF NOT EXISTS attendance_set_by TEXT;
ALTER TABLE public.tournament_registrations ADD COLUMN IF NOT EXISTS attendance_set_at TIMESTAMPTZ;

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS division_event_id UUID;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS group_no INTEGER;

ALTER TABLE public.category_entries ADD COLUMN IF NOT EXISTS division_event_id UUID;
ALTER TABLE public.category_entries ADD COLUMN IF NOT EXISTS guest BOOLEAN NOT NULL DEFAULT false;

-- Foreign keys under the names drizzle-kit gives them, so db:push and this migration agree.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_registrations_division_id_divisions_id_fk') THEN
    ALTER TABLE public.tournament_registrations ADD CONSTRAINT tournament_registrations_division_id_divisions_id_fk
      FOREIGN KEY (division_id) REFERENCES public.divisions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_division_event_id_division_events_id_fk') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_division_event_id_division_events_id_fk
      FOREIGN KEY (division_event_id) REFERENCES public.division_events(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_entries_division_event_id_division_events_id_fk') THEN
    ALTER TABLE public.category_entries ADD CONSTRAINT category_entries_division_event_id_division_events_id_fk
      FOREIGN KEY (division_event_id) REFERENCES public.division_events(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------- draft and hold
CREATE TABLE IF NOT EXISTS public.group_drafts (
  category_id UUID PRIMARY KEY,
  seed BIGINT NOT NULL,
  pins JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT group_drafts_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.division_holds (
  division_id UUID PRIMARY KEY,
  tournament_id UUID NOT NULL,
  holder_kind TEXT NOT NULL,
  stager_code_hash TEXT,
  admin_id UUID,
  holder_name TEXT NOT NULL,
  holder_label TEXT,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT division_holds_division_id_divisions_id_fk FOREIGN KEY (division_id) REFERENCES public.divisions(id) ON DELETE CASCADE,
  CONSTRAINT division_holds_tournament_id_tournaments_id_fk FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE,
  CONSTRAINT division_holds_admin_id_admins_id_fk FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE,
  CONSTRAINT division_holds_holder_kind_check CHECK (holder_kind IN ('stager', 'admin')),
  CONSTRAINT division_holds_holder_check CHECK ((holder_kind = 'stager' AND stager_code_hash IS NOT NULL AND admin_id IS NULL) OR (holder_kind = 'admin' AND admin_id IS NOT NULL AND stager_code_hash IS NULL))
);

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS divisions_tournament_idx ON public.divisions (tournament_id, sort_order);
CREATE INDEX IF NOT EXISTS tournament_registrations_division_idx ON public.tournament_registrations (division_id);
CREATE UNIQUE INDEX IF NOT EXISTS categories_division_event_group_unique
  ON public.categories (division_event_id, group_no) WHERE division_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS category_entries_division_event_athlete_unique
  ON public.category_entries (division_event_id, athlete_id) WHERE division_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS division_holds_stager_code_unique
  ON public.division_holds (stager_code_hash) WHERE stager_code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS division_holds_admin_unique
  ON public.division_holds (admin_id) WHERE admin_id IS NOT NULL;

-- ------------------------------------------- checks on existing tables' columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_tournament_type_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_tournament_type_check CHECK (tournament_type IN ('OFFICIAL', 'LOCAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_local_event_order_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_local_event_order_check CHECK (local_event_order IN ('KUMITE_FIRST', 'KATA_FIRST'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_local_bronze_medals_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_local_bronze_medals_check CHECK (local_bronze_medals IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_local_group_sizes_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_local_group_sizes_check CHECK (local_kumite_group_size BETWEEN 1 AND 32 AND local_kata_group_size BETWEEN 1 AND 32);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_local_bout_duration_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_local_bout_duration_check CHECK (local_bout_duration_ms IS NULL OR local_bout_duration_ms BETWEEN 10000 AND 600000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_registrations_attendance_check') THEN
    ALTER TABLE public.tournament_registrations ADD CONSTRAINT tournament_registrations_attendance_check CHECK (attendance IS NULL OR attendance IN ('present', 'absent', 'withdrawn'));
  END IF;
END $$;

-- kata_format existed without a check; add it NOT VALID so odd legacy rows never
-- fail the migration, then validate where the data already complies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_kata_format_check') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_kata_format_check CHECK (kata_format IN ('BRACKET', 'GROUP_POOLS', 'RANKED')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.categories VALIDATE CONSTRAINT categories_kata_format_check;
  EXCEPTION
    WHEN check_violation THEN
    RAISE NOTICE 'categories_kata_format_check: existing rows outside the allowed values; new writes are still checked';
  END;
END $$;

-- ------------------------------------------------------- live change feed
-- Staff screens only: these tables are never added to the public feed's list
-- (PUBLIC_TABLES in src/lib/realtime/liveStream.ts). division_events carries no
-- tournament or category id, so its actions broadcast explicitly instead.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['divisions', 'division_holds', 'group_drafts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_ringflow_notify', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ringflow_notify()',
      'trg_ringflow_notify', t
    );
  END LOOP;
END $$;

COMMIT;
