import { notifyUsers } from "@/lib/hr/leave-workflow"
import { applyAssignableStatusFilter } from "@/lib/workforce/assignment-policy"
import { DEPT_EXECUTIVE_MANAGEMENT, DEPT_CORPORATE_SERVICES } from "@/config/constants"
import type { SupabaseClient } from "@supabase/supabase-js"

type LeaveRoutingClient = SupabaseClient
type LeaveLeadProfile = {
  id: string
  department: string | null
  lead_departments: string[] | null
  is_department_lead: boolean
}
type LeaveApproverAssignment = {
  user_id: string
  effective_from: string | null
  effective_to: string | null
  is_primary: boolean | null
}
type LeaveRequester = {
  department_id: string | null
  department: string | null
}
type DepartmentHeadRow = {
  id?: string
  department_head_id?: string | null
}
type RouteConfigRow = {
  stage_order: number
  approver_role_code: string
  is_active?: boolean | null
}
type RouteSnapshotRow = Pick<
  ResolvedRouteStage,
  "stage_order" | "approver_role_code" | "approver_user_id" | "stage_code"
>

export const REQUESTER_KINDS = ["employee", "dept_lead", "admin_hr_lead", "hcs", "md"] as const
export type RequesterKind = (typeof REQUESTER_KINDS)[number]

export interface ResolvedRouteStage {
  stage_order: number
  approver_role_code: string
  approver_user_id: string
  stage_code: string
}

const DEPARTMENT_NAMES = {
  adminHr: "Admin & HR",
  md: DEPT_EXECUTIVE_MANAGEMENT,
  hcs: DEPT_CORPORATE_SERVICES,
} as const
const OPTIONAL_APPROVER_ROLES = new Set<string>(["department_lead", "admin_hr_lead"])

function hasLeadForDepartment(profile: LeaveLeadProfile | null | undefined, departmentName: string) {
  if (!profile) return false
  const managed = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  return Boolean(
    profile.is_department_lead && (profile.department === departmentName || managed.includes(departmentName))
  )
}

export function stageCodeForRole(roleCode: string) {
  switch (roleCode) {
    case "reliever":
      return "pending_reliever"
    case "department_lead":
      return "pending_department_lead"
    case "admin_hr_lead":
      return "pending_admin_hr_lead"
    case "md":
      return "pending_md"
    case "hcs":
      return "pending_hcs"
    default:
      return `pending_${roleCode}`
  }
}

export function classifyRequesterKind(profile: LeaveLeadProfile | null | undefined): RequesterKind {
  if (hasLeadForDepartment(profile, DEPARTMENT_NAMES.md)) return "md"
  if (hasLeadForDepartment(profile, DEPARTMENT_NAMES.hcs)) return "hcs"
  if (hasLeadForDepartment(profile, DEPARTMENT_NAMES.adminHr)) return "admin_hr_lead"
  if (profile?.is_department_lead) return "dept_lead"
  return "employee"
}

async function resolveProfileByDepartmentLead(
  supabase: LeaveRoutingClient,
  departmentName: string
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, department, lead_departments, is_department_lead")
    .eq("is_department_lead", true)

  if (error) throw new Error(`Failed to resolve ${departmentName} lead`)

  const matches = ((data || []) as LeaveLeadProfile[]).filter((profile) =>
    hasLeadForDepartment(profile, departmentName)
  )
  if (matches.length > 1) throw new Error(`LEAVE_APPROVER_CONFLICT:${departmentName}`)
  return matches[0] || null
}

async function resolveDepartmentHeadById(
  supabase: LeaveRoutingClient,
  departmentId: string
): Promise<{ id: string } | null> {
  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("department_head_id")
    .eq("id", departmentId)
    .single()
  const typedDepartment = department as DepartmentHeadRow | null

  if (departmentError) throw new Error("Failed to resolve department lead")
  if (!typedDepartment?.department_head_id) return null

  const profileQueryById = supabase.from("profiles").select("id").eq("id", typedDepartment.department_head_id)
  const { data: profile, error: profileError } = await applyAssignableStatusFilter(profileQueryById, {
    allowLegacyNullStatus: false,
  }).single()

  if (profileError || !profile?.id) return null
  return { id: profile.id }
}

async function resolveDepartmentHeadByName(
  supabase: LeaveRoutingClient,
  departmentName: string
): Promise<{ id: string } | null> {
  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("id, department_head_id")
    .eq("name", departmentName)
    .limit(2)
  const typedDepartments = (department || []) as DepartmentHeadRow[]

  if (departmentError) throw new Error("Failed to resolve department lead")
  if (typedDepartments.length === 0) return null
  if (typedDepartments.length > 1) throw new Error(`LEAVE_APPROVER_CONFLICT:${departmentName}`)

  const departmentHeadId = typedDepartments[0]?.department_head_id
  if (!departmentHeadId) return null

  const profileQueryByName = supabase.from("profiles").select("id").eq("id", departmentHeadId)
  const { data: profile, error: profileError } = await applyAssignableStatusFilter(profileQueryByName, {
    allowLegacyNullStatus: false,
  }).single()

  if (profileError || !profile?.id) return null
  return { id: profile.id }
}

