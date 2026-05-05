import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { applyDataScopeV2 } from "@/lib/admin/policy-v2"
import {
  areRequiredDocumentsVerified,
  assertNoOverlap,
  assertRelieverAvailability,
  computeLeaveDates,
  evaluateLeaveEligibility,
  getLeavePolicy,
  resolveProfileByIdentifier,
} from "@/lib/hr/leave-workflow"
import {
  buildResolvedRouteSnapshot,
  classifyRequesterKind,
  getRouteStageByOrder,
  notifyStageApprover,
  stageCodeForRole,
} from "@/lib/hr/leave-routing"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getPaginationRange, PaginationSchema } from "@/lib/pagination"

const log = logger("leave-requests")
const BLACKOUT_MONTHS = new Set([12, 1])
const CreateLeaveRequestSchema = z.object({
  leave_type_id: z.string().trim().min(1, "Missing required fields"),
  start_date: z.string().trim().min(1, "Missing required fields"),
  days_count: z.unknown().optional(),
  emergency_override: z.boolean().optional(),
  end_date: z.string().optional().nullable(),
  reason: z.string().trim().min(1, "Missing required fields"),
  reliever_identifier: z.string().trim().min(1, "Missing required fields"),
  handover_note: z.string().trim().min(1, "Missing required fields"),
})

const UpdateLeaveRequestSchema = z.object({
  id: z.string().trim().min(1, "Leave request ID is required"),
  leave_type_id: z.string().optional(),
  start_date: z.string().optional(),
  days_count: z.unknown().optional(),
  emergency_override: z.boolean().optional(),
  end_date: z.string().optional().nullable(),
  reason: z.string().optional(),
  reliever_identifier: z.string().optional(),
  handover_note: z.string().optional(),
})

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

type LeaveRequestStageState = {
  id: string
  status: string
  current_stage_code?: string | null
  approval_stage?: string | null
}

type ProfileReferenceRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  company_email?: string | null
  department_id?: string | null
  department?: string | null
}

type DepartmentReferenceRow = {
  id: string
  department_id?: string | null
}

type LeaveTypeReferenceRow = {
  id: string
  name?: string | null
  code?: string | null
  description?: string | null
  max_days?: number | null
  requires_approval?: boolean | null
}

type LeaveEvidenceRow = {
  id: string
  leave_request_id: string
  document_type?: string | null
  file_url?: string | null
  status?: string | null
  verified_by?: string | null
  verified_at?: string | null
  notes?: string | null
  created_at?: string | null
}

type LeaveApprovalRow = {
  id: string
  leave_request_id: string
  approver_id?: string | null
  approval_level?: number | null
  status?: string | null
  comments?: string | null
  approved_at?: string | null
  stage_code?: string | null
  stage_order?: number | null
  superseded?: boolean | null
  reliever_revision?: number | null
}

type LeaveBalanceRow = {
  leave_type_id?: string | null
  balance_days?: number | null
}

type LeaveRequestRow = LeaveRequestStageState & {
  user_id: string
  leave_type_id: string
  reliever_id?: string | null
  supervisor_id?: string | null
  approved_by?: string | null
  reliever_decision_at?: string | null
  supervisor_decision_at?: string | null
  hr_decision_at?: string | null
  route_snapshot?: Array<{
    stage_order?: number | null
    approver_role_code?: string | null
    approver_user_id?: string | null
  }> | null
  start_date?: string | null
  end_date?: string | null
  days_count?: number | null
  reason?: string | null
  handover_note?: string | null
}

type LeavePolicySummary = {
  required_documents?: string[] | null
}

type RelieverOption = {
  value: string
  label: string
}

type RelieverDebug = {
  reason?: string
  user_id: string
  requester_profile_id: string | null
  requester_department: string | null
  requester_department_id: string | null
  resolution_source: string
  total_profiles_scanned: number
  matched_profiles: number
  options_count: number
}

function normalizeDepartment(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
}

