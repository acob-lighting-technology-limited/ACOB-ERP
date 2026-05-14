import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { DEFAULT_MAINTENANCE_MESSAGE, canManageMaintenanceMode, parseMaintenanceMode } from "@/lib/maintenance"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("dev-maintenance")
export const dynamic = "force-dynamic"
const UpdateMaintenanceModeSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().optional(),
})

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profileError) {
      return NextResponse.json({ error: "Failed to resolve user role" }, { status: 500 })
    }

    const { data: settings, error: settingsError } = await supabase
      .from("system_settings")
      .select("value, updated_at, updated_by")
      .eq("key", "maintenance_mode")
      .maybeSingle()

    if (settingsError) {
      return NextResponse.json({ error: "Failed to load maintenance mode" }, { status: 500 })
    }

    const { enabled, message } = parseMaintenanceMode(settings?.value)

    return NextResponse.json({
      data: {
        enabled,
        message,
        updated_at: settings?.updated_at || null,
        updated_by: settings?.updated_by || null,
      },
      can_toggle: canManageMaintenanceMode(profile?.role),
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/dev/maintenance:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const rl = await rateLimit(`dev-maintenance:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profileError) {
      return NextResponse.json({ error: "Failed to resolve user role" }, { status: 500 })
    }

    if (!canManageMaintenanceMode(profile?.role)) {
      return NextResponse.json({ error: "Only super admin or developer can change maintenance mode" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = UpdateMaintenanceModeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const enabled = Boolean(parsed.data.enabled)
    const message = parsed.data.message ? String(parsed.data.message) : DEFAULT_MAINTENANCE_MESSAGE

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Server is missing Supabase service credentials" }, { status: 500 })
    }

    const adminClient = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: upsertError } = await adminClient.from("system_settings").upsert(
      {
        key: "maintenance_mode",
        value: { enabled, message },
        updated_by: user.id,
      },
      { onConflict: "key" }
    )

    if (upsertError) {
      return NextResponse.json({ error: `Failed to update maintenance mode: ${upsertError.message}` }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "system_setting",
        entityId: "maintenance_mode",
        newValues: { enabled, message },
        context: { actorId: user.id, source: "api", route: "/api/dev/maintenance" },
      },
      { failOpen: true }
    )

    return NextResponse.json({
      data: {
        enabled,
        message,
      },
      message: enabled ? "Maintenance mode enabled" : "Maintenance mode disabled",
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PUT /api/dev/maintenance:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
