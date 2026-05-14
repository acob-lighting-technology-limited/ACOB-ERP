-- ============================================================
-- Import historical correspondence records from the manual
-- Excel reference tracker into the ERP.
--
-- Run in the Supabase SQL Editor (requires postgres superuser).
--
-- Duplicate-reference notes:
--   • RECOMMENDATION LETTERS sheet had two records numbered
--     ACOB/MD/CSC/REF/2026/001 (CSC and IRCC sections).
--     The second is renumbered to /002; the IRCC /002-/006
--     continue as /003-/007 to preserve the sequence.
--   • NIGER STATE had two records with ACOB/MD/NSIPA/2026/001.
--     The second (Niger State Government) is given /002.
-- ============================================================

-- Step 1: disable trigger so we can insert with explicit reference numbers
ALTER TABLE public.correspondence_records
  DISABLE TRIGGER trg_correspondence_records_before_insert;

-- Step 2: purge all existing test/placeholder data
TRUNCATE TABLE public.correspondence_events   CASCADE;
TRUNCATE TABLE public.correspondence_approvals CASCADE;
TRUNCATE TABLE public.correspondence_versions  CASCADE;
TRUNCATE TABLE public.correspondence_records   CASCADE;
TRUNCATE TABLE public.correspondence_counters;

-- Step 3: insert historical records
-- created_by_id / originator_id = Surajo Idris (f16cd078-5324-4837-a011-50c57f9a32d5)
-- status = 'sent' (all letters already issued)

DO $$
DECLARE
  v_surajo UUID := 'f16cd078-5324-4837-a011-50c57f9a32d5';