async function resolveRequesterDepartmentLead(
  supabase: LeaveRoutingClient,
  requester: LeaveRequester
): Promise<{ id: string } | null> {
  if (requester.department_id) {
    const departmentHead = await resolveDepartmentHeadById(supabase, requester.department_id)
    if (departmentHead) return departmentHead

    const { data: leadByDeptId, error: leadByDeptIdError } = await supabase
      .from("profiles")
      .select("id")
      .eq("department_id", requester.department_id)
      .eq("is_department_lead", true)
      .limit(2)

    if (leadByDeptIdError) throw new Error("Failed to resolve department lead")
    if ((leadByDeptId || []).length > 1) throw new Error("LEAVE_APPROVER_CONFLICT:department_lead")
    if ((leadByDeptId || []).length === 1) return leadByDeptId[0]
  }

  if (requester.department) {
    const departmentHead = await resolveDepartmentHeadByName(supabase, requester.department)
    if (departmentHead) return departmentHead

    return resolveProfileByDepartmentLead(supabase, requester.department)
  }

  return null
}

async function resolveFixedRoleAssignee(
  supabase: LeaveRoutingClient,
  roleCode: string
): Promise<{ id: string } | null> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("leave_approver_assignments")
    .select("user_id, effective_from, effective_to, is_primary")
    .eq("approver_role_code", roleCode)
    .eq("is_active", true)
    .eq("scope_type", "global")
    .order("is_primary", { ascending: false })

  if (error) throw new Error(`Failed to resolve ${roleCode} assignment`)

  const valid = ((data || []) as LeaveApproverAssignment[]).filter((row) => {
    const startsOk = !row.effective_from || row.effective_from <= now
    const endsOk = !row.effective_to || row.effective_to >= now
    return startsOk && endsOk
  })

  if (valid.length > 1 && valid.filter((assignment) => assignment.is_primary).length > 1) {
    throw new Error(`LEAVE_APPROVER_CONFLICT:${roleCode}`)
  }

  return valid.length ? { id: valid[0].user_id } : null
}

async function resolveRoleApprover(
  supabase: LeaveRoutingClient,
  roleCode: string,
  context: {
    requester: LeaveRequester
    relieverId: string
  }
): Promise<{ id: string } | null> {
  if (roleCode === "reliever") {
    return { id: context.relieverId }
  }

  if (roleCode === "department_lead") {
    return resolveRequesterDepartmentLead(supabase, context.requester)
  }

  if (roleCode === "admin_hr_lead") {
    const adminHrLead = await resolveProfileByDepartmentLead(supabase, DEPARTMENT_NAMES.adminHr)
    if (adminHrLead?.id) return adminHrLead
    // Fallback to explicit role assignment when department lead mapping is missing.
    return resolveFixedRoleAssignee(supabase, "admin_hr_lead")
  }

  if (roleCode === "md") {
    return resolveProfileByDepartmentLead(supabase, DEPARTMENT_NAMES.md)
  }

  if (roleCode === "hcs") {
    return resolveProfileByDepartmentLead(supabase, DEPARTMENT_NAMES.hcs)
  }

  return resolveFixedRoleAssignee(supabase, roleCode)
}

export async function loadRouteRows(supabase: LeaveRoutingClient, requesterKind: RequesterKind) {
  const { data, error } = await supabase
    .from("leave_approval_role_routes")
    .select("stage_order, approver_role_code, is_active")
    .eq("requester_kind", requesterKind)
    .eq("is_active", true)
    .order("stage_order", { ascending: true })

  if (error) throw new Error("Failed to load leave route configuration")
  const routeRows = (data || []) as RouteConfigRow[]
  return applyRequesterStageOrder(routeRows, requesterKind)
}

function applyRequesterStageOrder(routeRows: RouteConfigRow[], requesterKind: RequesterKind) {
  const rolePriority: Partial<Record<RequesterKind, Record<string, number>>> = {
    dept_lead: {
      reliever: 10,
      department_lead: 20,
      admin_hr_lead: 30,
      hcs: 35,
      md: 40,
    },
    admin_hr_lead: {
      reliever: 10,
      hcs: 30,
      md: 40,
    },
    hcs: {
      reliever: 10,
      admin_hr_lead: 30,
      md: 40,
    },
  }

  const configuredPriority = rolePriority[requesterKind]
  if (!configuredPriority) return routeRows

  return [...routeRows].sort((left, right) => {
    const leftPriority = configuredPriority[left.approver_role_code]
    const rightPriority = configuredPriority[right.approver_role_code]
    const normalizedLeft = typeof leftPriority === "number" ? leftPriority : 1000 + left.stage_order
    const normalizedRight = typeof rightPriority === "number" ? rightPriority : 1000 + right.stage_order

    if (normalizedLeft === normalizedRight) {
      return left.stage_order - right.stage_order
    }
    return normalizedLeft - normalizedRight
  })
}

