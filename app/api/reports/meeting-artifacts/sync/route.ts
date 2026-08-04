import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope, getDepartmentScope } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"

const log = logger("api-meeting-artifact-sync")

type AdminScope = NonNullable<Awaited<ReturnType<typeof resolveAdminScope>>>

function hasGlobalReportsWriteAccess(scope: AdminScope): boolean {
  return getDepartmentScope(scope, "general") === null
}

/**
 * Manual "Sync now" trigger — invokes the sync-meeting-artifacts edge function
 * with { force: true } so an admin can pull artifacts without waiting for the
 * cron or for the meeting-day gate.
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can run meeting sync" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase environment is not configured" }, { status: 503 })
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/sync-meeting-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ force: true }),
    })

    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json({ error: payload?.error || "Sync failed" }, { status: 502 })
    }

    return NextResponse.json({ data: payload })
  } catch (error) {
    log.error({ err: String(error) }, "POST meeting-artifact sync failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
