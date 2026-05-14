import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope, type AdminScope } from "@/lib/admin/api-scope"

const log = logger("goal-linked-tasks-route")

const LinkTasksSchema = z.object({
  task_ids: z.array(z.string().uuid()).min(1),
})

type GoalRecord = {
  id: string
  user_id: string
  department?: string | null
}

type ProfileRecord = {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

function isAdmin(scope: AdminScope | null) {
  return scope?.isAdminLike === true && scope.scopeMode !== "lead"
}

function canLead(profile: ProfileRecord | null, department: string | null | undefined) {
  if (!profile?.is_department_lead || !department) return false
  const leadDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
  return profile.department === department || leadDepartments.includes(department)
}

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const [{ data: goal }, { data: profile }] = await Promise.all([
      supabase.from("goals_objectives").select("id, user_id, department").eq("id", params.id).single<GoalRecord>(),
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ProfileRecord>(),
    ])

    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })
    const getScope = await getRequestScope()
    if (goal.user_id !== user.id && !isAdmin(getScope) && !canLead(profile ?? null, goal.department)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("id, title, status, work_item_number, source_type, priority, due_date, completed_at")
      .eq("goal_id", params.id)
      .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: tasks || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in goal linked tasks GET")
    return NextResponse.json({ error: "Failed to fetch linked tasks" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`hr-performance-goals-tasks:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

    const parsed = LinkTasksSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const [{ data: goal }, { data: profile }] = await Promise.all([
      supabase.from("goals_objectives").select("id, user_id, department").eq("id", params.id).single<GoalRecord>(),
      supabase
        .from("profiles")
        .select("role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ProfileRecord>(),
    ])

    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 })
    const postScope = await getRequestScope()
    if (!isAdmin(postScope) && !canLead(profile ?? null, goal.department)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: linkedTasks, error } = await supabase
      .from("tasks")
      .update({ goal_id: params.id, updated_at: new Date().toISOString() })
      .in("id", parsed.data.task_ids)
      .select("id")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase,
      {
        action: "goal.link_tasks",
        entityType: "goal",
        entityId: params.id,
        newValues: { task_ids: parsed.data.task_ids },
        context: { actorId: user.id, source: "api", route: "/api/hr/performance/goals/[id]/tasks" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ linked_count: linkedTasks?.length || 0 })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in goal linked tasks POST")
    return NextResponse.json({ error: "Failed to link tasks" }, { status: 500 })
  }
}
