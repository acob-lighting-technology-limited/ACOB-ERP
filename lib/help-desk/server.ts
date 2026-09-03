import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { BUSINESS_HOUR_START, BUSINESS_HOUR_END, HELP_DESK_SLA } from "@/lib/org-config"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { TaskStatus, TaskAssignmentType } from "@/lib/tasks/constants"

/** Minimal profile shape used in help-desk access-control helpers */
export interface ProfileLike {
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
  managed_departments?: string[] | null
}

export interface HelpDeskProfile extends ProfileLike {
  id: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
}

export interface HelpDeskTicketRow {
  id: string
  title: string
  ticket_number: string
  description?: string | null
  status: string
  priority: string
  service_department: string | null
  requester_department: string | null
  requester_id: string
  created_by?: string | null
  assigned_to: string | null
  assigned_by?: string | null
  task_id?: string | null
  assigned_at?: string | null
  sla_target_at?: string | null
  started_at?: string | null
  resolved_at?: string | null
  closed_at?: string | null
  resumed_at?: string | null
  paused_at?: string | null
  current_approval_stage?: string | null
  request_type?: string | null
  support_mode?: HelpDeskSupportMode | null
  handling_mode?: HelpDeskHandlingMode | null
  csat_rating?: number | null
  csat_feedback?: string | null
  [key: string]: unknown
}

export interface HelpDeskApprovalRow {
  id: string
  ticket_id: string
  approval_stage: string
  status: string
  approver_id?: string | null
  comments?: string | null
  decided_at?: string | null
  requested_at?: string | null
  [key: string]: unknown
}

export const HELP_DESK_PRIORITIES = ["low", "medium", "high", "urgent"] as const
export const HELP_DESK_STATUSES = [
  "new",
  "pending_lead_review",
  "department_queue",
  "department_assigned",
  "assigned",
  "in_progress",
  "paused",
  "pending_approval",
  "approved_for_procurement",
  "rejected",
  "returned",
  "resolved",
  "closed",
  "cancelled",
] as const

export const HELP_DESK_SUPPORT_MODES = ["open_queue", "lead_review_required"] as const
export const HELP_DESK_HANDLING_MODES = ["individual", "queue", "department"] as const

export type HelpDeskPriority = (typeof HELP_DESK_PRIORITIES)[number]
export type HelpDeskStatus = (typeof HELP_DESK_STATUSES)[number]
export type HelpDeskSupportMode = (typeof HELP_DESK_SUPPORT_MODES)[number]
export type HelpDeskHandlingMode = (typeof HELP_DESK_HANDLING_MODES)[number]

type SyncedTaskRow = {
  id: string
  work_item_number: string | null
}

export function addBusinessHours(baseDate: Date, hours: number): Date {
  const date = new Date(baseDate)
  let remainingHours = hours

  while (remainingHours > 0) {
    date.setHours(date.getHours() + 1)
    const day = date.getDay() // 0 Sun, 6 Sat
    if (day === 0 || day === 6) continue

    const hour = date.getHours()
    if (hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END) {
      remainingHours -= 1
    }
  }

  return date
}

export function addBusinessDays(baseDate: Date, days: number): Date {
  const date = new Date(baseDate)
  let remaining = days

  while (remaining > 0) {
    date.setDate(date.getDate() + 1)
    const day = date.getDay()
    if (day !== 0 && day !== 6) {
      remaining -= 1
    }
  }

  return date
}

export function getSlaTarget(priority: HelpDeskPriority, submittedAt: Date): Date {
  const budget = HELP_DESK_SLA[priority as keyof typeof HELP_DESK_SLA]
  if (!budget) return addBusinessDays(submittedAt, HELP_DESK_SLA.low.value)
  return budget.unit === "business_hours"
    ? addBusinessHours(submittedAt, budget.value)
    : addBusinessDays(submittedAt, budget.value)
}

export function isAdminRole(role?: string | null): boolean {
  return role === "developer" || role === "admin" || role === "super_admin"
}

export function isLeadRole(profile?: { is_department_lead?: boolean } | null): boolean {
  return Boolean(profile?.is_department_lead)
}

/**
 * Department-lead membership check — no admin bypass.
 * Callers that want to allow global admins must OR this with their own
 * `isGlobalAdmin` check (derived from `getRequestScope()` + `scopeMode`).
 */
export function canLeadDepartment(profile: ProfileLike | null | undefined, department: string): boolean {
  if (!profile?.is_department_lead) return false

  const managedDepartments = Array.isArray(profile?.managed_departments)
    ? profile.managed_departments
    : Array.isArray(profile?.lead_departments)
      ? profile.lead_departments
      : []
  return managedDepartments.includes(department) || profile?.department === department
}

/**
 * Dept-membership / lead check — no admin bypass.
 * Callers that want to allow global admins must OR this with their own
 * `isGlobalAdmin` check.
 */
export function canWorkDepartment(profile: ProfileLike | null | undefined, department: string): boolean {
  return profile?.department === department || canLeadDepartment(profile, department)
}

export function resolveLeadForDepartment<
  T extends { is_department_lead?: boolean; department?: string | null; lead_departments?: string[] | null },
>(profiles: T[], department: string | null | undefined): T | null {
  if (!department) return null
  return (
    profiles.find((profile) => {
      if (!profile?.is_department_lead) return false
      const managedDepartments = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
      return profile.department === department || managedDepartments.includes(department)
    }) || null
  )
}

