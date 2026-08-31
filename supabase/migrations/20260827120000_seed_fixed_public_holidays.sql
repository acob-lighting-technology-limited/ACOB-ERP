-- Seed the Nigerian public holidays that fall on the same date every year.
--
-- These were being entered by hand each year, which is why the calendar had no
-- Christmas or New Year's Day at all — leave and attendance both treated them
-- as ordinary working days. The movable holidays (Good Friday, Easter Monday,
-- and the two Eids) still have to be added manually each year once the federal
-- government announces them.
--
-- location = 'all' is the company-wide scope used by the attendance admin.
-- ON CONFLICT DO NOTHING keeps this safe to re-run and leaves any date HR has
-- already entered (with their own name or created_by) untouched.

INSERT INTO public.holiday_calendar (holiday_date, location, name, is_business_day)
SELECT
  make_date(year_series.year, holiday.month, holiday.day),
  'all',
  holiday.name,
  false
FROM generate_series(2026, 2030) AS year_series(year)
CROSS JOIN (
  VALUES
    (1, 1, 'New Year''s Day'),
    (5, 1, 'Workers'' Day'),
    (6, 12, 'Democracy Day'),
    (10, 1, 'Independence Day'),
    (12, 25, 'Christmas Day'),
    (12, 26, 'Boxing Day')
) AS holiday(month, day, name)
ON CONFLICT (holiday_date, location) DO NOTHING;

NOTIFY pgrst, 'reload schema';
