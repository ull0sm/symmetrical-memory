-- =========================================================================
-- RingFlow Migration 8 — Live change feed (LISTEN/NOTIFY) for the SSE bridge
--
-- The app talks to a plain PostgREST proxy, which has no websocket service, so
-- Supabase Realtime channels are inert. Instead every row change on the tables
-- a live screen cares about raises a NOTIFY on a single channel, and the Node
-- server turns those into Server-Sent Events for the browsers.
--
-- The payload carries ids only: NOTIFY payloads are capped at 8000 bytes and
-- every subscriber re-reads what it needs through its existing queries.
--
-- Safe to run more than once, and safe on both a local Postgres created from
-- the Drizzle schema and a hosted Supabase project.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.ringflow_notify() RETURNS TRIGGER AS $$
DECLARE
  payload JSONB;
  row_data JSONB;
BEGIN
  -- DELETE has no NEW; keep whatever the old row can tell us.
  row_data := COALESCE(to_jsonb(NEW), to_jsonb(OLD));

  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'op', TG_OP
  );

  -- Only include keys that exist on this table, so the payload stays small and
  -- the subscriber can match on whichever id it scoped itself to.
  IF row_data ? 'id' THEN
    payload := payload || jsonb_build_object('id', row_data->'id');
  END IF;
  IF row_data ? 'ring_id' THEN
    payload := payload || jsonb_build_object('ringId', row_data->'ring_id');
  END IF;
  IF row_data ? 'tournament_id' THEN
    payload := payload || jsonb_build_object('tournamentId', row_data->'tournament_id');
  END IF;
  IF row_data ? 'category_id' THEN
    payload := payload || jsonb_build_object('categoryId', row_data->'category_id');
  END IF;
  IF row_data ? 'match_id' THEN
    payload := payload || jsonb_build_object('matchId', row_data->'match_id');
  END IF;
  IF row_data ? 'session_token' THEN
    payload := payload || jsonb_build_object('sessionToken', row_data->'session_token');
  END IF;

  -- A ring, a category and a match are their own scope, so a screen watching
  -- "this mat" or "this category" has to be able to match the row's own id.
  IF TG_TABLE_NAME = 'rings' THEN
    payload := payload || jsonb_build_object('ringId', row_data->'id');
  ELSIF TG_TABLE_NAME = 'categories' THEN
    payload := payload || jsonb_build_object('categoryId', row_data->'id');
  ELSIF TG_TABLE_NAME = 'matches' THEN
    payload := payload || jsonb_build_object(
      'matchId', row_data->'id',
      'akaScore', row_data->'aka_score',
      'aoScore', row_data->'ao_score',
      'akaPenalties', row_data->'aka_penalties',
      'aoPenalties', row_data->'ao_penalties',
      'senshu', row_data->'senshu',
      'status', row_data->'status'
    );
    -- Resolve ringId from category_assignments so screens watching ringId get instant score updates
    IF row_data ? 'category_id' AND (row_data->>'category_id') IS NOT NULL THEN
      DECLARE
        resolved_ring_id UUID;
        resolved_tourn_id UUID;
      BEGIN
        SELECT ring_id INTO resolved_ring_id FROM public.category_assignments WHERE category_id = (row_data->>'category_id')::uuid LIMIT 1;
        IF resolved_ring_id IS NOT NULL THEN
          payload := payload || jsonb_build_object('ringId', resolved_ring_id);
        END IF;
        SELECT tournament_id INTO resolved_tourn_id FROM public.categories WHERE id = (row_data->>'category_id')::uuid LIMIT 1;
        IF resolved_tourn_id IS NOT NULL THEN
          payload := payload || jsonb_build_object('tournamentId', resolved_tourn_id);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  ELSIF TG_TABLE_NAME = 'category_assignments' THEN
    -- Resolve tournament_id from rings so admin, organiser, and stager watching tournamentId receive category assignment changes immediately
    IF row_data ? 'ring_id' AND (row_data->>'ring_id') IS NOT NULL THEN
      DECLARE
        resolved_tourn_id UUID;
      BEGIN
        SELECT tournament_id INTO resolved_tourn_id FROM public.rings WHERE id = (row_data->>'ring_id')::uuid LIMIT 1;
        IF resolved_tourn_id IS NOT NULL THEN
          payload := payload || jsonb_build_object('tournamentId', resolved_tourn_id);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;

  -- 7999 is the hard limit; ids-only payloads sit far below it, but a defensive
  -- guard beats a runtime error inside a trigger.
  IF length(payload::text) < 7000 THEN
    PERFORM pg_notify('ringflow_events', payload::text);
  END IF;

  RETURN NULL; -- AFTER trigger: the return value is ignored.
END;
$$ LANGUAGE plpgsql;

-- Every table a live screen reads. The joins that resolve a category to its
-- tournament go through categories/rings, which are covered here.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'rings',
    'category_assignments',
    'matches',
    'draws',
    'match_slots',
    'categories',
    'event_log',
    'moderator_requests',
    'stager_requests',
    'organiser_requests',
    'tournaments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip tables that do not exist in this database rather than failing.
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_ringflow_notify', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ringflow_notify()',
      'trg_ringflow_notify', t
    );
  END LOOP;
END;
$$;

COMMIT;

-- Ask PostgREST to pick up any schema change immediately.
NOTIFY pgrst, 'reload schema';
