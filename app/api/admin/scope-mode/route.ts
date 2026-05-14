import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ADMIN_SCOPE_MODE_COOKIE, resolveAdminScope, type AdminScopeMode } from "@/lib/admin/rbac"
import { getClientId, rateLimit } from "@/lib/rate-limit"

function normalizeMode(value: string | undefined): AdminScopeMode {
  return value === "lead" ? "lead" : "global"
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return NextResponse.json({
    mode: scope.scopeMode,
    canToggleLeadScope: scope.canToggleLeadScope,
    managedDepartments: scope.managedDepartments,
  })
}

export async function POST(request: Request) {
  const rl = await rateLimit(`admin-scope-mode:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const payload = (await request.json().catch(() => null)) as { mode?: string } | null
  const requestedMode = normalizeMode(payload?.mode)
  const nextMode: AdminScopeMode = scope.canToggleLeadScope ? requestedMode : "global"

  const response = NextResponse.json({
    ok: true,
    mode: nextMode,
    canToggleLeadScope: scope.canToggleLeadScope,
  })

  response.cookies.set(ADMIN_SCOPE_MODE_COOKIE, nextMode, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  })

  return response
}
