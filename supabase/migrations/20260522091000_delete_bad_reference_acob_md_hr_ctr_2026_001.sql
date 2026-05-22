-- Delete only the single correspondence record that was created with the
-- wrong category-in-reference format after the format was supposed to have
-- been fixed. All OTHER records that previously had a category in their
-- reference (e.g. older CTR references) are intentional historical records
-- and must NOT be modified or deleted.
--
-- Target: reference_number = 'ACOB/MD/HR/CTR/2026/001'
--         subject = 'OFFER OF EMPLOYMENT - HEAD, QUALITY ASSURANCE'

ALTER TABLE public.correspondence_records DISABLE TRIGGER trg_correspondence_records_before_update;

DELETE FROM public.correspondence_records
WHERE reference_number = 'ACOB/MD/HR/CTR/2026/001'
  AND subject ILIKE '%OFFER OF EMPLOYMENT%HEAD%QUALITY ASSURANCE%';

ALTER TABLE public.correspondence_records ENABLE TRIGGER trg_correspondence_records_before_update;
