-- Attendance device key for Hikvision matching.
--
-- Hikvision sends one person ID per punch, which must map to exactly one person.
-- With namespaced employee numbers, the numeric suffix is no longer unique
-- (SIWES/001, PT/001, NYSC/001 all end in 001), so matching on the suffix collides.
--
-- device_key is a compact, unique form of the employee number that is what gets
-- enrolled on the Hikvision unit. It is DERIVED (generated) from employee_number,
-- so it is not a separate number to manage and it updates automatically on conversion:
--   * Full time   ACOB/2026/063        -> '063'       (unchanged; existing enrollments keep working)
--   * Contract/PT ACOB/SIWES/2026/001  -> 'SIWES001'  (code + number)

alter table public.profiles
  add column if not exists device_key text generated always as (
    case
      -- Full time: ACOB/{year}/{NNN} -> NNN
      when employee_number ~ '^ACOB/[0-9]{4}/[0-9]+$'
        then split_part(employee_number, '/', 3)
      -- Prefixed (contract / part-time): ACOB/{CODE}/{year}/{NNN} -> CODE || NNN
      when employee_number ~ '^ACOB/[A-Za-z0-9]+/[0-9]{4}/[0-9]+$'
        then upper(split_part(employee_number, '/', 2)) || split_part(employee_number, '/', 4)
      else null
    end
  ) stored;

create index if not exists idx_profiles_device_key on public.profiles (device_key);

comment on column public.profiles.device_key is
  'Compact unique ID enrolled on the Hikvision attendance unit, derived from employee_number. '
  'Full-time = numeric suffix (e.g. 063); contract/part-time = CODE+suffix (e.g. SIWES001).';
