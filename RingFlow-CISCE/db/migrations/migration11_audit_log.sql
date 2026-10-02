-- =========================================================================
-- RingFlow Migration 11 — Audit log (Phase 3)
--
-- Append-only record of every official action (approvals, scores, results,
-- corrections, draws, queue, settings). A trigger refuses UPDATE so history
-- cannot be rewritten; rows go away only with their tournament.
--
-- Idempotent: safe to run more than once.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  ring_id UUID,
  category_id UUID,
  match_id TEXT,
  actor_role TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  ip TEXT,
  user_agent TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before JSONB,
  after JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_tournament_created_idx ON public.audit_log (tournament_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_match_idx ON public.audit_log (match_id);

CREATE OR REPLACE FUNCTION public.audit_log_is_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON public.audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_is_append_only();

COMMIT;
