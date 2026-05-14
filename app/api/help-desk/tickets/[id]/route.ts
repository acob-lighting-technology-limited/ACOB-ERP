import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  HELP_DESK_STATUSES,
  appendAuditLog,
  appendHelpDeskEvent,
  canLeadDepartment,
  getAuthContext,
  isAdminRole,
  syncHelpDeskTicketTask,
} from "@/lib/help-desk/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { sendHelpDeskMail } from "@/lib/help-desk/mailer"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("help-desk-ticket")
export const dynamic = "force-dynamic"
const VALID_HD_TRANSITIONS: Record<string, string[]> = {
  new: ["assigned", "department_queue", "cancelled"],
  department_queue: ["department_assigned", "assigned", "cancelled"],
  department_assigned: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["resolved", "returned", "cancelled", "paused"],
  paused: ["in_progress", "cancelled"],
  resolved: ["closed", "in_progress"],
  returned: ["in_progress"],
  closed: [],
  cancelled: [],
  pending_approval: ["approved_for_procurement", "rejected"],
  approved_for_procurement: ["assigned", "cancelled"],
  rejected: ["new"],
  pending_lead_review: ["department_queue", "assigned", "cancelled"],
}
const DEPARTMENT_WORKFLOW_STATUSES = new Set([
  "department_queue",
  "department_assigned",
  "pending_lead_review",
  "pending_approval",
  "approved_for_procurement",
])
const UpdateHelpDeskTicketSchema = z.object({
  status: z.enum(HELP_DESK_STATUSES).optional(),
  status_note: z.string().optional().nullable(),
  csat_rating: z
    .number()
    .min(1, "CSAT rating must be between 1 and 5")
    .max(5, "CSAT rating must be between 1 and 5")
    .optional(),
  csat_feedback: z.string().optional().nullable(),
})

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: ticket, error } = await supabase.from("help_desk_tickets").select("*").eq("id", params.id).single()

    if (error || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    const getScope = await getRequestScope()
    const isGlobalAdmin = isAdminRole(profile.role) && getScope?.scopeMode !== "lead"
    const canView =
      isGlobalAdmin ||
      canLeadDepartment(profile, ticket.service_department) ||
      canLeadDepartment(profile, ticket.requester_department) ||
      ticket.requester_id === user.id ||
      ticket.assigned_to === user.id

    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const [commentsRes, approvalsRes, eventsRes] = await Promise.all([
      supabase
        .from("help_desk_comments")
        .select("*")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("help_desk_approvals")
        .select("*")
        .eq("ticket_id", ticket.id)
        .order("requested_at", { ascending: true }),
      supabase.from("help_desk_events").select("*").eq("ticket_id", ticket.id).order("created_at", { ascending: true }),
    ])

    return NextResponse.json({
      data: {
        ticket,
        comments: commentsRes.data || [],
        approvals: approvalsRes.data || [],
        events: eventsRes.data || [],
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET")
    return NextResponse.json({ error: "Failed to fetch ticket" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`help-desk-tickets:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("help_desk_tickets")
      .select("*")
      .eq("id", params.id)
      .single()

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    const body = await request.json()
    const parsed = UpdateHelpDeskTicketSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const nextStatus = parsed.data.status ? String(parsed.data.status) : null
    const statusNote = parsed.data.status_note ? String(parsed.data.status_note).trim() : null
    const csatRating = parsed.data.csat_rating
    const csatFeedback = parsed.data.csat_feedback ? String(parsed.data.csat_feedback) : null

    const patchScope = await getRequestScope()
    const isGlobalAdminPatch = isAdminRole(profile.role) && patchScope?.scopeMode !== "lead"
    const canManageWorkflow =
      isGlobalAdminPatch ||
      canLeadDepartment(profile, ticket.service_department) ||
      canLeadDepartment(profile, ticket.requester_department) ||
      ticket.assigned_to === user.id
    const canLeadWorkflow =
      isGlobalAdminPatch ||
      canLeadDepartment(profile, ticket.service_department) ||
      canLeadDepartment(profile, ticket.requester_department)
    const isDepartmentTicket =
      String(ticket.handling_mode || "") === "queue" || DEPARTMENT_WORKFLOW_STATUSES.has(String(ticket.status || ""))

    const canRateTicket = ticket.requester_id === user.id

    if (nextStatus && !canManageWorkflow) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (nextStatus && isDepartmentTicket && !canLeadWorkflow) {
      return NextResponse.json(
        { error: "Department help desk tickets can only be updated by leads/admin from Admin Help Desk" },
        { status: 403 }
      )
    }

    const updates: Record<string, unknown> = {}

    if (nextStatus) {
      const currentStatus = String(ticket.status)
      const allowed = VALID_HD_TRANSITIONS[currentStatus] || []
      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          { error: `Cannot transition from "${currentStatus}" to "${nextStatus}"` },
          { status: 400 }
        )
      }

      if (["in_progress", "resolved", "closed"].includes(nextStatus)) {
        const taskId = String(ticket.task_id || "")
        if (!taskId) {
          return NextResponse.json(
            { error: "This help desk item must be linked to a department goal before work can continue" },
            { status: 400 }
          )
        }

        const { data: linkedTask } = await supabase
          .from("tasks")
          .select("id, goal_id")
          .eq("id", taskId)
          .maybeSingle<{ id: string; goal_id?: string | null }>()

        if (!linkedTask?.goal_id) {
          return NextResponse.json(
            { error: "Link this help desk item to a department goal before starting or resolving it" },
            { status: 400 }
          )
        }
      }

      updates.status = nextStatus
      if (nextStatus === "in_progress" && !ticket.started_at) {
        updates.started_at = new Date().toISOString()
      }
      if (nextStatus === "resolved") {
        updates.resolved_at = new Date().toISOString()
      }
      if (nextStatus === "closed") {
        updates.closed_at = new Date().toISOString()
      }
    }

    if (typeof csatRating === "number") {
      if (!canRateTicket) {
        return NextResponse.json({ error: "Only requester can rate a ticket" }, { status: 403 })
      }
      if (!["resolved", "closed"].includes(String(ticket.status || "").toLowerCase())) {
        return NextResponse.json({ error: "Ticket can only be rated after it is resolved or closed" }, { status: 400 })
      }
      if (csatRating < 1 || csatRating > 5) {
        return NextResponse.json({ error: "CSAT rating must be between 1 and 5" }, { status: 400 })
      }
      updates.csat_rating = csatRating
      updates.csat_feedback = csatFeedback
    }

    if (!nextStatus && typeof csatRating !== "number") {
      return NextResponse.json({ error: "No valid update provided" }, { status: 400 })
    }

    const { data: updated, error: updateError } = await supabase
      .from("help_desk_tickets")
      .update(updates)
      .eq("id", params.id)
      .select("*")
      .single()

    if (updateError) throw updateError

    if (nextStatus && statusNote) {
      const { error: commentError } = await supabase.from("help_desk_comments").insert({
        ticket_id: ticket.id,
        actor_id: user.id,
        body: statusNote,
      })

      if (commentError) throw commentError
    }

    const syncResult = nextStatus
      ? await syncHelpDeskTicketTask({
          ticket: updated,
          actorId: user.id,
        })
      : null
    const workItemNumber = syncResult?.workItemNumber || updated.ticket_number || ticket.ticket_number

    await appendHelpDeskEvent({
      ticketId: ticket.id,
      actorId: user.id,
      eventType: "ticket_updated",
      oldStatus: ticket.status,
      newStatus: updated.status,
      details: {
        ...updates,
        status_note: statusNote,
      },
    })

    const auditAction = nextStatus && nextStatus !== ticket.status ? "status_change" : "update"

    await appendAuditLog({
      actorId: user.id,
      action: auditAction,
      entityId: ticket.id,
      department: ticket.service_department,
      route: "/api/help-desk/tickets/[id]",
      critical: Boolean(nextStatus && nextStatus !== ticket.status),
      oldValues: { status: ticket.status, csat_rating: ticket.csat_rating },
      newValues: { status: updated.status, csat_rating: updated.csat_rating },
    })

    if (nextStatus === "resolved") {
      await supabase.rpc("create_notification", {
        p_user_id: ticket.requester_id,
        p_type: "task_completed",
        p_category: "tasks",
        p_title: "Ticket resolved",
        p_message: `${workItemNumber} has been resolved. Please review and rate the service.`,
        p_priority: "normal",
        p_link_url: "/help-desk",
        p_actor_id: user.id,
        p_entity_type: "help_desk_ticket",
        p_entity_id: ticket.id,
        p_rich_content: { ticket_number: workItemNumber },
      })

      try {
        await sendHelpDeskMail({
          userIds: [ticket.requester_id],
          subject: `Ticket Resolved: ${workItemNumber}`,
          title: "Help Desk Ticket Resolved",
          message: `${ticket.title} has been resolved. Please confirm and provide your service rating.`,
          ticketNumber: workItemNumber,
        })
      } catch (mailError) {
        log.error({ err: String(mailError) }, "Help desk mail error on resolve")
      }
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in PATCH")
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 })
  }
}
