-- Add cbt_details column to store verification metadata (e.g. entered DOB)
alter table public.cbt_attempts
  add column if not exists cbt_details jsonb;
