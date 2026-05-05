import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { areRequiredDocumentsVerified, getLeavePolicy, notifyUsers } from "@/lib/hr/leave-workflow"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"

const log = logger("hr-leave-evidence")
const UploadLeaveEvidenceSchema = z.object({
  leave_request_id: z.string().trim().min(1, "leave_request_id, document_type and file_url are required"),
  document_type: z.string().trim().min(1, "leave_request_id, document_type and file_url are required"),
  file_url: z.string().trim().min(1, "leave_request_id, document_type and file_url are required"),
  notes: z.string().optional().nullable(),
})

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const parsed = UploadLeaveEvidenceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { leave_request_id, document_type, file_url, notes } = parsed.data

    const { data: leaveRequest } = await supabase
      .from("leave_requests")
      .select("id, user_id, leave_type_id, reliever_id, supervisor_id, status")
      .eq("id", leave_request_id)
      .single()

    if (!leaveRequest) return NextResponse.json({ error: "Leave request not found" }, { status: 404 })
    if (leaveRequest.user_id !== user.id) {
      return NextResponse.json({ error: "You can only upload evidence for your own request" }, { status: 403 })
    }

    const { data: evidence, error } = await supabase
      .from("leave_evidence")
      .insert({
        leave_request_id,
        document_type,
        file_url,
        uploaded_by: user.id,
        notes: notes || null,
        status: "verified",
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: "Failed to upload evidence" }, { status: 500 })

    const policy = await getLeavePolicy(supabase, leaveRequest.leave_type_id)
    const requiredDocs = policy.required_documents || []
    const evidenceStatus = await areRequiredDocumentsVerified(supabase, leave_request_id, requiredDocs)

    if (leaveRequest.status === "pending_evidence" && evidenceStatus.complete) {
      await supabase.from("leave_requests").update({ status: "pending" }).eq("id", leave_request_id)

      await notifyUsers(supabase, {
        userIds: [leaveRequest.reliever_id, leaveRequest.supervisor_id].filter(Boolean),
        title: "Leave request ready for approval",
        message: "Required evidence has been completed. The leave request has entered approval workflow.",
        actorId: user.id,
        linkUrl: "/leave",
        entityId: leave_request_id,
        emailEvent: "ready_for_approval",
      })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "leave_evidence",
        entityId: evidence.id,
        newValues: { leave_request_id, document_type },
        context: { actorId: user.id, source: "api", route: "/api/hr/leave/evidence" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: evidence, message: "Evidence uploaded successfully" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/leave/evidence:")
    return NextResponse.json({ error: error instanceof Error ? error.message : "An error occurred" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  return PATCH(request)
}
