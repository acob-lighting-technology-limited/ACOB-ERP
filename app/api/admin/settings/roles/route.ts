import { NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"

const log = logger("admin-settings-roles")
export const dynamic = "force-dynamic"

// Roles administration is org-wide and admin-only (settings). Scope is resolved
// server-side; the browser no longer queries Supabase directly (see AGENTS.md).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const db = getServiceRoleClientOrFallback(supabase)

  const { data, error } = await db.from("roles").select("*").order("name")
  if (error) {
    // Table absent (fresh env) — signal the client to use its built-in defaults.
    if (error.code === "42P01" || error.message?.includes("relation")) {
      return NextResponse.json({ data: null, fallback: true })
    }
    log.error({ err: error.message }, "failed to load roles")
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: profiles } = await db.from("profiles").select("role")
  const roleCounts = new Map<string, number>()
  for (const p of profiles ?? []) {
    const role = (p as { role?: string | null }).role
    if (role) roleCounts.set(role, (roleCounts.get(role) || 0) + 1)
  }

  const roles = (data ?? []).map((r) => ({
    ...(r as Record<string, unknown>),
    user_count: roleCounts.get((r as { name?: string }).name ?? "") || 0,
  }))

  return NextResponse.json({ data: roles })
}
