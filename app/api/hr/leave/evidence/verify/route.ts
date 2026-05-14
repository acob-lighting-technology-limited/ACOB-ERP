import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { areRequiredDocumentsVerified, getLeavePolicy, notifyUsers } from "@/lib/hr/leave-workflow"
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

    const { data, error } = await supabase
      .from("leave_evidence")
      .update({ status, notes: notes || null, verified_by: user.id, verified_at: new Date().toISOString() })
      .eq("id", evidence_id)
      .select("*")
      .single()

    if (error || !data) return NextResponse.json({ error: "Failed to verify evidence" }, { status: 500 })

    const { data: leaveRequest } = await supabase
      .from("leave_requests")
      .select("id, status, leave_type_id, reliever_id, supervisor_id")
      .eq("id", data.leave_request_id)
      .single()

    if (leaveRequest) {
      const policy = await getLeavePolicy(supabase, leaveRequest.leave_type_id)
      const requiredDocs = policy.required_documents || []
      const evidenceStatus = await areRequiredDocumentsVerified(supabase, leaveRequest.id, requiredDocs)

      if (leaveRequest.status === "pending_evidence" && evidenceStatus.complete) {
        await supabase.from("leave_requests").update({ status: "pending" }).eq("id", leaveRequest.id)

        await notifyUsers(supabase, {
          userIds: [leaveRequest.reliever_id, leaveRequest.supervisor_id].filter(Boolean),
          title: "Leave request ready for approval",
          message: "Evidence has been verified and the leave request is now ready for workflow approvals.",
          actorId: user.id,
          linkUrl: "/leave",
          entityId: leaveRequest.id,
          emailEvent: "ready_for_approval",
        })
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