BEGIN

  -- ── MRS ─────────────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/2026/MRS/001',
     'REQUEST FOR FUEL COUPON ACCOUNT ARRANGEMENT',
     'Executive Management', 'MD', 'MRS', 'MRS', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-04', '2026-03-04', '2026-03-04', '2026-03-04 00:00:00+00', false, '{}');

  -- ── ROTARY ──────────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/RI/2026/001',
     'RE: INVITATION AS DISTINGUISHED GUEST OF HONOUR TO THE ROTARY INTERNATIONAL DISTRICT CONFERENCE (DISCON) - MAY 13, 2026',
     'Executive Management', 'MD', 'Rotary International District Conference', 'RI', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-21', '2026-04-21', '2026-04-21', '2026-04-21 00:00:00+00', false, '{}');

  -- ── ATC-NG ──────────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/ATC-NG/2026/001',
     'PAYMENT ADVICE - SOLAR POWER CONNECTION AT UMAISHA, TUNGA, AND ONIPANU COMMUNITIES',
     'Executive Management', 'MD', 'ATC-NG', 'ATC-NG', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-21', '2026-04-21', '2026-04-21', '2026-04-21 00:00:00+00', false, '{}');

  -- ── INTERNAL HR (6 records — internal letters) ───────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/HR/2025/001',
     'CONFIRMATION OF EMPLOYMENT AND NOTICE OF INCREMENT IN SALARY',
     'Executive Management', 'MD', 'Admin & HR Department', 'HR', 'internal',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-12', '2026-03-12', '2026-03-12', '2026-03-12 00:00:00+00', false,
     '{"remark":"Backdated letter (07/05/2025)"}'),

    ('ACOB/MD/HR/2026/001',
     'REDEPLOYMENT NOTICE',
     'Executive Management', 'MD', 'Admin & HR Department', 'HR', 'internal',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-04', '2026-03-04', '2026-03-04', '2026-03-04 00:00:00+00', false, '{}'),

    ('ACOB/MD/HR/2026/002',
     'REDEPLOYMENT NOTICE',
     'Executive Management', 'MD', 'Admin & HR Department', 'HR', 'internal',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-04', '2026-03-04', '2026-03-04', '2026-03-04 00:00:01+00', false, '{}'),

    ('ACOB/MD/HR/2026/003',
     'REDEPLOYMENT NOTICE',
     'Executive Management', 'MD', 'Admin & HR Department', 'HR', 'internal',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-04', '2026-03-04', '2026-03-04', '2026-03-04 00:00:02+00', false, '{}'),

    ('ACOB/MD/HR/2026/004',
     'APPOINTMENT AS HEAD OF STAKEHOLDER ENGAGEMENT',
     'Executive Management', 'MD', 'Admin & HR Department', 'HR', 'internal',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-05-05', '2026-05-05', '2026-05-05', '2026-05-05 00:00:00+00', false, '{}'),

    ('ACOB/MD/HR/2026/005',
     'APPOINTMENT AS PROCUREMENT OFFICER',
     'Executive Management', 'MD', 'Admin & HR Department', 'HR', 'internal',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-05-05', '2026-05-05', '2026-05-05', '2026-05-05 00:00:01+00', false, '{}');

  -- ── AEDC ─────────────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/AEDC/2026/001',
     'REQUEST FOR IDENTIFICATION OF ADDITIONAL LOCAL COMMUNITIES FOR INTERCONNECTED MINI-GRID DEVELOPMENT IN NASARAWA AND NIGER STATE',
     'Executive Management', 'MD', 'Abuja Electricity Distribution Company', 'AEDC', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-12', '2026-03-12', '2026-03-12', '2026-03-12 00:00:00+00', false, '{}');

  -- ── SECURITY ─────────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, category, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/MRB-DPO/SEC/2026/001',
     'LETTER OF APPRECIATION AND REQUEST FOR SECURITY COLLABORATION AT THE MARARABA UDEGE INTERCONNECTED MINI-GRID SITE',
     'Executive Management', 'MD', 'MRB-DPO Security', 'MRB-DPO', 'SEC', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-10', '2026-04-10', '2026-04-10', '2026-04-10 00:00:00+00', false, '{}');

  -- ── BGI — KNCV ───────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/BGI/KNCV/2026/001',
     'REQUEST TO SUBMIT QUOTATION FOR THE SUPPLY OF SOLAR PANELS INVERTER REPLACEMENT TO KNCV NIGERIA',
     'Business, Growth and Innovation', 'BGI', 'Knowledge Network for Disease Control and Vigilance', 'KNCV', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-25', '2026-03-25', '2026-03-25', '2026-03-25 00:00:00+00', false, '{}'),

    ('ACOB/BGI/LOTUS/2026/001',
     'REQUEST FOR PRODUCT FINANCING',
     'Business, Growth and Innovation', 'BGI', 'Lotus Bank', 'LOTUS', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:00+00', false, '{}'),

    ('ACOB/BGI/NBSA/2026/001',
     'REQUEST FOR COURTESY VISIT',
     'Business, Growth and Innovation', 'BGI', 'National Blood Service Agency', 'NBSA', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:01+00', false, '{}');

  -- ── RECOMMENDATION LETTERS ───────────────────────────────────────────────────
  -- Note: Excel had duplicate ACOB/MD/CSC/REF/2026/001 (CSC + IRCC sections).
  -- CSC gets /001; IRCC letters are renumbered /002-/007 in sequence order.
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, category, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/CSC/REF/2026/001',
     'LETTER OF RECOMMENDATION FOR COMMONWEALTH SCHOLARSHIP APPLICATION',
     'Executive Management', 'MD', 'Commonwealth Scholarship Council', 'CSC', 'REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:00+00', false, '{}'),

    ('ACOB/MD/CSC/REF/2026/002',
     'PROFESSIONAL ATTESTATION FOR EMMANUEL JOSEPH IBANGA',
     'Executive Management', 'MD', 'Immigration, Refugees and Citizenship Canada', 'CSC', 'REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:01+00', false,
     '{"note":"Original Excel ref was /001 (duplicate); renumbered to /002"}'),

    ('ACOB/MD/CSC/REF/2026/003',
     'PROFESSIONAL ATTESTATION FOR VANESSA LAWRENCE',
     'Executive Management', 'MD', 'Immigration, Refugees and Citizenship Canada', 'CSC', 'REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:02+00', false, '{}'),

    ('ACOB/MD/CSC/REF/2026/004',
     'PROFESSIONAL ATTESTATION FOR CALEB RAYMOND OBIECHINA',
     'Executive Management', 'MD', 'Immigration, Refugees and Citizenship Canada', 'CSC', 'REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:03+00', false, '{}'),

    ('ACOB/MD/CSC/REF/2026/005',
     'PROFESSIONAL ATTESTATION FOR BEVERLY TOCHUKWU OBIECHINA',
     'Executive Management', 'MD', 'Immigration, Refugees and Citizenship Canada', 'CSC', 'REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:04+00', false, '{}'),

    ('ACOB/MD/CSC/REF/2026/006',
     'PROFESSIONAL ATTESTATION FOR VICTORIA OMOJO AKOJI-OMALE',
     'Executive Management', 'MD', 'Immigration, Refugees and Citizenship Canada', 'CSC', 'REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:05+00', false, '{}'),

    ('ACOB/MD/CSC/REF/2026/007',
     'PROFESSIONAL ATTESTATION FOR CHUKWUEMEKA EZE',
     'Executive Management', 'MD', 'Immigration, Refugees and Citizenship Canada', 'CSC', 'REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:06+00', false, '{}');

  -- ── KANO STATE ───────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/KN-GOV/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR RENEWABLE ENERGY INVESTMENT AND SUSTAINABLE ELECTRICITY EXPANSION IN KANO STATE',
     'Executive Management', 'MD', 'Kano State Government House', 'KN-GOV', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-01', '2026-04-01', '2026-04-01', '2026-04-01 00:00:00+00', false, '{}'),

    ('ACOB/MD/KAN-MPRE/2026/001',
     'EXPRESSION OF INTEREST FOR STRATEGIC PARTNERSHIP ON RENEWABLE ENERGY INVESTMENT AND ELECTRICITY ACCESS EXPANSION IN KANO STATE',
     'Executive Management', 'MD', 'Kano State Ministry of Power and Renewable Energy', 'KAN-MPRE', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-01', '2026-04-01', '2026-04-01', '2026-04-01 00:00:01+00', false, '{}'),

    ('ACOB/MD/KAN-MCI/2026/001',
     'EXPRESSION OF INTEREST FOR STRATEGIC PARTNERSHIP ON RENEWABLE ENERGY INVESTMENT AND ELECTRICITY ACCESS EXPANSION IN KANO STATE',
     'Executive Management', 'MD', 'Kano State Ministry of Commerce and Industry', 'KAN-MCI', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-01', '2026-04-01', '2026-04-01', '2026-04-01 00:00:02+00', false, '{}'),

    ('ACOB/MD/KANINVEST/2026/001',
     'EXPRESSION OF INTEREST FOR STRATEGIC PARTNERSHIP ON RENEWABLE ENERGY INVESTMENT AND ELECTRICITY ACCESS EXPANSION IN KANO STATE',
     'Executive Management', 'MD', 'Kano State Investment Promotion Agency', 'KANINVEST', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-01', '2026-04-01', '2026-04-01', '2026-04-01 00:00:03+00', false, '{}'),

    ('ACOB/MD/KEDCO/2026/001',
     'INTRODUCTION AND STRATEGIC PARTNERSHIP PROPOSAL',
     'Executive Management', 'MD', 'Kano Electricity Distribution Company', 'KEDCO', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-14', '2026-04-14', '2026-04-14', '2026-04-14 00:00:00+00', false, '{}');

  -- ── NIGER STATE ──────────────────────────────────────────────────────────────
  -- Note: Excel had duplicate ACOB/MD/NSIPA/2026/001 for two different letters.
  -- First kept as /001; second (Niger State Government) assigned /002.
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/NSIPA/2026/001',
     'LETTER OF INTRODUCTION TO NIGER STATE INVESTMENT PROMOTION AGENCY',
     'Executive Management', 'MD', 'Niger State Investment Promotion Agency', 'NSIPA', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:00+00', false, '{}'),

    ('ACOB/MD/NSIPA/2026/002',
     'LETTER OF INTRODUCTION TO NIGER STATE GOVERNMENT',
     'Executive Management', 'MD', 'Niger State Government', 'NSIPA', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-26', '2026-03-26', '2026-03-26', '2026-03-26 00:00:01+00', false,
     '{"note":"Original Excel ref was /001 (duplicate); renumbered to /002"}');

  -- ── NASARAWA STATE ───────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, category, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/NASIDA/PROP/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR EXPANSION OF MINI-GRID INVESTMENT IN NASARAWA STATE',
     'Executive Management', 'MD', 'Nasarawa Investment Development Agency', 'NASIDA', 'PROP', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-13', '2026-03-13', '2026-03-13', '2026-03-13 00:00:00+00', false, '{}'),

    ('ACOB/MD/NASEB/PROP/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR EXPANSION OF MINI-GRID INVESTMENT IN NASARAWA STATE',
     'Executive Management', 'MD', 'Nasarawa Electricity Board', 'NASEB', 'PROP', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-13', '2026-03-13', '2026-03-13', '2026-03-13 00:00:01+00', false, '{}');

  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/NASERC/2026/001',
     'INTRODUCTION OF ACOB LIGHTING TECHNOLOGY AS A STRATEGIC PARTNER',
     'Executive Management', 'MD', 'Nasarawa Electricity Regulatory Commission', 'NASERC', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-30', '2026-03-30', '2026-03-30', '2026-03-30 00:00:00+00', false, '{}'),

    ('ACOB/MD/NASERC/2026/002',
     'REQUEST FOR A COURTESY VISIT',
     'Executive Management', 'MD', 'Nasarawa Electricity Regulatory Commission', 'NASERC', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-30', '2026-03-30', '2026-03-30', '2026-03-30 00:00:01+00', false, '{}'),

    ('ACOB/MD/NAS-GOV/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR EXPANSION OF MINI-GRID INVESTMENT IN NASARAWA STATE',
     'Executive Management', 'MD', 'Nasarawa State Government', 'NAS-GOV', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-13', '2026-03-13', '2026-03-13', '2026-03-13 00:00:02+00', false, '{}'),

    ('ACOB/MD/NAS-GOV/2026/002',
     'APPRECIATION LETTER',
     'Executive Management', 'MD', 'Nasarawa State Government', 'NAS-GOV', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-03-13', '2026-03-13', '2026-03-13', '2026-03-13 00:00:03+00', false, '{}');

  -- ── REA-REF ──────────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/REA-REF/2026/001',
     'RE: NOTICE OF TERMINATION OF GRANT AWARD (REF: REA/01/MDCE/GEN/092/VOL.3/2025/5177/002) - FORMAL URGENT APPEAL FOR RECONSIDERATION REGARDING THE ISHATA COMMUNITY SHS PROJECT',
     'Executive Management', 'MD', 'Rural Electrification Agency', 'REA-REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-14', '2026-04-14', '2026-04-14', '2026-04-14 00:00:00+00', false, '{}'),

    ('ACOB/MD/REA-REF/2026/002',
     'RE: NOTICE OF TERMINATION OF GRANT AWARD (REF: REA/01/MDCE/GEN/092/VOL.3/2025/5177/002) - FORMAL URGENT APPEAL FOR RECONSIDERATION REGARDING THE ISHATA COMMUNITY SHS PROJECT',
     'Executive Management', 'MD', 'Rural Electrification Agency', 'REA-REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-14', '2026-04-14', '2026-04-14', '2026-04-14 00:00:01+00', false, '{}'),

    ('ACOB/MD/REA-REF/2026/003',
     'APPLICATION FOR PAYMENT OF THE DEPLOYMENT OF 100 UNITS',
     'Executive Management', 'MD', 'Rural Electrification Agency', 'REA-REF', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-20', '2026-04-20', '2026-04-20', '2026-04-20 00:00:00+00', false, '{}');

  -- ── CBRE ─────────────────────────────────────────────────────────────────────
  INSERT INTO public.correspondence_records
    (reference_number, subject, department_name, department_code,
     recipient_name, recipient_code, letter_type,
     status, originator_id, created_by_id, sender_name,
     due_date, submitted_at, approved_at, created_at, action_required, metadata)
  VALUES
    ('ACOB/MD/CBRE/2026/001',
     'REQUEST FOR CLARIFICATION ON DISBURSEMENT OF APG',
     'Executive Management', 'MD', 'CBRE', 'CBRE', 'external',
     'sent', v_surajo, v_surajo, 'Surajo Idris',
     '2026-04-20', '2026-04-20', '2026-04-20', '2026-04-20 00:00:01+00', false, '{}');

END $$;

-- Step 4: re-enable trigger
ALTER TABLE public.correspondence_records
  ENABLE TRIGGER trg_correspondence_records_before_insert;

-- Step 5: seed counters so next auto-generated reference continues correctly
INSERT INTO public.correspondence_counters (counter_key, year, last_number, updated_at)
VALUES
  -- MD / no-category recipients
  ('outgoing:MD:MRS:',      2026, 1, now()),
  ('outgoing:MD:RI:',       2026, 1, now()),
  ('outgoing:MD:ATC-NG:',   2026, 1, now()),
  ('outgoing:MD:HR:',       2025, 1, now()),
  ('outgoing:MD:HR:',       2026, 5, now()),
  ('outgoing:MD:AEDC:',     2026, 1, now()),
  ('outgoing:MD:KN-GOV:',   2026, 1, now()),
  ('outgoing:MD:KAN-MPRE:', 2026, 1, now()),
  ('outgoing:MD:KAN-MCI:',  2026, 1, now()),
  ('outgoing:MD:KANINVEST:',2026, 1, now()),
  ('outgoing:MD:KEDCO:',    2026, 1, now()),
  ('outgoing:MD:NSIPA:',    2026, 2, now()),
  ('outgoing:MD:NASERC:',   2026, 2, now()),
  ('outgoing:MD:NAS-GOV:',  2026, 2, now()),
  ('outgoing:MD:REA-REF:',  2026, 3, now()),
  ('outgoing:MD:CBRE:',     2026, 1, now()),
  -- MD / with category
  ('outgoing:MD:MRB-DPO:SEC',  2026, 1, now()),
  ('outgoing:MD:CSC:REF',      2026, 7, now()),
  ('outgoing:MD:NASIDA:PROP',  2026, 1, now()),
  ('outgoing:MD:NASEB:PROP',   2026, 1, now()),
  -- BGI / no-category recipients
  ('outgoing:BGI:KNCV:',   2026, 1, now()),
  ('outgoing:BGI:LOTUS:',  2026, 1, now()),
  ('outgoing:BGI:NBSA:',   2026, 1, now())
ON CONFLICT (counter_key, year)
  DO UPDATE SET last_number = EXCLUDED.last_number, updated_at = now();

-- Done: 41 historical records imported, trigger re-enabled, counters seeded.
