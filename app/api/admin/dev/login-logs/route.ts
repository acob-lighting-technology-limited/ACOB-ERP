import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type LoginLogsClient = Awaited<ReturnType<typeof createClient>>

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
  const { data, error } = await dataClient
    .from("dev_login_logs")
    .select("id, email, full_name, role, ip_address, user_agent, auth_method, login_at")
    .order("login_at", { ascending: false })
    .limit(2000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}