export async function buildResolvedRouteSnapshot(params: {
  supabase: LeaveRoutingClient
  requester: LeaveRequester
  requesterId: string
  requesterKind: RequesterKind
  relieverId: string
}) {
  const { supabase, requester, requesterId, requesterKind, relieverId } = params

  const routeRows = await loadRouteRows(supabase, requesterKind)
  if (!routeRows.length) {
    throw new Error(`LEAVE_APPROVER_NOT_CONFIGURED:route:${requesterKind}`)
  }

  const resolved: ResolvedRouteStage[] = []
  let adminHrLeadApproverId: string | null | undefined

  for (const row of routeRows) {
    let approver: { id: string } | null = null
    try {
      approver = await resolveRoleApprover(supabase, row.approver_role_code, {
        requester,
        relieverId,
      })
    } catch (error) {
      // Optional approver lookup failures must never block workflow.
      if (OPTIONAL_APPROVER_ROLES.has(row.approver_role_code)) {
        continue
      }
      throw error
    }

    if (!approver?.id) {
      // Missing optional approvers should not block request creation/preview.
      if (OPTIONAL_APPROVER_ROLES.has(row.approver_role_code)) {
        continue
      }
      throw new Error(`LEAVE_APPROVER_NOT_CONFIGURED:${row.approver_role_code}`)
    }

    if (row.approver_role_code === "admin_hr_lead") {
      adminHrLeadApproverId = approver.id
    } else if (typeof adminHrLeadApproverId === "undefined") {
      const adminHrLeadApprover = await resolveRoleApprover(supabase, "admin_hr_lead", {
        requester,
        relieverId,
      })
      adminHrLeadApproverId = adminHrLeadApprover?.id || null
    }

    // Business rule:
    // - If reliever is Admin & HR Lead, skip reliever and department lead stages.
    if (
      adminHrLeadApproverId &&
      relieverId === adminHrLeadApproverId &&
      (row.approver_role_code === "reliever" || row.approver_role_code === "department_lead")
    ) {
      continue
    }

    // Business rule:
    // - If department lead resolves to Admin & HR Lead, bypass department lead stage.
    if (
      row.approver_role_code === "department_lead" &&
      adminHrLeadApproverId &&
      approver.id === adminHrLeadApproverId
    ) {
      continue
    }

    if (approver.id === requesterId) {
      continue
    }

    const prev = resolved[resolved.length - 1]
    if (prev && prev.approver_user_id === approver.id) {
      // Same person should not approve twice in sequence when reliever == department lead.
      // Promote the stage to department_lead so requester gets a single actionable approval step.
      if (prev.approver_role_code === "reliever" && row.approver_role_code === "department_lead") {
        prev.approver_role_code = "department_lead"
        prev.stage_code = stageCodeForRole("department_lead")
        continue
      }

      // Collapse exact duplicates (same user + same role).
      if (prev.approver_role_code === row.approver_role_code) {
        continue
      }
    }

    resolved.push({
      stage_order: resolved.length + 1,
      approver_role_code: row.approver_role_code,
      approver_user_id: approver.id,
      stage_code: stageCodeForRole(row.approver_role_code),
    })
  }

  if (!resolved.length) {
    throw new Error("LEAVE_APPROVER_NOT_CONFIGURED:empty_route")
  }

  return resolved
}

export function getRouteStageByOrder(
  snapshot: RouteSnapshotRow[] | null | undefined,
  stageOrder: number
): ResolvedRouteStage | null {
  if (!Array.isArray(snapshot)) return null
  return (
    snapshot
      .map((row) => ({
        stage_order: Number(row.stage_order),
        approver_role_code: String(row.approver_role_code),
        approver_user_id: String(row.approver_user_id),
        stage_code: String(row.stage_code),
      }))
      .find((row) => row.stage_order === stageOrder) || null
  )
}

export async function notifyStageApprover(params: {
  supabase: LeaveRoutingClient
  approverUserId: string
  title: string
  message: string
  actorId: string
  entityId: string
  linkUrl?: string
}) {
  await notifyUsers(params.supabase, {
    userIds: [params.approverUserId],
    title: params.title,
    message: params.message,
    actorId: params.actorId,
    entityId: params.entityId,
    linkUrl: params.linkUrl || "/leave",
    emailEvent: "approval_required",
  })
}
