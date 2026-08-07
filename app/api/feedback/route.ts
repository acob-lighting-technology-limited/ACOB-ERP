import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { resolveLeadFeedbackTarget, watDayStampISO } from "@/lib/feedback/lead-feedback"

const log = logger("feedback-route")

const CreateFeedbackSchema = z.object({
  feedbackType: z.enum(["concern", "complaint", "suggestion", "required_item"]),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  isAnonymous: z.boolean().optional().default(true),
  /** When set, the feedback is about this department lead — must lead the submitter's own department. */
  targetLeadId: z.string().uuid("Invalid lead").optional().nullable(),
})

export async function POST(request: NextRequest) {
  try {
    const rl = await rateLimit(`feedback:${getClientId(request)}`, { limit: 10, windowSec: 60 })
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
    }

    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const sizeError = checkRequestSize(request)
    if (sizeError) return sizeError

    const parsed = CreateFeedbackSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request body" }, { status: 400 })
    }

    const payload = parsed.data

    // ── Lead-directed feedback ────────────────────────────────────────────────
    // Staff may only target a lead of their OWN department. Such rows are stored
    // with user_id = NULL so nothing links them back to the author, which also
    // means the submitter gets no record back to list, edit, or delete.
    if (payload.targetLeadId) {
      const leadRateLimit = await rateLimit(`lead-feedback:${user.id}`, { limit: 5, windowSec: 3600 })
      if (!leadRateLimit.allowed) {
        return NextResponse.json(
          { error: "You have submitted several lead feedback entries recently. Please try again later." },
          { status: 429 }
        )
      }

      const targetLead = await resolveLeadFeedbackTarget(dataClient, user.id, payload.targetLeadId)
      if (!targetLead) {
        return NextResponse.json(
          { error: "You can only give feedback about your own department lead." },
          { status: 403 }
        )
      }

      // Day-granular stamp, never `now()` — see watDayStampISO for why.
      const dayStamp = watDayStampISO()
      const { error: leadError } = await dataClient.from("feedback").insert({
        user_id: null,
        feedback_type: payload.feedbackType,
        title: payload.title,
        description: payload.description || null,
        status: "open",
        is_anonymous: true,
        target_lead_id: targetLead.id,
        target_department: targetLead.department,
        created_at: dayStamp,
        updated_at: dayStamp,
      })
      if (leadError) {
        return NextResponse.json({ error: leadError.message || "Failed to submit feedback" }, { status: 500 })
      }

      // No audit entry, deliberately. Any "created at <precise time>" record —
      // even one with no actor — can be correlated against request logs to
      // identify the submitter, which is exactly what this feature promises not
      // to allow. The row itself is the record; UPDATE/DELETE by HR is still
      // audited by the audit_feedback_changes trigger. The returned id is
      // withheld for the same reason.
      return NextResponse.json({ data: null, leadFeedback: true }, { status: 201 })
    }

    const insertPayload = {
      // Keep ownership for "My Feedback" listing while preserving anonymity flags in UI/admin views.
      user_id: user.id,
      feedback_type: payload.feedbackType,
      title: payload.title,
      description: payload.description || null,
      status: "open",
      is_anonymous: payload.isAnonymous,
    }

    const { data: createdFeedback, error } = await dataClient
      .from("feedback")
      .insert(insertPayload)
      .select("*")
      .single()
    if (error || !createdFeedback) {
      return NextResponse.json({ error: error?.message || "Failed to submit feedback" }, { status: 500 })
    }

    await writeAuditLog(
      dataClient,
      {
        action: "create",
        entityType: "feedback",
        entityId: createdFeedback.id,
        newValues: {
          feedback_type: payload.feedbackType,
          title: payload.title,
          description: payload.description || null,
          status: "open",
          is_anonymous: payload.isAnonymous,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/feedback",
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: createdFeedback }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled feedback POST error")
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 })
  }
}
