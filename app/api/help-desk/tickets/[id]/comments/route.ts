import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  appendAuditLog,
  appendHelpDeskEvent,
  canLeadDepartment,
  getAuthContext,
  isAdminRole,
} from "@/lib/help-desk/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("help-desk-tickets-comments")
const CreateHelpDeskCommentSchema = z.object({
  comment: z.string().trim().min(1, "comment is required"),
  visibility: z.string().optional(),
})

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const { supabase, user, profile } = await getAuthContext()

    if (!user || !profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("help_desk_tickets")
      .select("id, requester_id, assigned_to, service_department, requester_department")
      .eq("id", params.id)
      .single()

    if (ticketError || !ticket) {
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

    const { data, error } = await supabase
      .from("help_desk_comments")
      .select("*")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true })

    if (error) throw error

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/help-desk/tickets/[id]/comments:")
    return NextResponse.json({ error: "Failed to fetch comments" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`help-desk-tickets-comments:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    const parsed = CreateHelpDeskCommentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const comment = parsed.data.comment
    const visibility = parsed.data.visibility

    const { data: ticket, error: ticketError } = await supabase
      .from("help_desk_tickets")
      .select("*")
      .eq("id", params.id)
      .single()

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    const postScope = await getRequestScope()
    const isGlobalAdminPost = isAdminRole(profile.role) && postScope?.scopeMode !== "lead"
    const canComment =
      isGlobalAdminPost ||
      canLeadDepartment(profile, ticket.service_department) ||
      canLeadDepartment(profile, ticket.requester_department) ||
      ticket.requester_id === user.id ||
      ticket.assigned_to === user.id

    if (!canComment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const commentVisibility = visibility === "requester" ? "requester" : "internal"

    const { data: created, error: createError } = await supabase
      .from("help_desk_comments")
      .insert({
        ticket_id: ticket.id,
        author_id: user.id,
        comment: comment,
        visibility: commentVisibility,
      })
      .select("*")
      .single()

    if (createError) throw createError

    await appendHelpDeskEvent({
      ticketId: ticket.id,
      actorId: user.id,
      eventType: "comment_added",
      oldStatus: ticket.status,
      newStatus: ticket.status,
      details: { visibility: commentVisibility },
    })

    await appendAuditLog({
      actorId: user.id,
      action: "help_desk_comment_added",
      entityId: ticket.id,
      department: ticket.service_department,
      route: "/api/help-desk/tickets/[id]/comments",
      critical: false,
      newValues: { visibility: commentVisibility },
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/help-desk/tickets/[id]/comments:")
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 })
  }
}