export async function getAuthContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, user: null, profile: null }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, department, is_department_lead, lead_departments, first_name, last_name, full_name")
    .eq("id", user.id)
    .single()
  const scope = await resolveAdminScope(supabase as unknown as SupabaseClient, user.id)
  const managedDepartments = scope?.managedDepartments ?? []

  return {
    supabase,
    user,
    profile: profile
      ? {
          ...profile,
          managed_departments: managedDepartments,
        }
      : null,
  }
}

export async function appendHelpDeskEvent(params: {
  ticketId: string
  actorId: string
  eventType: string
  oldStatus?: string | null
  newStatus?: string | null
  details?: Record<string, unknown>
}) {
  const supabase = await createClient()
  await supabase.from("help_desk_events").insert({
    ticket_id: params.ticketId,
    actor_id: params.actorId,
    event_type: params.eventType,
    old_status: params.oldStatus ?? null,
    new_status: params.newStatus ?? null,
    details: params.details ?? null,
  })
}

export async function appendAuditLog(params: {
  actorId: string
  action: string
  entityId: string
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  department?: string | null
  route?: string
  critical?: boolean
}) {
  const supabase = await createClient()
  await writeAuditLog(
    supabase as unknown as SupabaseClient,
    {
      action: params.action,
      entityType: "help_desk_ticket",
      entityId: params.entityId,
      oldValues: params.oldValues ?? null,
      newValues: params.newValues ?? null,
      context: {
        actorId: params.actorId,
        department: params.department ?? null,
        source: "api",
        route: params.route ?? "/api/help-desk",
      },
    },
    {
      critical: params.critical,
    }
  )
}

function normalizeTaskStatusFromTicket(ticketStatus: string): TaskStatus | null {
  switch (ticketStatus) {
    case "department_queue":
    case "department_assigned":
    case "assigned":
    case "approved_for_procurement":
      return "pending"
    case "in_progress":
      return "in_progress"
    case "resolved":
    case "closed":
      return "completed"
    case "rejected":
    case "cancelled":
      return "cancelled"
    default:
      return null
  }
}

function normalizeTaskAssignmentType(ticket: HelpDeskTicketRow): TaskAssignmentType {
  return ticket.handling_mode === "individual" && ticket.assigned_to ? "individual" : "department"
}

function normalizeTaskDueDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.includes("T") ? value.split("T")[0] || null : value
}

export function generateFallbackHelpDeskTicketNumber(): string {
  const epochMillis = Date.now().toString()
  const randomSuffix = parseInt(crypto.randomUUID().replace(/-/g, "").slice(0, 3), 16).toString().padStart(3, "0")
  return `HDT-${epochMillis}${randomSuffix}`
}

export async function syncHelpDeskTicketTask(params: {
  ticket: HelpDeskTicketRow
  actorId: string
}): Promise<{ taskId: string; workItemNumber: string | null } | null> {
  const taskStatus = normalizeTaskStatusFromTicket(params.ticket.status)
  if (!taskStatus) return null

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  let existingTask: SyncedTaskRow | null = null

  if (params.ticket.task_id) {
    const { data } = await dataClient
      .from("tasks")
      .select("id, work_item_number")
      .eq("id", params.ticket.task_id)
      .maybeSingle<SyncedTaskRow>()
    existingTask = data ?? null
  }

  if (!existingTask) {
    const { data } = await dataClient
      .from("tasks")
      .select("id, work_item_number")
      .eq("source_type", "help_desk")
      .eq("source_id", params.ticket.id)
      .maybeSingle<SyncedTaskRow>()
    existingTask = data ?? null
  }

  const assignmentType = normalizeTaskAssignmentType(params.ticket)
  const taskPayload = {
    title: params.ticket.title,
    description: params.ticket.description ?? null,
    priority: params.ticket.priority,
    status: taskStatus,
    assigned_to: assignmentType === "individual" ? params.ticket.assigned_to : null,
    assigned_by: params.ticket.assigned_by || params.ticket.created_by || params.ticket.requester_id || params.actorId,
    department: params.ticket.service_department || params.ticket.requester_department || null,
    due_date: normalizeTaskDueDate(params.ticket.sla_target_at),
    started_at: params.ticket.started_at || null,
    completed_at:
      taskStatus === "completed"
        ? params.ticket.resolved_at || params.ticket.closed_at || new Date().toISOString()
        : null,
    source_type: "help_desk" as const,
    source_id: params.ticket.id,
    assignment_type: assignmentType,
    goal_id: null,
  }

  // work_item_number is insert-only. The assign trigger is BEFORE INSERT, so
  // including this key on the update path would blank an existing task's
  // number with no way to restore it.
  const { data: syncedTask, error } = existingTask
    ? await dataClient
        .from("tasks")
        .update(taskPayload)
        .eq("id", existingTask.id)
        .select("id, work_item_number")
        .single<SyncedTaskRow>()
    : await dataClient
        .from("tasks")
        .insert({
          ...taskPayload,
          work_item_number: params.ticket.ticket_number?.startsWith("TSK-") ? params.ticket.ticket_number : null,
        })
        .select("id, work_item_number")
        .single<SyncedTaskRow>()

  if (error || !syncedTask) {
    throw error || new Error("Failed to sync help desk task")
  }

  // Tickets keep their own HD- identity; only the link is written back. The
  // task carries the TSK number.
  if (params.ticket.task_id !== syncedTask.id) {
    const { error: linkError } = await dataClient
      .from("help_desk_tickets")
      .update({ task_id: syncedTask.id })
      .eq("id", params.ticket.id)

    if (linkError) {
      throw linkError
    }
  }

  return {
    taskId: syncedTask.id,
    workItemNumber: syncedTask.work_item_number,
  }
}
