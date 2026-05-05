import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import {
  areRequiredDocumentsVerified,
  getLeavePolicy,
  notifyUsers,
  syncAttendanceForApprovedLeave,
} from "@/lib/hr/leave-workflow"
import { getRouteStageByOrder, stageCodeForRole } from "@/lib/hr/leave-routing"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("hr-leave-approve")

const ApproveLeaveRequestSchema = z
  .object({
    leave_request_id: z.string().trim().min(1, "Missing required fields"),
    action: z.enum(["approve", "reject"]).optional(),
    status: z.enum(["approved", "rejected"]).optional(),
    comments: z.string().optional(),
    override_evidence: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const normalizedAction =
      value.action === "approve" || value.status === "approved"
        ? "approved"
        : value.action === "reject" || value.status === "rejected"
          ? "rejected"
          : null

    if (!normalizedAction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Missing required fields",
        path: ["action"],
      })
    }

    if (normalizedAction === "rejected" && !value.comments?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Comments are required when rejecting a leave request",
        path: ["comments"],
      })
    }
  })

type LeaveRequestStageSnapshot = {
  stage_order: number
  approver_role_code: string
  stage_code: string
  approver_user_id?: string | null
}

function normalizeRouteSnapshot(snapshot: LeaveRequestStageSnapshot[]) {
  return snapshot.filter(
    (
      stage
    ): stage is LeaveRequestStageSnapshot & {
      approver_user_id: string
    } => typeof stage.approver_user_id === "string" && stage.approver_user_id.length > 0
  )
}

type LeaveRequestApprovalRow = {
  status: string
  current_stage_code?: string | null
  approval_stage?: string | null
  route_snapshot?: LeaveRequestStageSnapshot[] | null
  current_stage_order?: number | null
  current_approver_user_id?: string | null
  reliever_decision_at?: string | null
  supervisor_decision_at?: string | null
  hr_decision_at?: string | null
  reliever_revision?: number | null
  user_id: string
  leave_type_id: string
  days_count: number
  start_date: string
  end_date: string
  resume_date?: string | null
  reliever_id?: string | null
  lead_reconfirm_required?: boolean | null
}

type ProfileLookupRow = {
  id: string
  role?: string | null
  full_name?: string | null
  company_email?: string | null
  additional_email?: string | null
}

function normalizeAction(body: { action?: string; status?: string }) {
  if (body.action === "approve" || body.status === "approved") return "approved"
  if (body.action === "reject" || body.status === "rejected") return "rejected"
  return null
}

function inferCurrentStageCode(leaveRequest: LeaveRequestApprovalRow) {
  return leaveRequest.current_stage_code || leaveRequest.approval_stage
}

function toWorkflowRejectionStage(stageCode: string) {
  if (stageCode === stageCodeForRole("reliever")) return "reliever"
  if (stageCode === stageCodeForRole("department_lead")) return "supervisor"
  return "hr"
}

