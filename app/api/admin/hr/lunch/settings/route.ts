import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
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
    const { data } = await dataClient.from("system_settings").select("value").eq("key", "lunch_settings").maybeSingle()

    const defaultSettings = { cost: 2200, subsidy_percent: 50, eating_days: ["Monday", "Wednesday", "Friday"] }
    const settings = data?.value ? { ...defaultSettings, ...data.value } : defaultSettings

    return NextResponse.json(settings)
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
    const { cost, subsidy_percent, eating_days } = body as {
      cost: number
      subsidy_percent: number
      eating_days?: string[]
    }

    if (isNaN(cost) || isNaN(subsidy_percent) || cost < 0 || subsidy_percent < 0 || subsidy_percent > 100) {
      return NextResponse.json({ error: "Invalid cost or subsidy percentage" }, { status: 400 })
    }

    const defaultDays = ["Monday", "Wednesday", "Friday"]
    const finalDays = Array.isArray(eating_days) ? eating_days : defaultDays

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { error } = await dataClient.from("system_settings").upsert({
      key: "lunch_settings",
      value: { cost, subsidy_percent, eating_days: finalDays },
      description: "Lunch tracker cost, subsidy, and eating days configuration",
      updated_at: new Date().toISOString(),
      updated_by: scope.userId,
    })

    if (error) {
      throw new Error(`Failed to save settings: ${error.message}`)
    }

    return NextResponse.json({
      success: true,
      settings: { cost, subsidy_percent, eating_days: finalDays },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/lunch/settings")
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
