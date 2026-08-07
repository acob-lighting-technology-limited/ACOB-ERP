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
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { checkRequestSize } from "@/lib/api/request-size"
import { APPROVAL_STATUSES } from "@/lib/validation"

const log = logger("hr-leave-approve")

const ApproveLeaveRequestSchema = z
  .object({
    leave_request_id: z.string().trim().min(1, "Missing required fields"),
    action: z.enum(["approve", "reject"]).optional(),
    status: z.enum(APPROVAL_STATUSES).optional(),
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
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const supabaseAdmin =
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : supabase

    const sizeError = checkRequestSize(request)
    if (sizeError) return sizeError

    const body = await request.json()
    const parsed = ApproveLeaveRequestSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message ?? "Validation failed",
        ApiErrorCode.VALIDATION_ERROR,
        400,
        parsed.error.issues
      )
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
      return apiError("Leave request not found", ApiErrorCode.NOT_FOUND, 404)
    }

    const typedLeaveRequest = leaveRequest as LeaveRequestApprovalRow

    if (!["pending", "pending_evidence"].includes(typedLeaveRequest.status)) {
      return apiError("Only active requests can be processed", ApiErrorCode.INVALID_STATE, 400)
    }

    const stageCode = inferCurrentStageCode(typedLeaveRequest)
    const snapshot = Array.isArray(typedLeaveRequest.route_snapshot)
      ? normalizeRouteSnapshot(typedLeaveRequest.route_snapshot)
      : []

    if (!stageCode) {
      return apiError("LEAVE_APPROVER_NOT_CONFIGURED:current_stage_code", ApiErrorCode.INVALID_STATE, 400)
    }

    const currentStageOrder = Number(typedLeaveRequest.current_stage_order || 1)
    const currentStage = getRouteStageByOrder(snapshot, currentStageOrder)

    const expectedApproverId = typedLeaveRequest.current_approver_user_id || currentStage?.approver_user_id
    if (!expectedApproverId) {
      return apiError("LEAVE_APPROVER_NOT_CONFIGURED:current_stage", ApiErrorCode.INVALID_STATE, 400)
    }

    if (expectedApproverId !== actorProfileId) {
      return apiError("LEAVE_STAGE_NOT_ASSIGNED_TO_ACTOR", ApiErrorCode.FORBIDDEN, 403)
    }

    if (typedLeaveRequest.status === "pending_evidence" && action === "approved" && !canOverrideEvidence) {
      return apiError("Request is awaiting evidence verification before approval.", ApiErrorCode.INVALID_STATE, 400)
    }

    const now = new Date().toISOString()

    if (action === "rejected") {
      const { error: rejectionError } = await supabaseAdmin.rpc("atomic_leave_reject", {
        p_leave_request_id: leave_request_id,
        p_actor_profile_id: actorProfileId,
        p_current_stage_order: currentStageOrder,
        p_stage_code: stageCode,
        p_comments: comments || null,
        p_reliever_revision: typedLeaveRequest.reliever_revision || 1,
        p_reliever_decision_at:
          stageCode === stageCodeForRole("reliever") ? now : typedLeaveRequest.reliever_decision_at,
        p_supervisor_decision_at:
          stageCode === stageCodeForRole("department_lead") ? now : typedLeaveRequest.supervisor_decision_at,
        p_hr_decision_at:
          stageCode === stageCodeForRole("admin_hr_lead") || stageCode === stageCodeForRole("hcs")
            ? now
            : typedLeaveRequest.hr_decision_at,
      })
      if (rejectionError) {
        return apiError(`Failed to reject leave request: ${rejectionError.message}`, ApiErrorCode.DATABASE_ERROR, 500)
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
    const nextStageOrder = currentStageOrder + 1
    const nextStage = getRouteStageByOrder(snapshot, nextStageOrder)

    if (!nextStage) {
      const policy = await getLeavePolicy(supabase, typedLeaveRequest.leave_type_id)
      const requiredDocs = policy.required_documents || []
      const evidenceStatus = await areRequiredDocumentsVerified(supabase, leave_request_id, requiredDocs)

      if (!evidenceStatus.complete) {
        if (!override_evidence) {
          return apiError(
            `Required evidence not complete. Missing: ${evidenceStatus.missing.join(", ")}`,
            ApiErrorCode.VALIDATION_ERROR,
            400,
            { missing_documents: evidenceStatus.missing }
          )
        }

        if (!policy.override_allowed) {
          return apiError("Policy does not allow evidence override", ApiErrorCode.INVALID_STATE, 400)
        }

        if (!comments?.trim()) {
          return apiError("Override reason is required", ApiErrorCode.MISSING_REQUIRED_FIELD, 400)
        }
      }

      const { error: finalApproveError } = await supabaseAdmin.rpc("atomic_leave_approve_final", {
        p_leave_request_id: leave_request_id,
        p_actor_profile_id: actorProfileId,
        p_current_stage_order: currentStageOrder,
        p_stage_code: stageCode,
        p_comments: comments || null,
        p_reliever_revision: typedLeaveRequest.reliever_revision || 1,
      })
      if (finalApproveError) {
        return apiError(
          `Failed to approve leave request: ${finalApproveError.message}`,
          ApiErrorCode.DATABASE_ERROR,
          500
        )
      }

      // No balance write here on purpose: entitlements are derived from
      // leave_requests (see COMMITTED_LEAVE_STATUSES in lib/hr/leave-entitlement.ts),
      // so approving the request is itself what consumes the balance. The legacy
      // leave_balances table is read by nothing.

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
      return apiError("LEAVE_APPROVER_NOT_CONFIGURED:next_stage_approver", ApiErrorCode.INVALID_STATE, 400)
    }

    const { error: transitionError } = await supabaseAdmin.rpc("atomic_leave_approve_transition", {
      p_leave_request_id: leave_request_id,
      p_actor_profile_id: actorProfileId,
      p_current_stage_order: currentStageOrder,
      p_stage_code: stageCode,
      p_next_stage_code: nextStage.stage_code,
      p_next_stage_order: nextStage.stage_order,
      p_next_approver_user_id: nextStage.approver_user_id,
      p_comments: comments || null,
      p_reliever_revision: typedLeaveRequest.reliever_revision || 1,
      p_reliever_decision_at: stageCode === stageCodeForRole("reliever") ? now : typedLeaveRequest.reliever_decision_at,
      p_supervisor_decision_at:
        stageCode === stageCodeForRole("department_lead") ? now : typedLeaveRequest.supervisor_decision_at,
      p_hr_decision_at:
        stageCode === stageCodeForRole("admin_hr_lead") || stageCode === stageCodeForRole("hcs")
          ? now
          : typedLeaveRequest.hr_decision_at,
      p_lead_reconfirm_required:
        stageCode === stageCodeForRole("department_lead") ? false : Boolean(typedLeaveRequest.lead_reconfirm_required),
    })
    if (transitionError) {
      return apiError(`Failed to advance leave request: ${transitionError.message}`, ApiErrorCode.DATABASE_ERROR, 500)
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
    return apiError(error instanceof Error ? error.message : "An error occurred", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  return PATCH(request)
}