function humanStage(stageCode: string) {
  switch (stageCode) {
    case "pending_reliever":
      return "Reliever"
    case "pending_department_lead":
      return "Department Lead"
    case "pending_admin_hr_lead":
      return "Admin & HR Lead"
    case "pending_hcs":
      return "HCS"
    case "pending_md":
      return "MD"
    default:
      return stageCode.replaceAll("_", " ")
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`leave-approve:${getClientId(request)}`, { limit: 30, windowSec: 600 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabaseAdmin =
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : supabase

    const body = await request.json()
    const parsed = ApproveLeaveRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { leave_request_id, comments, override_evidence } = parsed.data
    const action = normalizeAction(parsed.data)

    const requestScope = await getRequestScope()

    let actorProfileId = user.id
    let actorProfile: ProfileLookupRow | null = null
    const { data: actorById } = await supabase
      .from("profiles")
      .select("id, role, full_name, company_email, additional_email")
      .eq("id", user.id)
      .maybeSingle<ProfileLookupRow>()

    if (actorById?.id) {
      actorProfileId = actorById.id
      actorProfile = actorById
    } else if (user.email) {
      const { data: actorByCompanyEmail } = await supabase
        .from("profiles")
        .select("id, role, full_name, company_email, additional_email")
        .eq("company_email", user.email)
        .maybeSingle<ProfileLookupRow>()

      if (actorByCompanyEmail?.id) {
        actorProfileId = actorByCompanyEmail.id
        actorProfile = actorByCompanyEmail
      } else {
        const { data: actorByAdditionalEmail } = await supabase
          .from("profiles")
          .select("id, role, full_name, company_email, additional_email")
          .eq("additional_email", user.email)
          .maybeSingle<ProfileLookupRow>()
        if (actorByAdditionalEmail?.id) {
          actorProfileId = actorByAdditionalEmail.id
          actorProfile = actorByAdditionalEmail
        }
      }
    }
    const canOverrideEvidence = requestScope?.isAdminLike === true && requestScope.scopeMode !== "lead"
    const actorName = actorProfile?.full_name || actorProfile?.company_email || "An approver"

    const { data: leaveRequest, error: fetchError } = await supabase
      .from("leave_requests")
      .select("*")
      .eq("id", leave_request_id)
      .single()

    if (fetchError || !leaveRequest) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 })
    }

    const typedLeaveRequest = leaveRequest as LeaveRequestApprovalRow

    if (!["pending", "pending_evidence"].includes(typedLeaveRequest.status)) {
      return NextResponse.json({ error: "Only active requests can be processed" }, { status: 400 })
    }

    const stageCode = inferCurrentStageCode(typedLeaveRequest)
    const snapshot = Array.isArray(typedLeaveRequest.route_snapshot)
      ? normalizeRouteSnapshot(typedLeaveRequest.route_snapshot)
      : []

    if (!stageCode) {
      return NextResponse.json({ error: "LEAVE_APPROVER_NOT_CONFIGURED:current_stage_code" }, { status: 400 })
    }

    const currentStageOrder = Number(typedLeaveRequest.current_stage_order || 1)
    const currentStage = getRouteStageByOrder(snapshot, currentStageOrder)

    const expectedApproverId = typedLeaveRequest.current_approver_user_id || currentStage?.approver_user_id
    if (!expectedApproverId) {
      return NextResponse.json({ error: "LEAVE_APPROVER_NOT_CONFIGURED:current_stage" }, { status: 400 })
    }

    if (expectedApproverId !== actorProfileId) {
      return NextResponse.json({ error: "LEAVE_STAGE_NOT_ASSIGNED_TO_ACTOR" }, { status: 403 })
    }

    if (typedLeaveRequest.status === "pending_evidence" && action === "approved" && !canOverrideEvidence) {
      return NextResponse.json({ error: "Request is awaiting evidence verification before approval." }, { status: 400 })
    }

    const now = new Date().toISOString()

    if (action === "rejected") {
      const { error: updateError } = await supabaseAdmin
        .from("leave_requests")
        .update({
          status: "rejected",
          approval_stage: "rejected",
          current_stage_code: "rejected",
          rejected_reason: comments,
          workflow_rejection_stage: toWorkflowRejectionStage(stageCode),
          reliever_decision_at:
            stageCode === stageCodeForRole("reliever") ? now : typedLeaveRequest.reliever_decision_at,
          supervisor_decision_at:
            stageCode === stageCodeForRole("department_lead") ? now : typedLeaveRequest.supervisor_decision_at,
          hr_decision_at:
            stageCode === stageCodeForRole("admin_hr_lead") || stageCode === stageCodeForRole("hcs")
              ? now
              : typedLeaveRequest.hr_decision_at,
        })
        .eq("id", leave_request_id)

      if (updateError) {
        return NextResponse.json({ error: `Failed to reject leave request: ${updateError.message}` }, { status: 500 })
      }

      const { error: rejectionAuditError } = await supabaseAdmin.from("leave_approvals").upsert(
        {
          leave_request_id,
          approver_id: actorProfileId,
          approval_level: currentStageOrder,
          status: action,
          comments: comments || null,
          approved_at: now,
          stage_code: stageCode,
          stage_order: currentStageOrder,
          reliever_revision: typedLeaveRequest.reliever_revision || 1,
          superseded: false,
        },
        { onConflict: "leave_request_id,approver_id,approval_level" }
      )
      if (rejectionAuditError) {
        return NextResponse.json(
          { error: `Failed to record rejection audit: ${rejectionAuditError.message}` },
          { status: 500 }
        )
      }

      await notifyUsers(supabaseAdmin, {
        userIds: [typedLeaveRequest.user_id],
        title: "Leave request rejected",
        message: `Your leave request was rejected at ${stageCode.replaceAll("_", " ")}. Reason: ${comments}`,
        actorId: actorProfileId,
        linkUrl: "/leave",
        entityId: leave_request_id,
        emailEvent: "rejected",
      })

      // If a different reliever had already been attached, tell them the commitment is no longer active.
      if (typedLeaveRequest.reliever_id && typedLeaveRequest.reliever_id !== typedLeaveRequest.user_id) {
        await notifyUsers(supabaseAdmin, {
          userIds: [typedLeaveRequest.reliever_id],
          title: "Reliever commitment released",
          message: "This leave request was rejected, so your reliever commitment for it is no longer active.",
          actorId: actorProfileId,
          linkUrl: "/leave",
          entityId: leave_request_id,
          emailEvent: "approval_required",
        })
      }

      await writeAuditLog(
        supabase,
        {
          action: "reject",
          entityType: "leave_request",
          entityId: leave_request_id,
          newValues: { status: "rejected", stage: stageCode, reason: comments },
          context: { actorId: actorProfileId, source: "api", route: "/api/hr/leave/approve" },
        },
        { failOpen: true }
      )

      return NextResponse.json({ message: "Leave request rejected" })
    }

    // Approval history row
    const { error: approvalAuditError } = await supabaseAdmin.from("leave_approvals").upsert(
      {
        leave_request_id,
        approver_id: actorProfileId,
        approval_level: currentStageOrder,
        status: action,
        comments: comments || null,
        approved_at: now,
        stage_code: stageCode,
        stage_order: currentStageOrder,
        reliever_revision: typedLeaveRequest.reliever_revision || 1,
        superseded: false,
      },
      { onConflict: "leave_request_id,approver_id,approval_level" }
    )
    if (approvalAuditError) {
      return NextResponse.json(
        { error: `Failed to record approval audit: ${approvalAuditError.message}` },
        { status: 500 }
      )
    }

    const nextStageOrder = currentStageOrder + 1
    const nextStage = getRouteStageByOrder(snapshot, nextStageOrder)

    if (!nextStage) {
      const policy = await getLeavePolicy(supabase, typedLeaveRequest.leave_type_id)
      const requiredDocs = policy.required_documents || []
      const evidenceStatus = await areRequiredDocumentsVerified(supabase, leave_request_id, requiredDocs)

      if (!evidenceStatus.complete) {
        if (!override_evidence) {
          return NextResponse.json(
            {
              error: `Required evidence not complete. Missing: ${evidenceStatus.missing.join(", ")}`,
              missing_documents: evidenceStatus.missing,
            },
            { status: 400 }
          )
        }

        if (!policy.override_allowed) {
          return NextResponse.json({ error: "Policy does not allow evidence override" }, { status: 400 })
        }

        if (!comments?.trim()) {
          return NextResponse.json({ error: "Override reason is required" }, { status: 400 })
        }
      }

      const { error: updateError } = await supabaseAdmin
        .from("leave_requests")
        .update({
          status: "approved",
          approval_stage: "completed",
          current_stage_code: "completed",
          approved_by: actorProfileId,
          approved_at: now,
          hr_decision_at: now,
          hr_comment: comments || null,
          lead_reconfirm_required: false,
        })
        .eq("id", leave_request_id)

      if (updateError) {
        return NextResponse.json({ error: `Failed to approve leave request: ${updateError.message}` }, { status: 500 })
      }

      await supabaseAdmin.rpc("update_leave_balance", {
        p_user_id: leaveRequest.user_id,
        p_leave_type_id: typedLeaveRequest.leave_type_id,
        p_days: typedLeaveRequest.days_count,
      })

      await syncAttendanceForApprovedLeave(
        supabaseAdmin,
        typedLeaveRequest.user_id,
        typedLeaveRequest.start_date,
        typedLeaveRequest.end_date,
        "set"
      )

      await notifyUsers(supabaseAdmin, {
        userIds: [typedLeaveRequest.user_id],
        title: "Leave approved - proceed on leave",
        message: `${actorName} completed final approval. Start: ${typedLeaveRequest.start_date}, Resume: ${typedLeaveRequest.resume_date}.`,
        actorId: actorProfileId,
        linkUrl: "/leave",
        entityId: leave_request_id,
        emailEvent: "approved",
      })

      if (typedLeaveRequest.reliever_id && typedLeaveRequest.reliever_id !== typedLeaveRequest.user_id) {
        await notifyUsers(supabaseAdmin, {
          userIds: [typedLeaveRequest.reliever_id],
          title: "Reliever commitment is now active",
          message: `This leave is fully approved (${typedLeaveRequest.start_date} to ${typedLeaveRequest.end_date}). You cannot request overlapping leave during this period.`,
          actorId: actorProfileId,
          linkUrl: "/leave",
          entityId: leave_request_id,
          emailEvent: "approval_required",
        })
      }

      await writeAuditLog(
        supabase,
        {
          action: "approve",
          entityType: "leave_request",
          entityId: leave_request_id,
          newValues: { status: "approved", final: true, stage: stageCode },
          context: { actorId: actorProfileId, source: "api", route: "/api/hr/leave/approve" },
        },
        { failOpen: true }
      )

      return NextResponse.json({ message: "Final approval recorded and leave approved" })
    }

    if (!nextStage.approver_user_id) {
      return NextResponse.json({ error: "LEAVE_APPROVER_NOT_CONFIGURED:next_stage_approver" }, { status: 400 })
    }

    const transitionUpdates: Record<string, unknown> = {
      approval_stage: nextStage.stage_code,
      current_stage_code: nextStage.stage_code,
      current_stage_order: nextStage.stage_order,
      current_approver_user_id: nextStage.approver_user_id,
      lead_reconfirm_required:
        stageCode === stageCodeForRole("department_lead") ? false : typedLeaveRequest.lead_reconfirm_required,
    }

    if (stageCode === stageCodeForRole("reliever")) {
      transitionUpdates.reliever_decision_at = now
      transitionUpdates.reliever_comment = comments || null
    }

    if (stageCode === stageCodeForRole("department_lead")) {
      transitionUpdates.supervisor_decision_at = now
      transitionUpdates.supervisor_comment = comments || null
    }

    if (stageCode === stageCodeForRole("admin_hr_lead") || stageCode === stageCodeForRole("hcs")) {
      transitionUpdates.hr_decision_at = now
      transitionUpdates.hr_comment = comments || null
    }

    const { error: updateError } = await supabaseAdmin
      .from("leave_requests")
      .update(transitionUpdates)
      .eq("id", leave_request_id)
    if (updateError) {
      return NextResponse.json({ error: `Failed to advance leave request: ${updateError.message}` }, { status: 500 })
    }

    await notifyUsers(supabaseAdmin, {
      userIds: [leaveRequest.user_id],
      title: `${humanStage(stageCode)} approved your leave request`,
      message: `${actorName} approved at ${humanStage(stageCode)} stage. Next: ${humanStage(nextStage.stage_code)}.`,
      actorId: actorProfileId,
      linkUrl: "/leave",
      entityId: leave_request_id,
      emailEvent: "approval_required",
    })

    await notifyUsers(supabaseAdmin, {
      userIds: [nextStage.approver_user_id],
      title: "Leave request awaiting your approval",
      message: `A leave request is now waiting at ${nextStage.stage_code.replaceAll("_", " ")}.`,
      actorId: actorProfileId,
      linkUrl: "/leave",
      entityId: leave_request_id,
      emailEvent: "approval_required",
    })

    await writeAuditLog(
      supabase,
      {
        action: "approve",
        entityType: "leave_request",
        entityId: leave_request_id,
        newValues: { stage: stageCode, next_stage: nextStage?.stage_code },
        context: { actorId: actorProfileId, source: "api", route: "/api/hr/leave/approve" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message: "Approval recorded" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/leave/approve:")
    return NextResponse.json({ error: error instanceof Error ? error.message : "An error occurred" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  return PATCH(request)
}
