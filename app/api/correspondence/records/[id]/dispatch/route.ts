import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { appendCorrespondenceAuditLog, canAccessRecord, getAuthContext, isAdminRole } from "@/lib/correspondence/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("correspondence-records-dispatch")

const DispatchCorrespondenceSchema = z.object({
  final_status: z.enum(["sent", "filed"], {
    errorMap: () => ({ message: "final_status must be sent or filed" }),
  }),
  dispatch_method: z.enum(["email", "courier", "hand_delivery", "regulatory_portal"], {
    errorMap: () => ({ message: "Invalid dispatch_method" }),
  }),
  proof_of_delivery_path: z.string().optional().nullable(),
  recipient_name: z.string().optional().nullable(),
})

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`correspondence-records-dispatch:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

    const dispatchScope = await getRequestScope()
    const isGlobalAdmin = isAdminRole(profile.role) && dispatchScope?.scopeMode !== "lead"
    if (!isGlobalAdmin && !canAccessRecord(profile, user.id, record)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (!isGlobalAdmin && record.originator_id !== user.id && record.responsible_officer_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = DispatchCorrespondenceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const finalStatus = parsed.data.final_status
    const dispatchMethod = parsed.data.dispatch_method

    const { data: updatedRecord, error: dispatchError } = await supabase.rpc("atomic_dispatch_correspondence", {
      p_record_id: record.id,
      p_actor_id: user.id,
      p_final_status: finalStatus,
      p_dispatch_method: dispatchMethod,
      p_proof_of_delivery_path: parsed.data.proof_of_delivery_path
        ? String(parsed.data.proof_of_delivery_path).trim()
        : null,
      p_recipient_name: parsed.data.recipient_name ? String(parsed.data.recipient_name).trim() : record.recipient_name,
      p_old_status: record.status,
    })
    if (dispatchError) throw dispatchError

    await appendCorrespondenceAuditLog({
      actorId: user.id,
      action: "correspondence_record_dispatched",
      recordId: record.id,
      department: record.department_name || record.assigned_department_name || null,
      route: "/api/correspondence/records/[id]/dispatch",
      critical: true,
      oldValues: {
        status: record.status,
        is_locked: record.is_locked,
      },
      newValues: {
        status: updatedRecord.status,
        dispatch_method: updatedRecord.dispatch_method,
        is_locked: updatedRecord.is_locked,
      },
    })

    return NextResponse.json({ data: updatedRecord })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/correspondence/records/[id]/dispatch:")
    return NextResponse.json({ error: "Failed to finalize dispatch" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export { PATCH as POST }
