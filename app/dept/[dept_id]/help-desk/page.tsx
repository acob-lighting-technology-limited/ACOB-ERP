import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { listAssignableProfiles } from "@/lib/workforce/assignment-policy"
import { AdminHelpDeskContent } from "@/app/admin/help-desk/management/admin-help-desk-content"
import type { EmployeeOption, HelpDeskTicket, LeadDirectoryMember } from "@/components/help-desk/ticket-queue-table"

type HelpDeskTicketRow = HelpDeskTicket & {
  requester_id: string
  current_approval_stage?: string | null
  requester_department?: string | null
}

const STAGE_ORDER = [
  "requester_department_lead",
  "service_department_lead",
  "head_corporate_services",
  "managing_director",
] as const

function normalizeApprovalStage(stage: string | null | undefined) {
  if (!stage) return null
  if (stage === "department_lead") return "service_department_lead"
  return stage
}

function stageRank(stage: string | null | undefined) {
  const normalized = normalizeApprovalStage(stage)
  if (!normalized) return Number.MAX_SAFE_INTEGER
  const rank = STAGE_ORDER.indexOf(normalized as (typeof STAGE_ORDER)[number])
  return rank >= 0 ? rank : Number.MAX_SAFE_INTEGER
}

interface DeptHelpDeskPageProps {
  params: Promise<{ dept_id: string }>
}

export default async function DeptHelpDeskPage({ params }: DeptHelpDeskPageProps) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)

  const [{ data: tickets }, { data: employees }] = await Promise.all([
    dataClient.from("help_desk_tickets").select("*").order("created_at", { ascending: false }),
    listAssignableProfiles(dataClient, {
      select: "id, first_name, last_name, department, employment_status",
      departmentScope: [deptName],
      allowLegacyNullStatus: false,
    }),
  ])

  const requesterIds = Array.from(
    new Set(((tickets as HelpDeskTicketRow[] | null) || []).map((t) => t.requester_id).filter(Boolean))
  )
  const { data: requesterProfiles } =
    requesterIds.length > 0
      ? await dataClient.from("profiles").select("id, department").in("id", requesterIds)
      : { data: [] as Array<{ id: string; department: string | null }> }

  const requesterDepartmentMap = new Map(
    ((requesterProfiles as Array<{ id: string; department: string | null }> | null) || []).map((row) => [
      row.id,
      row.department || null,
    ])
  )

  const enrichedTickets = ((tickets as HelpDeskTicketRow[] | null) || []).map((ticket) => ({
    ...ticket,
    requester_department: requesterDepartmentMap.get(ticket.requester_id) || null,
  })) as HelpDeskTicketRow[]

  const ticketIds = enrichedTickets.map((ticket) => ticket.id).filter(Boolean)
  const { data: pendingApprovals } =
    ticketIds.length > 0
      ? await dataClient
          .from("help_desk_approvals")
          .select("ticket_id, approval_stage, status, requested_at")
          .in("ticket_id", ticketIds)
          .eq("status", "pending")
          .order("requested_at", { ascending: true })
      : {
          data: [] as Array<{
            ticket_id: string
            approval_stage: string | null
            status: string
            requested_at: string | null
          }>,
        }

  const pendingStageByTicketId = new Map<string, string>()
  for (const approval of pendingApprovals || []) {
    const normalizedStage = normalizeApprovalStage(approval.approval_stage)
    if (!normalizedStage) continue
    const existing = pendingStageByTicketId.get(approval.ticket_id)
    if (!existing || stageRank(normalizedStage) < stageRank(existing)) {
      pendingStageByTicketId.set(approval.ticket_id, normalizedStage)
    }
  }

  const ticketsWithStage = enrichedTickets.map((ticket) => ({
    ...ticket,
    current_approval_stage:
      normalizeApprovalStage(ticket.current_approval_stage) || pendingStageByTicketId.get(ticket.id) || null,
  }))

  // Scope to this dept only
  const scopedTickets = ticketsWithStage.filter((ticket) => {
    const serviceDept = normalizeDepartmentName(ticket.service_department || "")
    const requesterDept = normalizeDepartmentName(ticket.requester_department || "")
    return serviceDept === deptName || requesterDept === deptName
  })

  const { data: leadDirectoryRows } = await listAssignableProfiles(dataClient, {
    select:
      "id, full_name, first_name, last_name, role, department, is_department_lead, lead_departments, employment_status",
    leadOnly: true,
  })

  const leadDirectory = (
    (leadDirectoryRows as Array<{
      id: string
      full_name: string | null
      first_name: string | null
      last_name: string | null
      role: string | null
      department: string | null
      lead_departments: string[] | null
    }> | null) || []
  ).map((profile) => ({
    id: profile.id,
    full_name:
      profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "Unnamed Lead",
    role: profile.role || "",
    department: profile.department || null,
    lead_departments: Array.isArray(profile.lead_departments) ? profile.lead_departments : [],
  })) as LeadDirectoryMember[]

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) redirect("/auth/login")

  return (
    <AdminHelpDeskContent
      initialTickets={scopedTickets as HelpDeskTicket[]}
      employees={employees as EmployeeOption[]}
      leadDirectory={leadDirectory}
      viewer={{
        id: authData.user.id,
        role: scope.role,
        department: scope.deptName,
        is_department_lead: true,
        lead_departments: [scope.deptName],
        managed_departments: [scope.deptName],
      }}
      lockedDepartment={scope.deptName}
      backLinkHref={`/dept/${dept_id}`}
    />
  )
}
