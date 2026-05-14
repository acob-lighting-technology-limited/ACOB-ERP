-- Add expires_at column
ALTER TABLE public.idempotency_keys
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
    NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON public.idempotency_keys (expires_at);

-- Backfill: existing rows expire immediately (they're already old)
UPDATE public.idempotency_keys
SET expires_at = NOW()
WHERE expires_at IS NULL OR expires_at > NOW() + INTERVAL '24 hours';

-- Auto-cleanup function (called by a pg_cron job or triggered manually)
CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.idempotency_keys WHERE expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
