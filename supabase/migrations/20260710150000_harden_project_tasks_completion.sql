-- Create validation function for project completion
CREATE OR REPLACE FUNCTION public.check_project_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF EXISTS (
      SELECT 1 
      FROM public.tasks 
      WHERE project_id = NEW.id 
        AND status NOT IN ('completed', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Cannot set project status to completed because there are uncompleted tasks.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Create validation function for task status on completed projects
CREATE OR REPLACE FUNCTION public.check_task_update_for_completed_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('completed', 'cancelled') THEN
    IF EXISTS (
      SELECT 1 
      FROM public.projects 
      WHERE id = NEW.project_id 
        AND status = 'completed'
    ) THEN
      RAISE EXCEPTION 'Cannot set task to uncompleted status because the parent project is already completed.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Revoke and grant execute permissions for security definer compliance
REVOKE EXECUTE ON FUNCTION public.check_project_completion() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_project_completion() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.check_task_update_for_completed_project() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_task_update_for_completed_project() TO authenticated, service_role;

-- Bind triggers
DROP TRIGGER IF EXISTS enforce_project_completion_status ON public.projects;
CREATE TRIGGER enforce_project_completion_status
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.check_project_completion();

DROP TRIGGER IF EXISTS enforce_task_status_completed_project ON public.tasks;
CREATE TRIGGER enforce_task_status_completed_project
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.check_task_update_for_completed_project();

-- Seed initial projects
INSERT INTO public.projects (
  id,
  project_name,
  location,
  deployment_start_date,
  deployment_end_date,
  capacity_w,
  technology_type,
  project_manager_id,
  description,
  status
) VALUES 
(
  'd1111111-1111-4111-a111-000000000001',
  '1155KWp INTERCONNECTED MINI-GRID ELECTRIFICATION',
  'MARARABA UDEGE, NASARAWA LGA, NASARAWA STATE',
  '2026-01-01',
  '2026-12-31',
  1155000,
  'Interconnected Mini-Grid',
  'c0857f43-15bf-459b-b0df-28753c7463fe', -- Emmanuel Ibanga
  'Interconnected mini-grid electrification project at Mararaba Udege.',
  'active'
),
(
  'd2222222-2222-4222-a222-000000000002',
  '990KWp INTERCONNECTED MINI-GRID ELECTRIFICATION',
  'JENGRE, BASSA LGA, PLATEAU STATE',
  '2026-01-01',
  '2026-12-31',
  990000,
  'Interconnected Mini-Grid',
  'c0857f43-15bf-459b-b0df-28753c7463fe', -- Emmanuel Ibanga
  'Interconnected mini-grid electrification project at Jengre.',
  'active'
),
(
  'd3333333-3333-4333-a333-000000000003',
  '600KWp ISOLATED MINI-GRID ELECTRIFICATION OF 10 KADUNA SITES',
  'KADI, KUGU & BIBI, ANGWAN TODO, ANGWAN ALHAJI, UGAMA, ANGWAN MAITANDU, MADACHI, DOKAN KARJI, ZAKADA',
  '2026-01-01',
  '2026-12-31',
  600000,
  'Isolated Mini-Grid',
  'c0857f43-15bf-459b-b0df-28753c7463fe', -- Emmanuel Ibanga
  'Isolated mini-grid electrification of 10 sites across Kaduna State.',
  'active'
),
(
  'd4444444-4444-4444-a444-000000000004',
  '50KWp ISOLATED MINI-GRID ELECTRIFICATION (AMP) - AWBA OFEMMILI',
  'AWBA OFEMMILI, ANAMBRA STATE',
  '2026-01-01',
  '2026-12-31',
  50000,
  'Isolated Mini-Grid',
  'c0857f43-15bf-459b-b0df-28753c7463fe', -- Emmanuel Ibanga
  'Isolated mini-grid electrification project at Awba Ofemmili.',
  'active'
),
(
  'd5555555-5555-4555-a555-000000000005',
  '50KWp ISOLATED MINI-GRID ELECTRIFICATION (AMP) - BUTUBUTU',
  'BUTUBUTU, ONA ARA LGA, OYO STATE',
  '2026-01-01',
  '2026-12-31',
  50000,
  'Isolated Mini-Grid',
  'c0857f43-15bf-459b-b0df-28753c7463fe', -- Emmanuel Ibanga
  'Isolated mini-grid electrification project at Butubutu.',
  'active'
),
(
  'd6666666-6666-4666-a666-000000000006',
  '320kWp CITIBANK PROJECT',
  'VICTORIA ISLAND, LAGOS',
  '2026-01-01',
  '2026-12-31',
  320000,
  'Solar C&I',
  '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', -- Lawrence Adukwu
  'Citibank solar commercial and industrial (C&I) installation at Victoria Island.',
  'active'
),
(
  'd7777777-7777-4777-a777-000000000007',
  '50KWp MICRO-GRID / BUILDING CONSTRUCTIONS AT NADDC OWERRI',
  'IMO STATE',
  '2026-01-01',
  '2026-12-31',
  50000,
  'Micro-Grid',
  '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', -- Lawrence Adukwu
  'Micro-grid & building constructions at NADDC Owerri.',
  'active'
),
(
  'd8888888-8888-4888-a888-000000000008',
  '64KWp MICRO-GRID AT ECOFITNESS',
  'ABUJA',
  '2026-01-01',
  '2026-12-31',
  64000,
  'Micro-Grid',
  '057f8d91-9502-46c6-abce-491e0fa1a15a', -- Oghenerune Orhorhomuke
  'Micro-grid solar installation at Ecofitness, Abuja.',
  'active'
),
(
  'd9999999-9999-4999-a999-000000000009',
  '250units SHS DEPLOYMENT ACROSS NASARAWA & ABIA STATE, & FCT',
  'NASARAWA & ABIA',
  '2026-01-01',
  '2026-12-31',
  NULL,
  'Solar Home Systems (SHS)',
  '55320e85-8bec-49c8-9115-f92f591aa5f6', -- Vanessa Lawrence-Ukaegbu
  'Solar Home Systems (SHS) deployment project.',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- Seed initial tasks mapped from spreadsheet columns
INSERT INTO public.tasks (
  title,
  status,
  project_id,
  assigned_to,
  priority,
  category
) VALUES 
-- Project 1 tasks
('Perimeter Fencing', 'completed', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Planting', 'completed', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('PV Array & Mounting Structure', 'completed', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Material Delivery', 'completed', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Network Stringing', 'pending', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('DropDown & Metering', 'pending', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Generation Asset Procurement', 'pending', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Transformer Procurements', 'pending', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('System Installation', 'pending', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Close-out negotiation for Stringing Subcontractor', 'in_progress', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Purchase of Generation Assets', 'pending', 'd1111111-1111-4111-a111-000000000001', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),

-- Project 2 tasks
('Perimeter Fencing', 'completed', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Planting', 'completed', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Mounting Structure', 'completed', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('PV Module Procurement', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Additional Mounting Structure Procurement', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Network Material Delivery & Distribution Network Stringing', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('DropDown & Metering', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Generation Asset Procurement', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Transformer Procurements', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('System Installation', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Close-out negotiation for Stringing Subcontractor', 'in_progress', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Purchase of Generation Assets', 'pending', 'd2222222-2222-4222-a222-000000000002', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),

-- Project 3 tasks
('Perimeter Fencing (8 sites**)', 'completed', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Moulding Material Purchase', 'completed', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Moulding Commencement', 'pending', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Distribution & Mounting', 'pending', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Network Stringing', 'pending', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('DropDown & Metering', 'pending', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Generation Asset Procurement', 'pending', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Network Accessories Procurement', 'pending', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('System Installation', 'pending', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Close-out negotiation for Pole Moulding Subcontractor', 'in_progress', 'd3333333-3333-4333-a333-000000000003', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),

-- Project 4 tasks
('Perimeter Fencing', 'completed', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Planting', 'completed', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Material Delivery', 'completed', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Stringing', 'completed', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Delivery of Porta Cabins & Assembly', 'pending', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Delivery of PV, Inverters & Battery Component, Smart Meters', 'pending', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('DropDown & Metering', 'pending', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('System Installation', 'pending', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Close-out negotiation for Porta Cabin Subcontractor for Assembly', 'in_progress', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Deliver Inverters, Batteries & Accessories to Site', 'pending', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Re-mobilize Team Members back to site for System Installation', 'pending', 'd4444444-4444-4444-a444-000000000004', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),

-- Project 5 tasks
('Perimeter Fencing', 'completed', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Planting', 'completed', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Distribution Material Delivery', 'pending', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Pole Stringing', 'pending', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Delivery of Porta Cabins & Assembly', 'pending', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Delivery of PV, Inverters & Battery Component, Smart Meters', 'pending', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('DropDown & Metering', 'pending', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('System Installation', 'pending', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Close-out logistics for AAC Cables & Material Delivery to site', 'in_progress', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),
('Mobilise Team to re-deploy to site for Stringing work commencement', 'in_progress', 'd5555555-5555-4555-a555-000000000005', 'c0857f43-15bf-459b-b0df-28753c7463fe', 'medium', 'general'),

-- Project 6 tasks
('1st Phase Roop-top Installation', 'completed', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Major Procurements Concluded', 'completed', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('2nd Phase Carport Fabrication Ongoing', 'completed', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Integration of the AC combiner to the Main low voltage panel', 'pending', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Communication cabling', 'pending', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Testing, configuration and commissioning', 'pending', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Kick-start phase 2 pending permit finalization', 'pending', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Alignment on the liability issues for Phase 1 and interconnections', 'in_progress', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Permit issuance for the Phase 2', 'in_progress', 'd6666666-6666-4666-a666-000000000006', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),

-- Project 7 tasks
('Civil Structural Works', 'completed', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Roof Works', 'completed', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('EV and CNG Wings Constructions', 'completed', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Electrical Wiring and Solar System Installations', 'completed', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Borehole and Water Reticulation', 'completed', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Air Conditions Installation', 'completed', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('EV Machines Cabling and Installations', 'pending', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Landscaping', 'pending', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),
('Installation of the EV chargers and landscaping activities', 'in_progress', 'd7777777-7777-4777-a777-000000000007', '84f1eb10-b4e3-47dd-9833-c15ceb09f45b', 'medium', 'general'),

-- Project 8 tasks
('Solar Panel Installation', 'completed', 'd8888888-8888-4888-a888-000000000008', '057f8d91-9502-46c6-abce-491e0fa1a15a', 'medium', 'general'),
('Battery and Inverter Installation', 'completed', 'd8888888-8888-4888-a888-000000000008', '057f8d91-9502-46c6-abce-491e0fa1a15a', 'medium', 'general'),
('Load Wiring and Integration to the Facility', 'pending', 'd8888888-8888-4888-a888-000000000008', '057f8d91-9502-46c6-abce-491e0fa1a15a', 'medium', 'general'),
('Integration and commissioning', 'in_progress', 'd8888888-8888-4888-a888-000000000008', '057f8d91-9502-46c6-abce-491e0fa1a15a', 'medium', 'general'),

-- Project 9 tasks
('Deployment of 100units across both NASARAWA & ABIA sites', 'completed', 'd9999999-9999-4999-a999-000000000009', '55320e85-8bec-49c8-9115-f92f591aa5f6', 'medium', 'general'),
('Close-out with MTN on Remote Monitoring', 'pending', 'd9999999-9999-4999-a999-000000000009', '55320e85-8bec-49c8-9115-f92f591aa5f6', 'medium', 'general'),
('Deploy additional SHS devices to peri-urban areas within Abuja', 'pending', 'd9999999-9999-4999-a999-000000000009', '55320e85-8bec-49c8-9115-f92f591aa5f6', 'medium', 'general'),
('Deployed, Commisioned, Operational status check', 'in_progress', 'd9999999-9999-4999-a999-000000000009', '55320e85-8bec-49c8-9115-f92f591aa5f6', 'medium', 'general')
ON CONFLICT DO NOTHING;

-- Add foreign key constraint to link tasks to projects
ALTER TABLE public.tasks 
DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;

ALTER TABLE public.tasks 
ADD CONSTRAINT tasks_project_id_fkey 
FOREIGN KEY (project_id) 
REFERENCES public.projects(id) 
ON DELETE SET NULL;

