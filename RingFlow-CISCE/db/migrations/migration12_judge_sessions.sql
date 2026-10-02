-- =========================================================================
-- RingFlow Migration 12 — Judge panel rebuild
--
-- * judge_sessions replaces judge_requests: one row per phone per tatami seat,
--   bound to the requesting browser (claim_hash) and, once approved, to a
--   hashed session token. A partial unique index keeps one approved phone
--   per seat.
-- * rings.judge_pairing_key: the secret in the judge QR link; rotated with
--   the PIN.
-- * matches.kata_voting: 'idle' | 'open' | 'closed'. Judges vote only while open.
-- * kata_scores.judge_session_id / judge_name: who gave each mark.
--
-- judge_requests held only transient pairing requests (never approved by any
-- UI), so it is dropped. Idempotent: safe to run more than once.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.judge_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ring_id UUID NOT NULL REFERENCES public.rings(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL,
  judge_name TEXT NOT NULL,
  claim_hash TEXT,
  token_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  end_reason TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS judge_sessions_ring_status_idx ON public.judge_sessions (ring_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS judge_sessions_one_per_seat
  ON public.judge_sessions (ring_id, seat) WHERE status = 'approved';

ALTER TABLE public.rings ADD COLUMN IF NOT EXISTS judge_pairing_key TEXT;
UPDATE public.rings
SET judge_pairing_key = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE judge_pairing_key IS NULL;
ALTER TABLE public.rings ALTER COLUMN judge_pairing_key SET NOT NULL;

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS kata_voting TEXT NOT NULL DEFAULT 'idle';

ALTER TABLE public.kata_scores ADD COLUMN IF NOT EXISTS judge_session_id UUID;
ALTER TABLE public.kata_scores ADD COLUMN IF NOT EXISTS judge_name TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kata_scores_judge_session_id_judge_sessions_id_fk'
  ) THEN
    ALTER TABLE public.kata_scores
      ADD CONSTRAINT kata_scores_judge_session_id_judge_sessions_id_fk
      FOREIGN KEY (judge_session_id) REFERENCES public.judge_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP TABLE IF EXISTS public.judge_requests;

COMMIT;
