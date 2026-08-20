import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { monthBounds, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"

const log = logger("admin-hr-leave-calendar")
export const dynamic = "force-dynamic"

type ProfileReferenceRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  company_email?: string | null
  department?: string | null
  employment_status?: string | null
}

type LeaveTypeRow = {
  id: string
  name: string
  code?: string | null
  max_days?: number | null
  requires_approval?: boolean | null
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
}

type LeaveRequestRow = {
  id: string
  user_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  resume_date: string
  days_count: number
  reason: string
  status: string
  approval_stage: string
  current_stage_code?: string | null
  current_stage_order?: number | null
  current_approver_user_id?: string | null
  reliever_id?: string | null
  supervisor_id?: string | null
  created_at: string
  admin_manual?: boolean | null
  approved_at?: string | null
  approved_by?: string | null
  user?: ProfileReferenceRow | null
  leave_type?: LeaveTypeRow | null
  approvals?: LeaveApprovalRow[] | null
}

type LeaveEvidenceRow = {
  id: string
  leave_request_id: string
  document_type: string
  file_url: string
  status: "pending" | "verified" | "rejected"
  notes?: string | null
}

type HolidayRow = {
  id: string
  holiday_date: string
  name: string
  location?: string | null
}

function resolveName(p?: ProfileReferenceRow | null): string {
  if (!p) return ""
  const full = String(p.full_name || "").trim()
  if (full) return full
  const composed = `${p.first_name || ""} ${p.last_name || ""}`.trim()
  if (composed) return composed
  const email = String(p.company_email || "").trim()
  if (email) return email.split("@")[0] || email
  return ""
}

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-leave-calendar:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const depts = getScopedDepartments(scope)

    if (depts !== null && depts.length === 0) {
      return NextResponse.json({
        data: {
          leaves: [],
          holidays: [],
          departments: [],
          employees: [],
          leave_types: [],
          stats: { total_days: 0, active_leaves: 0, approved_count: 0, pending_count: 0 },
        },
      })
    }

    const { searchParams } = request.nextUrl
    const yearMonth = searchParams.get("year_month") || toLocalYearMonth()
    const filterDept = searchParams.get("department") || null
    const filterUserId = searchParams.get("user_id") || null
    const filterLeaveTypeId = searchParams.get("leave_type_id") || null
    const filterStatus = searchParams.get("status") || null

    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: "Invalid year_month format (expected YYYY-MM)" }, { status: 400 })
    }

    const { start: monthStart, end: monthEnd } = monthBounds(yearMonth)

    // Load available departments for filter
    let deptQuery = dataClient.from("departments").select("id, name").order("name", { ascending: true })
    if (depts !== null) deptQuery = deptQuery.in("name", depts)
    const { data: deptRows } = await deptQuery
    const availableDepartments = ((deptRows || []) as Array<{ id: string; name: string }>).map((d) => d.name)

    // Load available active employees for filter (scoped)
    let profileQuery = dataClient
      .from("profiles")
      .select("id, full_name, first_name, last_name, company_email, department, employment_status")
      .order("first_name", { ascending: true })
    if (depts !== null) profileQuery = profileQuery.in("department", depts)
    const { data: allProfilesData } = await profileQuery
    const availableEmployees = ((allProfilesData || []) as ProfileReferenceRow[])
      .filter((p) => isAssignableEmploymentStatus(p.employment_status, { allowLegacyNullStatus: false }))
      .map((p) => ({
        id: p.id,
        name: resolveName(p) || "Unnamed",
        department: p.department || null,
      }))

    // Load all leave types (only verified columns)
    const { data: leaveTypesData } = await dataClient
      .from("leave_types")
      .select("id, name, code, max_days, requires_approval")
      .order("name", { ascending: true })
    const leaveTypes = (leaveTypesData || []) as LeaveTypeRow[]
    const leaveTypesMap = new Map<string, LeaveTypeRow>()
    for (const lt of leaveTypes) {
      leaveTypesMap.set(lt.id, lt)
    }

    // Load public holidays in this month (only verified columns)
    const { data: holidayData } = await dataClient
      .from("holiday_calendar")
      .select("id, holiday_date, name, location")
      .gte("holiday_date", monthStart)
      .lte("holiday_date", monthEnd)
      .order("holiday_date", { ascending: true })
    const holidays = (holidayData || []) as HolidayRow[]

    // Query leave requests overlapping this month with verified relations
    let leaveQuery = dataClient
      .from("leave_requests")
      .select(
        `
        *,
        user:profiles!leave_requests_user_id_profiles_fkey (
          id, full_name, first_name, last_name, company_email, department
        ),
        leave_type:leave_types!leave_requests_leave_type_id_fkey (
          id, name, code
        ),
        approvals:leave_approvals (
          id, approver_id, status, stage_code, approved_at, comments, stage_order
        )
      `
      )
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart)
      .order("start_date", { ascending: true })

    if (filterUserId) {
      leaveQuery = leaveQuery.eq("user_id", filterUserId)
    }
    if (filterLeaveTypeId) {
      leaveQuery = leaveQuery.eq("leave_type_id", filterLeaveTypeId)
    }
    if (filterStatus && filterStatus !== "all") {
      if (filterStatus === "approved") {
        leaveQuery = leaveQuery.in("status", ["approved", "completed"])
      } else if (filterStatus === "pending") {
        leaveQuery = leaveQuery.in("status", ["pending", "pending_evidence"])
      } else {
        leaveQuery = leaveQuery.eq("status", filterStatus)
      }
    } else {
      // Exclude cancelled and rejected from default calendar view unless requested
      leaveQuery = leaveQuery.not("status", "in", '("rejected","cancelled")')
    }

    const { data: rawLeaves, error: leavesError } = await leaveQuery
    if (leavesError) {
      log.error({ err: leavesError.message || String(leavesError) }, "Failed to fetch leave requests for calendar")
      return NextResponse.json({ error: `Failed to fetch leave calendar: ${leavesError.message}` }, { status: 500 })
    }

    const leaveRows = (rawLeaves || []) as LeaveRequestRow[]
    const requestIds = leaveRows.map((r) => r.id).filter(Boolean)

    // Load evidence for these requests
    let evidenceData: LeaveEvidenceRow[] = []
    if (requestIds.length > 0) {
      const { data: evData } = await dataClient
        .from("leave_evidence")
        .select("id, leave_request_id, document_type, file_url, status, notes")
        .in("leave_request_id", requestIds)
      evidenceData = (evData || []) as LeaveEvidenceRow[]
    }

    // Collect all profile IDs needing fallback resolution (reliever, supervisor, approved_by, approvers)
    const profileIds = new Set<string>()
    for (const r of leaveRows) {
      if (r.user_id) profileIds.add(r.user_id)
      if (r.reliever_id) profileIds.add(r.reliever_id)
      if (r.supervisor_id) profileIds.add(r.supervisor_id)
      if (r.approved_by) profileIds.add(r.approved_by)
      for (const a of r.approvals || []) {
        if (a.approver_id) profileIds.add(a.approver_id)
      }
    }

    const profilesMap = new Map<string, ProfileReferenceRow>()
    if (profileIds.size > 0) {
      const { data: profilesList } = await dataClient
        .from("profiles")
        .select("id, first_name, last_name, full_name, company_email, department")
        .in("id", Array.from(profileIds))
      for (const p of (profilesList || []) as ProfileReferenceRow[]) {
        profilesMap.set(p.id, p)
      }
    }

    const evidenceByRequestId = new Map<string, LeaveEvidenceRow[]>()
    for (const e of evidenceData) {
      const list = evidenceByRequestId.get(e.leave_request_id) || []
      list.push(e)
      evidenceByRequestId.set(e.leave_request_id, list)
    }

    // Filter by scoped departments and requested department
    const formattedLeaves = leaveRows
      .map((r) => {
        const userProfile = r.user || profilesMap.get(r.user_id) || null
        const userDept = userProfile?.department || null

        // Check if user matches scoped departments
        if (depts !== null && (!userDept || !depts.includes(userDept))) {
          return null
        }
        // Check filterDept
        if (filterDept && filterDept !== "all" && userDept !== filterDept) {
          return null
        }

        const relieverProfile = r.reliever_id ? profilesMap.get(r.reliever_id) || null : null
        const supervisorProfile = r.supervisor_id ? profilesMap.get(r.supervisor_id) || null : null
        const approvedByProfile = r.approved_by ? profilesMap.get(r.approved_by) || null : null
        const leaveType = r.leave_type || leaveTypesMap.get(r.leave_type_id) || null

        const empFullName = resolveName(userProfile) || "Employee"

        const resolvedApprovals = (r.approvals || []).map((a) => ({
          ...a,
          approver: a.approver_id ? profilesMap.get(a.approver_id) || null : null,
        }))

        return {
          id: r.id,
          user_id: r.user_id,
          start_date: r.start_date,
          end_date: r.end_date,
          resume_date: r.resume_date,
          days_count: r.days_count,
          reason: r.reason,
          status: r.status,
          approval_stage: r.approval_stage,
          current_stage_code: r.current_stage_code,
          current_stage_order: r.current_stage_order,
          current_approver_user_id: r.current_approver_user_id,
          reliever_id: r.reliever_id,
          supervisor_id: r.supervisor_id,
          created_at: r.created_at,
          admin_manual: r.admin_manual,
          approved_at: r.approved_at,
          user: {
            id: userProfile?.id || r.user_id,
            first_name: userProfile?.first_name || null,
            last_name: userProfile?.last_name || null,
            full_name: empFullName,
            company_email: userProfile?.company_email || "",
            department: userProfile?.department || undefined,
          },
          reliever: relieverProfile
            ? {
                id: relieverProfile.id,
                first_name: relieverProfile.first_name || null,
                last_name: relieverProfile.last_name || null,
                full_name: resolveName(relieverProfile) || null,
                company_email: relieverProfile.company_email || null,
              }
            : null,
          supervisor: supervisorProfile
            ? {
                id: supervisorProfile.id,
                first_name: supervisorProfile.first_name || null,
                last_name: supervisorProfile.last_name || null,
                full_name: resolveName(supervisorProfile) || null,
                company_email: supervisorProfile.company_email || null,
              }
            : null,
          approved_by_profile: approvedByProfile
            ? {
                id: approvedByProfile.id,
                first_name: approvedByProfile.first_name || null,
                last_name: approvedByProfile.last_name || null,
                full_name: resolveName(approvedByProfile) || null,
                company_email: approvedByProfile.company_email || null,
              }
            : null,
          leave_type: leaveType
            ? { id: leaveType.id, name: leaveType.name, code: leaveType.code || undefined }
            : { name: "Leave" },
          approvals: resolvedApprovals,
          evidence: evidenceByRequestId.get(r.id) || [],
          evidence_complete: (evidenceByRequestId.get(r.id) || []).length > 0,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

    // Calculate month stats
    let totalDaysSum = 0
    let approvedCount = 0
    let pendingCount = 0
    const uniqueEmployees = new Set<string>()

    for (const l of formattedLeaves) {
      totalDaysSum += l.days_count || 0
      uniqueEmployees.add(l.user_id)
      const st = String(l.status || "").toLowerCase()
      if (st === "approved" || st === "completed") {
        approvedCount++
      } else if (st === "pending" || st === "pending_evidence") {
        pendingCount++
      }
    }

    return NextResponse.json({
      data: {
        leaves: formattedLeaves,
        holidays,
        departments: availableDepartments,
        employees: availableEmployees,
        leave_types: leaveTypes,
        stats: {
          total_days: totalDaysSum,
          active_leaves: uniqueEmployees.size,
          approved_count: approvedCount,
          pending_count: pendingCount,
        },
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET /api/admin/hr/leave/calendar")
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 })
  }
}