function buildProfileLabel(row: ProfileReferenceRow) {
  return row.full_name?.trim() || `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Unnamed"
}

async function deriveRemainingDays(params: {
  supabase: SupabaseServerClient
  userId: string
  leaveTypeId: string
  maxDays: number
  excludeRequestId?: string
}) {
  let query = params.supabase
    .from("leave_requests")
    .select("id, days_count, status")
    .eq("user_id", params.userId)
    .eq("leave_type_id", params.leaveTypeId)
    .in("status", ["pending", "pending_evidence", "approved"])

  if (params.excludeRequestId) {
    query = query.neq("id", params.excludeRequestId)
  }

  const { data } = await query
  const usedDays = ((data || []) as Array<{ days_count?: number | null }>).reduce(
    (acc, row) => acc + Number(row.days_count || 0),
    0
  )
  return Math.max(0, Number(params.maxDays || 0) - usedDays)
}

function isRelieverStage(request: LeaveRequestStageState) {
  const stage = request.current_stage_code || request.approval_stage
  return stage === "pending_reliever" || stage === "reliever_pending"
}

async function assertNoDepartmentOverlap(
  supabase: SupabaseServerClient,
  requesterId: string,
  departmentId: string | null | undefined,
  startDate: string,
  endDate: string,
  excludeRequestId?: string
) {
  if (!departmentId) return

  const { data: peers } = await supabase
    .from("profiles")
    .select("id")
    .eq("department_id", departmentId)
    .neq("id", requesterId)

  const peerIds = ((peers || []) as ProfileReferenceRow[]).map((row) => row.id).filter(Boolean)
  if (peerIds.length === 0) return

  let overlapQuery = supabase
    .from("leave_requests")
    .select("id, user_id, start_date, end_date, status")
    .in("user_id", peerIds)
    .in("status", ["pending", "pending_evidence", "approved"])
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .limit(1)

  if (excludeRequestId) {
    overlapQuery = overlapQuery.neq("id", excludeRequestId)
  }

  const { data: overlapRows, error: overlapError } = await overlapQuery
  if (overlapError) {
    throw new Error("Failed to validate department leave overlap")
  }

  if (overlapRows && overlapRows.length > 0) {
    throw new Error("Another employee in your department already has an overlapping leave for these dates.")
  }
}

async function assertRequesterNotBlockedByRelieverCommitment(
  supabase: SupabaseServerClient,
  requesterId: string,
  startDate: string,
  endDate: string,
  excludeRequestId?: string
) {
  let overlapQuery = supabase
    .from("leave_requests")
    .select("id, user_id, reliever_id, start_date, end_date, status")
    .eq("reliever_id", requesterId)
    .neq("user_id", requesterId)
    .in("status", ["pending", "pending_evidence", "approved"])
    .lte("start_date", endDate)
    .gte("end_date", startDate)
    .limit(1)

  if (excludeRequestId) {
    overlapQuery = overlapQuery.neq("id", excludeRequestId)
  }

  const { data: overlapRows, error: overlapError } = await overlapQuery
  if (overlapError) {
    throw new Error("Failed to validate reliever commitment overlap")
  }

  if (overlapRows && overlapRows.length > 0) {
    throw new Error(
      "You are assigned as reliever for another leave during this period. You cannot request leave until that relief period ends."
    )
  }
}

async function canRequesterModifyBeforeRelieverDecision(
  supabase: SupabaseServerClient,
  request: LeaveRequestStageState
) {
  if (!["pending", "pending_evidence"].includes(request.status)) return false
  if (!isRelieverStage(request)) return false

  const { data: relieverDecisionRows, error } = await supabase
    .from("leave_approvals")
    .select("id")
    .eq("leave_request_id", request.id)
    .eq("stage_code", stageCodeForRole("reliever"))
    .eq("superseded", false)
    .in("status", ["approved", "rejected"])
    .limit(1)

  if (error) throw new Error("Failed to validate reliever decision state")
  return !(relieverDecisionRows && relieverDecisionRows.length > 0)
}

async function getUserDepartmentId(supabase: SupabaseServerClient, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("id, department_id")
    .eq("id", userId)
    .maybeSingle<DepartmentReferenceRow>()

  return data?.department_id || null
}

function assertSameDepartmentReliever(params: {
  requesterDepartmentId?: string | null
  relieverDepartmentId?: string | null
}) {
  if (!params.requesterDepartmentId || !params.relieverDepartmentId) {
    throw new Error("Requester and reliever must both have a department before leave can be submitted.")
  }

  if (params.requesterDepartmentId !== params.relieverDepartmentId) {
    throw new Error("Reliever must be from your department.")
  }
}

function assertBlackoutWindowAllowed(params: { startDate: string; endDate: string; emergencyOverride?: boolean }) {
  if (params.emergencyOverride) return

  const start = new Date(`${params.startDate}T00:00:00`)
  const end = new Date(`${params.endDate}T00:00:00`)
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const month = cursor.getMonth() + 1
    if (BLACKOUT_MONTHS.has(month)) {
      throw new Error(
        "Leave dates in December and January are restricted. Enable emergency override in the leave form if this is urgent."
      )
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const paginationParsed = PaginationSchema.safeParse({
      page: searchParams.get("page") || "1",
      per_page: searchParams.get("limit") || "20",
    })
    if (!paginationParsed.success) {
      return NextResponse.json({ error: "Invalid pagination params" }, { status: 400 })
    }
    const status = searchParams.get("status")
    const userId = searchParams.get("user_id")
    const all = searchParams.get("all") === "true"
    let scopedMode: "all" | "dept" | "none" = "all"
    let scopedDepartments: string[] = []

    let query = supabase
      .from("leave_requests")
      .select(
        `
        *,
        user:profiles!leave_requests_user_id_profiles_fkey (
          id, full_name, first_name, last_name, company_email, department
        ),
        leave_type:leave_types!leave_requests_leave_type_id_fkey (
          id, name
        ),
        approvals:leave_approvals (
          id, approver_id, status, stage_code, approved_at, comments
        )
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })

    if (status) query = query.eq("status", status)

    const targetUserId = userId || user.id

    if (all) {
      const contextResult = await requireAccessContextV2()
      if (!contextResult.ok) {
        return contextResult.response
      }
      const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.main")
      if (!routeAccess.ok) {
        return routeAccess.response
      }
      if (routeAccess.dataScope === "none") {
        return NextResponse.json({ data: [], meta: { total: 0, page: 1, per_page: 20 } })
      }
      if (routeAccess.dataScope !== "all") {
        scopedMode = "dept"
        scopedDepartments = routeAccess.dataScope
      }
    } else {
      query = query.eq("user_id", targetUserId)
    }

    const { from, to } = getPaginationRange(paginationParsed.data)
    const { data: requests, error, count } = await query.range(from, to)
    if (error) {
      return NextResponse.json({ error: `Failed to fetch leave requests: ${error.message}` }, { status: 500 })
    }

    const requestRows = ((requests || []) as LeaveRequestRow[]).filter((row) =>
      all ? true : row.user_id === targetUserId
    )
    const requestIds = requestRows.map((row) => row.id).filter(Boolean)

    const { data: balanceRows } = await supabase
      .from("leave_balances")
      .select("*")
      .eq("user_id", targetUserId)
      .order("leave_type_id")

    let evidenceRows: LeaveEvidenceRow[] = []
    let approvalRows: LeaveApprovalRow[] = []

    if (requestIds.length > 0) {
      const [{ data: evidenceData }, { data: approvalsData }] = await Promise.all([
        dataClient
          .from("leave_evidence")
          .select("id, leave_request_id, document_type, file_url, status, verified_by, verified_at, notes, created_at")
          .in("leave_request_id", requestIds),
        dataClient
          .from("leave_approvals")
          .select(
            "id, leave_request_id, approver_id, approval_level, status, comments, approved_at, stage_code, stage_order, superseded, reliever_revision"
          )
          .in("leave_request_id", requestIds),
      ])

      evidenceRows = evidenceData || []
      approvalRows = approvalsData || []
    }

    const profileIdSet = new Set<string>()
    for (const row of requestRows) {
      if (row.user_id) profileIdSet.add(row.user_id)
      if (row.reliever_id) profileIdSet.add(row.reliever_id)
      if (row.supervisor_id) profileIdSet.add(row.supervisor_id)
      if (row.approved_by) profileIdSet.add(row.approved_by)
    }
    for (const approval of approvalRows) {
      if (approval.approver_id) profileIdSet.add(approval.approver_id)
    }

    const leaveTypeIdSet = new Set<string>()
    for (const row of requestRows) {
      if (row.leave_type_id) leaveTypeIdSet.add(row.leave_type_id)
    }
    for (const balance of balanceRows || []) {
      if (balance.leave_type_id) leaveTypeIdSet.add(balance.leave_type_id)
    }

    let profileRows: ProfileReferenceRow[] = []
    let leaveTypeRows: LeaveTypeReferenceRow[] = []

    const profileIds = Array.from(profileIdSet)
    const leaveTypeIds = Array.from(leaveTypeIdSet)

    if (profileIds.length > 0) {
      const { data } = await dataClient
        .from("profiles")
        .select("id, first_name, last_name, full_name, company_email, department_id, department")
        .in("id", profileIds)
      profileRows = data || []
    }

    if (leaveTypeIds.length > 0) {
      const { data } = await dataClient
        .from("leave_types")
        .select("id, name, code, description, max_days, requires_approval")
        .in("id", leaveTypeIds)
      leaveTypeRows = data || []
    }

    const profileMap = new Map((profileRows || []).map((row) => [row.id, row] as const))
    const leaveTypeMap = new Map((leaveTypeRows || []).map((row) => [row.id, row] as const))

    const filteredRequestRows =
      all && scopedMode === "dept"
        ? applyDataScopeV2(requestRows, scopedDepartments, (row) =>
            row.user_id ? profileMap.get(row.user_id)?.department || null : null
          )
        : requestRows
    const evidenceByRequest = new Map<string, LeaveEvidenceRow[]>()
    const approvalsByRequest = new Map<string, Array<LeaveApprovalRow & { approver: ProfileReferenceRow | null }>>()

    for (const evidence of evidenceRows) {
      const rows = evidenceByRequest.get(evidence.leave_request_id) || []
      rows.push(evidence)
      evidenceByRequest.set(evidence.leave_request_id, rows)
    }

    for (const approval of approvalRows) {
      const rows = approvalsByRequest.get(approval.leave_request_id) || []
      rows.push({
        ...approval,
        approver: approval.approver_id ? profileMap.get(approval.approver_id) || null : null,
      })
      approvalsByRequest.set(approval.leave_request_id, rows)
    }

    // Pre-fetch all leave policies in parallel (one per unique leave_type_id)
    // instead of fetching inside the map (which would be N sequential queries).
    const uniqueLeaveTypeIds = Array.from(new Set(requestRows.map((r) => r.leave_type_id).filter(Boolean)))
    const policyEntries = await Promise.all(
      uniqueLeaveTypeIds.map(async (ltId) => {
        const policy = await getLeavePolicy(supabase, ltId as string)
        return [ltId, policy] as const
      })
    )
    const policyMap = new Map(policyEntries)

    // Check evidence completeness for all requests in parallel
    const enriched = await Promise.all(
      filteredRequestRows.map(async (leaveRequest) => {
        const policy = (policyMap.get(leaveRequest.leave_type_id) ?? { required_documents: [] }) as LeavePolicySummary
        const requiredDocs = policy.required_documents || []
        const evidence = await areRequiredDocumentsVerified(supabase, leaveRequest.id, requiredDocs)
        return {
          ...leaveRequest,
          user: leaveRequest.user_id ? profileMap.get(leaveRequest.user_id) || null : null,
          reliever: leaveRequest.reliever_id ? profileMap.get(leaveRequest.reliever_id) || null : null,
          supervisor: leaveRequest.supervisor_id ? profileMap.get(leaveRequest.supervisor_id) || null : null,
          approved_by_profile: leaveRequest.approved_by ? profileMap.get(leaveRequest.approved_by) || null : null,
          leave_type: leaveRequest.leave_type_id ? leaveTypeMap.get(leaveRequest.leave_type_id) || null : null,
          evidence: evidenceByRequest.get(leaveRequest.id) || [],
          approvals: approvalsByRequest.get(leaveRequest.id) || [],
          required_documents: requiredDocs,
          evidence_complete: evidence.complete,
          missing_documents: evidence.missing,
        }
      })
    )

    const balances = ((balanceRows || []) as LeaveBalanceRow[]).map((row) => ({
      ...row,
      leave_type: row.leave_type_id ? leaveTypeMap.get(row.leave_type_id) || null : null,
    }))

    let relieverCommitments: LeaveRequestRow[] = []
    if (!all) {
      const todayIsoDate = new Date().toISOString().slice(0, 10)
      const { data: relieverRows } = await supabase
        .from("leave_requests")
        .select(
          `
          id,
          user_id,
          leave_type_id,
          start_date,
          end_date,
          resume_date,
          days_count,
          status,
          user:profiles!leave_requests_user_id_profiles_fkey(id, full_name, company_email),
          leave_type:leave_types!leave_requests_leave_type_id_fkey(id, name)
        `
        )
        .eq("reliever_id", targetUserId)
        .neq("user_id", targetUserId)
        .in("status", ["pending", "pending_evidence", "approved"])
        .gte("end_date", todayIsoDate)
        .order("start_date", { ascending: true })

      relieverCommitments = relieverRows || []
    }

    const { data: requesterProfile } = await supabase
      .from("profiles")
      .select("id, department_id, department")
      .eq("id", user.id)
      .maybeSingle<ProfileReferenceRow>()

    const requesterDepartment = requesterProfile?.department || null
    const requesterDepartmentId = requesterProfile?.department_id || null
    const requesterProfileId = requesterProfile?.id || user.id

    const relieverCandidatesById = new Map<string, ProfileReferenceRow>()
    let totalProfilesScanned = 0

    if (requesterDepartmentId) {
      const { data: byDeptId } = await dataClient
        .from("profiles")
        .select("id, first_name, last_name, full_name, company_email, department_id, department")
        .eq("department_id", requesterDepartmentId)
        .neq("id", requesterProfileId)
        .order("first_name", { ascending: true })
      const rows = (byDeptId as ProfileReferenceRow[] | null) || []
      totalProfilesScanned += rows.length
      for (const row of rows) {
        if (row.id) relieverCandidatesById.set(row.id, row)
      }
    }

    if (requesterDepartment) {
      const { data: byDeptName } = await dataClient
        .from("profiles")
        .select("id, first_name, last_name, full_name, company_email, department_id, department")
        .eq("department", requesterDepartment)
        .neq("id", requesterProfileId)
        .order("first_name", { ascending: true })
      const rows = (byDeptName as ProfileReferenceRow[] | null) || []
      totalProfilesScanned += rows.length
      for (const row of rows) {
        if (row.id) relieverCandidatesById.set(row.id, row)
      }
    }

    const requesterDepartmentName = normalizeDepartment(requesterDepartment)
    const relieverRows = Array.from(relieverCandidatesById.values()).filter((row) => {
      const sameDepartmentId = Boolean(requesterDepartmentId && row.department_id === requesterDepartmentId)
      const sameDepartmentName =
        requesterDepartmentName.length > 0 && normalizeDepartment(row.department) === requesterDepartmentName
      return sameDepartmentId || sameDepartmentName
    })

    const relieverOptions: RelieverOption[] = relieverRows
      .map((row) => ({ value: row.id, label: buildProfileLabel(row) }))
      .filter((row) => Boolean(row.value))

    const relieverDebug: RelieverDebug = {
      reason: !requesterDepartment && !requesterDepartmentId ? "requester_has_no_department" : undefined,
      user_id: user.id,
      requester_profile_id: requesterProfileId || null,
      requester_department: requesterDepartment,
      requester_department_id: requesterDepartmentId,
      resolution_source: "requests_get_profile",
      total_profiles_scanned: totalProfilesScanned,
      matched_profiles: relieverRows.length,
      options_count: relieverOptions.length,
    }

    return NextResponse.json({
      data: enriched,
      balances: balances || [],
      reliever_options: relieverOptions,
      reliever_debug: relieverDebug,
      reliever_commitments: relieverCommitments,
      pagination: {
        page: paginationParsed.data.page,
        limit: paginationParsed.data.per_page,
        total: count || 0,
        total_pages: count ? Math.ceil(count / paginationParsed.data.per_page) : 0,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const validationClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const parsed = CreateLeaveRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const {
      leave_type_id,
      start_date,
      days_count,
      emergency_override,
      end_date,
      reason,
      reliever_identifier,
      handover_note,
    } = parsed.data

    const parsedDays = Number(days_count)
    const fallbackDays = end_date
      ? Math.ceil(
          (new Date(`${end_date}T00:00:00.000Z`).getTime() - new Date(`${start_date}T00:00:00.000Z`).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      : 0

    const effectiveDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : fallbackDays
    if (!effectiveDays || effectiveDays <= 0) {
      return NextResponse.json({ error: "Number of days must be greater than zero" }, { status: 400 })
    }

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select(
        "id, full_name, first_name, last_name, company_email, department, department_id, is_department_lead, lead_departments, gender, employment_date, work_location, employment_type, marital_status, has_children, pregnancy_status"
      )
      .eq("id", user.id)
      .single()

    if (requesterError || !requester) {
      return NextResponse.json({ error: "Failed to load employee profile" }, { status: 400 })
    }

    const { data: leaveType } = await supabase
      .from("leave_types")
      .select("id, name, code, max_days")
      .eq("id", leave_type_id)
      .single()
    if (!leaveType) {
      return NextResponse.json({ error: "Leave type not found" }, { status: 400 })
    }

    const policy = await getLeavePolicy(supabase, leave_type_id)
    const eligibility = await evaluateLeaveEligibility({
      supabase,
      policy,
      requesterProfile: requester,
      leaveType,
      startDate: start_date,
      daysCount: effectiveDays,
    })

    if (eligibility.status === "not_eligible") {
      return NextResponse.json(
        { error: eligibility.reason || "You are not eligible for this leave type" },
        { status: 400 }
      )
    }

    const { endDate, resumeDate } = await computeLeaveDates({
      supabase,
      startDate: start_date,
      daysCount: effectiveDays,
      accrualMode: (policy.accrual_mode as "calendar_days" | "business_days") || "calendar_days",
      location: requester.work_location || "global",
    })
    assertBlackoutWindowAllowed({
      startDate: start_date,
      endDate,
      emergencyOverride: emergency_override,
    })

    const reliever = await resolveProfileByIdentifier(validationClient, reliever_identifier, "Reliever")

    if (reliever.id === user.id) {
      return NextResponse.json({ error: "You cannot assign yourself as reliever" }, { status: 400 })
    }
    assertSameDepartmentReliever({
      requesterDepartmentId: requester.department_id,
      relieverDepartmentId: reliever.department_id,
    })

    await assertNoOverlap(validationClient, user.id, start_date, endDate)
    await assertNoDepartmentOverlap(validationClient, user.id, requester.department_id, start_date, endDate)
    await assertRequesterNotBlockedByRelieverCommitment(validationClient, user.id, start_date, endDate)
    await assertRelieverAvailability(validationClient, reliever.id, start_date, endDate)

    const [{ data: balance }, { data: balanceReserved, error: reserveError }] = await Promise.all([
      supabase
        .from("leave_balances")
        .select("balance_days")
        .eq("user_id", user.id)
        .eq("leave_type_id", leave_type_id)
        .single(),
      supabase.rpc("check_and_reserve_leave_balance", {
        p_user_id: user.id,
        p_leave_type_id: leave_type_id,
        p_days: effectiveDays,
      }),
    ])

    let reservationAccepted = Boolean(balanceReserved)
    if (reserveError) {
      log.warn(
        { err: String(reserveError), userId: user.id, leaveTypeId: leave_type_id, effectiveDays },
        "Reserve balance check failed; deriving fallback remaining days"
      )
      const maxDays = Number(leaveType.max_days || 0)
      const derivedRemaining = await deriveRemainingDays({
        supabase,
        userId: user.id,
        leaveTypeId: leave_type_id,
        maxDays,
      })
      if (effectiveDays > derivedRemaining) {
        return NextResponse.json(
          {
            error: `Insufficient leave balance. You requested ${effectiveDays} day(s), but only ${derivedRemaining} day(s) remain.`,
          },
          { status: 400 }
        )
      }
      reservationAccepted = true
    }

    if (!reservationAccepted) {
      const maxDays = Number(leaveType.max_days || 0)
      const derivedRemaining = await deriveRemainingDays({
        supabase,
        userId: user.id,
        leaveTypeId: leave_type_id,
        maxDays,
      })
      const remainingDays = Math.max(0, Math.min(Number(balance?.balance_days ?? derivedRemaining), derivedRemaining))
      return NextResponse.json(
        {
          error: `Insufficient leave balance. You requested ${effectiveDays} day(s), but only ${remainingDays} day(s) remain.`,
        },
        { status: 400 }
      )
    }

    const { data: existingWorkflowRequest } = await supabase
      .from("leave_requests")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["pending", "pending_evidence"])
      .limit(1)

    if (existingWorkflowRequest && existingWorkflowRequest.length > 0) {
      return NextResponse.json(
        { error: "You already have an active leave request. Complete it before submitting another." },
        { status: 400 }
      )
    }

    const { data: activeApprovedRequest } = await supabase
      .from("leave_requests")
      .select("id, start_date, end_date")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .lte("start_date", endDate)
      .gte("end_date", start_date)
      .limit(1)

    if (activeApprovedRequest && activeApprovedRequest.length > 0) {
      const activeRange = activeApprovedRequest[0]
      return NextResponse.json(
        {
          error: `You already have an approved leave overlapping these dates (${activeRange.start_date} to ${activeRange.end_date}). Choose a different period.`,
        },
        { status: 400 }
      )
    }

    const requesterRouteKind = classifyRequesterKind(requester)
    const routeSnapshot = await buildResolvedRouteSnapshot({
      supabase: validationClient,
      requester,
      requesterId: user.id,
      requesterKind: requesterRouteKind,
      relieverId: reliever.id,
    })

    const firstStage = getRouteStageByOrder(routeSnapshot, 1)
    if (!firstStage) {
      return NextResponse.json({ error: "LEAVE_APPROVER_NOT_CONFIGURED:first_stage" }, { status: 400 })
    }

    const departmentLeadStage = routeSnapshot.find((stage) => stage.approver_role_code === "department_lead")
    const initialStatus = eligibility.status === "missing_evidence" ? "pending_evidence" : "pending"

    const { data: newRequest, error } = await supabase
      .from("leave_requests")
      .insert({
        user_id: user.id,
        leave_type_id,
        start_date,
        end_date: endDate,
        resume_date: resumeDate,
        days_count: effectiveDays,
        reason,
        status: initialStatus,
        approval_stage: firstStage.stage_code,
        current_stage_code: firstStage.stage_code,
        current_stage_order: firstStage.stage_order,
        current_approver_user_id: firstStage.approver_user_id,
        requester_route_kind: requesterRouteKind,
        route_snapshot: routeSnapshot,
        reliever_id: reliever.id,
        supervisor_id: departmentLeadStage?.approver_user_id || null,
        handover_note,
        requested_days_mode: policy.accrual_mode || "calendar_days",
        request_kind: emergency_override ? "emergency" : "standard",
      })
      .select()
      .single()

    if (error || !newRequest) {
      const dbMessage = error?.message
        ? `Failed to create leave request: ${error.message}`
        : "Failed to create leave request"
      return NextResponse.json({ error: dbMessage }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "leave_request",
        entityId: newRequest.id,
        newValues: { leave_type_id, start_date, end_date: endDate, days_count: effectiveDays, status: initialStatus },
        context: { actorId: user.id, source: "api", route: "/api/hr/leave/requests" },
      },
      { failOpen: true }
    )

    const requesterName = requester.full_name || `${requester.first_name || ""} ${requester.last_name || ""}`.trim()

    if (initialStatus === "pending") {
      const isRelieverStage = firstStage.approver_role_code === "reliever"
      await notifyStageApprover({
        supabase,
        approverUserId: firstStage.approver_user_id,
        title: isRelieverStage ? "Leave relief confirmation required" : "Leave request awaiting your approval",
        message: isRelieverStage
          ? `${requesterName || "Employee"} selected you as reliever for ${leaveType.name} from ${start_date} to ${endDate}. Review the handover note and confirm coverage so the request can continue.`
          : `${requesterName || "Employee"} requested ${effectiveDays} day(s) leave from ${start_date} to ${endDate}.`,
        actorId: user.id,
        entityId: newRequest.id,
        linkUrl: "/leave",
      })
    }

    return NextResponse.json({
      data: {
        ...newRequest,
        required_documents: eligibility.requiredDocuments,
        missing_documents: eligibility.missingDocuments,
      },
      message:
        initialStatus === "pending_evidence"
          ? "Leave request saved. Upload required evidence to continue approval workflow."
          : "Leave request created successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in POST")
    const message = error instanceof Error ? error.message : "An error occurred"
    const status =
      message.startsWith("LEAVE_APPROVER_NOT_CONFIGURED:") ||
      message.startsWith("LEAVE_APPROVER_CONFLICT:") ||
      message.toLowerCase().includes("overlap") ||
      message.toLowerCase().includes("reliever") ||
      message.toLowerCase().includes("already has an approved leave")
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const validationClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const parsed = UpdateLeaveRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const {
      id,
      leave_type_id,
      start_date,
      days_count,
      emergency_override,
      end_date,
      reason,
      reliever_identifier,
      handover_note,
    } = parsed.data

    const { data: existingRequest, error: fetchError } = await supabase
      .from("leave_requests")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !existingRequest) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 })
    }

    // Lead-stage reliever reassignment workflow (reset to reliever)
    if (
      reliever_identifier &&
      existingRequest.status === "pending" &&
      (existingRequest.current_stage_code === stageCodeForRole("department_lead") ||
        existingRequest.approval_stage === stageCodeForRole("department_lead")) &&
      existingRequest.current_approver_user_id === user.id
    ) {
      const newReliever = await resolveProfileByIdentifier(validationClient, reliever_identifier, "Reliever")
      const requesterDepartmentId = await getUserDepartmentId(supabase, existingRequest.user_id)

      if (!newReliever?.id || newReliever.id === existingRequest.user_id) {
        return NextResponse.json({ error: "Invalid reliever selected" }, { status: 400 })
      }
      assertSameDepartmentReliever({
        requesterDepartmentId,
        relieverDepartmentId: newReliever.department_id,
      })

      await assertRelieverAvailability(
        validationClient,
        newReliever.id,
        existingRequest.start_date,
        existingRequest.end_date,
        existingRequest.id
      )

      const routeSnapshot = Array.isArray(existingRequest.route_snapshot) ? [...existingRequest.route_snapshot] : []
      const updatedSnapshot = routeSnapshot.map((stage) => {
        if (Number(stage.stage_order) === 1 && stage.approver_role_code === "reliever") {
          return { ...stage, approver_user_id: newReliever.id }
        }
        return stage
      })

      const newRevision = Number(existingRequest.reliever_revision || 1) + 1

      const { error: updateError } = await supabase
        .from("leave_requests")
        .update({
          reliever_id: newReliever.id,
          route_snapshot: updatedSnapshot,
          current_stage_order: 1,
          current_stage_code: stageCodeForRole("reliever"),
          current_approver_user_id: newReliever.id,
          approval_stage: stageCodeForRole("reliever"),
          reliever_revision: newRevision,
          lead_reconfirm_required: true,
        })
        .eq("id", existingRequest.id)

      if (updateError) {
        return NextResponse.json({ error: "Failed to update reliever" }, { status: 500 })
      }

      await supabase
        .from("leave_approvals")
        .update({ superseded: true })
        .eq("leave_request_id", existingRequest.id)
        .eq("stage_code", stageCodeForRole("reliever"))
        .eq("superseded", false)

      await notifyStageApprover({
        supabase,
        approverUserId: newReliever.id,
        title: "Leave request reassigned to you as reliever",
        message: "A leave request now requires your reliever approval before workflow continues.",
        actorId: user.id,
        entityId: existingRequest.id,
        linkUrl: "/leave",
      })

      return NextResponse.json({ message: "Reliever updated and request returned to reliever approval" })
    }

    // Requester self-edit allowed only while still at reliever stage
    if (existingRequest.user_id !== user.id) {
      return NextResponse.json({ error: "You can only edit your own leave requests" }, { status: 403 })
    }

    const canModify = await canRequesterModifyBeforeRelieverDecision(supabase, existingRequest)
    if (!canModify) {
      return NextResponse.json({ error: "You can only edit requests pending reliever review" }, { status: 400 })
    }

    const targetLeaveTypeId = leave_type_id || existingRequest.leave_type_id
    const targetStartDate = start_date || existingRequest.start_date

    const parsedDays = Number(days_count)
    const fallbackDays = end_date
      ? Math.ceil(
          (new Date(`${end_date}T00:00:00.000Z`).getTime() - new Date(`${targetStartDate}T00:00:00.000Z`).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
      : existingRequest.days_count

    const targetDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : fallbackDays

    const { data: requester } = await supabase
      .from("profiles")
      .select(
        "id, department, department_id, is_department_lead, lead_departments, gender, employment_date, work_location, employment_type, marital_status, has_children, pregnancy_status"
      )
      .eq("id", user.id)
      .single()

    if (!requester) {
      return NextResponse.json({ error: "Failed to load employee profile" }, { status: 400 })
    }

    const { data: leaveType } = await supabase
      .from("leave_types")
      .select("id, name, code, max_days")
      .eq("id", targetLeaveTypeId)
      .single()

    if (!leaveType) {
      return NextResponse.json({ error: "Leave type not found" }, { status: 400 })
    }

    const policy = await getLeavePolicy(supabase, targetLeaveTypeId)
    const eligibility = await evaluateLeaveEligibility({
      supabase,
      policy,
      requesterProfile: requester,
      leaveType,
      startDate: targetStartDate,
      daysCount: targetDays,
    })

    if (eligibility.status === "not_eligible") {
      return NextResponse.json(
        { error: eligibility.reason || "You are not eligible for this leave type" },
        { status: 400 }
      )
    }

    const { endDate, resumeDate } = await computeLeaveDates({
      supabase,
      startDate: targetStartDate,
      daysCount: targetDays,
      accrualMode: (policy.accrual_mode as "calendar_days" | "business_days") || "calendar_days",
      location: requester.work_location || "global",
    })
    assertBlackoutWindowAllowed({
      startDate: targetStartDate,
      endDate,
      emergencyOverride: emergency_override,
    })

    let relieverId = existingRequest.reliever_id
    let relieverDepartmentId: string | null | undefined = existingRequest.reliever_id ? undefined : null
    if (reliever_identifier) {
      const reliever = await resolveProfileByIdentifier(validationClient, reliever_identifier, "Reliever")
      relieverId = reliever.id
      relieverDepartmentId = reliever.department_id
    }

    if (relieverId && typeof relieverDepartmentId === "undefined") {
      relieverDepartmentId = await getUserDepartmentId(supabase, relieverId)
    }

    if (!relieverId || relieverId === user.id) {
      return NextResponse.json({ error: "Invalid reliever selected" }, { status: 400 })
    }
    assertSameDepartmentReliever({
      requesterDepartmentId: requester.department_id,
      relieverDepartmentId,
    })

    await assertNoOverlap(validationClient, user.id, targetStartDate, endDate, id)
    await assertNoDepartmentOverlap(validationClient, user.id, requester.department_id, targetStartDate, endDate, id)
    await assertRequesterNotBlockedByRelieverCommitment(validationClient, user.id, targetStartDate, endDate, id)
    await assertRelieverAvailability(validationClient, relieverId, targetStartDate, endDate, id)

    const [{ data: balance }, { data: balanceReserved, error: reserveError }] = await Promise.all([
      supabase
        .from("leave_balances")
        .select("balance_days")
        .eq("user_id", user.id)
        .eq("leave_type_id", targetLeaveTypeId)
        .single(),
      supabase.rpc("check_and_reserve_leave_balance", {
        p_user_id: user.id,
        p_leave_type_id: targetLeaveTypeId,
        p_days: targetDays,
      }),
    ])

    let reservationAccepted = Boolean(balanceReserved)
    if (reserveError) {
      log.warn(
        { err: String(reserveError), userId: user.id, leaveTypeId: targetLeaveTypeId, targetDays, requestId: id },
        "Reserve balance check failed on update; deriving fallback remaining days"
      )
      const maxDays = Number(leaveType.max_days || 0)
      const derivedRemaining = await deriveRemainingDays({
        supabase,
        userId: user.id,
        leaveTypeId: targetLeaveTypeId,
        maxDays,
        excludeRequestId: id,
      })
      if (targetDays > derivedRemaining) {
        return NextResponse.json(
          {
            error: `Insufficient leave balance. You requested ${targetDays} day(s), but only ${derivedRemaining} day(s) remain.`,
          },
          { status: 400 }
        )
      }
      reservationAccepted = true
    }

    if (!reservationAccepted) {
      const maxDays = Number(leaveType.max_days || 0)
      const derivedRemaining = await deriveRemainingDays({
        supabase,
        userId: user.id,
        leaveTypeId: targetLeaveTypeId,
        maxDays,
        excludeRequestId: id,
      })
      const remainingDays = Math.max(0, Math.min(Number(balance?.balance_days ?? derivedRemaining), derivedRemaining))
      return NextResponse.json(
        {
          error: `Insufficient leave balance. You requested ${targetDays} day(s), but only ${remainingDays} day(s) remain.`,
        },
        { status: 400 }
      )
    }

    const requesterRouteKind = classifyRequesterKind(requester)
    const routeSnapshot = await buildResolvedRouteSnapshot({
      supabase: validationClient,
      requester,
      requesterId: user.id,
      requesterKind: requesterRouteKind,
      relieverId,
    })

    const firstStage = getRouteStageByOrder(routeSnapshot, 1)
    if (!firstStage) {
      return NextResponse.json({ error: "LEAVE_APPROVER_NOT_CONFIGURED:first_stage" }, { status: 400 })
    }

    const departmentLeadStage = routeSnapshot.find((stage) => stage.approver_role_code === "department_lead")

    const { data: updatedRequest, error } = await supabase
      .from("leave_requests")
      .update({
        leave_type_id: targetLeaveTypeId,
        start_date: targetStartDate,
        end_date: endDate,
        resume_date: resumeDate,
        days_count: targetDays,
        reason: reason || existingRequest.reason,
        reliever_id: relieverId,
        supervisor_id: departmentLeadStage?.approver_user_id || null,
        handover_note: handover_note || existingRequest.handover_note,
        requested_days_mode: policy.accrual_mode || "calendar_days",
        request_kind:
          existingRequest.request_kind === "extension" ? "extension" : emergency_override ? "emergency" : "standard",
        status: eligibility.status === "missing_evidence" ? "pending_evidence" : "pending",
        requester_route_kind: requesterRouteKind,
        route_snapshot: routeSnapshot,
        current_stage_order: 1,
        current_stage_code: firstStage.stage_code,
        current_approver_user_id: firstStage.approver_user_id,
        approval_stage: firstStage.stage_code,
        lead_reconfirm_required: false,
      })
      .eq("id", id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: "Failed to update leave request" }, { status: 500 })

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "leave_request",
        entityId: id,
        newValues: {
          leave_type_id: targetLeaveTypeId,
          start_date: targetStartDate,
          end_date: endDate,
          days_count: targetDays,
        },
        context: { actorId: user.id, source: "api", route: "/api/hr/leave/requests" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: {
        ...updatedRequest,
        required_documents: eligibility.requiredDocuments,
        missing_documents: eligibility.missingDocuments,
      },
      message: "Leave request updated successfully",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in PATCH")
    const message = error instanceof Error ? error.message : "An error occurred"
    const status =
      message.startsWith("LEAVE_APPROVER_NOT_CONFIGURED:") ||
      message.startsWith("LEAVE_APPROVER_CONFLICT:") ||
      message.toLowerCase().includes("overlap") ||
      message.toLowerCase().includes("reliever")
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) return NextResponse.json({ error: "Leave request ID is required" }, { status: 400 })

    const { data: existingRequest, error: fetchError } = await supabase
      .from("leave_requests")
      .select("id, user_id, status, approval_stage, current_stage_code")
      .eq("id", id)
      .single()

    if (fetchError || !existingRequest) return NextResponse.json({ error: "Leave request not found" }, { status: 404 })

    if (existingRequest.user_id !== user.id) {
      return NextResponse.json({ error: "You can only delete your own leave requests" }, { status: 403 })
    }

    const normalizedStatus = String(existingRequest.status || "").toLowerCase()
    if (!["pending", "pending_evidence"].includes(normalizedStatus)) {
      return NextResponse.json({ error: "Only pending leave requests can be deleted" }, { status: 400 })
    }

    const { data: deletedRows, error } = await dataClient.from("leave_requests").delete().eq("id", id).select("id")
    if (error) return NextResponse.json({ error: "Failed to delete leave request" }, { status: 500 })
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json(
        { error: "Leave request could not be deleted. Please refresh and try again." },
        { status: 409 }
      )
    }

    await writeAuditLog(
      supabase,
      {
        action: "delete",
        entityType: "leave_request",
        entityId: id,
        oldValues: { status: existingRequest.status, stage: existingRequest.current_stage_code },
        context: { actorId: user.id, source: "api", route: "/api/hr/leave/requests" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message: "Leave request deleted successfully" })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in DELETE")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export { PATCH as PUT }
