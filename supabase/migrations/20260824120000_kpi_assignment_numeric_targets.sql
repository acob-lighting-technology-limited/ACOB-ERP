-- Attainment needs a number to divide by. corporate_kpis.target_text is the
-- corporate target in natural language ("At least 5 portfolio projects
-- awarded by 31/12/2026") -- not something code can compute against, and
-- often not even the number a specific department is accountable for (two
-- CORE owners on one KPI frequently carry different quotas, per the
-- workbook's own "Action Target / Quota" column).
--
-- target_value is that department's own numeric quota, set once by the lead
-- (or admin) confirming their target -- the same "yellow cell" the source
-- workbook asked departments to fill in. Milestone-type KPIs don't need it:
-- their attainment comes from kpi_actuals.milestones_completed /
-- milestones_total directly.

ALTER TABLE public.kpi_assignments
  ADD COLUMN IF NOT EXISTS target_value numeric,
  ADD COLUMN IF NOT EXISTS target_unit  text;

COMMENT ON COLUMN public.kpi_assignments.target_value IS
  'This department''s own numeric target for the KPI (e.g. 5 for "5 projects"). NULL until the department lead confirms it. Not used for milestone-type KPIs.';
COMMENT ON COLUMN public.kpi_assignments.target_unit IS
  'Free-text unit label for display next to target_value, e.g. "projects", "%", "million naira".';

NOTIFY pgrst, 'reload schema';
