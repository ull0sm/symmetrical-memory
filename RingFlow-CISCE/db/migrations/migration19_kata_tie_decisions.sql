-- =========================================================================
-- RingFlow Migration 19 — ranked kata tie decisions
--
-- kata_tie_decisions   the moderator's decision on a tie that decides a medal in a
--                      Local ranked kata group (after a re-performance or a flag
--                      vote): the tied athletes in order, the method and a note.
--                      One row per set of tied athletes (tie_key); recording the
--                      same tie again replaces it, and every decision is audited.
--
-- Status CHECKs mirror src/lib/statuses.ts.
-- Idempotent: safe to run more than once, after db:push or on its own.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.kata_tie_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL,
  tie_key TEXT NOT NULL,
  athlete_ids JSONB NOT NULL,
  method TEXT NOT NULL,
  note TEXT NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT kata_tie_decisions_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE,
  CONSTRAINT kata_tie_decisions_method_check CHECK (method IN ('REPERFORMANCE', 'FLAG_VOTE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS kata_tie_decisions_category_tie_unique
  ON public.kata_tie_decisions (category_id, tie_key);

-- Staff screens only (the moderator's ranking): never on the public feed's list.
DROP TRIGGER IF EXISTS trg_ringflow_notify ON public.kata_tie_decisions;
CREATE TRIGGER trg_ringflow_notify AFTER INSERT OR UPDATE OR DELETE ON public.kata_tie_decisions
  FOR EACH ROW EXECUTE FUNCTION public.ringflow_notify();

COMMIT;
