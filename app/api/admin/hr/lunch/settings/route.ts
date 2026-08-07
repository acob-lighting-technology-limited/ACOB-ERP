import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { DEFAULT_LUNCH_SETTINGS, isValidDeadlineTime, loadLunchSettings } from "@/lib/hr/lunch-voting"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch-settings")
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    return NextResponse.json(await loadLunchSettings(dataClient))
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/lunch/settings")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const { cost, subsidy_percent, eating_days, voting_deadline, voting_enabled } = body as {
      cost: number
      subsidy_percent: number
      eating_days?: string[]
      voting_deadline?: string
      voting_enabled?: boolean
    }

    if (isNaN(cost) || isNaN(subsidy_percent) || cost < 0 || subsidy_percent < 0 || subsidy_percent > 100) {
      return NextResponse.json({ error: "Invalid cost or subsidy percentage" }, { status: 400 })
    }
    if (voting_deadline !== undefined && !isValidDeadlineTime(voting_deadline)) {
      return NextResponse.json({ error: "Voting deadline must be a time like 07:00" }, { status: 400 })
    }

    const finalDays = Array.isArray(eating_days) ? eating_days : [...DEFAULT_LUNCH_SETTINGS.eating_days]
    const settings = {
      cost,
      subsidy_percent,
      eating_days: finalDays,
      voting_deadline: voting_deadline ?? DEFAULT_LUNCH_SETTINGS.voting_deadline,
      voting_enabled: voting_enabled ?? true,
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { error } = await dataClient.from("system_settings").upsert({
      key: "lunch_settings",
      value: settings,
      description: "Lunch tracker cost, subsidy, eating days, and voting deadline configuration",
      updated_at: new Date().toISOString(),
      updated_by: scope.userId,
    })

    if (error) {
      throw new Error(`Failed to save settings: ${error.message}`)
    }

    return NextResponse.json({ success: true, settings })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/lunch/settings")
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
