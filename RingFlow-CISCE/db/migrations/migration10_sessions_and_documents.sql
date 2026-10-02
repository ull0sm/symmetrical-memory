-- =========================================================================
-- RingFlow Migration 10 — Hashed sessions and local category documents
--
-- 1. admin_sessions: random per-browser admin sessions; only token hashes stored.
-- 2. Staff sessions (moderator/stager/organiser) are looked up by sha256 hash.
--    Existing approved sessions are carried over by hashing their tokens.
-- 3. category_documents: category PDFs stored in Postgres (no Supabase Storage).
--
-- Idempotent: safe to run more than once.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_id_idx ON public.admin_sessions (admin_id);

ALTER TABLE public.moderator_requests ADD COLUMN IF NOT EXISTS session_token_hash TEXT;
ALTER TABLE public.organiser_requests ADD COLUMN IF NOT EXISTS session_token_hash TEXT;
ALTER TABLE public.stager_requests ADD COLUMN IF NOT EXISTS session_token_hash TEXT;

-- Unique constraints named the way drizzle-kit names them, so `db:push` agrees with this file.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('admin_sessions', 'token_hash'),
    ('moderator_requests', 'session_token_hash'),
    ('organiser_requests', 'session_token_hash'),
    ('stager_requests', 'session_token_hash')
  ) AS t(tbl, col) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.tbl || '_' || c.col || '_unique') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%I)', c.tbl, c.tbl || '_' || c.col || '_unique', c.col);
    END IF;
  END LOOP;
END $$;

UPDATE public.moderator_requests
SET session_token_hash = encode(sha256(convert_to(session_token::text, 'UTF8')), 'hex'), session_token = NULL
WHERE session_token IS NOT NULL;
UPDATE public.organiser_requests
SET session_token_hash = encode(sha256(convert_to(session_token::text, 'UTF8')), 'hex'), session_token = NULL
WHERE session_token IS NOT NULL;
UPDATE public.stager_requests
SET session_token_hash = encode(sha256(convert_to(session_token::text, 'UTF8')), 'hex'), session_token = NULL
WHERE session_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.category_documents (
  category_id UUID PRIMARY KEY REFERENCES public.categories(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL,
  content BYTEA NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Old doc_url values pointed at Supabase Storage, which no longer exists.
UPDATE public.categories SET doc_url = NULL WHERE doc_url IS NOT NULL AND doc_url NOT LIKE '/api/category-docs/%';

COMMIT;
