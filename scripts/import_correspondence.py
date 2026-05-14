import psycopg2
from datetime import datetime, timedelta

SURAJO = 'f16cd078-5324-4837-a011-50c57f9a32d5'
DSN = 'postgres://postgres.itqegqxeqkeogwrvlzlj:yhUHpxFsvHmDw24C@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require'

# (reference_number, subject, dept_name, dept_code, recipient_name, recipient_code, category, letter_type, date_str)
records = [
    ('ACOB/MD/2026/MRS/001',
     'REQUEST FOR FUEL COUPON ACCOUNT ARRANGEMENT',
     'Executive Management','MD','MRS','MRS',None,'external','2026-03-04'),

    ('ACOB/MD/RI/2026/001',
     'RE: INVITATION AS DISTINGUISHED GUEST OF HONOUR TO THE ROTARY INTERNATIONAL DISTRICT CONFERENCE (DISCON) - MAY 13, 2026',
     'Executive Management','MD','Rotary International District Conference','RI',None,'external','2026-04-21'),

    ('ACOB/MD/ATC-NG/2026/001',
     'PAYMENT ADVICE - SOLAR POWER CONNECTION AT UMAISHA, TUNGA, AND ONIPANU COMMUNITIES',
     'Executive Management','MD','ATC-NG','ATC-NG',None,'external','2026-04-21'),

    ('ACOB/MD/HR/2025/001',
     'CONFIRMATION OF EMPLOYMENT AND NOTICE OF INCREMENT IN SALARY',
     'Executive Management','MD','Admin & HR Department','HR',None,'internal','2026-03-12'),

    ('ACOB/MD/HR/2026/001',
     'REDEPLOYMENT NOTICE',
     'Executive Management','MD','Admin & HR Department','HR',None,'internal','2026-03-04'),

    ('ACOB/MD/HR/2026/002',
     'REDEPLOYMENT NOTICE',
     'Executive Management','MD','Admin & HR Department','HR',None,'internal','2026-03-04'),

    ('ACOB/MD/HR/2026/003',
     'REDEPLOYMENT NOTICE',
     'Executive Management','MD','Admin & HR Department','HR',None,'internal','2026-03-04'),

    ('ACOB/MD/HR/2026/004',
     'APPOINTMENT AS HEAD OF STAKEHOLDER ENGAGEMENT',
     'Executive Management','MD','Admin & HR Department','HR',None,'internal','2026-05-05'),

    ('ACOB/MD/HR/2026/005',
     'APPOINTMENT AS PROCUREMENT OFFICER',
     'Executive Management','MD','Admin & HR Department','HR',None,'internal','2026-05-05'),

    ('ACOB/MD/AEDC/2026/001',
     'REQUEST FOR IDENTIFICATION OF ADDITIONAL LOCAL COMMUNITIES FOR INTERCONNECTED MINI-GRID DEVELOPMENT IN NASARAWA AND NIGER STATE',
     'Executive Management','MD','Abuja Electricity Distribution Company','AEDC',None,'external','2026-03-12'),

    ('ACOB/MD/MRB-DPO/SEC/2026/001',
     'LETTER OF APPRECIATION AND REQUEST FOR SECURITY COLLABORATION AT THE MARARABA UDEGE INTERCONNECTED MINI-GRID SITE',
     'Executive Management','MD','MRB-DPO Security','MRB-DPO','SEC','external','2026-04-10'),

    ('ACOB/BGI/KNCV/2026/001',
     'REQUEST TO SUBMIT QUOTATION FOR THE SUPPLY OF SOLAR PANELS INVERTER REPLACEMENT TO KNCV NIGERIA',
     'Business, Growth and Innovation','BGI','Knowledge Network for Disease Control and Vigilance','KNCV',None,'external','2026-03-25'),

    ('ACOB/BGI/LOTUS/2026/001',
     'REQUEST FOR PRODUCT FINANCING',
     'Business, Growth and Innovation','BGI','Lotus Bank','LOTUS',None,'external','2026-03-26'),

    ('ACOB/BGI/NBSA/2026/001',
     'REQUEST FOR COURTESY VISIT',
     'Business, Growth and Innovation','BGI','National Blood Service Agency','NBSA',None,'external','2026-03-26'),

    ('ACOB/MD/CSC/REF/2026/001',
     'LETTER OF RECOMMENDATION FOR COMMONWEALTH SCHOLARSHIP APPLICATION',
     'Executive Management','MD','Commonwealth Scholarship Council','CSC','REF','external','2026-03-26'),

    ('ACOB/MD/CSC/REF/2026/002',
     'PROFESSIONAL ATTESTATION FOR EMMANUEL JOSEPH IBANGA',
     'Executive Management','MD','Immigration, Refugees and Citizenship Canada','CSC','REF','external','2026-03-26'),

    ('ACOB/MD/CSC/REF/2026/003',
     'PROFESSIONAL ATTESTATION FOR VANESSA LAWRENCE',
     'Executive Management','MD','Immigration, Refugees and Citizenship Canada','CSC','REF','external','2026-03-26'),

    ('ACOB/MD/CSC/REF/2026/004',
     'PROFESSIONAL ATTESTATION FOR CALEB RAYMOND OBIECHINA',
     'Executive Management','MD','Immigration, Refugees and Citizenship Canada','CSC','REF','external','2026-03-26'),

    ('ACOB/MD/CSC/REF/2026/005',
     'PROFESSIONAL ATTESTATION FOR BEVERLY TOCHUKWU OBIECHINA',
     'Executive Management','MD','Immigration, Refugees and Citizenship Canada','CSC','REF','external','2026-03-26'),

    ('ACOB/MD/CSC/REF/2026/006',
     'PROFESSIONAL ATTESTATION FOR VICTORIA OMOJO AKOJI-OMALE',
     'Executive Management','MD','Immigration, Refugees and Citizenship Canada','CSC','REF','external','2026-03-26'),

    ('ACOB/MD/CSC/REF/2026/007',
     'PROFESSIONAL ATTESTATION FOR CHUKWUEMEKA EZE',
     'Executive Management','MD','Immigration, Refugees and Citizenship Canada','CSC','REF','external','2026-03-26'),

    ('ACOB/MD/KN-GOV/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR RENEWABLE ENERGY INVESTMENT AND SUSTAINABLE ELECTRICITY EXPANSION IN KANO STATE',
     'Executive Management','MD','Kano State Government House','KN-GOV',None,'external','2026-04-01'),

    ('ACOB/MD/KAN-MPRE/2026/001',
     'EXPRESSION OF INTEREST FOR STRATEGIC PARTNERSHIP ON RENEWABLE ENERGY INVESTMENT AND ELECTRICITY ACCESS EXPANSION IN KANO STATE',
     'Executive Management','MD','Kano State Ministry of Power and Renewable Energy','KAN-MPRE',None,'external','2026-04-01'),

    ('ACOB/MD/KAN-MCI/2026/001',
     'EXPRESSION OF INTEREST FOR STRATEGIC PARTNERSHIP ON RENEWABLE ENERGY INVESTMENT AND ELECTRICITY ACCESS EXPANSION IN KANO STATE',
     'Executive Management','MD','Kano State Ministry of Commerce and Industry','KAN-MCI',None,'external','2026-04-01'),

    ('ACOB/MD/KANINVEST/2026/001',
     'EXPRESSION OF INTEREST FOR STRATEGIC PARTNERSHIP ON RENEWABLE ENERGY INVESTMENT AND ELECTRICITY ACCESS EXPANSION IN KANO STATE',
     'Executive Management','MD','Kano State Investment Promotion Agency','KANINVEST',None,'external','2026-04-01'),

    ('ACOB/MD/KEDCO/2026/001',
     'INTRODUCTION AND STRATEGIC PARTNERSHIP PROPOSAL',
     'Executive Management','MD','Kano Electricity Distribution Company','KEDCO',None,'external','2026-04-14'),

    ('ACOB/MD/NSIPA/2026/001',
     'LETTER OF INTRODUCTION TO NIGER STATE INVESTMENT PROMOTION AGENCY',
     'Executive Management','MD','Niger State Investment Promotion Agency','NSIPA',None,'external','2026-03-26'),

    ('ACOB/MD/NSIPA/2026/002',
     'LETTER OF INTRODUCTION TO NIGER STATE GOVERNMENT',
     'Executive Management','MD','Niger State Government','NSIPA',None,'external','2026-03-26'),

    ('ACOB/MD/NASIDA/PROP/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR EXPANSION OF MINI-GRID INVESTMENT IN NASARAWA STATE',
     'Executive Management','MD','Nasarawa Investment Development Agency','NASIDA','PROP','external','2026-03-13'),

    ('ACOB/MD/NASEB/PROP/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR EXPANSION OF MINI-GRID INVESTMENT IN NASARAWA STATE',
     'Executive Management','MD','Nasarawa Electricity Board','NASEB','PROP','external','2026-03-13'),

    ('ACOB/MD/NASERC/2026/001',
     'INTRODUCTION OF ACOB LIGHTING TECHNOLOGY AS A STRATEGIC PARTNER',
     'Executive Management','MD','Nasarawa Electricity Regulatory Commission','NASERC',None,'external','2026-03-30'),

    ('ACOB/MD/NASERC/2026/002',
     'REQUEST FOR A COURTESY VISIT',
     'Executive Management','MD','Nasarawa Electricity Regulatory Commission','NASERC',None,'external','2026-03-30'),

    ('ACOB/MD/NAS-GOV/2026/001',
     'STRATEGIC PARTNERSHIP PROPOSAL FOR EXPANSION OF MINI-GRID INVESTMENT IN NASARAWA STATE',
     'Executive Management','MD','Nasarawa State Government','NAS-GOV',None,'external','2026-03-13'),

    ('ACOB/MD/NAS-GOV/2026/002',
     'APPRECIATION LETTER',
     'Executive Management','MD','Nasarawa State Government','NAS-GOV',None,'external','2026-03-13'),

    ('ACOB/MD/REA-REF/2026/001',
     'RE: NOTICE OF TERMINATION OF GRANT AWARD - FORMAL URGENT APPEAL FOR RECONSIDERATION REGARDING THE ISHATA COMMUNITY SHS PROJECT',
     'Executive Management','MD','Rural Electrification Agency','REA-REF',None,'external','2026-04-14'),

    ('ACOB/MD/REA-REF/2026/002',
     'RE: NOTICE OF TERMINATION OF GRANT AWARD - FORMAL URGENT APPEAL FOR RECONSIDERATION REGARDING THE ISHATA COMMUNITY SHS PROJECT (FOLLOW-UP)',
     'Executive Management','MD','Rural Electrification Agency','REA-REF',None,'external','2026-04-14'),

    ('ACOB/MD/REA-REF/2026/003',
     'APPLICATION FOR PAYMENT OF THE DEPLOYMENT OF 100 UNITS',
     'Executive Management','MD','Rural Electrification Agency','REA-REF',None,'external','2026-04-20'),

    ('ACOB/MD/CBRE/2026/001',
     'REQUEST FOR CLARIFICATION ON DISBURSEMENT OF APG',
     'Executive Management','MD','CBRE','CBRE',None,'external','2026-04-20'),
]

