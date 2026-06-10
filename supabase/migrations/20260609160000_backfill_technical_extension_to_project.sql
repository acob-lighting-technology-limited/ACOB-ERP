-- Data backfill: the "Technical Extension" office location was renamed to "Project".
--
-- profiles.office_location and profiles.department are denormalised text copies of
-- the canonical names in office_locations / departments, so renaming the canonical
-- row left older profiles holding the stale string. This realigns them.
--
-- Idempotent: re-running is a no-op once no "Technical Extension" rows remain.
-- Going forward, the rename-cascade route keeps these in sync automatically.

UPDATE public.profiles
SET office_location = 'Project'
WHERE office_location = 'Technical Extension';

UPDATE public.profiles
SET department = 'Project'
WHERE department = 'Technical Extension';
