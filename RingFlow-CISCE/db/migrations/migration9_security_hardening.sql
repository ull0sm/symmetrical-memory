-- =========================================================================
-- RingFlow Migration 9 — Security hardening
--
-- 1. The live-feed trigger no longer publishes session tokens.
-- 2. Access requests carry a claim hash so only the browser that asked for
--    access can collect the session once it is approved.
-- 3. Tatamis still on the old shared default PIN get a random one.
-- 4. Categories get a real event_type instead of relying on the name.
-- 5. Finished kata bouts use the same CONFIRMED status as kumite.
--
-- Idempotent: safe to run more than once.
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
  -- Access requests only ever announce their status. Session tokens and claim
  -- hashes are credentials and never leave the database.
  IF TG_TABLE_NAME IN ('moderator_requests', 'stager_requests', 'organiser_requests') THEN
    payload := payload || jsonb_build_object('status', row_data->'status');
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

ALTER TABLE public.moderator_requests ADD COLUMN IF NOT EXISTS claim_hash TEXT;
ALTER TABLE public.organiser_requests ADD COLUMN IF NOT EXISTS claim_hash TEXT;
ALTER TABLE public.stager_requests ADD COLUMN IF NOT EXISTS claim_hash TEXT;

UPDATE public.rings
SET judge_pin = lpad((floor(random() * 9000) + 1000)::int::text, 4, '0')
WHERE judge_pin IS NULL OR judge_pin = '1234';

ALTER TABLE public.rings ALTER COLUMN judge_pin DROP DEFAULT;

UPDATE public.categories
SET event_type = CASE
  WHEN name ILIKE '%team%kata%' THEN 'team_kata'
  WHEN name ILIKE '%team%kumite%' THEN 'team_kumite'
  WHEN name ILIKE '%kata%' THEN 'kata'
  ELSE 'kumite'
END
WHERE event_type IS NULL OR event_type = 'kumite';

-- 5. Kata bouts used to finish as COMPLETED while kumite used CONFIRMED, so
--    kata results were missing from the official results export.
UPDATE public.matches SET status = 'CONFIRMED' WHERE status = 'COMPLETED';

COMMIT;
