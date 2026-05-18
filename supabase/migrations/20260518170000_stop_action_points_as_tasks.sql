-- Stop mirroring weekly report action points into the task module.
DROP TRIGGER IF EXISTS tr_sync_weekly_report_tasks ON public.weekly_reports;
DROP FUNCTION IF EXISTS public.trg_sync_weekly_report_tasks();
DROP FUNCTION IF EXISTS public.sync_weekly_report_tasks(uuid);

DELETE FROM public.tasks
WHERE category = 'weekly_action';
