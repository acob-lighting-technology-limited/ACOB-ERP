import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  appendAuditLog,
  appendHelpDeskEvent,
  getAuthContext,
  HelpDeskProfile,
  syncHelpDeskTicketTask,
} from "@/lib/help-desk/server"
import { sendHelpDeskMail } from "@/lib/help-desk/mailer"
import { getUnassignableReason } from "@/lib/workforce/assignment-policy"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("help-desk-tickets-assign")
const AssignHelpDeskTicketSchema = z.object({
  assigned_to: z.string().optional().nullable(),
  action: z.string().optional(),
})

function managesDepartmentStrict(profile: HelpDeskProfile, department: string | null | undefined) {
  if (!profile?.is_department_lead || !department) return false
  const managedDepartments = Array.isArray(profile?.managed_departments)
    ? profile.managed_departments
    : Array.isArray(profile?.lead_departments)
      ? profile.lead_departments
      : []
  return managedDepartments.includes(department) || profile?.department === department
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`help-desk-tickets-assign:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

    const body = await request.json()
    const parsed = AssignHelpDeskTicketSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const assigned_to = parsed.data.assigned_to
    const normalizedAction = String(parsed.data.action || "assign_staff")

    const { data: ticket, error: ticketError } = await supabase
      .from("help_desk_tickets")
      .select("*")
      .eq("id", params.id)
      .single()

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    const canAssign = managesDepartmentStrict(profile, ticket.service_department)
    if (!canAssign) {
      return NextResponse.json({ error: "Only the service department lead can assign this ticket." }, { status: 403 })
    }

    if (ticket.status === "pending_approval") {
      return NextResponse.json({ error: "Cannot assign while ticket is pending approval." }, { status: 400 })
    }
    if (!["new", "pending_lead_review", "department_queue", "department_assigned"].includes(ticket.status)) {
      return NextResponse.json({ error: "Ticket is not assignable at its current stage." }, { status: 400 })
    }

    const now = new Date().toISOString()
    let updates: Record<string, unknown>
    let eventType = "ticket_assigned"
    let newAssignedTo = assigned_to || null

    if (normalizedAction === "send_to_queue") {
      updates = {
        assigned_to: null,
        assigned_by: user.id,
        handling_mode: "queue",
        status: "department_queue",
      }
      eventType = "ticket_sent_to_queue"
      newAssignedTo = null
    } else if (normalizedAction === "assign_department") {
      updates = {
        assigned_to: null,
        assigned_by: user.id,
        handling_mode: "department",
        status: "department_assigned",
      }
      eventType = "ticket_assigned_to_department"
      newAssignedTo = null
    } else if (normalizedAction === "assign_me") {
      updates = {
        assigned_to: user.id,
        assigned_by: user.id,
        handling_mode: "individual",
        status:
          ticket.status === "pending_lead_review" || ticket.status === "department_queue" ? "assigned" : ticket.status,
        assigned_at: ticket.assigned_at ?? now,
      }
      newAssignedTo = user.id
    } else {
      if (!assigned_to) {
        return NextResponse.json({ error: "assigned_to is required" }, { status: 400 })
      }
      const { data: assignee, error: assigneeError } = await supabase
        .from("profiles")
        .select("id, department, employment_status")
        .eq("id", assigned_to)
        .maybeSingle()
      if (assigneeError || !assignee) {
        return NextResponse.json({ error: "Selected assignee not found" }, { status: 400 })
      }
      const unassignableReason = getUnassignableReason(assignee, {
        allowLegacyNullStatus: false,
        requiredDepartment: ticket.service_department,
      })
      if (unassignableReason) {
        return NextResponse.json({ error: unassignableReason }, { status: 400 })
      }
      updates = {
        assigned_to,
        assigned_by: user.id,
        handling_mode: "individual",
        status:
          ticket.status === "new" || ticket.status === "pending_lead_review" || ticket.status === "department_queue"
            ? "assigned"
            : ticket.status,
        assigned_at: ticket.assigned_at ?? now,
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("help_desk_tickets")
      .update(updates)
      .eq("id", ticket.id)
      .select("*")
      .single()

    if (updateError) throw updateError

    const syncResult = await syncHelpDeskTicketTask({
      ticket: updated,
      actorId: user.id,
    })

    const workItemNumber = syncResult?.workItemNumber || updated.ticket_number || ticket.ticket_number

    await appendHelpDeskEvent({
      ticketId: ticket.id,
      actorId: user.id,
      eventType,
      oldStatus: ticket.status,
      newStatus: updated.status,
      details: { from: ticket.assigned_to, to: newAssignedTo, action: normalizedAction },
    })

    await appendAuditLog({
      actorId: user.id,
      action: "help_desk_ticket_assigned",
      entityId: ticket.id,
      department: ticket.service_department,
      route: "/api/help-desk/tickets/[id]/assign",
      critical: true,
      oldValues: { assigned_to: ticket.assigned_to },
      newValues: {
        assigned_to: newAssignedTo,
        handling_mode: updated.handling_mode,
        status: updated.status,
        action: normalizedAction,
      },
    })

    if (newAssignedTo) {
      await supabase.rpc("create_notification", {
        p_user_id: newAssignedTo,
        p_type: "task_assigned",
        p_category: "tasks",
        p_title: "Help desk ticket assigned",
        p_message: `${workItemNumber} - ${ticket.title}`,
        p_priority: ticket.priority === "urgent" ? "urgent" : ticket.priority === "high" ? "high" : "normal",
        p_link_url: "/help-desk",
        p_actor_id: user.id,
        p_entity_type: "help_desk_ticket",
        p_entity_id: ticket.id,
        p_rich_content: { service_department: ticket.service_department, priority: ticket.priority },
      })

      try {
        await sendHelpDeskMail({
          userIds: [newAssignedTo],
          subject: `Help Desk Assignment: ${workItemNumber}`,
          title: "Ticket Assigned To You",
          message: `${ticket.title} has been assigned to you for execution.`,
          ticketNumber: workItemNumber,
        })
      } catch (mailError) {
        log.error({ err: String(mailError) }, "Help desk mail error (assign):")
      }
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/help-desk/tickets/[id]/assign:")
    return NextResponse.json({ error: "Failed to assign ticket" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export { PATCH as POST }
