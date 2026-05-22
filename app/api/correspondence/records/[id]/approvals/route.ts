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
import { sendCorrespondenceDecisionEmail } from "@/lib/correspondence/mailer"
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

async function resolveCategoryCodeForReference(
  supabase: Awaited<ReturnType<typeof getAuthContext>>["supabase"],
  categoryInput: string | null | undefined
): Promise<string | null> {
  if (!categoryInput || !categoryInput.trim()) return null
  const raw = categoryInput.trim()
  const normalizedRaw = raw.toUpperCase()

  const { data: byCode } = await supabase
    .from("correspondence_categories")
    .select("code")
    .ilike("code", normalizedRaw)
    .limit(1)
    .returns<Array<{ code: string }>>()
  if (byCode?.[0]?.code) return byCode[0].code.trim().toUpperCase()

  const { data: byName } = await supabase
    .from("correspondence_categories")
    .select("code")
    .ilike("name", raw)
    .limit(1)
    .returns<Array<{ code: string }>>()
  if (byName?.[0]?.code) return byName[0].code.trim().toUpperCase()

  return null
}

type AnySupabaseClient = Pick<Awaited<ReturnType<typeof getAuthContext>>["supabase"], "from" | "rpc">

async function ensureReferenceNumberOnFinalApproval(params: {
  dataClient: AnySupabaseClient
  record: Record<string, unknown>
}): Promise<string> {
  const currentReference = String(params.record.reference_number || "").trim()
  if (currentReference) return currentReference

  const departmentCode = String(params.record.department_code || "")
    .trim()
    .toUpperCase()
  const recipientCode = String(params.record.recipient_code || "")
    .trim()
    .toUpperCase()

  if (!departmentCode || !recipientCode) {
    throw new Error("Missing department_code or recipient_code for final approval numbering")
  }

  const categoryCode = await resolveCategoryCodeForReference(
    params.dataClient as Awaited<ReturnType<typeof getAuthContext>>["supabase"],
    (params.record.category as string | null | undefined) || null
  )
  const yearSource = String(params.record.submitted_at || params.record.created_at || "")
  const parsedYear = new Date(yearSource).getFullYear()
  const referenceYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()

  const { data: generatedReference, error: generateError } = await params.dataClient.rpc(
    "generate_correspondence_reference",
    {
      p_department_code: departmentCode,
      p_recipient_code: recipientCode,
      p_letter_type: String((params.record.letter_type as string | null | undefined) || "external"),
      p_category_code: categoryCode,
      p_reference_year: referenceYear,
    }
  )
  if (generateError || !generatedReference) {
    throw generateError || new Error("Failed to generate correspondence reference")
  }

  return String(generatedReference)
}

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
    const canBypassChain = role === "super_admin" || role === "developer" || role === "admin"

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

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // ── Super admin / developer bypass ─────────────────────────────────────────
    if (canBypassChain && decision === "approved") {
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

      const finalReferenceNumber = await ensureReferenceNumberOnFinalApproval({ dataClient, record })
      const { data: updatedRecord, error: recordUpdateError } = await dataClient
        .from("correspondence_records")
        .update({ status: "approved", approved_at: now, reference_number: finalReferenceNumber })
        .eq("id", record.id)
        .select("*")
        .single()

      if (recordUpdateError || !updatedRecord) throw recordUpdateError || new Error("Approval update returned no data")

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
          p_type: "approval_granted",
          p_category: "approvals",
          p_title: "Correspondence approved",
          p_message: `${String(updatedRecord.reference_number || finalReferenceNumber)} was approved`,
          p_priority: "normal",
          p_link_url: "/correspondence",
          p_actor_id: user.id,
          p_entity_type: "correspondence_record",
          p_entity_id: record.id,
          p_rich_content: { decision: "approved", reference_number: String(updatedRecord.reference_number || "") },
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
        if (emails.length === 0) {
          log.warn({ recordId: record.id }, "Bypass approval: no email address found for originator, skipping email")
        } else {
          const approverName =
            [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "Administrator"
          await sendCorrespondenceDecisionEmail({
            to: emails,
            referenceNumber: updatedRecord.reference_number,
            subject: updatedRecord.subject,
            approverName,
            letterType: updatedRecord.letter_type,
            decision: "approved",
          })
        }
      } catch (mailErr) {
        log.error(
          { err: String(mailErr), recordId: record.id, ref: updatedRecord?.reference_number },
          "Correspondence approval email failed (bypass)"
        )
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

    const finalReferenceNumber =
      nextRecordStatus === "approved" ? await ensureReferenceNumberOnFinalApproval({ dataClient, record }) : null

    const { data: updatedRecord, error: recordUpdateError } = await dataClient
      .from("correspondence_records")
      .update({
        status: nextRecordStatus,
        approved_at: approvedAt,
        ...(finalReferenceNumber ? { reference_number: finalReferenceNumber } : {}),
      })
      .eq("id", record.id)
      .select("*")
      .single()

    if (recordUpdateError || !updatedRecord) throw recordUpdateError || new Error("Approval update returned no data")

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
        p_type: decision === "approved" ? "approval_granted" : decision === "rejected" ? "approval_rejected" : "system",
        p_category: "approvals",
        p_title: `Correspondence ${decision}`,
        p_message: `${String(updatedRecord.reference_number || finalReferenceNumber || "Draft")} was marked ${decision}`,
        p_priority: decision === "rejected" ? "high" : "normal",
        p_link_url: "/correspondence",
        p_actor_id: user.id,
        p_entity_type: "correspondence_record",
        p_entity_id: record.id,
        p_rich_content: {
          decision,
          reference_number: String(updatedRecord.reference_number || finalReferenceNumber || ""),
        },
      })
    } catch (notifyError) {
      log.error({ err: String(notifyError) }, "Correspondence approval notification error:")
    }

    if (
      nextRecordStatus === "approved" ||
      nextRecordStatus === "rejected" ||
      nextRecordStatus === "returned_for_correction"
    ) {
      try {
        const { data: originatorProfile } = await dataClient
          .from("profiles")
          .select("company_email, additional_email")
          .eq("id", record.originator_id)
          .single()
        const emails = [originatorProfile?.company_email, originatorProfile?.additional_email].filter(
          Boolean
        ) as string[]
        if (emails.length === 0) {
          log.warn({ recordId: record.id }, "Approval decision: no email address found for originator, skipping email")
        } else {
          const approverName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || "Approver"
          await sendCorrespondenceDecisionEmail({
            to: emails,
            referenceNumber: updatedRecord.reference_number,
            subject: updatedRecord.subject,
            approverName,
            letterType: updatedRecord.letter_type,
            decision: nextRecordStatus,
          })
        }
      } catch (mailErr) {
        log.error(
          { err: String(mailErr), recordId: record.id, ref: updatedRecord?.reference_number },
          "Correspondence decision email failed"
        )
      }
    }

    return NextResponse.json({ data: { record: updatedRecord, approval: targetApproval } })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : JSON.stringify(error)
    log.error({ err: errMsg }, "Error in POST /api/correspondence/records/[id]/approvals:")
    return NextResponse.json({ error: "Failed to process approval" }, { status: 500 })
  }
}

export { POST as PATCH }
