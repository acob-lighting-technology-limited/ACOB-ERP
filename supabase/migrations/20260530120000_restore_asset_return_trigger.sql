-- The on_asset_assignment_return trigger was dropped in 20260306194000 without replacement.
-- handle_asset_return() still exists in the DB — just recreate the trigger.

DROP TRIGGER IF EXISTS on_asset_assignment_return ON public.asset_assignments;

CREATE TRIGGER on_asset_assignment_return
  AFTER UPDATE ON public.asset_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_asset_return();
