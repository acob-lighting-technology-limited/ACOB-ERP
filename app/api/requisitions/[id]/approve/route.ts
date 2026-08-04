import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { z } from "zod"
import { getNextStage } from "@/lib/requisitions/workflow"
import { logger } from "@/lib/logger"
import { apiError, ApiErrorCode } from "@/lib/api/errors"

const log = logger("api-requisitions-approve")

const ApproveSchema = z.object({
  action: z.enum(["approve", "reject"]),
  comments: z.string().optional(),
})

function getAdminClient() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

    const body = await request.json()
    const parsed = ApproveSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || "Validation error", ApiErrorCode.VALIDATION_ERROR, 400)
    }

    const { action, comments } = parsed.data
    const adminClient = getAdminClient() || supabase

    // Get current requisition status
    const { data: req, error: fetchErr } = await adminClient.from("requisitions").select("*").eq("id", id).single()

    if (fetchErr || !req) {
      return apiError("Requisition not found", ApiErrorCode.NOT_FOUND, 404)
    }

    if (req.status !== "pending") {
      return apiError(`Requisition is already ${req.status}`, ApiErrorCode.VALIDATION_ERROR, 400)
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {}

    if (action === "reject") {
      updatePayload.status = "rejected"
      updatePayload.current_stage_code = "rejected"
      updatePayload.rejection_reason = comments || "No rejection reason provided"
      updatePayload.rejected_by = user.id
      updatePayload.rejected_at = now
    } else {
      // Handle approval stage progression
      switch (req.current_stage_code) {
        case "pending_reviewed_by":
          updatePayload.reviewed_by = user.id
          updatePayload.reviewed_at = now
          updatePayload.reviewed_comments = comments || null
          updatePayload.current_stage_code = getNextStage("pending_reviewed_by")
          break

        case "pending_authorized_by":
          updatePayload.authorized_by = user.id
          updatePayload.authorized_at = now
          updatePayload.authorized_comments = comments || null
          updatePayload.current_stage_code = getNextStage("pending_authorized_by")
          break

        case "pending_verified_by":
          updatePayload.verified_by = user.id
          updatePayload.verified_at = now
          updatePayload.verified_comments = comments || null
          updatePayload.current_stage_code = getNextStage("pending_verified_by")
          break

        case "pending_approved_by":
          updatePayload.approved_by = user.id
          updatePayload.approved_at = now
          updatePayload.approved_comments = comments || null
          updatePayload.current_stage_code = "completed"
          updatePayload.status = "approved"
          break

        default:
          return apiError("Invalid current stage for approval", ApiErrorCode.VALIDATION_ERROR, 400)
      }
    }

    const { data: updatedReq, error: updateErr } = await adminClient
      .from("requisitions")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single()

    if (updateErr || !updatedReq) {
      log.error("Failed to update requisition:", updateErr)
      return apiError("Failed to update requisition status", ApiErrorCode.INTERNAL_ERROR, 500)
    }

    // Send notifications
    try {
      if (action === "reject") {
        await adminClient.rpc("create_notification", {
          p_user_id: req.user_id,
          p_type: "requisition_rejected",
          p_category: "approvals",
          p_title: "Requisition Rejected",
          p_message: `Your requisition ${req.requisition_number} was rejected.`,
          p_priority: "high",
          p_link_url: `/requisition/${req.id}`,
          p_actor_id: user.id,
          p_entity_type: "requisition",
          p_entity_id: req.id,
        })
      } else if (updatedReq.status === "approved") {
        await adminClient.rpc("create_notification", {
          p_user_id: req.user_id,
          p_type: "requisition_approved",
          p_category: "approvals",
          p_title: "Requisition Fully Approved",
          p_message: `Your requisition ${req.requisition_number} (₦${req.amount.toLocaleString()}) has been fully approved by Executive Management.`,
          p_priority: "high",
          p_link_url: `/requisition/${req.id}`,
          p_actor_id: user.id,
          p_entity_type: "requisition",
          p_entity_id: req.id,
        })
      } else {
        // Notify next stage group or requester
        await adminClient.rpc("create_notification", {
          p_user_id: req.user_id,
          p_type: "requisition_stage_passed",
          p_category: "approvals",
          p_title: "Requisition Approval Progress",
          p_message: `Your requisition ${req.requisition_number} passed stage approval and is now ${updatedReq.current_stage_code.replaceAll("_", " ")}.`,
          p_priority: "normal",
          p_link_url: `/requisition/${req.id}`,
          p_actor_id: user.id,
          p_entity_type: "requisition",
          p_entity_id: req.id,
        })
      }
    } catch (notifErr) {
      log.error("Failed sending approval notification:", notifErr)
    }

    return NextResponse.json({ data: updatedReq, message: `Requisition ${action}d successfully` })
  } catch (err) {
    log.error("Unexpected error in PATCH /api/requisitions/[id]/approve:", err)
    return apiError("Internal Server Error", ApiErrorCode.INTERNAL_ERROR, 500)
  }
}
