import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  appendCorrespondenceAuditLog,
  appendCorrespondenceEvent,
  canAccessDepartment,
  canAccessRecord,
  getAuthContext,
  getExecutiveDepartmentName,
} from "@/lib/correspondence/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { sendCorrespondenceApprovalEmail } from "@/lib/correspondence/mailer"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { normalizeDepartmentName } from "@/shared/departments"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("correspondence-records-approvals")

const STAGE_DEPT = "dept_review"
const STAGE_EXEC = "exec_review"
// Support legacy stage names from records created before v2
const STAGE_DEPT_LEGACY = "department_review"
const STAGE_EXEC_LEGACY = "executive_review"

const CreateCorrespondenceApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected", "returned_for_correction"], {
    errorMap: () => ({ message: "decision must be one of approved, rejected, returned_for_correction" }),
  }),
  comments: z.string().optional().nullable(),
})

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`correspondence-records-approvals:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )

  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: record, error: recordError } = await supabase
      .from("correspondence_records")
      .select("*")
      .eq("id", params.id)
      .single()

    if (recordError || !record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 })
    }

    const approvalsScope = await getRequestScope()
    const isGlobalAdmin = approvalsScope?.isAdminLike === true && approvalsScope.scopeMode !== "lead"
    if (!isGlobalAdmin && !canAccessRecord(profile, user.id, record)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = CreateCorrespondenceApprovalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const decision = parsed.data.decision
    const comments = parsed.data.comments ? String(parsed.data.comments).trim() : null
    const now = new Date().toISOString()

    const approvalScopeDepartment = String(record.department_name || record.assigned_department_name || "")
    const designation = String((profile as { designation?: string | null })?.designation || "").toLowerCase()
    const role = String(profile.role || "").toLowerCase()

    const isManagingDirector =
      role === "super_admin" ||
      role === "developer" ||
      designation.includes("managing director") ||
      designation === "md"

    const execMgmtDept = await getExecutiveDepartmentName()
    const isExecutiveLead =
      Boolean(profile.is_department_lead) &&
      normalizeDepartmentName(approvalScopeDepartment) === normalizeDepartmentName(execMgmtDept) &&
      canAccessDepartment(profile, execMgmtDept)

    const isDepartmentLeadForRecord =
      Boolean(profile.is_department_lead) &&
      Boolean(approvalScopeDepartment) &&
      canAccessDepartment(profile, approvalScopeDepartment)

    const isExecutiveApprover = isManagingDirector || isExecutiveLead
    const canBypassChain = role === "super_admin" || role === "developer"

    const { data: existingApprovals, error: approvalError } = await supabase
      .from("correspondence_approvals")
      .select("*")
      .eq("correspondence_id", record.id)
      .order("created_at", { ascending: true })

    if (approvalError) throw approvalError

    const approvals = existingApprovals || []

    const deptApproval = approvals.find(
      (a) => a.approval_stage === STAGE_DEPT || a.approval_stage === STAGE_DEPT_LEGACY
    )
    const execApproval = approvals.find(
      (a) => a.approval_stage === STAGE_EXEC || a.approval_stage === STAGE_EXEC_LEGACY
    )

    // ── Super admin / developer bypass ─────────────────────────────────────────
    if (canBypassChain && decision === "approved") {
      const dataClient = getServiceRoleClientOrFallback(supabase)
      const pendingStages = [
        { key: STAGE_DEPT, existing: deptApproval },
        { key: STAGE_EXEC, existing: execApproval },
      ]

      for (const { key, existing } of pendingStages) {
        if (existing) {
          await dataClient
            .from("correspondence_approvals")
            .update({
              approver_id: user.id,
              status: "approved",
              comments: "Approved by administrator",
              decided_at: now,
            })
            .eq("id", existing.id)
        } else {
          await dataClient.from("correspondence_approvals").insert({
            correspondence_id: record.id,
            approval_stage: key,
            approver_id: user.id,
            status: "approved",
            comments: "Approved by administrator",
            requested_at: now,
            decided_at: now,
          })
        }
      }

      const { data: updatedRecord, error: recordUpdateError } = await supabase
        .from("correspondence_records")
        .update({ status: "approved", approved_at: now })
        .eq("id", record.id)
        .select("*")
        .single()

      if (recordUpdateError) throw recordUpdateError

      await appendCorrespondenceEvent({
        correspondenceId: record.id,
        actorId: user.id,
        eventType: "approval_decision",
        oldStatus: record.status,
        newStatus: "approved",
        details: { decision: "approved", bypass: true, comments },
      })

      await appendCorrespondenceAuditLog({
        actorId: user.id,
        action: "correspondence_approval_approved",
        recordId: record.id,
        department: approvalScopeDepartment || null,
        route: "/api/correspondence/records/[id]/approvals",
        critical: true,
        oldValues: { status: record.status },
        newValues: { status: "approved", bypass: true },
      })

      try {
        await supabase.rpc("create_notification", {
          p_user_id: record.originator_id,
          p_type: "approval",
          p_category: "operations",
          p_title: "Correspondence approved",
          p_message: `${record.reference_number} was approved`,
          p_priority: "normal",
          p_link_url: "/correspondence",
          p_actor_id: user.id,
          p_entity_type: "correspondence_record",
          p_entity_id: record.id,
          p_rich_content: { decision: "approved", reference_number: record.reference_number },
        })
      } catch (notifyError) {
        log.error({ err: String(notifyError) }, "Correspondence approval notification error:")
      }

      try {
        const { data: originatorProfile } = await dataClient
          .from("profiles")
          .select("company_email, additional_email")
          .eq("id", record.originator_id)
          .single()
        const emails = [originatorProfile?.company_email, originatorProfile?.additional_email].filter(
          Boolean
        ) as string[]
        const approverName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "Administrator"
        await sendCorrespondenceApprovalEmail({
          to: emails,
          referenceNumber: updatedRecord.reference_number,
          subject: updatedRecord.subject,
          approverName,
        })
      } catch (mailErr) {
        log.error({ err: String(mailErr) }, "Correspondence approval email failed (bypass)")
      }

      return NextResponse.json({ data: { record: updatedRecord } })
    }

    // ── Normal chain flow ───────────────────────────────────────────────────────

    if (decision !== "approved" && !isDepartmentLeadForRecord && !isExecutiveApprover) {
      return NextResponse.json(
        { error: "Only department leads or executive approvers can reject/return correspondence" },
        { status: 403 }
      )
    }

    let targetApproval = deptApproval || execApproval
    let nextRecordStatus: "under_review" | "approved" | "rejected" | "returned_for_correction" = "under_review"
    let approvedAt: string | null = null

    if (decision === "approved") {
      const deptApproved = deptApproval?.status === "approved"

      if (!deptApproved) {
        // Stage 1: dept_review
        if (!isDepartmentLeadForRecord && !isExecutiveApprover) {
          return NextResponse.json({ error: "Department lead approval is required first" }, { status: 403 })
        }

        if (!deptApproval) {
          const { data: inserted, error: insertError } = await supabase
            .from("correspondence_approvals")
            .insert({
              correspondence_id: record.id,
              approval_stage: STAGE_DEPT,
              approver_id: user.id,
              status: "approved",
              comments,
              requested_at: now,
              decided_at: now,
            })
            .select("*")
            .single()
          if (insertError) throw insertError
          targetApproval = inserted
        } else {
          const { data: updatedApproval, error: updateError } = await supabase
            .from("correspondence_approvals")
            .update({ approver_id: user.id, status: "approved", comments, decided_at: now })
            .eq("id", deptApproval.id)
            .select("*")
            .single()
          if (updateError) throw updateError
          targetApproval = updatedApproval
        }

        // Ensure exec_review record exists for next stage
        if (!execApproval) {
          await supabase.from("correspondence_approvals").insert({
            correspondence_id: record.id,
            approval_stage: STAGE_EXEC,
            status: "pending",
            requested_at: now,
          })
        }

        nextRecordStatus = "under_review"
      } else {
        // Stage 2: exec_review
        if (!isExecutiveApprover) {
          return NextResponse.json(
            { error: "Only Managing Director or Executive Management lead can finalize approval" },
            { status: 403 }
          )
        }

        if (!execApproval) {
          const { data: inserted, error: insertError } = await supabase
            .from("correspondence_approvals")
            .insert({
              correspondence_id: record.id,
              approval_stage: STAGE_EXEC,
              approver_id: user.id,
              status: "approved",
              comments,
              requested_at: now,
              decided_at: now,
            })
            .select("*")
            .single()
          if (insertError) throw insertError
          targetApproval = inserted
        } else {
          const { data: updatedExec, error: updateError } = await supabase
            .from("correspondence_approvals")
            .update({ approver_id: user.id, status: "approved", comments, decided_at: now })
            .eq("id", execApproval.id)
            .select("*")
            .single()
          if (updateError) throw updateError
          targetApproval = updatedExec
        }

        nextRecordStatus = "approved"
        approvedAt = now
      }
    } else {
      // Rejection or return-for-correction
      const activeApproval = deptApproval && deptApproval.status !== "approved" ? deptApproval : execApproval
      const stageToUse = activeApproval?.approval_stage || STAGE_DEPT

      if (!activeApproval) {
        const { data: inserted, error: insertError } = await supabase
          .from("correspondence_approvals")
          .insert({
            correspondence_id: record.id,
            approval_stage: stageToUse,
            approver_id: user.id,
            status: decision,
            comments,
            requested_at: now,
            decided_at: now,
          })
          .select("*")
          .single()
        if (insertError) throw insertError
        targetApproval = inserted
      } else {
        const { data: updated, error: updateError } = await supabase
          .from("correspondence_approvals")
          .update({ approver_id: user.id, status: decision, comments, decided_at: now })
          .eq("id", activeApproval.id)
          .select("*")
          .single()
        if (updateError) throw updateError
        targetApproval = updated
      }

      nextRecordStatus = decision === "rejected" ? "rejected" : "returned_for_correction"
    }

    const { data: updatedRecord, error: recordUpdateError } = await supabase
      .from("correspondence_records")
      .update({ status: nextRecordStatus, approved_at: approvedAt })
      .eq("id", record.id)
      .select("*")
      .single()

    if (recordUpdateError) throw recordUpdateError

    await appendCorrespondenceEvent({
      correspondenceId: record.id,
      actorId: user.id,
      eventType: "approval_decision",
      oldStatus: record.status,
      newStatus: nextRecordStatus,
      details: {
        decision,
        approval_stage: targetApproval?.approval_stage,
        comments,
      },
    })

    await appendCorrespondenceAuditLog({
      actorId: user.id,
      action: `correspondence_approval_${decision}`,
      recordId: record.id,
      department: approvalScopeDepartment || null,
      route: "/api/correspondence/records/[id]/approvals",
      critical: true,
      oldValues: { status: record.status },
      newValues: { status: updatedRecord.status, decision },
    })

    try {
      await supabase.rpc("create_notification", {
        p_user_id: record.originator_id,
        p_type: decision === "approved" ? "approval" : "warning",
        p_category: "operations",
        p_title: `Correspondence ${decision}`,
        p_message: `${record.reference_number} was marked ${decision}`,
        p_priority: decision === "rejected" ? "high" : "normal",
        p_link_url: "/correspondence",
        p_actor_id: user.id,
        p_entity_type: "correspondence_record",
        p_entity_id: record.id,
        p_rich_content: { decision, reference_number: record.reference_number },
      })
    } catch (notifyError) {
      log.error({ err: String(notifyError) }, "Correspondence approval notification error:")
    }

    if (nextRecordStatus === "approved") {
      try {
        const dataClient = getServiceRoleClientOrFallback(supabase)
        const { data: originatorProfile } = await dataClient
          .from("profiles")
          .select("company_email, additional_email")
          .eq("id", record.originator_id)
          .single()
        const emails = [originatorProfile?.company_email, originatorProfile?.additional_email].filter(
          Boolean
        ) as string[]
        const approverName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "Approver"
        await sendCorrespondenceApprovalEmail({
          to: emails,
          referenceNumber: updatedRecord.reference_number,
          subject: updatedRecord.subject,
          approverName,
        })
      } catch (mailErr) {
        log.error({ err: String(mailErr) }, "Correspondence approval email failed")
      }
    }

    return NextResponse.json({ data: { record: updatedRecord, approval: targetApproval } })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/correspondence/records/[id]/approvals:")
    return NextResponse.json({ error: "Failed to process approval" }, { status: 500 })
  }
}

export { POST as PATCH }
