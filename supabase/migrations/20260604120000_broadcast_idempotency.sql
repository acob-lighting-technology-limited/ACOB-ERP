-- Idempotency ledger for admin broadcast sends.
--
-- Background: a single "Send Now" click could send to everyone twice. The
-- send-communications-mail edge function ran ~27s synchronously (one email at a
-- time behind a 500ms global rate limiter), long enough for the request to time
-- out and be retried while the first invocation was still running. With no
-- dedupe, each invocation sent the full recipient list again.
--
-- This table lets the edge function "claim" a broadcast by its client-generated
-- broadcast_id before sending. The PRIMARY KEY makes a second claim (a retry,
-- or a concurrent duplicate) fail with unique_violation, so it is skipped.

CREATE TABLE IF NOT EXISTS public.broadcast_dispatches (
  broadcast_id uuid PRIMARY KEY,
  subject text,
  department text,
  requested_by uuid,
  recipient_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  success_count integer,
  failure_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- The edge function uses the service-role key, which bypasses RLS. Enabling RLS
-- with no policies keeps this ledger inaccessible to anon/authenticated clients.
ALTER TABLE public.broadcast_dispatches ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.broadcast_dispatches IS
  'Idempotency ledger for admin broadcast emails. One row per broadcast_id; a duplicate claim (retry) is rejected by the primary key, preventing double-sends.';
