import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("hr-leave-flow")

type LeaveApproverRoleInput = {
  code: string
  name?: string | null
  description?: string | null
  resolution_mode?: string | null
  resolution_config?: Record<string, unknown> | null
  is_active?: boolean | null
}

type LeaveApprovalRouteInput = {
  requester_kind: string
  stage_order: number
  approver_role_code: string
  is_active?: boolean | null
}

type LeaveApproverAssignmentInput = {
  approver_role_code: string
  user_id: string
  scope_type?: string | null
  scope_value?: string | null
  effective_from?: string | null
  effective_to?: string | null
  is_active?: boolean | null
  is_primary?: boolean | null
}

const LeaveApproverRoleSchema = z.object({
  code: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  resolution_mode: z.string().nullable().optional(),
  resolution_config: z.record(z.unknown()).nullable().optional(),
  is_active: z.boolean().nullable().optional(),
})

const LeaveApprovalRouteSchema = z.object({
  requester_kind: z.string(),
  stage_order: z.coerce.number(),
  approver_role_code: z.string(),
  is_active: z.boolean().nullable().optional(),
})

const LeaveApproverAssignmentSchema = z.object({
  approver_role_code: z.string(),
  user_id: z.string(),
  scope_type: z.string().nullable().optional(),
  scope_value: z.string().nullable().optional(),
  effective_from: z.string().nullable().optional(),
  effective_to: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
})

const UpdateLeaveFlowSchema = z.object({
  roles: z.array(LeaveApproverRoleSchema).optional(),
  routes: z.array(LeaveApprovalRouteSchema).optional(),
  assignments: z.array(LeaveApproverAssignmentSchema).optional(),
})

function canViewFlow(role?: string | null) {
  return ["developer", "super_admin", "admin"].includes(role || "")
}

function canEditFlow(role?: string | null) {
  return ["developer", "super_admin"].includes(role || "")
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (!canViewFlow(profile?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const [rolesRes, routesRes, assignmentsRes, healthRes] = await Promise.all([
      supabase.from("leave_approver_roles").select("*").order("code"),
      supabase.from("leave_approval_role_routes").select("*").order("requester_kind").order("stage_order"),
      supabase
        .from("leave_approver_assignments")
        .select(
          "id, approver_role_code, user_id, scope_type, scope_value, effective_from, effective_to, is_active, is_primary"
        )
        .order("approver_role_code"),
      supabase.from("leave_routing_health_v").select("*").limit(1),
    ])

    if (rolesRes.error || routesRes.error || assignmentsRes.error || healthRes.error) {
      return NextResponse.json({ error: "Failed to load leave flow configuration" }, { status: 500 })
    }

    return NextResponse.json({
      data: {
        roles: rolesRes.data || [],
        routes: routesRes.data || [],
        assignments: assignmentsRes.data || [],
        health: healthRes.data?.[0] || null,
      },
      permissions: {
        can_edit: canEditFlow(profile?.role),
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/flow:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-leave-flow:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (!canEditFlow(profile?.role)) {
      return NextResponse.json({ error: "Only super admin or developer can edit leave flow" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = UpdateLeaveFlowSchema.safeParse(body || {})
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const { roles, routes, assignments } = parsed.data

    if (Array.isArray(roles) && roles.length) {
      const payload = (roles as LeaveApproverRoleInput[]).map((row) => ({
        code: String(row.code),
        name: String(row.name || row.code),
        description: row.description || null,
        resolution_mode: row.resolution_mode || "rule_based",
        resolution_config: row.resolution_config || {},
        is_active: row.is_active ?? true,
      }))
      const { error } = await supabase.from("leave_approver_roles").upsert(payload, { onConflict: "code" })
      if (error) return NextResponse.json({ error: "Failed to save approver roles" }, { status: 500 })
    }

    if (Array.isArray(routes) && routes.length) {
      const payload = (routes as LeaveApprovalRouteInput[]).map((row) => ({
        requester_kind: String(row.requester_kind),
        stage_order: Number(row.stage_order),
        approver_role_code: String(row.approver_role_code),
        is_active: row.is_active ?? true,
      }))

      const { error } = await supabase.from("leave_approval_role_routes").upsert(payload, {
        onConflict: "requester_kind,stage_order",
      })
      if (error) return NextResponse.json({ error: "Failed to save route rows" }, { status: 500 })
    }

    if (Array.isArray(assignments) && assignments.length) {
      const payload = (assignments as LeaveApproverAssignmentInput[]).map((row) => ({
        approver_role_code: String(row.approver_role_code),
        user_id: String(row.user_id),
        scope_type: row.scope_type || "global",
        scope_value: row.scope_value || null,
        effective_from: row.effective_from || null,
        effective_to: row.effective_to || null,
        is_active: row.is_active ?? true,
        is_primary: row.is_primary ?? true,
      }))

      const { error } = await supabase.from("leave_approver_assignments").upsert(payload)
      if (error) return NextResponse.json({ error: "Failed to save assignments" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "leave_flow_config",
        entityId: "bulk",
        newValues: {
          roles_count: Array.isArray(roles) ? roles.length : 0,
          routes_count: Array.isArray(routes) ? routes.length : 0,
          assignments_count: Array.isArray(assignments) ? assignments.length : 0,
        },
        context: { actorId: user.id, source: "api", route: "/api/hr/leave/flow" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message: "Leave flow configuration saved" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/leave/flow:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-leave-flow:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(request)
}
