import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type AcobotLogsClient = Awaited<ReturnType<typeof createClient>>

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-acobot-logs:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase as AcobotLogsClient, user.id)
  if (!scope || !canAccessAdminSection(scope, "dev")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Optional ?source=erp|website filter (the dev page has a tab per surface).
  const sourceParam = request.nextUrl.searchParams.get("source")
  const source = sourceParam === "website" ? "website" : sourceParam === "erp" ? "erp" : null

  const dataClient = getServiceRoleClientOrFallback(supabase as AcobotLogsClient)
  let query = dataClient
    .from("acobot_logs_enriched")
    .select(
      "id, user_id, source, email, full_name, role, department, question, answer, had_context, model, ip_address, user_agent, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(2000)

  if (source) query = query.eq("source", source)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}
