import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import {
  areRequiredDocumentsVerified,
  formatLeaveReference,
  getLeavePolicy,
  notifyUsers,
} from "@/lib/hr/leave-workflow"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("hr-leave-evidence-verify")
const VerifyLeaveEvidenceSchema = z.object({
  evidence_id: z.string().trim().min(1, "evidence_id and valid status are required"),
  status: z.enum(["verified", "rejected"], {
    errorMap: () => ({ message: "evidence_id and valid status are required" }),
  }),
  notes: z.string().optional().nullable(),
})

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-leave-evidence-verify:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const evidenceScope = await getRequestScope()
    if (!evidenceScope?.isAdminLike || evidenceScope.scopeMode === "lead") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = VerifyLeaveEvidenceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { evidence_id, status, notes } = parsed.data

    // Rejecting someone's sick note or evidence must say why — they need to know
    // what to re-submit.
    if (status === "rejected" && !notes?.trim()) {
      return NextResponse.json({ error: "A reason is required when rejecting evidence" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("leave_evidence")
      .update({ status, notes: notes || null, verified_by: user.id, verified_at: new Date().toISOString() })
      .eq("id", evidence_id)
      .select("*")
      .single()

    if (error || !data) return NextResponse.json({ error: "Failed to verify evidence" }, { status: 500 })

    const { data: leaveRequest } = await supabase
      .from("leave_requests")
      .select(
        "id, status, user_id, leave_type_id, reliever_id, supervisor_id, current_approver_user_id, start_date, end_date, days_count, resume_date"
      )
      .eq("id", data.leave_request_id)
      .single()

    if (leaveRequest) {
      const ref = formatLeaveReference(leaveRequest.id)
      const refSuffix = ref ? ` — ${ref}` : ""

      if (status === "rejected") {
        await notifyUsers(supabase, {
          userIds: [leaveRequest.user_id],
          title: "Leave evidence rejected",
          message: `Your submitted evidence for leave request (${leaveRequest.start_date} to ${leaveRequest.end_date}) was rejected. Reason: ${notes}`,
          actorId: user.id,
          linkUrl: "/leave",
          entityId: leaveRequest.id,
          emailEvent: "rejected",
          emailSubject: `Leave Evidence Rejected${refSuffix}`,
          emailTitle: "Leave Evidence Rejected",
          badgeText: "Evidence Rejected",
          badgeVariant: "destructive",
          detailsTitle: "Rejection Details",
          details: [
            { label: "Leave Period", value: `${leaveRequest.start_date} to ${leaveRequest.end_date}` },
            { label: "Document Type", value: data.document_type || "Evidence Document" },
            { label: "Reason / Notes", value: notes || "Please re-upload valid supporting evidence" },
          ],
          ctaLabel: "Upload New Evidence",
        })
      } else {
        const policy = await getLeavePolicy(supabase, leaveRequest.leave_type_id)
        const requiredDocs = policy.required_documents || []
        const evidenceStatus = await areRequiredDocumentsVerified(supabase, leaveRequest.id, requiredDocs)

        if (leaveRequest.status === "pending_evidence" && evidenceStatus.complete) {
          await supabase.from("leave_requests").update({ status: "pending" }).eq("id", leaveRequest.id)

          const [{ data: requesterProfile }, { data: leaveTypeRow }] = await Promise.all([
            supabase
              .from("profiles")
              .select("id, full_name, first_name, last_name, company_email, department")
              .eq("id", leaveRequest.user_id)
              .maybeSingle(),
            supabase.from("leave_types").select("id, name").eq("id", leaveRequest.leave_type_id).maybeSingle(),
          ])

          const requesterName =
            requesterProfile?.full_name ||
            `${requesterProfile?.first_name || ""} ${requesterProfile?.last_name || ""}`.trim() ||
            requesterProfile?.company_email ||
            "Employee"
          const leaveTypeName = leaveTypeRow?.name || "Leave"

          const approverId =
            leaveRequest.current_approver_user_id || leaveRequest.reliever_id || leaveRequest.supervisor_id

          if (approverId) {
            await notifyUsers(supabase, {
              userIds: [approverId],
              title: "Leave request ready for approval",
              message: `Evidence has been verified for ${requesterName}'s leave request for ${leaveTypeName} (${leaveRequest.start_date} to ${leaveRequest.end_date}). The request is now awaiting your approval.`,
              actorId: user.id,
              linkUrl: "/leave",
              entityId: leaveRequest.id,
              emailEvent: "ready_for_approval",
              emailSubject: `Action Required: Leave Request Ready for Approval — ${requesterName}${refSuffix}`,
              emailTitle: "Leave Request Ready for Approval",
              badgeText: "Action Required",
              badgeVariant: "warning",
              detailsTitle: "Leave Request Details",
              details: [
                { label: "Employee", value: requesterName },
                { label: "Department", value: requesterProfile?.department || "-" },
                { label: "Leave Type", value: leaveTypeName },
                { label: "Duration", value: `${leaveRequest.days_count} day(s)` },
                { label: "Period", value: `${leaveRequest.start_date} to ${leaveRequest.end_date}` },
                { label: "Resumption Date", value: leaveRequest.resume_date || "-" },
                { label: "Evidence Status", value: "Verified by HR" },
              ],
              ctaLabel: "Review & Endorse",
            })
          }

          await notifyUsers(supabase, {
            userIds: [leaveRequest.user_id],
            title: "Leave evidence verified",
            message: `Your supporting evidence for ${leaveTypeName} has been verified. Your request has advanced into the approval workflow.`,
            actorId: user.id,
            linkUrl: "/leave",
            entityId: leaveRequest.id,
            emailEvent: "ready_for_approval",
            emailSubject: `Leave Evidence Verified Successfully${refSuffix}`,
            emailTitle: "Evidence Verified",
            badgeText: "Evidence Verified — In Progress",
            badgeVariant: "info",
            detailsTitle: "Leave Request Details",
            details: [
              { label: "Leave Type", value: leaveTypeName },
              { label: "Period", value: `${leaveRequest.start_date} to ${leaveRequest.end_date}` },
              { label: "Status", value: "Pending Approvals" },
            ],
            ctaLabel: "View Leave Status",
          })
        }
      }
    }

    await writeAuditLog(
      supabase,
      {
        action: status === "verified" ? "approve" : "reject",
        entityType: "leave_evidence",
        entityId: evidence_id,
        newValues: { status, notes: notes || null, leave_request_id: data.leave_request_id },
        context: { actorId: user.id, source: "api", route: "/api/hr/leave/evidence/verify" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data, message: `Evidence ${status}` })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/leave/evidence/verify:")
    return NextResponse.json({ error: error instanceof Error ? error.message : "An error occurred" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-leave-evidence-verify:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(request)
}
