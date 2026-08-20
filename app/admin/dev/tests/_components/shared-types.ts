export type StepResult = {
  step: string
  status: "ok" | "error" | "skipped"
  detail?: string
  data?: unknown
}

export type TestResult = {
  ok: boolean
  steps: StepResult[]
  error?: string
}

export type DiagRow = {
  requester_kind: string
  stage_order: number
  approver_role_code: string
  resolved: boolean
  resolved_user_id?: string | null
  resolved_name?: string | null
  fail_reason?: string
}

export type DiagnosticsResult = {
  results: DiagRow[]
  broken_count: number
  total: number
}

export type HelpDeskDiagRow = {
  flow_kind: "support" | "procurement"
  stage_code: "department_lead" | "head_corporate_services" | "managing_director"
  scope: string
  resolved: boolean
  resolved_user_id?: string | null
  resolved_name?: string | null
  fail_reason?: string
}

export type HelpDeskDiagnosticsResult = {
  results: HelpDeskDiagRow[]
  broken_count: number
  total: number
}

export type TaskDiagRow = {
  check_code: "department_lead_coverage" | "department_assignment_target"
  scope: string
  resolved: boolean
  resolved_user_id?: string | null
  resolved_name?: string | null
  fail_reason?: string
}

export type TaskDiagnosticsResult = {
  results: TaskDiagRow[]
  broken_count: number
  total: number
}

export type AssetMailRoutingRow = {
  employee_id: string
  employee_name: string
  department: string
  routing_class: "employee" | "department_lead" | "hcs" | "md"
  recipients: string[]
}

export type AssetMailRoutingResult = {
  rows: AssetMailRoutingRow[]
  total: number
  hcs: { id: string; name: string } | null
  md: { id: string; name: string } | null
  mail_types: string[]
}

export const FIX_HINTS: Record<string, string> = {
  md: 'Set someone\'s profile: is_department_lead = true AND department = "Executive Management" (or add it to lead_departments)',
  hcs: 'Set someone\'s profile: is_department_lead = true AND department = "Corporate Services" (or add it to lead_departments)',
  admin_hr_lead:
    'Set someone\'s profile: is_department_lead = true AND department = "Admin and HR" (or add it to lead_departments)',
  department_lead: "Dynamic — the requester's department needs someone with is_department_lead = true",
  reliever: "Dynamic per request — no fix needed",
}

export const HELP_DESK_FIX_HINTS: Record<string, string> = {
  department_lead: "Assign at least one active department lead for this department.",
  requester_department_lead: "Assign an active lead for the requester's department.",
  service_department_lead: "Assign an active lead for the selected service department.",
  head_corporate_services: "Set an active Corporate Services lead/admin candidate for the HCS stage.",
  managing_director: "Set an active MD candidate (Executive Management admin or super_admin/developer).",
}

export const TASK_FIX_HINTS: Record<string, string> = {
  department_lead_coverage: "Assign an active department lead for this department.",
  department_assignment_target: "Ensure at least one active user belongs to this department.",
}
