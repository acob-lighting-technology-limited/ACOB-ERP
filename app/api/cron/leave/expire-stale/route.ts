import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("cron-leave-expire-stale")

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Auto-archive leave requests whose period has fully passed but were never actioned —
 * they shouldn't linger in the approval queue. Pending leave has not consumed any
 * balance (balance is drawn down on approval), so no balance restore is needed. The
 * request is moved to "cancelled" with a clear note and stays visible under History.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`
  if (!safeCompare(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Missing configuration" }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const today = toLocalISODate()

  const { data, error } = await supabase
    .from("leave_requests")
    .update({
      status: "cancelled",
      approval_stage: "cancelled",
      current_stage_code: "cancelled",
      rejected_reason: "Auto-archived: leave period passed without action",
      updated_at: new Date().toISOString(),
    })
    .in("status", ["pending", "pending_evidence"])
    .lt("end_date", today)
    .select("id, user_id, start_date, end_date")

  if (error) {
    log.error({ err: String(error) }, "Failed to expire stale leave requests")
    return NextResponse.json({ error: "Failed to expire requests" }, { status: 500 })
  }

  const rows = (data ?? []) as Array<{ id: string; user_id: string; start_date: string; end_date: string }>
  for (const row of rows) {
    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "leave_request",
        entityId: row.id,
        newValues: {
          user_id: row.user_id,
          status: "cancelled",
          start_date: row.start_date,
          end_date: row.end_date,
          reason: "Auto-archived: leave period passed without action",
        },
        context: { actorId: undefined, source: "system", route: "/api/cron/leave/expire-stale" },
      },
      { failOpen: true }
    )
  }

  log.info({ count: rows.length, today }, "Auto-archived stale leave requests")
  return NextResponse.json({ archived: rows.length })
}
