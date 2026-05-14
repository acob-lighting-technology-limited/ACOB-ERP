import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  appendAuditLog,
  appendHelpDeskEvent,
  getAuthContext,
  HelpDeskApprovalRow,
  HelpDeskProfile,
  resolveLeadForDepartment,
  syncHelpDeskTicketTask,
} from "@/lib/help-desk/server"
import { sendHelpDeskMail } from "@/lib/help-desk/mailer"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("help-desk-tickets-approvals")
const ProcessHelpDeskApprovalSchema = z.object({
  decision: z.enum(["approved", "rejected"], {
    errorMap: () => ({ message: 'decision must be "approved" or "rejected"' }),
  }),
  comments: z.string().optional().nullable(),
})

const STAGE_ORDER = [
  "requester_department_lead",
  "service_department_lead",
  "head_corporate_services",
  "managing_director",
] as const

type ApprovalProfileRow = {
  id: string
  full_name: string | null
  role: string | null
  department: string | null
  is_department_lead: boolean | null
  lead_departments: string[] | null
}

type ResolvableApprovalProfile = Omit<ApprovalProfileRow, "is_department_lead"> & {
  is_department_lead?: boolean
}

function normalizeApprovalProfiles(profiles: ApprovalProfileRow[] | null | undefined): ResolvableApprovalProfile[] {
  return (profiles || []).map((profile) => ({
    ...profile,
    is_department_lead: profile.is_department_lead ?? undefined,
  }))
}

function nextStage(currentStage: string) {
  const idx = STAGE_ORDER.indexOf(currentStage as (typeof STAGE_ORDER)[number])
  if (idx < 0 || idx === STAGE_ORDER.length - 1) return null
  return STAGE_ORDER[idx + 1]
}

function managesDepartmentStrict(profile: HelpDeskProfile, department: string | null | undefined) {
  if (!profile?.is_department_lead || !department) return false
  const managedDepartments = Array.isArray(profile?.managed_departments)
    ? profile.managed_departments
    : Array.isArray(profile?.lead_departments)
      ? profile.lead_departments
      : []
  return managedDepartments.includes(department) || profile?.department === department
}

function normalizeApprovalStage(stage: string | null | undefined) {
  if (!stage) return ""
  if (stage === "department_lead") return "service_department_lead"
  return stage
}

