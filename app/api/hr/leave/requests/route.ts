import { NextRequest, NextResponse } from "next/server"
import {
  addIsoDays,
  countLeaveDays,
  trimRangeToWorkingDays,
  NO_HOLIDAYS,
  type HolidaySet,
} from "@/lib/hr/leave-days"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { applyDataScopeV2 } from "@/lib/admin/policy-v2"
import { getRequestScope } from "@/lib/admin/api-scope"
import {
  areRequiredDocumentsVerified,
  assertNoOverlap,
  assertRelieverAvailability,
  evaluateLeaveEligibility,
  formatLeaveReference,
  getHolidaySet,
  getLeavePolicy,
  getLeaveRequestSegments,
  getNextBusinessDate,
  notifyUsers,
  parseISODate,
  resolveProfileByIdentifier,
} from "@/lib/hr/leave-workflow"
import { getLeaveEntitlements, getRemainingDays } from "@/lib/hr/leave-entitlement"
import {
  buildResolvedRouteSnapshot,
  classifyRequesterKind,
  getRouteStageByOrder,
  notifyStageApprover,
  stageCodeForRole,
} from "@/lib/hr/leave-routing"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getPaginationRange, PaginationSchema } from "@/lib/pagination"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("leave-requests")
const BLACKOUT_MONTHS = new Set([12, 1])

const LeaveSegmentSchema = z.object({
  start_date: z.string().trim().min(1, "Segment start date is required"),
  end_date: z.string().trim().min(1, "Segment end date is required"),
})

const CreateLeaveRequestSchema = z
  .object({
    leave_type_id: z.string().trim().min(1, "Missing required fields"),
    segments: z.array(LeaveSegmentSchema).min(1, "At least one date range is required"),
    emergency_override: z.boolean().optional(),
    reason: z.string().trim().min(1, "Missing required fields"),
    reliever_identifier: z.string().trim().min(1, "Missing required fields"),
    handover_note: z.string().trim().optional().nullable(),
    handover_checklist_url: z.string().trim().optional().nullable(),
  })
  .refine((data) => Boolean(data.handover_checklist_url), {
    message: "Handover document is required",
    path: ["handover_checklist_url"],
  })

const UpdateLeaveRequestSchema = z.object({
  id: z.string().trim().min(1, "Leave request ID is required"),
  leave_type_id: z.string().optional(),
  segments: z.array(LeaveSegmentSchema).min(1).optional(),
  emergency_override: z.boolean().optional(),
  reason: z.string().optional(),
  reliever_identifier: z.string().optional(),
  handover_note: z.string().optional().nullable(),
  handover_checklist_url: z.string().optional().nullable(),
})

/**
 * Sorts segments, rejects inverted or overlapping ranges, trims each range down
 * to the working days it actually covers, and totals the days to deduct.
 *
 * Trimming is what stops a Mon-Sun selection from being stored as ending on a
 * Sunday: the stored range becomes Mon-Fri, so the resumption date the employee
 * is shown is the following Monday without them having to pad the selection.
 */
function resolveSegments(segments: { start_date: string; end_date: string }[], holidays: HolidaySet = NO_HOLIDAYS) {
  const sorted = [...segments].sort((a, b) => a.start_date.localeCompare(b.start_date))
  for (const segment of sorted) {
    if (segment.end_date < segment.start_date) {
      throw new Error("Each date range's end date must be on or after its start date")
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_date <= sorted[i - 1].end_date) {
      throw new Error("Date ranges cannot overlap each other")
    }
  }

  const trimmed = sorted
    .map((segment) => trimRangeToWorkingDays(segment.start_date, segment.end_date, holidays))
    .filter((segment): segment is { start_date: string; end_date: string } => segment !== null)

  if (trimmed.length === 0) {
    throw new Error(
      "Select at least one working day — weekends and public holidays are not deducted from your leave balance"
    )
  }

  const resolvedSegments = trimmed.map((segment, index) => ({
    start_date: segment.start_date,
    end_date: segment.end_date,
    days_count: countLeaveDays(segment.start_date, segment.end_date, holidays),
    segment_order: index + 1,
  }))

  const totalDays = resolvedSegments.reduce((sum, segment) => sum + segment.days_count, 0)

  return {
    segments: resolvedSegments,
    startDate: resolvedSegments[0].start_date,
    endDate: resolvedSegments[resolvedSegments.length - 1].end_date,
    totalDays,
  }
}

