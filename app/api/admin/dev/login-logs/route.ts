import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { REAUTH_SOURCE } from "@/lib/auth/login-log"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type LoginLogsClient = Awaited<ReturnType<typeof createClient>>

const DEFAULT_DAYS = 90
const MAX_DAYS = 730
const ROW_LIMIT = 5000

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-login-logs:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase as LoginLogsClient, user.id)
  if (!scope || !canAccessAdminSection(scope, "dev")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase as LoginLogsClient)

  const fetchType = request.nextUrl.searchParams.get("type")
  const targetUserId = request.nextUrl.searchParams.get("user_id")
  const department = request.nextUrl.searchParams.get("department")

  if (fetchType === "audit" && targetUserId) {
    const { data: auditLogs, error: auditError } = await dataClient
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, created_at, metadata")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false })
      .limit(50)

    if (auditError) {
      return NextResponse.json({ error: auditError.message }, { status: 500 })
    }

    return NextResponse.json({ data: auditLogs || [] })
  }

  if (fetchType === "dashboard-audit") {
    let query = dataClient
      .from("audit_logs")
      .select("id, action, entity_type, entity_id, created_at, metadata, department, user_id")
      .order("created_at", { ascending: false })
      .limit(1000)

    if (targetUserId && targetUserId !== "all") {
      query = query.eq("user_id", targetUserId)
    } else if (department && department !== "all") {
      query = query.eq("department", department)
    }

    const { data: auditLogs, error: auditError } = await query

    if (auditError) {
      return NextResponse.json({ error: auditError.message }, { status: 500 })
    }

    return NextResponse.json({ data: auditLogs || [] })
  }

  // `days=all` lifts the window; anything else is clamped to a sane range so a
  // large table can't be pulled in one request.
  const rawDays = request.nextUrl.searchParams.get("days")
  const allTime = rawDays === "all"
  const parsedDays = Number.parseInt(rawDays || "", 10)
  const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), MAX_DAYS) : DEFAULT_DAYS

  let query = dataClient
    .from("dev_login_logs_enriched")
    .select("id, user_id, email, full_name, role, department, ip_address, user_agent, auth_method, login_at, metadata")
    .order("login_at", { ascending: false })
    .limit(ROW_LIMIT)

  if (!allTime) {
    query = query.gte("login_at", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data || []

  // Re-auth rows exist only for audit-log reconciliation — they are password
  // checks, not sign-ins, so they must not inflate the login stats. Filtered
  // here rather than in the query because `neq` on a JSON key would also drop
  // legacy rows whose metadata has no `source` (NULL != 'reauth' is NULL).
  const logins = rows
    .filter((row) => (row.metadata as { source?: string } | null)?.source !== REAUTH_SOURCE)
    .map(({ metadata: _metadata, ...row }) => row)

  return NextResponse.json({
    data: logins,
    meta: {
      days: allTime ? null : days,
      limit: ROW_LIMIT,
      truncated: rows.length >= ROW_LIMIT,
    },
  })
}
