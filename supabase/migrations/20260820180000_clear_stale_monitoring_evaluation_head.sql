-- Migration: Clear stale department head on disabled Monitoring and Evaluation
--
-- "Monitoring and Evaluation" is is_active=false with zero members, but its
-- department_head_id still points at Caleb Obiechina, who actually leads
-- Stakeholder Engagement. That makes him a two-department head in the
-- departments table while his profile.lead_departments lists only one --
-- exactly the drift that trips LEAVE_APPROVER_CONFLICT in lib/hr/leave-routing.ts.
-- He is confirmed lead of Stakeholder Engagement only.
--
-- When M&E was disabled only is_active was flipped; department_head_id was
-- left behind. This clears it so reactivating M&E cannot silently recreate a
-- two-department head.

BEGIN;

UPDATE public.departments
SET department_head_id = NULL
WHERE name = 'Monitoring and Evaluation'
  AND is_active = false;

COMMIT;