/**
 * Loads the holiday calendar covering the requested ranges, then resolves them.
 * The lookahead past the last date covers the resumption-date walk.
 */
async function resolveSegmentsWithHolidays(
  client: SupabaseServerClient,
  segments: { start_date: string; end_date: string }[],
  location?: string | null
) {
  const dates = segments.flatMap((segment) => [segment.start_date, segment.end_date]).filter(Boolean).sort()
  const spanStart = dates[0]
  const spanEnd = dates[dates.length - 1]
  if (!spanStart || !spanEnd) throw new Error("At least one date range is required")

  const lookaheadEnd = addIsoDays(spanEnd, 30)

  const holidays = await getHolidaySet(client, location, spanStart, lookaheadEnd)
  return { resolved: resolveSegments(segments, holidays), holidays }
}

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

    const { searchParams } = request.nextUrl
    const paginationParsed = PaginationSchema.safeParse({
      page: searchParams.get("page") || "1",
      per_page: searchParams.get("limit") || "20",
    })
    if (!paginationParsed.success) {
      return NextResponse.json({ error: "Invalid pagination params" }, { status: 400 })
    }
    const wantsPage = searchParams.has("page") || searchParams.has("limit")
    const status = searchParams.get("status")
    const userId = searchParams.get("user_id")
    const all = searchParams.get("all") === "true"
    let scopedMode: "all" | "dept" | "none" = "all"
    let scopedDepartments: string[] = []

    // Read via the service-role client. Department scoping is enforced in code below
    // (applyDataScopeV2), and the non-admin path is guarded — so this does NOT widen
    // access; it only lets every admin tier (developer/super_admin/lead), not just the
    // exact `admin` role, see leave that RLS would otherwise hide.
    let query = dataClient
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
        ),
        leave_request_segments (
          start_date, end_date, days_count, segment_order
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
      const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.leave")
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
      // Non-admin path: a caller may only read their OWN requests unless admin-like.
      // (We now read with the service-role client, so RLS no longer guards this.)
      if (userId && userId !== user.id) {
        const requesterScope = await getRequestScope()
        if (!requesterScope?.isAdminLike) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
      }
      query = query.eq("user_id", targetUserId)
    }

    const { from, to } = getPaginationRange(paginationParsed.data)
    const { data: requests, error, count } = wantsPage ? await query.range(from, to) : await query
    if (error) {
      return NextResponse.json({ error: `Failed to fetch leave requests: ${error.message}` }, { status: 500 })
    }

    const requestRows = ((requests || []) as LeaveRequestRow[]).filter((row) =>
      all ? true : row.user_id === targetUserId
    )
    const requestIds = requestRows.map((row) => row.id).filter(Boolean)

    // Derived from the leave type allowance minus this user's requests — see
    // lib/hr/leave-entitlement.ts. Shaped like the stored rows this used to read so the
    // response contract is unchanged.
    const balanceRows = (await getLeaveEntitlements(dataClient, targetUserId)).map((e) => ({
      user_id: targetUserId,
      leave_type_id: e.leaveTypeId,
      allocated_days: e.entitlementDays,
      used_days: e.usedDays,
      pending_days: e.pendingDays,
      carry_forward_days: 0,
      balance_days: e.remainingDays,
    }))

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
    for (const balance of balanceRows) {
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

    const balances = balanceRows.map((row) => ({
      ...row,
      leave_type: row.leave_type_id ? leaveTypeMap.get(row.leave_type_id) || null : null,
    }))

    let relieverCommitments: LeaveRequestRow[] = []
    if (!all) {
      const todayIsoDate = toLocalISODate()
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
        limit: wantsPage ? paginationParsed.data.per_page : count || enriched.length || paginationParsed.data.per_page,
        total: count || 0,
        total_pages: wantsPage && count ? Math.ceil(count / paginationParsed.data.per_page) : count ? 1 : 0,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-leave-requests:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
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
      segments: rawSegments,
      emergency_override,
      reason,
      reliever_identifier,
      handover_note,
      handover_checklist_url,
    } = parsed.data

    let resolved: ReturnType<typeof resolveSegments>
    try {
      // Company-wide holidays apply to every requester; site-specific holidays
      // would need the profile, which is loaded below.
      resolved = (await resolveSegmentsWithHolidays(validationClient, rawSegments)).resolved
    } catch (segmentError) {
      return NextResponse.json(
        { error: segmentError instanceof Error ? segmentError.message : "Invalid date ranges" },
        { status: 400 }
      )
    }
    const { segments, startDate: start_date, endDate: aggregateEndDate, totalDays: effectiveDays } = resolved

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

    const endDate = aggregateEndDate
    const resumeDate = await getNextBusinessDate(supabase, endDate, requester.work_location || "global")
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

    // Remaining days are derived from the leave type's allowance minus this user's own
    // requests for the year, so there is no stored balance to reserve against and nothing to
    // put back if the request is later cancelled — the sum simply changes.
    const remainingDays = await getRemainingDays(supabase, user.id, leave_type_id, {
      year: parseISODate(start_date).getUTCFullYear(),
    })

    if (effectiveDays > remainingDays) {
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

    const effectiveHandoverNote =
      handover_note?.trim() || (handover_checklist_url ? "Handover document attached" : null)

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
        handover_note: effectiveHandoverNote,
        handover_checklist_url: handover_checklist_url || null,
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

    const { error: segmentsError } = await validationClient.from("leave_request_segments").insert(
      segments.map((segment) => ({
        leave_request_id: newRequest.id,
        start_date: segment.start_date,
        end_date: segment.end_date,
        days_count: segment.days_count,
        segment_order: segment.segment_order,
      }))
    )
    if (segmentsError) {
      log.error({ err: segmentsError, leaveRequestId: newRequest.id }, "Failed to write leave request segments")
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

    const requesterName =
      requester.full_name || `${requester.first_name || ""} ${requester.last_name || ""}`.trim() || "Employee"
    const ref = formatLeaveReference(newRequest.id)
    const refSuffix = ref ? ` — ${ref}` : ""
    const relieverName = reliever.full_name || reliever.company_email || "Assigned Reliever"

    if (initialStatus === "pending") {
      const isRelieverStage = firstStage.approver_role_code === "reliever"

      // 1. Notify first stage approver (Reliever or Department Lead) with rich details
      await notifyStageApprover({
        supabase,
        approverUserId: firstStage.approver_user_id,
        title: isRelieverStage ? "Leave relief confirmation required" : "Leave request awaiting your approval",
        message: isRelieverStage
          ? `${requesterName} selected you as reliever for ${leaveType.name} (${effectiveDays} day(s), ${start_date} to ${endDate}). Review the handover note and confirm coverage so the request can proceed.`
          : `${requesterName} submitted a leave request for ${leaveType.name} (${effectiveDays} day(s), ${start_date} to ${endDate}) awaiting your endorsement.`,
        actorId: user.id,
        entityId: newRequest.id,
        linkUrl: "/leave",
        emailSubject: isRelieverStage
          ? `Action Required: Leave Relief Confirmation for ${requesterName}${refSuffix}`
          : `Action Required: Leave Request Awaiting Your Approval — ${requesterName}${refSuffix}`,
        emailTitle: isRelieverStage ? "Leave Relief Confirmation Required" : "Leave Request Awaiting Your Approval",
        badgeText: isRelieverStage ? "Relief Confirmation Required" : "Action Required",
        detailsTitle: "Leave Request Details",
        details: [
          { label: "Employee", value: requesterName },
          { label: "Department", value: requester.department || "-" },
          { label: "Leave Type", value: leaveType.name || "-" },
          { label: "Duration", value: `${effectiveDays} day(s)` },
          { label: "Period", value: `${start_date} to ${endDate}` },
          { label: "Resumption Date", value: resumeDate || "-" },
          ...(handover_checklist_url ? [{ label: "Handover Document", value: "Attached (View in Leave Portal)" }] : []),
          ...(handover_note && (!handover_checklist_url || !handover_note.startsWith("Attached:"))
            ? [{ label: "Handover Note", value: handover_note }]
            : []),
          ...(reason ? [{ label: "Reason", value: reason }] : []),
        ],
        ctaLabel: isRelieverStage ? "Review & Confirm Relief" : "Review & Endorse",
      })

      // 2. Send submission acknowledgement email to the requester
      await notifyUsers(supabase, {
        userIds: [user.id],
        title: "Leave request submitted",
        message: `Your leave request for ${leaveType.name} (${start_date} to ${endDate}) was submitted and is pending ${
          isRelieverStage
            ? `relief confirmation by ${relieverName}`
            : `approval at ${firstStage.stage_code.replaceAll("_", " ")}`
        }.`,
        actorId: user.id,
        entityId: newRequest.id,
        linkUrl: "/leave",
        emailSubject: `Leave Request Submitted Successfully${refSuffix}`,
        emailTitle: "Leave Request Submitted",
        badgeText: "Submitted — Pending Review",
        badgeVariant: "info",
        detailsTitle: "Request Summary",
        details: [
          { label: "Leave Type", value: leaveType.name || "-" },
          { label: "Duration", value: `${effectiveDays} day(s)` },
          { label: "Period", value: `${start_date} to ${endDate}` },
          { label: "Resumption Date", value: resumeDate || "-" },
          { label: "Assigned Reliever", value: relieverName },
          {
            label: "Current Stage",
            value: isRelieverStage
              ? `Relief Confirmation (${relieverName})`
              : firstStage.stage_code.replaceAll("_", " "),
          },
        ],
        ctaLabel: "View Leave Status",
      })
    } else if (initialStatus === "pending_evidence") {
      // Notify requester that evidence upload is required
      await notifyUsers(supabase, {
        userIds: [user.id],
        title: "Supporting evidence required for leave request",
        message: `Your leave request for ${leaveType.name} (${start_date} to ${endDate}) requires supporting documentation before it can proceed to approvals.`,
        actorId: user.id,
        entityId: newRequest.id,
        linkUrl: "/leave",
        emailSubject: `Action Required: Supporting Evidence Needed for Leave Request${refSuffix}`,
        emailTitle: "Supporting Evidence Required",
        badgeText: "Evidence Required",
        badgeVariant: "warning",
        detailsTitle: "Leave Request Details",
        details: [
          { label: "Leave Type", value: leaveType.name || "-" },
          { label: "Duration", value: `${effectiveDays} day(s)` },
          { label: "Period", value: `${start_date} to ${endDate}` },
          ...(eligibility.missingDocuments?.length
            ? [{ label: "Required Documents", value: eligibility.missingDocuments.join(", ") }]
            : []),
        ],
        ctaLabel: "Upload Required Evidence",
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
  const rl = await rateLimit(`hr-leave-requests:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
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
      segments: rawSegments,
      emergency_override,
      reason,
      reliever_identifier,
      handover_note,
      handover_checklist_url,
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

      const { data: reqProfile } = await supabase
        .from("profiles")
        .select("id, full_name, first_name, last_name, company_email, department")
        .eq("id", existingRequest.user_id)
        .maybeSingle()
      const reqName =
        reqProfile?.full_name ||
        `${reqProfile?.first_name || ""} ${reqProfile?.last_name || ""}`.trim() ||
        reqProfile?.company_email ||
        "Employee"
      const { data: ltRow } = await supabase
        .from("leave_types")
        .select("id, name")
        .eq("id", existingRequest.leave_type_id)
        .maybeSingle()
      const ltName = ltRow?.name || "Leave"
      const ref = formatLeaveReference(existingRequest.id)
      const refSuffix = ref ? ` — ${ref}` : ""

      await notifyStageApprover({
        supabase,
        approverUserId: newReliever.id,
        title: "Leave relief confirmation required",
        message: `${reqName} has designated you as reliever for ${ltName} (${existingRequest.days_count} day(s), ${existingRequest.start_date} to ${existingRequest.end_date}). Review the handover note and confirm coverage so the workflow can proceed.`,
        actorId: user.id,
        entityId: existingRequest.id,
        linkUrl: "/leave",
        emailSubject: `Action Required: Leave Relief Reassigned to You — ${reqName}${refSuffix}`,
        emailTitle: "Leave Relief Confirmation Required",
        badgeText: "Relief Required",
        detailsTitle: "Leave Request Details",
        details: [
          { label: "Employee", value: reqName },
          { label: "Department", value: reqProfile?.department || "-" },
          { label: "Leave Type", value: ltName },
          { label: "Duration", value: `${existingRequest.days_count} day(s)` },
          { label: "Period", value: `${existingRequest.start_date} to ${existingRequest.end_date}` },
          { label: "Resumption Date", value: existingRequest.resume_date || "-" },
          ...(existingRequest.handover_note ? [{ label: "Handover Note", value: existingRequest.handover_note }] : []),
        ],
        ctaLabel: "Review & Confirm Relief",
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

    let targetSegments: ReturnType<typeof resolveSegments>
    try {
      const segmentsToResolve =
        rawSegments ||
        (await getLeaveRequestSegments(validationClient, id, existingRequest.start_date, existingRequest.end_date))
      targetSegments = (await resolveSegmentsWithHolidays(validationClient, segmentsToResolve)).resolved
    } catch (segmentError) {
      return NextResponse.json(
        { error: segmentError instanceof Error ? segmentError.message : "Invalid date ranges" },
        { status: 400 }
      )
    }
    const targetStartDate = targetSegments.startDate
    const targetDays = targetSegments.totalDays

    const { data: requester } = await supabase
      .from("profiles")
      .select(
        "id, full_name, first_name, last_name, company_email, department, department_id, is_department_lead, lead_departments, gender, employment_date, work_location, employment_type, marital_status, has_children, pregnancy_status"
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

    const endDate = targetSegments.endDate
    const resumeDate = await getNextBusinessDate(supabase, endDate, requester.work_location || "global")
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

    // The request being edited is excluded from the sum, so its own days are not counted
    // against the employee twice.
    const remainingDays = await getRemainingDays(supabase, user.id, targetLeaveTypeId, {
      year: parseISODate(targetStartDate).getUTCFullYear(),
      excludeRequestId: id,
    })

    if (targetDays > remainingDays) {
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
        handover_checklist_url:
          typeof handover_checklist_url !== "undefined"
            ? handover_checklist_url
            : existingRequest.handover_checklist_url,
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

    if (rawSegments) {
      await validationClient.from("leave_request_segments").delete().eq("leave_request_id", id)
      const { error: segmentsError } = await validationClient.from("leave_request_segments").insert(
        targetSegments.segments.map((segment) => ({
          leave_request_id: id,
          start_date: segment.start_date,
          end_date: segment.end_date,
          days_count: segment.days_count,
          segment_order: segment.segment_order,
        }))
      )
      if (segmentsError) {
        log.error({ err: segmentsError, leaveRequestId: id }, "Failed to update leave request segments")
      }
    }

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

    if (updatedRequest && updatedRequest.status === "pending") {
      const isRelieverStage = firstStage.approver_role_code === "reliever"
      const reqName =
        requester.full_name || `${requester.first_name || ""} ${requester.last_name || ""}`.trim() || "Employee"
      const ref = formatLeaveReference(updatedRequest.id)
      const refSuffix = ref ? ` — ${ref}` : ""

      await notifyStageApprover({
        supabase,
        approverUserId: firstStage.approver_user_id,
        title: isRelieverStage ? "Updated leave relief request" : "Updated leave request awaiting your approval",
        message: `${reqName} updated their leave request for ${leaveType.name} (${targetDays} day(s), ${targetStartDate} to ${endDate}). Review the updated details and confirm.`,
        actorId: user.id,
        entityId: updatedRequest.id,
        linkUrl: "/leave",
        emailSubject: isRelieverStage
          ? `Action Required: Updated Leave Relief for ${reqName}${refSuffix}`
          : `Action Required: Updated Leave Request — ${reqName}${refSuffix}`,
        emailTitle: isRelieverStage ? "Updated Leave Relief Request" : "Updated Leave Request",
        badgeText: isRelieverStage ? "Relief Required" : "Action Required",
        detailsTitle: "Updated Request Details",
        details: [
          { label: "Employee", value: reqName },
          { label: "Department", value: requester.department || "-" },
          { label: "Leave Type", value: leaveType.name || "-" },
          { label: "Duration", value: `${targetDays} day(s)` },
          { label: "Period", value: `${targetStartDate} to ${endDate}` },
          { label: "Resumption Date", value: resumeDate || "-" },
          ...(updatedRequest.handover_note ? [{ label: "Handover Note", value: updatedRequest.handover_note }] : []),
          ...(updatedRequest.reason ? [{ label: "Reason", value: updatedRequest.reason }] : []),
        ],
        ctaLabel: isRelieverStage ? "Review & Confirm Relief" : "Review & Endorse",
      })
    }

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
  const rl = await rateLimit(`hr-leave-requests:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = request.nextUrl
    const id = searchParams.get("id")

    if (!id) return NextResponse.json({ error: "Leave request ID is required" }, { status: 400 })

    const { data: existingRequest, error: fetchError } = await supabase
      .from("leave_requests")
      .select(
        "id, user_id, reliever_id, start_date, end_date, leave_type_id, status, approval_stage, current_stage_code"
      )
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

    if (existingRequest.reliever_id && existingRequest.reliever_id !== user.id) {
      const ref = formatLeaveReference(id)
      const refSuffix = ref ? ` — ${ref}` : ""
      const { data: callerProfile } = await supabase
        .from("profiles")
        .select("full_name, first_name, last_name, company_email")
        .eq("id", user.id)
        .maybeSingle()
      const callerName =
        callerProfile?.full_name ||
        `${callerProfile?.first_name || ""} ${callerProfile?.last_name || ""}`.trim() ||
        callerProfile?.company_email ||
        "Employee"

      await notifyUsers(dataClient, {
        userIds: [existingRequest.reliever_id],
        title: "Leave request cancelled",
        message: `${callerName} cancelled their pending leave request (${existingRequest.start_date} to ${existingRequest.end_date}). Your reliever commitment has been released.`,
        actorId: user.id,
        linkUrl: "/leave",
        entityId: id,
        emailEvent: "approval_required",
        emailSubject: `Reliever Duty Released — ${callerName}${refSuffix}`,
        emailTitle: "Reliever Duty Released",
        badgeText: "Request Cancelled",
        badgeVariant: "info",
        detailsTitle: "Cancelled Request Details",
        details: [
          { label: "Employee", value: callerName },
          { label: "Period", value: `${existingRequest.start_date} to ${existingRequest.end_date}` },
          { label: "Status", value: "Cancelled by Requester (Relief Released)" },
        ],
        ctaLabel: "Open Leave Portal",
      })
    }

    return NextResponse.json({ message: "Leave request deleted successfully" })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in DELETE")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export { PATCH as PUT }
