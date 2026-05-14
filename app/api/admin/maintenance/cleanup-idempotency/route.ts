import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"

export async function POST() {
  const rl = await rateLimit("admin-maintenance-cleanup-idempotency", { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response

  const role = String(scopeResult.scope.role || "").toLowerCase()
  if (!["developer", "super_admin"].includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await dataClient.rpc("cleanup_expired_idempotency_keys")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ cleaned: Number(data || 0) })
}
