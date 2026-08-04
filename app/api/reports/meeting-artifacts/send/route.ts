import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope, getDepartmentScope } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"

const log = logger("api-meeting-artifact-send")

type AdminScope = NonNullable<Awaited<ReturnType<typeof resolveAdminScope>>>

function hasGlobalReportsWriteAccess(scope: AdminScope): boolean {
  return getDepartmentScope(scope, "general") === null
}

/**
 * Manually email an already-stored occurrence (latest or a chosen week) of a
 * meeting's attendance and/or transcript to its configured recipients.
 * Delegates to the sync-meeting-artifacts edge function (service role + Resend).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can send meeting artifacts" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const sourceId = String(body?.sourceId || "")
    if (!sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 })

    const includeAttendance = body?.includeAttendance !== false
    const includeTranscript = body?.includeTranscript !== false
    if (!includeAttendance && !includeTranscript) {
      return NextResponse.json({ error: "Select attendance and/or transcript" }, { status: 400 })
    }

    // occurrence: "latest" or { week, year }
    let occurrence: "latest" | { week: number; year: number } = "latest"
    if (body?.week && body?.year) {
      occurrence = { week: Number(body.week), year: Number(body.year) }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase environment is not configured" }, { status: 503 })
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/sync-meeting-artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ send: { sourceId, occurrence, includeAttendance, includeTranscript } }),
    })

    const payload = await res.json().catch(() => ({}))
    if (!res.ok) return NextResponse.json({ error: payload?.error || "Send failed" }, { status: 502 })
    if (!payload?.sent) {
      return NextResponse.json({ error: payload?.reason || "Nothing was sent" }, { status: 422 })
    }

    return NextResponse.json({ data: payload })
  } catch (error) {
    log.error({ err: String(error) }, "POST meeting-artifact send failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
