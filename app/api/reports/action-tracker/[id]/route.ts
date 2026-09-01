import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import {
  canEditActionContent,
  canUpdateActionProgress,
  type ActionTrackerScopeProfile,
} from "@/lib/reports/action-tracker-permissions"

const log = logger("action-tracker-item-route")

const ActionStatusSchema = z.object({
  status: z.enum(["not_started", "pending", "in_progress", "completed"]).optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  priority: z.string().trim().min(1).optional(),
  department: z.string().trim().min(1).optional(),
  week_number: z.number().int().min(1).max(53).optional(),
  year: z.number().int().min(2000).max(9999).optional(),
  // Management directive fields — ignored for tasks and for report-derived items.
  meeting_date: z.string().trim().min(1).optional().nullable(),
  timeline_text: z.string().trim().optional().nullable(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  // Hindrance reporting — applies to every action item, not just directives.
  // Sending null or an empty string clears a previously reported hindrance.
  blocker_note: z.string().trim().optional().nullable(),
})

type ActionEntity = {
  table: "action_items" | "tasks"
  entityType: "action_item" | "task"
  item: Record<string, unknown> & { id: string; department?: string | null }
  /** Named responsible staff. Always empty for anything but a management directive. */
  assigneeIds: string[]
}

/** Fields that describe the item itself, as opposed to progress against it. */
const CONTENT_FIELDS = [
  "title",
  "description",
  "priority",
  "department",
  "week_number",
  "year",
  "meeting_date",
  "timeline_text",
  "assignee_ids",
] as const

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
      assigneeIds: [],
    }
  }

  const { data: actionItem } = await supabase.from("action_items").select("*").eq("id", id).maybeSingle()
  if (!actionItem) return null

  // Named responsible staff decide who may move a directive, so they are loaded
  // before the permission check rather than only when the assignee list changes.
  let assigneeIds: string[] = []
  if (String(actionItem.origin) === "management_directive") {
    const { data: assignees } = await supabase
      .from("action_item_assignees")
      .select("profile_id")
      .eq("action_item_id", id)
      .returns<{ profile_id: string }[]>()
    assigneeIds = (assignees || []).map((row) => String(row.profile_id))
  }

  return {
    table: "action_items",
    entityType: "action_item",
    item: actionItem as Record<string, unknown> & { id: string; department?: string | null },
    assigneeIds,
  }
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
        .select("id, role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ActionTrackerScopeProfile>(),
      findActionEntity(supabase, params.id),
    ])

    if (!entity) return NextResponse.json({ error: "Action item not found" }, { status: 404 })

    const scope = {
      department: entity.item.department,
      origin: String(entity.item.origin || ""),
      assigneeIds: entity.assigneeIds,
    }
    const canEditContent = canEditActionContent(profile ?? null, scope)
    const canUpdateProgress = canUpdateActionProgress(profile ?? null, scope)

    if (!canEditContent && !canUpdateProgress) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const touchesContent = CONTENT_FIELDS.some((field) => typeof parsed.data[field] !== "undefined")
    if (touchesContent && !canEditContent) {
      return NextResponse.json(
        { error: "You can report progress on this directive, but not edit it." },
        { status: 403 }
      )
    }

    const touchesProgress = typeof parsed.data.status !== "undefined" || typeof parsed.data.blocker_note !== "undefined"
    if (touchesProgress && !canUpdateProgress) {
      return NextResponse.json(
        { error: "This directive is assigned to named staff. Only they can update its status." },
        { status: 403 }
      )
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

    // Only action_items carries hindrance columns; tasks rows have their own model.
    if (entity.table === "action_items" && typeof parsed.data.blocker_note !== "undefined") {
      const note = parsed.data.blocker_note?.trim() || null
      updates.blocker_note = note
      // Clearing the note clears the attribution with it, so a stale reporter is
      // never left attached to an item with nothing reported.
      updates.blocker_reported_at = note ? new Date().toISOString() : null
      updates.blocker_reported_by = note ? user.id : null
    }

    const isDirective = entity.table === "action_items" && String(entity.item.origin) === "management_directive"
    if (isDirective) {
      if (typeof parsed.data.meeting_date !== "undefined") updates.meeting_date = parsed.data.meeting_date || null
      if (typeof parsed.data.timeline_text !== "undefined") updates.timeline_text = parsed.data.timeline_text || null
    }

    // RLS on action_items grants UPDATE to admins and department leads only. A
    // tagged assignee outside that set is authorised here, on the progress fields
    // this route controls, so their write goes through the data client instead.
    const writeClient = canEditContent ? supabase : getServiceRoleClientOrFallback(supabase)

    const { data: updatedItem, error } = await writeClient
      .from(entity.table)
      .update(updates)
      .eq("id", params.id)
      .select("*")
      .single()

    if (error || !updatedItem) {
      return NextResponse.json({ error: error?.message || "Failed to update action item" }, { status: 500 })
    }

    // Responsible staff are replaced wholesale — the dialog always submits the
    // full list, so a removed name has to disappear rather than linger.
    if (isDirective && parsed.data.assignee_ids) {
      const assigneeIds = Array.from(new Set(parsed.data.assignee_ids))
      await supabase.from("action_item_assignees").delete().eq("action_item_id", params.id)
      if (assigneeIds.length > 0) {
        const { error: assigneeError } = await supabase
          .from("action_item_assignees")
          .insert(assigneeIds.map((profileId) => ({ action_item_id: params.id, profile_id: profileId })))
        if (assigneeError) {
          log.error({ err: assigneeError.message, itemId: params.id }, "Failed to update directive assignees")
        }
      }
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
        .select("id, role, department, is_department_lead, lead_departments")
        .eq("id", user.id)
        .single<ActionTrackerScopeProfile>(),
      findActionEntity(supabase, params.id),
    ])

    if (!entity) return NextResponse.json({ error: "Action item not found" }, { status: 404 })
    // Deleting is editing the record, not reporting against it: being tagged on a
    // directive never grants the right to remove it.
    if (!canEditActionContent(profile ?? null, { department: entity.item.department })) {
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
