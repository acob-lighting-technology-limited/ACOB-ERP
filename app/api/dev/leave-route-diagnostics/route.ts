/**
 * GET /api/dev/leave-route-diagnostics
 *
 * Validates all leave_approval_role_routes and their resolvers.
 * For each (requester_kind, stage) combination it reports whether
 * the approver can actually be resolved right now.
 *
 * Protected: developer role only.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js"
import { DEPT_EXECUTIVE_MANAGEMENT, DEPT_CORPORATE_SERVICES, DEPT_ADMIN_HR } from "@/config/constants"
import { isSameDepartment } from "@/shared/departments"

const DEPARTMENT_NAMES: Record<string, string> = {
  admin_hr_lead: DEPT_ADMIN_HR,
  md: DEPT_EXECUTIVE_MANAGEMENT,
  hcs: DEPT_CORPORATE_SERVICES,
}

type DiagRow = {
  requester_kind: string
  stage_order: number
  approver_role_code: string
  resolved: boolean
  resolved_user_id?: string | null
  resolved_name?: string | null
  fail_reason?: string
}

type LeaveResolverProfile = {
  id: string
  full_name?: string | null
  department?: string | null
  lead_departments?: string[] | null
  is_department_lead?: boolean | null
}

type LeaveApproverAssignmentRow = {
  user_id: string
  effective_from?: string | null
  effective_to?: string | null
  profiles?: {
    full_name?: string | null
  } | null
}

type LeaveRouteRow = {
  requester_kind: string
  stage_order: number
  approver_role_code: string
  is_active: boolean
}

async function tryResolve(
  admin: SupabaseClient,
  roleCode: string,
  dummyRelieverId = "00000000-0000-0000-0000-000000000000"
): Promise<{ id: string; name: string | null } | null> {
  if (roleCode === "reliever") {
    // Reliever is per-request; for diagnostics just mark as "dynamic"
    return { id: dummyRelieverId, name: "(dynamic — set per request)" }
  }

  if (roleCode === "department_lead") {
    // Department lead also dynamic per requester; mark as such
    return { id: "dynamic", name: "(dynamic — resolved per requester's department)" }
  }

  const departmentName = DEPARTMENT_NAMES[roleCode]
  if (departmentName) {
    // Try to find a profile with is_department_lead=true for this department
    const { data, error } = await admin
      .from("profiles")
      .select("id, full_name, department, lead_departments, is_department_lead")
      .eq("is_department_lead", true)

    if (error) return null

    const match = ((data || []) as LeaveResolverProfile[]).find((p) => {
      const managed = Array.isArray(p.lead_departments) ? p.lead_departments : []
      return (
        p.is_department_lead &&
        (isSameDepartment(p.department, departmentName) ||
          managed.some((dept) => isSameDepartment(dept, departmentName)))
      )
    })

    if (!match) return null
    if (
      ((data || []) as LeaveResolverProfile[]).filter((p) => {
        const managed = Array.isArray(p.lead_departments) ? p.lead_departments : []
        return (
          p.is_department_lead &&
          (isSameDepartment(p.department, departmentName) ||
            managed.some((dept) => isSameDepartment(dept, departmentName)))
        )
      }).length > 1
    ) {
      return null // conflict
    }
    return { id: match.id, name: match.full_name || null }
  }

  // Fixed role from leave_approver_assignments table
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from("leave_approver_assignments")
    .select(
      "user_id, effective_from, effective_to, is_primary, profiles:profiles!leave_approver_assignments_user_id_fkey(full_name)"
    )
    .eq("approver_role_code", roleCode)
    .eq("is_active", true)
    .eq("scope_type", "global")
    .order("is_primary", { ascending: false })

  if (error || !data?.length) return null

  const valid = ((data || []) as LeaveApproverAssignmentRow[]).filter((row) => {
    const startsOk = !row.effective_from || row.effective_from <= now
    const endsOk = !row.effective_to || row.effective_to >= now
    return startsOk && endsOk
  })

  if (!valid.length) return null
  const top = valid[0]
  return {
    id: top.user_id,
    name: top.profiles?.full_name || null,
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: actorProfile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (actorProfile?.role !== "developer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 })
  }

  const admin = createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const db = admin as unknown as SupabaseClient

  // Fetch all route rows
  const { data: routeRows, error: routeError } = await db
    .from("leave_approval_role_routes")
    .select("requester_kind, stage_order, approver_role_code, is_active")
    .order("requester_kind")
    .order("stage_order")

  if (routeError) {
    return NextResponse.json({ error: `Failed to load routes: ${routeError.message}` }, { status: 500 })
  }

  const results: DiagRow[] = []

  for (const row of (routeRows || []) as LeaveRouteRow[]) {
    if (!row.is_active) {
      results.push({
        requester_kind: row.requester_kind,
        stage_order: row.stage_order,
        approver_role_code: row.approver_role_code,
        resolved: false,
        fail_reason: "Stage is inactive (is_active = false)",
      })
      continue
    }

    try {
      const resolved = await tryResolve(db, row.approver_role_code)
      results.push({
        requester_kind: row.requester_kind,
        stage_order: row.stage_order,
        approver_role_code: row.approver_role_code,
        resolved: resolved !== null,
        resolved_user_id: resolved?.id ?? null,
        resolved_name: resolved?.name ?? null,
        fail_reason: resolved ? undefined : `No active approver found for role "${row.approver_role_code}"`,
      })
    } catch (e: unknown) {
      results.push({
        requester_kind: row.requester_kind,
        stage_order: row.stage_order,
        approver_role_code: row.approver_role_code,
        resolved: false,
        fail_reason: e instanceof Error ? e.message : "Unknown error during resolution",
      })
    }
  }

  const broken = results.filter((r) => !r.resolved)
  return NextResponse.json({ results, broken_count: broken.length, total: results.length })
}
