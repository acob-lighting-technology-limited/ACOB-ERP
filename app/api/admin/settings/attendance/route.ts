import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { z } from "zod"

const PolicySchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Start time must be in HH:MM format"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "End time must be in HH:MM format"),
  lateCutoff: z.string().regex(/^\d{2}:\d{2}$/, "Grace cutoff must be in HH:MM format"),
  incompletePenalty: z.number().nonnegative("Incomplete penalty must be a positive number"),
  totalCredits: z.number().positive("Total credits must be a positive number"),
  emailNotificationsEnabled: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) return contextResult.response
    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.attendance")
    if (!routeAccess.ok) return routeAccess.response

    const body = await request.json()
    const parsed = PolicySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }

    const { startTime, endTime, lateCutoff, incompletePenalty, totalCredits, emailNotificationsEnabled } = parsed.data

    const { error } = await supabase.from("system_settings").upsert(
      {
        key: "attendance_policy",
        value: {
          startTime,
          endTime,
          lateCutoff,
          incompletePenalty,
          totalCredits,
          emailNotificationsEnabled: emailNotificationsEnabled ?? true,
        },
        description: "Workday timing configurations and lateness/incomplete penalties",
        updated_by: user.id,
      },
      { onConflict: "key" }
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 })
  }
}
