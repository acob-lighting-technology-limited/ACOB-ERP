import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { areRequiredDocumentsVerified, getLeavePolicy } from "@/lib/hr/leave-workflow"
import { logger } from "@/lib/logger"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { applyDataScopeV2 } from "@/lib/admin/policy-v2"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

const log = logger("hr-leave-queue")
export const dynamic = "force-dynamic"

const LEGACY_SLA_STAGE_MAP: Record<string, string> = {
  pending_reliever: "reliever_pending",
  pending_department_lead: "supervisor_pending",
  pending_admin_hr_lead: "hr_pending",
  pending_md: "hr_pending",
  pending_hcs: "hr_pending",
}

type ProfileSummary = {
  id: string
  full_name?: string | null
  company_email?: string | null
  role?: string | null
  department?: string | null
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
  reliever_revision?: number | null
  superseded?: boolean | null
}

type LeaveQueueRequestRow = {
  id: string
  created_at: string
  status?: string | null
  leave_type_id: string
  reliever_id?: string | null
  approval_stage?: string | null
  current_stage_code?: string | null
  current_approver_user_id?: string | null
  user?: ProfileSummary | null
  reliever?: ProfileSummary | null
  supervisor?: ProfileSummary | null
  leave_type?: {
    id: string
    name?: string | null
  } | null
}

type SlaPolicyRow = {
  stage: string
  due_hours: number
  reminder_hours_before: number
}

