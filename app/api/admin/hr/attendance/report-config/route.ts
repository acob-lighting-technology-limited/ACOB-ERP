import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { logger } from "@/lib/logger"

const log = logger("hr-attendance-report-config")
const SETTINGS_KEY = "attendance_daily_report_config"

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const PatchSchema = z.object({
  recipientUserIds: z.array(z.string().uuid()).max(100),
  enabled: z.boolean(),
  sendTimes: z.array(z.string().regex(TIME_RE, "Times must be in HH:MM format")).min(1).max(6),
})

const DEFAULT_SEND_TIMES = ["11:00", "23:00"]

type ReportConfig = {
  recipientUserIds: string[]
  enabled: boolean
  sendTimes: string[]
  lastSentByTime?: Record<string, string>
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) return contextResult.response
    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.attendance")
    if (!routeAccess.ok) return routeAccess.response

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { data: settingRow } = await dataClient
      .from("system_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle()

    const value = (settingRow?.value as Partial<ReportConfig>) || {}
    const recipientUserIds = Array.isArray(value.recipientUserIds) ? value.recipientUserIds : []
    const sendTimes =
      Array.isArray(value.sendTimes) && value.sendTimes.length > 0 ? value.sendTimes : DEFAULT_SEND_TIMES

    let recipients: Array<{ id: string; user_name: string; department: string | null }> = []
    if (recipientUserIds.length > 0) {
      const { data: profileRows } = await dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name, department")
        .in("id", recipientUserIds)
      recipients = (profileRows ?? []).map((p) => ({
        id: p.id,
        user_name: p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown",
        department: p.department ?? null,
      }))
    }

    return NextResponse.json({
      data: { recipientUserIds, enabled: Boolean(value.enabled), sendTimes, recipients },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load attendance report config")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) return contextResult.response
    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.attendance")
    if (!routeAccess.ok) return routeAccess.response

    const parsed = PatchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Preserve per-slot send history for times that still exist, so editing recipients/
    // toggling enabled doesn't reset today's "already sent" bookkeeping for unrelated slots.
    const { data: existingRow } = await dataClient
      .from("system_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle()
    const existingLastSent = ((existingRow?.value as Partial<ReportConfig>)?.lastSentByTime as
      | Record<string, string>
      | undefined) ?? {}
    const lastSentByTime = Object.fromEntries(
      Object.entries(existingLastSent).filter(([time]) => parsed.data.sendTimes.includes(time))
    )

    const { error } = await dataClient.from("system_settings").upsert(
      {
        key: SETTINGS_KEY,
        value: {
          recipientUserIds: parsed.data.recipientUserIds,
          enabled: parsed.data.enabled,
          sendTimes: parsed.data.sendTimes,
          lastSentByTime,
        },
        description: "Recipients, schedule, and automation toggle for the daily attendance status report",
        updated_by: user.id,
      },
      { onConflict: "key" }
    )

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to save attendance report config")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
