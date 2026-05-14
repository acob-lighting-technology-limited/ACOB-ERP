import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("action-tracker-item-route")

const ActionStatusSchema = z.object({
  status: z.enum(["not_started", "pending", "in_progress", "completed"]).optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  priority: z.string().trim().min(1).optional(),
  department: z.string().trim().min(1).optional(),
  week_number: z.number().int().min(1).max(53).optional(),
  year: z.number().int().min(2000).max(9999).optional(),
})

type ScopeProfile = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

type ActionEntity =
  | {
      table: "action_items"
      entityType: "action_item"
      item: Record<string, unknown> & { id: string; department?: string | null }
    }
  | {
      table: "tasks"
      entityType: "task"
      item: Record<string, unknown> & { id: string; department?: string | null }
    }

function canManageDepartment(profile: ScopeProfile | null, department: string | null | undefined) {
  const role = String(profile?.role || "").toLowerCase()
  if (["developer", "super_admin", "admin"].includes(role)) return true
  if (!profile?.is_department_lead || !department) return false
  const leadDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  return profile.department === department || leadDepartments.includes(department)
}

async function findActionEntity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string
): Promise<ActionEntity | null> {
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("category", "weekly_action")
    .maybeSingle()
  if (task) {
    return {
      table: "tasks",
      entityType: "task",
      item: task as Record<string, unknown> & { id: string; department?: string | null },
    }
  }

  const { data: actionItem } = await supabase.from("action_items").select("*").eq("id", id).maybeSingle()
  if (actionItem) {
    return {
      table: "action_items",
      entityType: "action_item",
      item: actionItem as Record<string, unknown> & { id: string; department?: string | null },
    }
  }

  return null
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`reports-action-tracker:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

    const parsed = ActionStatusSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const [{ data: profile }, entity] = await Promise.all([
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ScopeProfile>(),
      findActionEntity(supabase, params.id),
    ])

    if (!entity) return NextResponse.json({ error: "Action item not found" }, { status: 404 })
    if (!canManageDepartment(profile ?? null, entity.item.department)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (parsed.data.status) {
      updates.status = parsed.data.status
    }
    if (parsed.data.title) updates.title = parsed.data.title
    if (typeof parsed.data.description !== "undefined") updates.description = parsed.data.description
    if (parsed.data.priority && entity.table === "tasks") updates.priority = parsed.data.priority
    if (parsed.data.department) updates.department = parsed.data.department
    if (parsed.data.week_number) updates.week_number = parsed.data.week_number
    if (parsed.data.year) updates.year = parsed.data.year
    if (parsed.data.status === "completed") {
      updates.completed_at = new Date().toISOString()
    }

    const { data: updatedItem, error } = await supabase
      .from(entity.table)
      .update(updates)
      .eq("id", params.id)
      .select("*")
      .single()

    if (error || !updatedItem) {
      return NextResponse.json({ error: error?.message || "Failed to update action item" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: `${entity.entityType}.update`,
        entityType: entity.entityType,
        entityId: params.id,
        newValues: parsed.data,
        context: { actorId: user.id, source: "api", route: "/api/reports/action-tracker/[id]" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: updatedItem })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in action tracker PATCH")
    return NextResponse.json({ error: "Failed to update action item" }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit("reports-action-tracker", { limit: 20, windowSec: 60 })
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

    const [{ data: profile }, entity] = await Promise.all([
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ScopeProfile>(),
      findActionEntity(supabase, params.id),
    ])

    if (!entity) return NextResponse.json({ error: "Action item not found" }, { status: 404 })
    if (!canManageDepartment(profile ?? null, entity.item.department)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { error } = await supabase.from(entity.table).delete().eq("id", params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase,
      {
        action: `${entity.entityType}.delete`,
        entityType: entity.entityType,
        entityId: params.id,
        oldValues: entity.item,
        context: { actorId: user.id, source: "api", route: "/api/reports/action-tracker/[id]" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in action tracker DELETE")
    return NextResponse.json({ error: "Failed to delete action item" }, { status: 500 })
  }
}
