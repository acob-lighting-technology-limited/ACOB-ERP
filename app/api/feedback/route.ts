import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { checkRequestSize } from "@/lib/api/request-size"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("feedback-route")

const CreateFeedbackSchema = z.object({
  feedbackType: z.enum(["concern", "complaint", "suggestion", "required_item"]),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  isAnonymous: z.boolean().optional().default(true),
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
