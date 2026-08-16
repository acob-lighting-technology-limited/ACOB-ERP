import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { DEFAULT_CBT_SETTINGS, getCbtSettings } from "@/lib/cbt-config"
import { logger } from "@/lib/logger"

const log = logger("admin-settings-cbt")

const CbtSettingsSchema = z.object({
  time_per_question_seconds: z.number().min(5, "Time per question must be at least 5 seconds").max(600),
  total_questions_count: z.number().min(1, "Question count must be at least 1").max(100),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()

    if (!scope || (scope.role !== "super_admin" && scope.role !== "developer")) {
      return NextResponse.json({ error: "Only super_admin and developer can access CBT settings" }, { status: 403 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const settings = await getCbtSettings(dataClient)

    return NextResponse.json({ data: settings })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to fetch CBT settings")
    return NextResponse.json({ error: "Failed to fetch CBT settings" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()

    if (!scope || (scope.role !== "super_admin" && scope.role !== "developer")) {
      return NextResponse.json({ error: "Only super_admin and developer can modify CBT settings" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = CbtSettingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { error } = await dataClient.from("system_settings").upsert(
      {
        key: "cbt_settings",
        value: parsed.data,
        updated_at: new Date().toISOString(),
        updated_by: scope.userId,
      },
      { onConflict: "key" }
    )

    if (error) {
      log.error({ err: String(error) }, "Failed to update CBT settings in database")
      return NextResponse.json({ error: "Failed to save CBT settings" }, { status: 500 })
    }

    return NextResponse.json({ data: parsed.data, message: "CBT settings updated successfully" })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error updating CBT settings")
    return NextResponse.json({ error: "Failed to save CBT settings" }, { status: 500 })
  }
}
