import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { evaluateLeaveEligibility, getLeavePolicy } from "@/lib/hr/leave-workflow"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { LeaveContent } from "./leave-content"

export interface LeaveApprovalAudit {
  id: string
  approver_id?: string | null
  approval_level?: number | null
  status: string
  comments?: string | null
  approved_at?: string | null
  stage_code?: string | null
  stage_order?: number | null
  reliever_revision?: number | null
  superseded?: boolean | null
  approver?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
}

export interface LeaveRequest {
  id: string
  user_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  resume_date: string
  days_count: number
  reason: string
  handover_note?: string | null
  status: string
  approval_stage: string
  reliever_id?: string | null
  approved_by?: string | null
  reliever_decision_at?: string | null
  supervisor_decision_at?: string | null
  hr_decision_at?: string | null
  current_stage_code?: string
  current_stage_order?: number
  current_approver_user_id?: string
  requester_route_kind?: string
  lead_reconfirm_required?: boolean
  reliever_revision?: number
  created_at: string
  leave_type: {
    name: string
  }
  user?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
  reliever?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
  supervisor?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
  approved_by_profile?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
  } | null
  current_approver?: {
    id?: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    company_email?: string | null
    role?: string | null
  } | null
  required_documents?: string[]
  missing_documents?: string[]
  evidence_complete?: boolean
  approvals?: LeaveApprovalAudit[]
}

export interface LeaveBalance {
  leave_type_id: string
  allocated_days: number
  used_days: number
  balance_days: number
}

export interface LeaveType {
  id: string
  name: string
  code: string
  max_days: number
  eligibility_status: "eligible" | "not_eligible" | "missing_evidence"
  eligibility_reason: string | null
  required_documents: string[]
  missing_documents: string[]
}

type RelieverOption = {
  value: string
  label: string
}

type InitialRelieverDebug = {
  reason?: string
  user_id?: string
  requester_profile_id?: string
  requester_department?: string | null
  requester_department_id?: string | null
  resolution_source?: string
  total_profiles_scanned?: number
  matched_profiles?: number
  options_count?: number
}

async function getLeaveData() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const [{ data: requestsData }, { data: balancesData }, { data: leaveTypes }, { data: profileData }] =
    await Promise.all([
      supabase
        .from("leave_requests")
        .select(
          `
        *,
        leave_type:leave_types(name),
        reliever:profiles!leave_requests_reliever_id_fkey(id, full_name, company_email),
        supervisor:profiles!leave_requests_supervisor_id_fkey(id, full_name, company_email)
      `
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("leave_balances")
        .select("leave_type_id, allocated_days, used_days, balance_days")
        .eq("user_id", user.id),
      supabase.from("leave_types").select("id, name, code, max_days").eq("is_active", true).order("name"),
      supabase
        .from("profiles")
        .select(
          "id, role, gender, employment_date, employment_type, marital_status, has_children, pregnancy_status, work_location, department, department_id"
        )
        .eq("id", user.id)
        .single(),
    ])

  const requesterProfile = profileData || {
    id: user.id,
    role: "employee",
    department: null,
    department_id: null,
    gender: "unspecified",
    employment_date: null,
    employment_type: null,
    marital_status: "unspecified",
    has_children: false,
    pregnancy_status: "unspecified",
  }

  const enrichedLeaveTypes = await Promise.all(
    (leaveTypes || []).map(async (leaveType: { id: string; name: string; code: string; max_days: number }) => {
      const policy = await getLeavePolicy(supabase, leaveType.id)
      const eligibility = await evaluateLeaveEligibility({
        supabase,
        policy,
        requesterProfile,
        leaveType,
        startDate: new Date().toISOString().slice(0, 10),
        daysCount: 1,
      })

      return {
        ...leaveType,
        eligibility_status: eligibility.status,
        eligibility_reason: eligibility.reason,
        required_documents: eligibility.requiredDocuments,
        missing_documents: eligibility.missingDocuments,
      }
    })
  )

  const relieverCandidatesById = new Map<
    string,
    {
      id: string
      full_name?: string | null
      first_name?: string | null
      last_name?: string | null
      department?: string | null
      department_id?: string | null
      employment_status?: string | null
    }
  >()
  let totalProfilesScanned = 0

  if (requesterProfile.department_id) {
    const { data: deptIdRows } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name, department, department_id, employment_status")
      .eq("department_id", requesterProfile.department_id)
      .neq("id", requesterProfile.id)
      .order("first_name", { ascending: true })
    for (const row of deptIdRows || []) {
      if (row.id) relieverCandidatesById.set(row.id, row)
    }
    totalProfilesScanned += (deptIdRows || []).length
  }

  if (requesterProfile.department) {
    const { data: deptNameRows } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name, department, department_id, employment_status")
      .eq("department", requesterProfile.department)
      .neq("id", requesterProfile.id)
      .order("first_name", { ascending: true })
    for (const row of deptNameRows || []) {
      if (row.id) relieverCandidatesById.set(row.id, row)
    }
    totalProfilesScanned += (deptNameRows || []).length
  }

  const normalizedRequesterDept = String(requesterProfile.department || "")
    .trim()
    .toLowerCase()
  const relieverRows = Array.from(relieverCandidatesById.values()).filter((row) => {
    const sameDeptId = Boolean(requesterProfile.department_id && row.department_id === requesterProfile.department_id)
    const sameDeptName =
      normalizedRequesterDept.length > 0 &&
      String(row.department || "")
        .trim()
        .toLowerCase() === normalizedRequesterDept
    const assignableStatus = isAssignableEmploymentStatus(row.employment_status, {
      allowLegacyNullStatus: false,
    })
    return (sameDeptId || sameDeptName) && assignableStatus
  })

  const relieverOptions: RelieverOption[] = relieverRows
    .map((row) => ({
      value: row.id,
      label: row.full_name?.trim() || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Unnamed",
    }))
    .filter((row) => Boolean(row.value))

  const relieverDebug: InitialRelieverDebug = {
    reason: !requesterProfile.department && !requesterProfile.department_id ? "requester_has_no_department" : undefined,
    user_id: user.id,
    requester_profile_id: requesterProfile.id || null,
    requester_department: requesterProfile.department || null,
    requester_department_id: requesterProfile.department_id || null,
    resolution_source: "leave_page_server_prefetch",
    total_profiles_scanned: totalProfilesScanned,
    matched_profiles: relieverRows.length,
    options_count: relieverOptions.length,
  }

  return {
    currentUserId: user.id,
    currentUserRole: requesterProfile.role || "employee",
    requests: (requestsData || []) as LeaveRequest[],
    balances: (balancesData || []) as LeaveBalance[],
    leaveTypes: enrichedLeaveTypes as LeaveType[],
    relieverOptions,
    relieverDebug,
  }
}

export default async function LeavePage() {
  const data = await getLeaveData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const leaveData = data as {
    currentUserId: string
    currentUserRole: string
    requests: LeaveRequest[]
    balances: LeaveBalance[]
    leaveTypes: LeaveType[]
    relieverOptions: RelieverOption[]
    relieverDebug: InitialRelieverDebug
  }

  return (
    <LeaveContent
      currentUserId={leaveData.currentUserId}
      initialRequests={leaveData.requests}
      initialBalances={leaveData.balances}
      initialLeaveTypes={leaveData.leaveTypes}
      initialRelieverOptions={leaveData.relieverOptions}
      initialRelieverDebug={leaveData.relieverDebug}
    />
  )
}
