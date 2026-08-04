import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"

const log = logger("admin-settings-roles")
export const dynamic = "force-dynamic"

const RoleUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  permissions: z.array(z.string()).default([]),
})

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

// Create or update a role.
export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = RoleUpsertSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const { id, name, description, permissions } = parsed.data
  const db = getServiceRoleClientOrFallback(supabase)

  if (id) {
    const { error } = await db
      .from("roles")
      .update({ name, description: description || null, permissions })
      .eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await db
      .from("roles")
      .insert({ name, description: description || null, permissions, is_system: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// Delete a non-system role.
export async function DELETE(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const id = request.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
  const db = getServiceRoleClientOrFallback(supabase)

  const { data: role } = await db.from("roles").select("is_system").eq("id", id).maybeSingle()
  if ((role as { is_system?: boolean } | null)?.is_system) {
    return NextResponse.json({ error: "Cannot delete system roles" }, { status: 400 })
  }
  const { error } = await db.from("roles").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
