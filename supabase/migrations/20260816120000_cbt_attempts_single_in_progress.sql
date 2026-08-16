-- Two logins on the same account (same email+password) starting the same
-- review cycle at the exact same instant could both pass the "any existing
-- in_progress attempt?" check before either INSERT lands, producing two
-- separate in_progress cbt_attempts rows for one profile/cycle. Each could
-- then independently reach "submitted" and stomp the other's cbt_score on
-- performance_reviews. This closes the race at the database level.
create unique index if not exists cbt_attempts_profile_cycle_in_progress_uidx
  on public.cbt_attempts (profile_id, review_cycle_id)
  where status = 'in_progress';
