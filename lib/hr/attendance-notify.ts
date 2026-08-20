import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { normalizeDepartmentName, DEPT_ADMIN_HR } from "@/shared/departments"
import { loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { ATTENDANCE_STATUS_LABELS, type UnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { sendAttendanceMail, type AttendanceMailDetail } from "@/lib/hr/attendance-mailer"

const log = logger("attendance-notify")

const ADMIN_HR_DEPARTMENT = DEPT_ADMIN_HR

type NotifyClient = SupabaseClient

type ProfileNameEmailRow = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
}

type LeadProfileRow = {
  id: string
  department: string | null
  lead_departments: string[] | null
  company_email: string | null
  additional_email: string | null
}

/** How the attendance state was changed — drives subject + wording. */
export type AttendanceMailDecision = "created" | "updated" | "approved" | "rejected"

export interface NotifyAttendanceMailParams {
  /** Employee whose attendance was altered / whose appeal was decided. */
  affectedUserId: string
  /** Admin/approver who performed the action. */
  actorId: string | null
  /** Day affected, YYYY-MM-DD. */
  date: string
  fromStatus?: string | null
  toStatus?: string | null
  decision: AttendanceMailDecision
  /** Employee-supplied reason (appeal reason). Null for pure manual alterations. */
  requesterComment?: string | null
  /** Admin/approver comment (resolution note or manual comment). */
  approverComment?: string | null
  /** When the action happened; defaults to now. */
  occurredAt?: string
}

function formatName(row: Pick<ProfileNameEmailRow, "full_name" | "first_name" | "last_name"> | null | undefined) {
  if (!row) return "Unknown"
  return row.full_name?.trim() || [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Unknown"
}

function collectEmails(
  row: { company_email: string | null; additional_email: string | null } | null | undefined
): string[] {
  if (!row) return []
  return [row.company_email, row.additional_email].filter(
    (email): email is string => typeof email === "string" && email.includes("@")
  )
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "—"
  return ATTENDANCE_STATUS_LABELS[status as UnifiedAttendanceStatus] ?? status
}

function decisionVerb(decision: AttendanceMailDecision): string {
  switch (decision) {
    case "approved":
      return "approved"
    case "rejected":
      return "rejected"
    case "created":
      return "recorded"
    default:
      return "updated"
  }
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Resolve the Admin & HR lead's email addresses. Mirrors leave routing: the profile that is a
 * department lead for "Admin & HR". Falls back to super admins when no such lead is configured.
 */
async function resolveAdminHrLeadEmails(client: NotifyClient): Promise<string[]> {
  const { data: leads } = await client
    .from("profiles")
    .select("id, department, lead_departments, company_email, additional_email")
    .eq("is_department_lead", true)

  const matches = ((leads ?? []) as LeadProfileRow[]).filter((profile) => {
    const managed = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
    return (
      normalizeDepartmentName(profile.department ?? "") === ADMIN_HR_DEPARTMENT ||
      managed.some((dept) => normalizeDepartmentName(dept) === ADMIN_HR_DEPARTMENT)
    )
  })

  let emails = matches.flatMap((lead) => collectEmails(lead))

  if (emails.length === 0) {
    const { data: superAdmins } = await client
      .from("profiles")
      .select("id, company_email, additional_email")
      .eq("is_super_admin", true)
    emails = ((superAdmins ?? []) as Array<Pick<LeadProfileRow, "company_email" | "additional_email">>).flatMap(
      (admin) => collectEmails(admin)
    )
  }

  return Array.from(new Set(emails.map((email) => email.toLowerCase())))
}

/**
 * Sends attendance-change emails to the affected employee and the Admin & HR lead. Covers manual
 * alterations (create/update) and LWP/AWP appeal decisions (approve/reject).
 *
 * Best-effort: never throws, so a mail failure can never block the attendance write.
 */
export async function notifyAttendanceMail(client: NotifyClient, params: NotifyAttendanceMailParams): Promise<void> {
  try {
    // Gated by the admin-configurable toggle in Attendance Policy Settings.
    const policy = await loadAttendancePolicy(client)
    if (policy.emailNotificationsEnabled === false) return

    const occurredAt = params.occurredAt ?? new Date().toISOString()

    const idsToLoad = Array.from(new Set([params.affectedUserId, params.actorId].filter(Boolean))) as string[]
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name, first_name, last_name, company_email, additional_email")
      .in("id", idsToLoad)

    const profileMap = new Map<string, ProfileNameEmailRow>()
    for (const profile of (profiles ?? []) as ProfileNameEmailRow[]) profileMap.set(profile.id, profile)

    const affected = profileMap.get(params.affectedUserId) ?? null
    const actor = params.actorId ? (profileMap.get(params.actorId) ?? null) : null

    const affectedName = formatName(affected)
    const actorName = formatName(actor)
    const employeeEmails = collectEmails(affected)
    const leadEmails = await resolveAdminHrLeadEmails(client)

    const verb = decisionVerb(params.decision)
    const isAppeal = params.decision === "approved" || params.decision === "rejected"
    const statusTransition =
      params.fromStatus && params.toStatus
        ? `${statusLabel(params.fromStatus)} → ${statusLabel(params.toStatus)}`
        : statusLabel(params.toStatus)

    const subjectAction = isAppeal
      ? `Attendance Appeal ${verb.charAt(0).toUpperCase()}${verb.slice(1)}`
      : "Attendance Record Updated"
    const subject = `${subjectAction} — ${params.date}`

    // ── Employee / requester copy ──
    if (employeeEmails.length > 0) {
      const employeeMessage = isAppeal
        ? `Your attendance appeal for ${params.date} has been ${verb}.`
        : `Your attendance record for ${params.date} has been ${verb} by the Admin and HR team.`

      const employeeDetails: AttendanceMailDetail[] = [
        { label: "Date", value: params.date },
        { label: "Status", value: statusTransition },
      ]
      if (params.approverComment?.trim()) {
        employeeDetails.push({ label: "Comment", value: params.approverComment.trim() })
      }

      await sendAttendanceMail({
        to: employeeEmails,
        subject,
        title: subjectAction,
        message: employeeMessage,
        detailsTitle: isAppeal ? "Appeal Details" : "Attendance Change",
        details: employeeDetails,
      })
    }

    // ── Admin & HR lead copy (fuller audit view) ──
    if (leadEmails.length > 0) {
      const leadMessage = isAppeal
        ? `${affectedName}'s attendance appeal for ${params.date} was ${verb} by ${actorName}.`
        : `${affectedName}'s attendance record for ${params.date} was ${verb} by ${actorName}.`

      const leadDetails: AttendanceMailDetail[] = [
        { label: "Employee", value: affectedName },
        { label: "Date", value: params.date },
        { label: "Status", value: statusTransition },
        { label: "Actioned by", value: actorName },
        { label: "Requester comment", value: params.requesterComment?.trim() || "N/A" },
        { label: "Approver comment", value: params.approverComment?.trim() || "N/A" },
        { label: "Timestamp", value: formatTimestamp(occurredAt) },
      ]

      await sendAttendanceMail({
        to: leadEmails,
        subject: `${subject} (${affectedName})`,
        title: subjectAction,
        message: leadMessage,
        detailsTitle: isAppeal ? "Appeal Details" : "Attendance Change",
        details: leadDetails,
      })
    }
  } catch (err) {
    log.error({ err: String(err) }, "Failed to send attendance change email")
  }
}

export interface NotifyAttendanceInAppParams {
  affectedUserId: string
  actorId: string | null
  date: string
  fromStatus?: string | null
  toStatus?: string | null
  /** "created" for a new manual record, "updated" for an edit. */
  action: "created" | "updated"
  entityId?: string | null
}

/**
 * Internal (in-app) notification for a manual attendance alteration — no email. Emailing is
 * reserved for LWP/AWP appeal decisions; every other manual change only pings the employee in-app.
 * Best-effort: never throws.
 */
export async function notifyAttendanceInApp(client: NotifyClient, params: NotifyAttendanceInAppParams): Promise<void> {
  try {
    const statusText = statusLabel(params.toStatus)
    const message =
      params.action === "created"
        ? `Your attendance for ${params.date} was recorded as ${statusText} by the Admin and HR team.`
        : `Your attendance for ${params.date} was updated to ${statusText} by the Admin and HR team.`

    await client.rpc("create_notification", {
      p_user_id: params.affectedUserId,
      p_type: "system",
      p_category: "system",
      p_title: "Attendance Record Updated",
      p_message: message,
      p_priority: "normal",
      p_link_url: "/attendance",
      p_actor_id: params.actorId,
      p_entity_type: "attendance_record",
      p_entity_id: params.entityId ?? null,
    })
  } catch (err) {
    log.error({ err: String(err) }, "Failed to create attendance in-app notification")
  }
}
