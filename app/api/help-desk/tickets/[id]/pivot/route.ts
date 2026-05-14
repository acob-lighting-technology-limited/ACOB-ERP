import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  appendAuditLog,
  appendHelpDeskEvent,
  canLeadDepartment,
  getAuthContext,
  HelpDeskProfile,
  isAdminRole,
  resolveLeadForDepartment,
} from "@/lib/help-desk/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { sendHelpDeskMail } from "@/lib/help-desk/mailer"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("help-desk-tickets-pivot")
export const dynamic = "force-dynamic"
const PivotHelpDeskTicketSchema = z.object({
  reason: z.string().optional().nullable(),
})

type ApprovalProfileRow = Pick<
  HelpDeskProfile,
  "id" | "full_name" | "role" | "department" | "is_department_lead" | "lead_departments"
>

type ResolvableApprovalProfile = Omit<ApprovalProfileRow, "is_department_lead"> & {
  is_department_lead?: boolean
}

function normalizeApprovalProfiles(profiles: ApprovalProfileRow[] | null | undefined): ResolvableApprovalProfile[] {
  return (profiles || [])
    .filter((profile): profile is ApprovalProfileRow => Boolean(profile?.id))
    .map((profile) => ({
      ...profile,
      is_department_lead: profile.is_department_lead ?? undefined,
    }))
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`help-desk-tickets-pivot:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    const parsed = PivotHelpDeskTicketSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const pivotReason = parsed.data.reason ? String(parsed.data.reason).trim() : "Procurement required to proceed"

    const { data: ticket, error: ticketError } = await supabase
      .from("help_desk_tickets")
      .select("*")
      .eq("id", params.id)
      .single()

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    const pivotScope = await getRequestScope()
    const isGlobalAdmin = isAdminRole(profile.role) && pivotScope?.scopeMode !== "lead"
    const canPivot =
      ticket.assigned_to === user.id || isGlobalAdmin || canLeadDepartment(profile, ticket.service_department)

    if (!canPivot) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const now = new Date().toISOString()

    const { data: updated, error: updateError } = await supabase
      .from("help_desk_tickets")
      .update({
        request_type: "procurement",
        approval_required: true,
        pivoted_to_procurement: true,
        procurement_reason: pivotReason,
        status: "pending_approval",
        current_approval_stage: "requester_department_lead",
        paused_at: now,
      })
      .eq("id", ticket.id)
      .select("*")
      .single()

    if (updateError) throw updateError

    const { data: existingApprovals } = await supabase
      .from("help_desk_approvals")
      .select("id")
      .eq("ticket_id", ticket.id)

    if (!existingApprovals?.length) {
      await supabase.from("help_desk_approvals").insert([
        { ticket_id: ticket.id, approval_stage: "requester_department_lead", status: "pending" },
        { ticket_id: ticket.id, approval_stage: "service_department_lead", status: "pending" },
        { ticket_id: ticket.id, approval_stage: "head_corporate_services", status: "pending" },
        { ticket_id: ticket.id, approval_stage: "managing_director", status: "pending" },
      ])
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, role, department, is_department_lead, lead_departments")
      .eq("is_department_lead", true)

    const requesterLead = resolveLeadForDepartment(
      normalizeApprovalProfiles(profiles as ApprovalProfileRow[] | null),
      ticket.requester_department
    )

    try {
      await sendHelpDeskMail({
        userIds: requesterLead?.id ? [requesterLead.id] : [],
        subject: `Procurement Pivot: ${ticket.ticket_number}`,
        title: "Ticket Requires Procurement Approval",
        message: `${ticket.title} has been moved to procurement flow and is awaiting requester department approval first.`,
        ticketNumber: ticket.ticket_number,
        ctaPath: "/admin/help-desk",
      })
    } catch (mailError) {
      log.error({ err: String(mailError) }, "Help desk mail error (pivot):")
    }

    await appendHelpDeskEvent({
      ticketId: ticket.id,
      actorId: user.id,
      eventType: "pivot_to_procurement",
      oldStatus: ticket.status,
      newStatus: "pending_approval",
      details: { reason: pivotReason },
    })

    await appendAuditLog({
      actorId: user.id,
      action: "help_desk_ticket_pivoted_to_procurement",
      entityId: ticket.id,
      department: ticket.service_department,
      route: "/api/help-desk/tickets/[id]/pivot",
      critical: true,
      oldValues: { request_type: ticket.request_type, status: ticket.status },
      newValues: { request_type: "procurement", status: "pending_approval", procurement_reason: pivotReason },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/help-desk/tickets/[id]/pivot:")
    return NextResponse.json({ error: "Failed to pivot ticket" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export { POST as PATCH }
