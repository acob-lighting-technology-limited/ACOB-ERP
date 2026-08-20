-- Populate missing department descriptions with clear, standard descriptions
UPDATE public.departments
SET description = CASE
  WHEN name ILIKE 'Accounts%' OR name ILIKE 'Finance%' THEN 'Finance, accounting, budgeting, expenditure control, and financial reporting.'
  WHEN name ILIKE 'Admin & HR%' OR name ILIKE 'Admin and HR%' OR name ILIKE 'Human Resources%' THEN 'Human resources, staff welfare, office administration, and recruitment management.'
  WHEN name ILIKE 'Business, Growth%' OR name ILIKE 'Business Growth%' OR name ILIKE 'BGI%' THEN 'Business development, strategic partnerships, sales expansion, and innovation initiatives.'
  WHEN name ILIKE 'Corporate Services%' THEN 'Corporate communications, facilities, legal support, and operational logistics.'
  WHEN name ILIKE 'Executive Management%' THEN 'Executive leadership, strategic direction, governance, and organizational oversight.'
  WHEN name ILIKE 'IT and Communications%' OR name ILIKE 'IT & Communications%' OR name ILIKE 'ICT%' OR name ILIKE 'Information Technology%' THEN 'Information technology infrastructure, software systems, network security, and internal communications.'
  WHEN name ILIKE 'Operations and Maintenance%' OR name ILIKE 'Operations%' OR name ILIKE 'OPM%' THEN 'Field operations, system maintenance, infrastructure reliability, and quality assurance.'
  WHEN name ILIKE 'Project%' THEN 'Project planning, execution, vendor coordination, and milestone delivery.'
  WHEN name ILIKE 'Regulatory and Compliance%' OR name ILIKE 'Legal, Regulatory%' OR name ILIKE 'Legal%' THEN 'Legal compliance, policy adherence, statutory regulations, and industry standards.'
  WHEN name ILIKE 'Stakeholder%' THEN 'Stakeholder engagement, client partnerships, external communication, and relationship management.'
  WHEN name ILIKE 'Technical%' THEN 'Technical engineering, research and development, design specifications, and hardware solutions.'
  WHEN name ILIKE 'Monitoring%' THEN 'Performance tracking, project impact assessment, metrics evaluation, and quality audit.'
  ELSE 'Department responsible for ' || name || ' functions and operations.'
END
WHERE description IS NULL OR trim(description) = '' OR trim(description) = 'No description added';
