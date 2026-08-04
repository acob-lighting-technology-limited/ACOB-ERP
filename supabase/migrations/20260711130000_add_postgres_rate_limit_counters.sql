-- Shared, cross-lambda rate-limit store for lib/rate-limit.ts. Used as the
-- production fallback when Upstash Redis isn't configured, since an
-- in-memory Map is per-lambda-instance and effectively no limit on Vercel.
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_counters FROM PUBLIC, anon, authenticated;

-- Atomically increments the counter for `p_key`, resetting it if the window
-- has elapsed, and returns whether the request is still within `p_limit`.
-- SECURITY DEFINER + service_role-only EXECUTE since this table has no
-- direct grants — only this function may touch it.
CREATE OR REPLACE FUNCTION public.rate_limit_increment(p_key text, p_window_seconds integer, p_limit integer)
RETURNS TABLE (allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_reset_at timestamptz;
  v_count integer;
BEGIN
  -- Opportunistic cleanup of long-stale rows so the table doesn't grow
  -- unbounded; cheap no-op most of the time.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters WHERE reset_at < v_now - interval '1 day';
  END IF;

  INSERT INTO public.rate_limit_counters (key, count, reset_at)
  VALUES (p_key, 1, v_now + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                   WHEN rate_limit_counters.reset_at < v_now THEN 1
                   ELSE rate_limit_counters.count + 1
                 END,
        reset_at = CASE
                     WHEN rate_limit_counters.reset_at < v_now THEN v_now + make_interval(secs => p_window_seconds)
                     ELSE rate_limit_counters.reset_at
                   END
  RETURNING rate_limit_counters.count, rate_limit_counters.reset_at INTO v_count, v_reset_at;

  RETURN QUERY SELECT (v_count <= p_limit), GREATEST(0, p_limit - v_count), v_reset_at;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_increment(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_increment(text, integer, integer) TO service_role;
