-- CRM has moved to a standalone system. These legacy tables are ERP residue:
-- crm_contacts / crm_activities / crm_opportunities were empty; crm_pipelines held
-- only a pipeline config row and crm_tags a few tag definitions. No application
-- code references them (verified) and no view/foreign-key depends on them. Remove.

drop table if exists public.crm_activities cascade;
drop table if exists public.crm_opportunities cascade;
drop table if exists public.crm_contacts cascade;
drop table if exists public.crm_pipelines cascade;
drop table if exists public.crm_tags cascade;
