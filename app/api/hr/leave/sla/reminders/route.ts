import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { notifyUsers } from "@/lib/hr/leave-workflow"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("hr-leave-sla-reminders")

type SlaPolicyRow = {
  stage: string
  due_hours: number
  reminder_hours_before: number
  escalate_to_role?: string | null
}

type PendingLeaveRequestRow = {
  id: string
  user_id: string
  status: string
  start_date?: string | null
  current_stage_code?: string | null
  current_approver_user_id?: string | null
  created_at: string
}

type ProfileIdRow = {
  id: string
}

const LEGACY_SLA_STAGE_MAP: Record<string, string> = {
  pending_reliever: "reliever_pending",
  pending_department_lead: "supervisor_pending",
  pending_admin_hr_lead: "hr_pending",
  pending_md: "hr_pending",
  pending_hcs: "hr_pending",
}

export async function PATCH() {
  const rl = await rateLimit("hr-leave-sla-reminders", { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const cronSecret = process.env.CRON_SECRET

    // Allow secure scheduled execution (e.g. Vercel Cron) via CRON secret.
    // If no valid cron token is provided, fall back to authenticated RBAC checks.
    const requestHeaders = await headers()
    const bearerToken = requestHeaders
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim()
    const isAuthorizedCron = Boolean(cronSecret && bearerToken && bearerToken === cronSecret)

    if (!isAuthorizedCron) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

      const reminderScope = await getRequestScope()
      if (!reminderScope?.isAdminLike || reminderScope.scopeMode === "lead") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const { data: slaPolicies } = await supabase
      .from("approval_sla_policies")
      .select("stage, due_hours, reminder_hours_before, escalate_to_role")
      .eq("is_active", true)

    const policyMap = new Map(((slaPolicies || []) as SlaPolicyRow[]).map((item) => [item.stage, item] as const))

    const { data: pendingRequests, error } = await supabase
      .from("leave_requests")
      .select("id, user_id, status, start_date, current_stage_code, current_approver_user_id, created_at")
      .in("status", ["pending", "pending_evidence"])

    if (error) return NextResponse.json({ error: "Failed to fetch pending leave requests" }, { status: 500 })

    const now = Date.now()
    const today = new Date().toISOString().slice(0, 10)
    let remindersSent = 0

    for (const request of (pendingRequests || []) as PendingLeaveRequestRow[]) {
      // Industry-standard lapse behavior: unresolved requests are expired/cancelled
      // once leave start date is reached.
      if (request.start_date && request.start_date <= today) {
        const expiryReason = `Auto-lapsed: no final approval before leave start date (${request.start_date}).`

        const { error: expireError } = await supabase
          .from("leave_requests")
          .update({
            status: "cancelled",
            approval_stage: "cancelled",
            current_stage_code: "cancelled",
            rejected_reason: expiryReason,
            current_approver_user_id: null,
          })
          .eq("id", request.id)
          .in("status", ["pending", "pending_evidence"])

        if (!expireError) {
          const recipientIds = [request.user_id, request.current_approver_user_id].filter(Boolean) as string[]
          if (recipientIds.length > 0) {
            const uniqueRecipients = Array.from(new Set(recipientIds))
            await notifyUsers(supabase, {
              userIds: uniqueRecipients,
              title: "Leave request lapsed",
              message: `Leave request ${request.id} was automatically lapsed because it was not fully approved before start date.`,
              linkUrl: "/leave",
              entityId: request.id,
              emailEvent: "lapsed",
            })
            remindersSent += uniqueRecipients.length
          }
        }

        continue
      }

      if (!request.current_approver_user_id) continue

      const slaStage = LEGACY_SLA_STAGE_MAP[request.current_stage_code || ""] || "reliever_pending"
      const policy = policyMap.get(slaStage)
      if (!policy) continue

      const createdAt = new Date(request.created_at).getTime()
      const dueAt = createdAt + policy.due_hours * 60 * 60 * 1000
      const reminderAt = dueAt - policy.reminder_hours_before * 60 * 60 * 1000

      if (now >= reminderAt && now < dueAt) {
        await notifyUsers(supabase, {
          userIds: [request.current_approver_user_id],
          title: "Leave approval SLA reminder",
          message: `Leave request ${request.id} is due soon. Please review before SLA breach.`,
          linkUrl: "/leave",
          entityId: request.id,
          emailEvent: "sla_reminder",
        })
        remindersSent += 1
      }

      if (now >= dueAt && policy.escalate_to_role) {
        const { data: escalatedUsers } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", policy.escalate_to_role)

        const escalateRecipients = ((escalatedUsers || []) as ProfileIdRow[]).map((row) => row.id)
        if (escalateRecipients.length) {
          await notifyUsers(supabase, {
            userIds: escalateRecipients,
            title: "Leave approval SLA breached",
            message: `Leave request ${request.id} has breached SLA at ${request.current_stage_code}.`,
            linkUrl: "/admin/hr/leave/approve",
            entityId: request.id,
            emailEvent: "sla_breached",
          })
          remindersSent += escalateRecipients.length
        }
      }
    }

    return NextResponse.json({ message: "SLA reminders processed", reminders_sent: remindersSent })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/hr/leave/sla/reminders:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST() {
  const rl = await rateLimit("hr-leave-sla-reminders", { limit: 15, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH()
}
