import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { NOTIFICATION_KEYS, isNotificationKey } from "@/lib/notifications/delivery-policy"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type ModulePreferencePayload = {
  notification_key: string
  in_app_enabled?: boolean | null
  email_enabled?: boolean | null
}

const NotificationModuleSchema = z.object({
  notification_key: z.string(),
  in_app_enabled: z.boolean().nullable().optional(),
  email_enabled: z.boolean().nullable().optional(),
})

const UpdateNotificationPreferencesSchema = z.object({
  global: z
    .object({
      in_app_enabled: z.boolean().optional(),
      email_enabled: z.boolean().optional(),
      email_frequency: z.enum(["immediate", "hourly", "daily", "weekly", "never"]).optional(),
      quiet_hours_start: z.string().nullable().optional(),
      quiet_hours_end: z.string().nullable().optional(),
    })
    .optional(),
  modules: z.array(NotificationModuleSchema).optional().default([]),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await supabase.from("notification_preferences").upsert(
      {
        user_id: user.id,
        in_app_enabled: true,
        email_enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id", ignoreDuplicates: true }
    )

    const [globalRes, systemRes, userRes] = await Promise.all([
      supabase
        .from("notification_preferences")
        .select("user_id, in_app_enabled, email_enabled, email_frequency, quiet_hours_start, quiet_hours_end")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("notification_delivery_policies")
        .select("notification_key, in_app_enabled, email_enabled, in_app_mandatory, email_mandatory")
        .in("notification_key", [...NOTIFICATION_KEYS]),
      supabase
        .from("notification_user_delivery_preferences")
        .select("notification_key, in_app_enabled, email_enabled")
        .eq("user_id", user.id)
        .in("notification_key", [...NOTIFICATION_KEYS]),
    ])

    const systemMap = new Map<
      string,
      { in_app_enabled: boolean; email_enabled: boolean; in_app_mandatory: boolean; email_mandatory: boolean }
    >(
      (
        (systemRes.data || []) as Array<{
          notification_key: string
          in_app_enabled: boolean
          email_enabled: boolean
          in_app_mandatory: boolean
          email_mandatory: boolean
        }>
      ).map((row) => [row.notification_key, row])
    )

    const userMap = new Map<string, { in_app_enabled: boolean | null; email_enabled: boolean | null }>(
      (
        (userRes.data || []) as Array<{
          notification_key: string
          in_app_enabled: boolean | null
          email_enabled: boolean | null
        }>
      ).map((row) => [row.notification_key, row])
    )

    const globalPrefs = {
      in_app_enabled: globalRes.data?.in_app_enabled !== false,
      email_enabled: globalRes.data?.email_enabled !== false,
      email_frequency: globalRes.data?.email_frequency || "immediate",
      quiet_hours_start: globalRes.data?.quiet_hours_start || null,
      quiet_hours_end: globalRes.data?.quiet_hours_end || null,
    }

    const modules = NOTIFICATION_KEYS.map((key) => {
      const systemRow = systemMap.get(key)
      const userRow = userMap.get(key)
      const systemInApp = systemRow?.in_app_enabled !== false
      const systemEmail = systemRow?.email_enabled !== false
      const systemInAppMandatory = systemRow?.in_app_mandatory === true
      const systemEmailMandatory = systemRow?.email_mandatory === true
      const userInApp = userRow?.in_app_enabled ?? null
      const userEmail = userRow?.email_enabled ?? null

      const effectiveInApp =
        systemInApp && (systemInAppMandatory || (globalPrefs.in_app_enabled && userInApp !== false))
      const effectiveEmail = systemEmail && (systemEmailMandatory || (globalPrefs.email_enabled && userEmail !== false))

      return {
        notification_key: key,
        system_in_app_enabled: systemInApp,
        system_email_enabled: systemEmail,
        system_in_app_mandatory: systemInAppMandatory,
        system_email_mandatory: systemEmailMandatory,
        user_in_app_enabled: userInApp,
        user_email_enabled: userEmail,
        effective_in_app_enabled: effectiveInApp,
        effective_email_enabled: effectiveEmail,
      }
    })

    return NextResponse.json({
      global: globalPrefs,
      modules,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "An error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const rl = await rateLimit(`settings-notifications:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const parsed = UpdateNotificationPreferencesSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const globalPrefs = parsed.data.global
    const modules = parsed.data.modules as ModulePreferencePayload[]

    if (globalPrefs) {
      const payload: Record<string, unknown> = {
        user_id: user.id,
        updated_at: new Date().toISOString(),
      }

      if (typeof globalPrefs.in_app_enabled === "boolean") payload.in_app_enabled = globalPrefs.in_app_enabled
      if (typeof globalPrefs.email_enabled === "boolean") payload.email_enabled = globalPrefs.email_enabled
      if (typeof globalPrefs.email_frequency === "string") payload.email_frequency = globalPrefs.email_frequency
      if (globalPrefs.quiet_hours_start !== undefined) payload.quiet_hours_start = globalPrefs.quiet_hours_start
      if (globalPrefs.quiet_hours_end !== undefined) payload.quiet_hours_end = globalPrefs.quiet_hours_end

      const { error } = await supabase.from("notification_preferences").upsert(payload, { onConflict: "user_id" })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (modules.length > 0) {
      const { data: systemPolicies } = await supabase
        .from("notification_delivery_policies")
        .select("notification_key, in_app_mandatory, email_mandatory")
        .in("notification_key", [...NOTIFICATION_KEYS])

      const mandatoryMap = new Map<string, { in_app_mandatory: boolean; email_mandatory: boolean }>(
        (
          (systemPolicies || []) as Array<{
            notification_key: string
            in_app_mandatory: boolean
            email_mandatory: boolean
          }>
        ).map((row) => [row.notification_key, row])
      )

      const payload = modules
        .filter((row) => isNotificationKey(String(row.notification_key || "")))
        .map((row) => {
          const mandatory = mandatoryMap.get(row.notification_key)
          const inAppMandatory = mandatory?.in_app_mandatory === true
          const emailMandatory = mandatory?.email_mandatory === true

          return {
            user_id: user.id,
            notification_key: row.notification_key,
            in_app_enabled:
              row.in_app_enabled === undefined
                ? null
                : inAppMandatory
                  ? row.in_app_enabled !== false
                  : row.in_app_enabled,
            email_enabled:
              row.email_enabled === undefined ? null : emailMandatory ? row.email_enabled !== false : row.email_enabled,
            updated_at: new Date().toISOString(),
          }
        })

      if (payload.length > 0) {
        const { error } = await supabase
          .from("notification_user_delivery_preferences")
          .upsert(payload, { onConflict: "user_id,notification_key" })

        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "notification_preference",
        entityId: user.id,
        newValues: { modules_updated: modules.length, global_updated: !!globalPrefs },
        context: { actorId: user.id, source: "api", route: "/api/settings/notifications" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "An error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
