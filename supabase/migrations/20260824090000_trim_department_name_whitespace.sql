-- The "Quality Assurance " department row carries a trailing space
-- ('Quality Assurance ', 18 chars) while every profile.department value that
-- should match it is the clean 'Quality Assurance' (17 chars, no trailing
-- space). Every exact-equality join between profiles.department and
-- departments.name — scoped queries, admin department lists, RLS checks —
-- silently fails to match this one department. Trimming it is the fix; no
-- other department name in the table carries stray whitespace.

UPDATE public.departments
SET name = trim(name)
WHERE name <> trim(name);

NOTIFY pgrst, 'reload schema';