conn = psycopg2.connect(DSN)
conn.autocommit = True
cur = conn.cursor()

sql = """INSERT INTO public.correspondence_records
  (reference_number, subject, department_name, department_code,
   recipient_name, recipient_code, category, letter_type,
   status, originator_id, created_by_id, sender_name,
   due_date, submitted_at, approved_at, created_at, action_required, metadata)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'sent',%s,%s,'Surajo Idris',%s,%s,%s,%s,false,'{}')"""

for i, r in enumerate(records):
    ref, subj, dept_name, dept_code, rec_name, rec_code, cat, ltype, dt = r
    base_dt = datetime.fromisoformat(dt + 'T00:00:00')
    created_at = (base_dt + timedelta(seconds=i)).isoformat() + '+00'
    cur.execute(sql, (ref, subj, dept_name, dept_code, rec_name, rec_code, cat, ltype,
                      SURAJO, SURAJO, dt, dt, dt, created_at))
    print(f'  inserted {ref}')

print(f'\nTotal: {len(records)} records inserted')

# Seed counters
counters = [
    ('outgoing:MD:MRS:',       2026, 1),
    ('outgoing:MD:RI:',        2026, 1),
    ('outgoing:MD:ATC-NG:',    2026, 1),
    ('outgoing:MD:HR:',        2025, 1),
    ('outgoing:MD:HR:',        2026, 5),
    ('outgoing:MD:AEDC:',      2026, 1),
    ('outgoing:MD:MRB-DPO:SEC',2026, 1),
    ('outgoing:BGI:KNCV:',     2026, 1),
    ('outgoing:BGI:LOTUS:',    2026, 1),
    ('outgoing:BGI:NBSA:',     2026, 1),
    ('outgoing:MD:CSC:REF',    2026, 7),
    ('outgoing:MD:KN-GOV:',    2026, 1),
    ('outgoing:MD:KAN-MPRE:',  2026, 1),
    ('outgoing:MD:KAN-MCI:',   2026, 1),
    ('outgoing:MD:KANINVEST:', 2026, 1),
    ('outgoing:MD:KEDCO:',     2026, 1),
    ('outgoing:MD:NSIPA:',     2026, 2),
    ('outgoing:MD:NASIDA:PROP',2026, 1),
    ('outgoing:MD:NASEB:PROP', 2026, 1),
    ('outgoing:MD:NASERC:',    2026, 2),
    ('outgoing:MD:NAS-GOV:',   2026, 2),
    ('outgoing:MD:REA-REF:',   2026, 3),
    ('outgoing:MD:CBRE:',      2026, 1),
]

for key, year, last in counters:
    cur.execute("""INSERT INTO public.correspondence_counters (counter_key, year, last_number, updated_at)
        VALUES (%s,%s,%s,now())
        ON CONFLICT (counter_key, year) DO UPDATE SET last_number=EXCLUDED.last_number, updated_at=now()""",
        (key, year, last))

print('Counters seeded')

# Re-enable trigger
cur.execute('ALTER TABLE public.correspondence_records ENABLE TRIGGER trg_correspondence_records_before_insert')
print('Trigger re-enabled')

cur.close()
conn.close()
print('Done.')