type ProfileLookupRow = {
  id: string
  company_email?: string | null
  additional_email?: string | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let actorProfileId = user.id
    const { data: actorById } = await dataClient
      .from("profiles")
      .select("id, company_email, additional_email")
      .eq("id", user.id)
      .maybeSingle<ProfileLookupRow>()

    if (actorById?.id) {
      actorProfileId = actorById.id
    } else if (user.email) {
      const { data: actorByCompanyEmail } = await dataClient
        .from("profiles")
        .select("id, company_email, additional_email")
        .eq("company_email", user.email)
        .maybeSingle<ProfileLookupRow>()

      if (actorByCompanyEmail?.id) {
        actorProfileId = actorByCompanyEmail.id
      } else {
        const { data: actorByAdditionalEmail } = await dataClient
          .from("profiles")
          .select("id, company_email, additional_email")
          .eq("additional_email", user.email)
          .maybeSingle<ProfileLookupRow>()
        if (actorByAdditionalEmail?.id) {
          actorProfileId = actorByAdditionalEmail.id
        }
      }
    }

    const { searchParams } = new URL(request.url)
    const all = searchParams.get("all") === "true"
    const scope = await getRequestScope()
    let scopedDepts = scope ? getScopedDepartments(scope) : null
    let scopedMode: "all" | "dept" | "none" = "all"

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
        scopedMode = "none"
      } else if (routeAccess.dataScope === "all") {
        scopedMode = "all"
      } else {
        scopedMode = "dept"
        scopedDepts = routeAccess.dataScope
      }
    }

    const query = dataClient
      .from("leave_requests")
      .select(
        `
        *,
        user:profiles!leave_requests_user_id_profiles_fkey(id, full_name, company_email, department),
        reliever:profiles!leave_requests_reliever_id_fkey(id, full_name, company_email),
        supervisor:profiles!leave_requests_supervisor_id_fkey(id, full_name, company_email),
        leave_type:leave_types!leave_requests_leave_type_id_fkey(id, name)
      `
      )
      .in("status", ["pending", "pending_evidence"])
      .order("created_at", { ascending: true })

    const { data: requests, error } = await query

    if (error) {
      return NextResponse.json({ error: `Failed to fetch approval queue: ${error.message}` }, { status: 500 })
    }

    // Apply department scope filter for leads viewing the global queue
    const fetchedRequests = (requests || []) as LeaveQueueRequestRow[]
    let typedRequests = fetchedRequests

    if (!all) {
      typedRequests = typedRequests.filter((row) => {
        const stage = String(row.current_stage_code || row.approval_stage || "").toLowerCase()
        const isRelieverStage = stage === "pending_reliever" || stage === "reliever_pending"
        const matchedByApprover = row.current_approver_user_id === actorProfileId
        const matchedByReliever = row.reliever_id === actorProfileId && isRelieverStage
        const matched = matchedByApprover || matchedByReliever
        return matched
      })
    }
    if (all && scopedMode === "none") {
      typedRequests = []
    } else if (all && scopedMode === "dept" && scopedDepts) {
      typedRequests = applyDataScopeV2(typedRequests, scopedDepts, (row) => row.user?.department || null)
    }

    const requestIds = Array.from(new Set(typedRequests.map((row) => row.id).filter(Boolean)))
    const approverIds = Array.from(
      new Set(typedRequests.map((row) => row.current_approver_user_id).filter(Boolean))
    ) as string[]

    const approverMap = new Map<string, ProfileSummary>()
    if (approverIds.length > 0) {
      const { data: approverRows } = await supabase
        .from("profiles")
        .select("id, full_name, company_email, role")
        .in("id", approverIds)
      for (const approver of approverRows || []) {
        approverMap.set(approver.id, approver)
      }
    }

    const approvalsByRequest = new Map<string, Array<LeaveApprovalRow & { approver: ProfileSummary | null }>>()
    if (requestIds.length > 0) {
      const { data: approvalRows, error: approvalError } = await supabase
        .from("leave_approvals")
        .select(
          "id, leave_request_id, approver_id, approval_level, status, comments, approved_at, stage_code, stage_order, reliever_revision, superseded"
        )
        .in("leave_request_id", requestIds)
        .order("approved_at", { ascending: false })

      if (approvalError) {
        return NextResponse.json(
          { error: `Failed to fetch approval history: ${approvalError.message}` },
          { status: 500 }
        )
      }

      const approvalApproverIds = Array.from(
        new Set(((approvalRows || []) as LeaveApprovalRow[]).map((row) => row.approver_id).filter(Boolean))
      )
      const approvalApproverMap = new Map<string, ProfileSummary>()
      if (approvalApproverIds.length > 0) {
        const { data: approvalApproverRows } = await supabase
          .from("profiles")
          .select("id, full_name, company_email")
          .in("id", approvalApproverIds)
        for (const row of approvalApproverRows || []) {
          approvalApproverMap.set(row.id, row)
        }
      }

      for (const approval of (approvalRows || []) as LeaveApprovalRow[]) {
        const rows = approvalsByRequest.get(approval.leave_request_id) || []
        rows.push({
          ...approval,
          approver: approval.approver_id ? approvalApproverMap.get(approval.approver_id) || null : null,
        })
        approvalsByRequest.set(approval.leave_request_id, rows)
      }
    }

    const { data: slaRows } = await supabase
      .from("approval_sla_policies")
      .select("stage, due_hours, reminder_hours_before")
      .eq("is_active", true)

    const slaMap = new Map(((slaRows || []) as SlaPolicyRow[]).map((row) => [row.stage, row] as const))

    const now = Date.now()
    const enriched = await Promise.all(
      typedRequests.map(async (item) => {
        try {
          const stageCode = item.current_stage_code || item.approval_stage || ""
          const slaStage = LEGACY_SLA_STAGE_MAP[stageCode] || "reliever_pending"

          const policy = slaMap.get(slaStage) || { due_hours: 24, reminder_hours_before: 4 }
          const createdAt = new Date(item.created_at).getTime()
          const dueAt = createdAt + policy.due_hours * 60 * 60 * 1000
          const remainingMs = dueAt - now
          const dueStatus =
            remainingMs <= 0
              ? "overdue"
              : remainingMs <= policy.reminder_hours_before * 60 * 60 * 1000
                ? "due_soon"
                : "on_track"

          const leavePolicy = await getLeavePolicy(supabase, item.leave_type_id)
          const requiredDocs = leavePolicy.required_documents || []
          const evidenceStatus = await areRequiredDocumentsVerified(supabase, item.id, requiredDocs)

          return {
            ...item,
            approvals: approvalsByRequest.get(item.id) || [],
            current_approver: item.current_approver_user_id
              ? approverMap.get(item.current_approver_user_id) || null
              : null,
            required_documents: requiredDocs,
            evidence_complete: evidenceStatus.complete,
            missing_documents: evidenceStatus.missing,
            sla: {
              due_at: new Date(dueAt).toISOString(),
              due_status: dueStatus,
              hours_remaining: Math.floor(remainingMs / (1000 * 60 * 60)),
            },
          }
        } catch (itemError: unknown) {
          return {
            ...item,
            approvals: approvalsByRequest.get(item.id) || [],
            current_approver: item.current_approver_user_id
              ? approverMap.get(item.current_approver_user_id) || null
              : null,
            required_documents: [],
            evidence_complete: true,
            missing_documents: [],
            sla: null,
            queue_enrichment_error: itemError instanceof Error ? itemError.message : "Queue enrichment failed",
          }
        }
      })
    )

    const { data: historyApprovals, error: historyError } = await supabase
      .from("leave_approvals")
      .select(
        "id, leave_request_id, approver_id, approval_level, status, comments, approved_at, stage_code, stage_order, reliever_revision, superseded"
      )
      .eq("approver_id", actorProfileId)
      .order("approved_at", { ascending: false })
      .limit(20)

    if (historyError) {
      return NextResponse.json(
        { error: `Failed to fetch your approval activity: ${historyError.message}` },
        { status: 500 }
      )
    }

    const historyRequestIds = Array.from(
      new Set(((historyApprovals || []) as LeaveApprovalRow[]).map((row) => row.leave_request_id).filter(Boolean))
    )
    const historyRequestMap = new Map<
      string,
      LeaveQueueRequestRow & { approvals: Array<LeaveApprovalRow & { approver: ProfileSummary | null }> }
    >()
    const historyApprovalsByRequest = new Map<string, Array<LeaveApprovalRow & { approver: ProfileSummary | null }>>()
    if (historyRequestIds.length > 0) {
      const { data: historyRequests } = await supabase
        .from("leave_requests")
        .select(
          `
          *,
          user:profiles!leave_requests_user_id_profiles_fkey(id, full_name, company_email),
          reliever:profiles!leave_requests_reliever_id_fkey(id, full_name, company_email),
          supervisor:profiles!leave_requests_supervisor_id_fkey(id, full_name, company_email),
          leave_type:leave_types!leave_requests_leave_type_id_fkey(id, name)
        `
        )
        .in("id", historyRequestIds)

      const { data: historyRequestApprovals } = await supabase
        .from("leave_approvals")
        .select(
          "id, leave_request_id, approver_id, approval_level, status, comments, approved_at, stage_code, stage_order, reliever_revision, superseded"
        )
        .in("leave_request_id", historyRequestIds)
        .order("approved_at", { ascending: false })

      const historyApproverIds = Array.from(
        new Set(((historyRequestApprovals || []) as LeaveApprovalRow[]).map((row) => row.approver_id).filter(Boolean))
      )
      const historyApproverMap = new Map<string, ProfileSummary>()
      if (historyApproverIds.length > 0) {
        const { data: historyApproverRows } = await supabase
          .from("profiles")
          .select("id, full_name, company_email")
          .in("id", historyApproverIds)
        for (const row of historyApproverRows || []) {
          historyApproverMap.set(row.id, row)
        }
      }

      for (const approval of (historyRequestApprovals || []) as LeaveApprovalRow[]) {
        const rows = historyApprovalsByRequest.get(approval.leave_request_id) || []
        rows.push({
          ...approval,
          approver: approval.approver_id ? historyApproverMap.get(approval.approver_id) || null : null,
        })
        historyApprovalsByRequest.set(approval.leave_request_id, rows)
      }

      for (const row of (historyRequests || []) as LeaveQueueRequestRow[]) {
        historyRequestMap.set(row.id, {
          ...row,
          approvals: historyApprovalsByRequest.get(row.id) || [],
        })
      }
    }

    const history = ((historyApprovals || []) as LeaveApprovalRow[]).map((approval) => ({
      ...approval,
      request: historyRequestMap.get(approval.leave_request_id) || null,
    }))

    return NextResponse.json({ data: enriched, history })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/queue:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