function stageRank(stage: string) {
  const normalized = normalizeApprovalStage(stage)
  const rank = STAGE_ORDER.indexOf(normalized as (typeof STAGE_ORDER)[number])
  return rank >= 0 ? rank : Number.MAX_SAFE_INTEGER
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const rl = await rateLimit(`help-desk-tickets-approvals:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    const parsed = ProcessHelpDeskApprovalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const normalizedDecision = parsed.data.decision
    const comments = parsed.data.comments ? String(parsed.data.comments).trim() : null

    if (normalizedDecision === "rejected" && !comments) {
      return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 })
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("help_desk_tickets")
      .select("*")
      .eq("id", params.id)
      .single()

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 })
    }

    const { data: approvals, error: approvalsError } = await supabase
      .from("help_desk_approvals")
      .select("*")
      .eq("ticket_id", ticket.id)
      .order("requested_at", { ascending: true })

    if (approvalsError) throw approvalsError

    const pendingApproval =
      ((approvals as HelpDeskApprovalRow[] | null) || [])
        .filter((a) => a.status === "pending")
        .sort((a, b) => stageRank(a.approval_stage) - stageRank(b.approval_stage))[0] || null
    if (!pendingApproval) {
      return NextResponse.json({ error: "No pending approval for this ticket" }, { status: 400 })
    }
    const approvalStage = normalizeApprovalStage(pendingApproval.approval_stage)

    const canApproveStage =
      (approvalStage === "requester_department_lead" &&
        managesDepartmentStrict(profile, ticket.requester_department)) ||
      (approvalStage === "service_department_lead" && managesDepartmentStrict(profile, ticket.service_department)) ||
      (approvalStage === "head_corporate_services" && managesDepartmentStrict(profile, "Corporate Services")) ||
      (approvalStage === "managing_director" && managesDepartmentStrict(profile, "Executive Management"))

    if (!canApproveStage) {
      return NextResponse.json({ error: "You are not authorized to decide this approval stage" }, { status: 403 })
    }

    const now = new Date().toISOString()

    const { error: updateApprovalError } = await supabase
      .from("help_desk_approvals")
      .update({
        status: normalizedDecision,
        approver_id: user.id,
        comments,
        decided_at: now,
      })
      .eq("id", pendingApproval.id)

    if (updateApprovalError) throw updateApprovalError

    let finalStatus = ticket.status
    let latestTicket = ticket

    if (normalizedDecision === "rejected") {
      finalStatus = "rejected"
      const { data: rejectedTicket } = await supabase
        .from("help_desk_tickets")
        .update({ status: "rejected", current_approval_stage: null })
        .eq("id", ticket.id)
        .select("*")
        .single()

      if (rejectedTicket) {
        latestTicket = rejectedTicket
      }

      await syncHelpDeskTicketTask({
        ticket: latestTicket,
        actorId: user.id,
      })

      await supabase.rpc("create_notification", {
        p_user_id: ticket.requester_id,
        p_type: "approval_rejected",
        p_category: "approvals",
        p_title: "Procurement request rejected",
        p_message: `${ticket.ticket_number} was rejected at ${approvalStage}`,
        p_priority: "high",
        p_link_url: "/help-desk",
        p_actor_id: user.id,
        p_entity_type: "help_desk_ticket",
        p_entity_id: ticket.id,
        p_rich_content: { approval_stage: approvalStage, comments: comments || null },
      })

      try {
        await sendHelpDeskMail({
          userIds: [ticket.requester_id, ticket.assigned_to].filter(Boolean) as string[],
          subject: `Procurement Rejected: ${ticket.ticket_number}`,
          title: "Ticket Procurement Request Rejected",
          message: `${ticket.title} was rejected at ${approvalStage}. Review and update the request.`,
          ticketNumber: ticket.ticket_number,
        })
      } catch (mailError) {
        log.error({ err: String(mailError) }, "Help desk mail error (rejected):")
      }
    } else {
      const upcomingStage = nextStage(approvalStage)

      if (!upcomingStage) {
        finalStatus = "approved_for_procurement"
        const { data: approvedTicket } = await supabase
          .from("help_desk_tickets")
          .update({
            status: "approved_for_procurement",
            resumed_at: now,
            paused_at: null,
            current_approval_stage: null,
          })
          .eq("id", ticket.id)
          .select("*")
          .single()

        if (approvedTicket) {
          latestTicket = approvedTicket
        }

        const syncResult = await syncHelpDeskTicketTask({
          ticket: latestTicket,
          actorId: user.id,
        })
        const workItemNumber = syncResult?.workItemNumber || latestTicket.ticket_number || ticket.ticket_number

        const notificationTargets = [ticket.requester_id, ticket.assigned_to].filter(Boolean)
        for (const targetId of notificationTargets) {
          await supabase.rpc("create_notification", {
            p_user_id: targetId,
            p_type: "approval_granted",
            p_category: "approvals",
            p_title: "Procurement approved",
            p_message: `${workItemNumber} has completed all approval stages`,
            p_priority: "normal",
            p_link_url: "/help-desk",
            p_actor_id: user.id,
            p_entity_type: "help_desk_ticket",
            p_entity_id: ticket.id,
            p_rich_content: { final_stage: approvalStage },
          })
        }

        try {
          await sendHelpDeskMail({
            userIds: notificationTargets as string[],
            subject: `Procurement Approved: ${workItemNumber}`,
            title: "Ticket Procurement Fully Approved",
            message: `${ticket.title} has passed all approval levels and work can continue.`,
            ticketNumber: workItemNumber,
          })
        } catch (mailError) {
          log.error({ err: String(mailError) }, "Help desk mail error (final approval):")
        }
      } else {
        finalStatus = "pending_approval"

        const { data: potentialApprovers } = await supabase
          .from("profiles")
          .select("id, full_name, role, department, is_department_lead, lead_departments")
          .eq("is_department_lead", true)

        const nextApprover = (() => {
          const rows = normalizeApprovalProfiles(potentialApprovers as ApprovalProfileRow[] | null)
          if (upcomingStage === "requester_department_lead") {
            return resolveLeadForDepartment(rows, ticket.requester_department)
          }
          if (upcomingStage === "service_department_lead") {
            return resolveLeadForDepartment(rows, ticket.service_department)
          }
          if (upcomingStage === "head_corporate_services") {
            return (
              rows.find((p) => {
                return (
                  p.is_department_lead &&
                  (p.department === "Corporate Services" || (p.lead_departments || []).includes("Corporate Services"))
                )
              }) || null
            )
          }
          return (
            rows.find((p) => {
              return (
                p.is_department_lead &&
                (p.department === "Executive Management" || (p.lead_departments || []).includes("Executive Management"))
              )
            }) || null
          )
        })()

        const { data: stagedTicket } = await supabase
          .from("help_desk_tickets")
          .update({ current_approval_stage: upcomingStage })
          .eq("id", ticket.id)
          .select("*")
          .single()

        if (stagedTicket) {
          latestTicket = stagedTicket
        }

        if (nextApprover?.id) {
          await supabase.rpc("create_notification", {
            p_user_id: nextApprover.id,
            p_type: "approval_request",
            p_category: "approvals",
            p_title: "Procurement approval required",
            p_message: `${ticket.ticket_number} is waiting for ${upcomingStage} approval`,
            p_priority: ticket.priority === "urgent" ? "urgent" : "high",
            p_link_url: "/admin/help-desk",
            p_actor_id: user.id,
            p_entity_type: "help_desk_ticket",
            p_entity_id: ticket.id,
            p_rich_content: { next_stage: upcomingStage },
          })

          try {
            await sendHelpDeskMail({
              userIds: [nextApprover.id],
              subject: `Approval Required: ${ticket.ticket_number}`,
              title: "Procurement Approval Needed",
              message: `${ticket.title} is waiting for your decision at ${upcomingStage}.`,
              ticketNumber: ticket.ticket_number,
              ctaPath: "/admin/help-desk",
            })
          } catch (mailError) {
            log.error({ err: String(mailError) }, "Help desk mail error (next approver):")
          }
        }
      }
    }

    await appendHelpDeskEvent({
      ticketId: ticket.id,
      actorId: user.id,
      eventType: normalizedDecision === "approved" ? "approval_approved" : "approval_rejected",
      oldStatus: ticket.status,
      newStatus: finalStatus,
      details: {
        stage: approvalStage,
        decision: normalizedDecision,
        comments: comments || null,
      },
    })

    await appendAuditLog({
      actorId: user.id,
      action: `help_desk_approval_${normalizedDecision}`,
      entityId: ticket.id,
      department: ticket.service_department,
      route: "/api/help-desk/tickets/[id]/approvals",
      critical: true,
      newValues: {
        approval_stage: approvalStage,
        decision: normalizedDecision,
        status: finalStatus,
      },
    })

    return NextResponse.json({
      data: {
        ticket_id: ticket.id,
        approval_stage: approvalStage,
        decision: normalizedDecision,
        status: finalStatus,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in PATCH /api/help-desk/tickets/[id]/approvals:")
    return NextResponse.json({ error: "Failed to process approval decision" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export { PATCH as POST }
