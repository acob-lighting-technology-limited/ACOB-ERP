import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { NOTIFICATION_KEYS, isNotificationKey } from "@/lib/notifications/delivery-policy"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type PolicyUpdatePayload = {
  notification_key: string
  in_app_enabled?: boolean
  email_enabled?: boolean
  in_app_mandatory?: boolean
  email_mandatory?: boolean
}

type MailSettingsClient = Awaited<ReturnType<typeof createClient>>
const MailPolicySchema = z.object({
  notification_key: z.string(),
  in_app_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  in_app_mandatory: z.boolean().optional(),
  email_mandatory: z.boolean().optional(),
})

const UpdateMailPoliciesSchema = z.object({
  policies: z.array(MailPolicySchema).min(1, "No policies provided"),
})

async function requirePrivilegedActor(supabase: MailSettingsClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (!["super_admin", "developer"].includes(profile?.role)) {
    return { user: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  return { user, error: null }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requirePrivilegedActor(supabase)
    if (auth.error) return auth.error

    const admin = getServiceRoleClientOrFallback(supabase)

    const { data, error } = await admin
      .from("notification_delivery_policies")
      .select(
        "notification_key, in_app_enabled, email_enabled, in_app_mandatory, email_mandatory, updated_by, updated_at"
      )
      .in("notification_key", [...NOTIFICATION_KEYS])
      .order("notification_key")

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ policies: data || [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "An error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const rl = await rateLimit(`admin-settings-mail:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const auth = await requirePrivilegedActor(supabase)
    if (auth.error) return auth.error

    const body = await request.json()
    const parsed = UpdateMailPoliciesSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const inputPolicies = parsed.data.policies as PolicyUpdatePayload[]

    const payload = inputPolicies
      .filter((row) => isNotificationKey(String(row.notification_key || "")))
      .map((row) => ({
        notification_key: row.notification_key,
        in_app_enabled: row.in_app_enabled,
        email_enabled: row.email_enabled,
        in_app_mandatory: row.in_app_mandatory,
        email_mandatory: row.email_mandatory,
        updated_by: auth.user!.id,
        updated_at: new Date().toISOString(),
      }))

    if (payload.length === 0) {
      return NextResponse.json({ error: "No valid notification keys provided" }, { status: 400 })
    }

    for (const row of payload) {
      if (row.in_app_enabled === false && row.in_app_mandatory === true) {
        return NextResponse.json(
          { error: `In-app mandatory cannot be enabled while in-app delivery is disabled (${row.notification_key})` },
          { status: 400 }
        )
      }
      if (row.email_enabled === false && row.email_mandatory === true) {
        return NextResponse.json(
          { error: `Email mandatory cannot be enabled while email delivery is disabled (${row.notification_key})` },
          { status: 400 }
        )
      }
    }

    const admin = getServiceRoleClientOrFallback(supabase)

    const { error } = await admin.from("notification_delivery_policies").upsert(payload, {
      onConflict: "notification_key",
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "notification_policy",
        entityId: "bulk",
        newValues: { updated_keys: payload.map((r) => r.notification_key) },
        context: { actorId: auth.user!.id, source: "api", route: "/api/admin/settings/mail" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "An error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
