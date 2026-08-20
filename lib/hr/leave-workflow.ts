import { sendLeaveWorkflowEmail, type LeaveWorkflowDetail, type LeaveBadgeVariant } from "@/lib/leave-mailer"
import { resolveChannelEligibleUserIds } from "@/lib/notifications/delivery-policy"
import { logger } from "@/lib/logger"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Json } from "@/types/database"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("leave-workflow")

type LeaveWorkflowClient = SupabaseClient

type HolidayCalendarRow = {
  holiday_date: string
  is_business_day: boolean
}

type MinimalProfileRow = {
  id: string
  full_name: string | null
  company_email: string | null
  additional_email: string | null
  department_id: string | null
}

type LeaveTypeLimitRow = {
  max_days: number
}

export const LEAVE_PENDING_STAGES = {
  RELIEVER: "pending_reliever",
  SUPERVISOR: "pending_department_lead",
  HR: "pending_admin_hr_lead",
} as const

export type LeavePendingStage = (typeof LEAVE_PENDING_STAGES)[keyof typeof LEAVE_PENDING_STAGES]

export type LeaveEligibilityStatus = "eligible" | "not_eligible" | "missing_evidence"

export interface LeavePolicyRecord {
  leave_type_id: string
  annual_days: number
  eligibility: string
  min_tenure_months: number
  notice_days: number
  accrual_mode: "calendar_days" | "business_days"
  is_active: boolean
  eligibility_conditions?: Record<string, Json>
  required_documents?: string[]
  frequency_rules?: Record<string, Json>
  override_allowed?: boolean
}

export interface LeaveEligibilityResult {
  status: LeaveEligibilityStatus
  reason: string | null
  requiredDocuments: string[]
  missingDocuments: string[]
}

export type LeaveEmailEvent =
  | "approval_required"
  | "approved"
  | "rejected"
  | "ready_for_approval"
  | "sla_reminder"
  | "sla_breached"
  | "lapsed"

const APPROVAL_LEVELS: Record<string, number> = {
  pending_reliever: 1,
  pending_department_lead: 2,
  pending_admin_hr_lead: 3,
  pending_md: 3,
  pending_hcs: 3,
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DAY_MS = 24 * 60 * 60 * 1000

export function isValidUUID(value: string) {
  return UUID_REGEX.test(value)
}

export function parseISODate(dateString: string) {
  const parsed = new Date(`${dateString}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date format")
  }
  return parsed
}

export function toISODate(date: Date) {
  return toLocalISODate(date)
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

export function diffMonths(fromDate: Date, toDate: Date) {
  const years = toDate.getUTCFullYear() - fromDate.getUTCFullYear()
  const months = toDate.getUTCMonth() - fromDate.getUTCMonth()
  return years * 12 + months
}

function isWeekend(date: Date) {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

async function hasLifeEvent(
  supabase: LeaveWorkflowClient,
  employeeId: string,
  eventTypes: string[],
  windowDays?: number
): Promise<boolean> {
  let query = supabase
    .from("employee_life_events")
    .select("id, event_date")
    .eq("employee_id", employeeId)
    .in("event_type", eventTypes)
    .order("event_date", { ascending: false })
    .limit(1)

  if (windowDays && Number.isFinite(windowDays) && windowDays > 0) {
    const earliest = addDays(new Date(), -windowDays)
    query = query.gte("event_date", toISODate(earliest))
  }

  const { data } = await query
  return Boolean(data && data.length)
}

export async function getHolidaySet(
  supabase: LeaveWorkflowClient,
  location: string,
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase
    .from("holiday_calendar")
    .select("holiday_date, is_business_day")
    .eq("location", location)
    .gte("holiday_date", startDate)
    .lte("holiday_date", endDate)

  if (error) {
    throw new Error("Failed to fetch holiday calendar")
  }

  const holidaySet = new Set<string>()
  for (const row of (data || []) as HolidayCalendarRow[]) {
    if (!row.is_business_day) {
      holidaySet.add(row.holiday_date)
    }
  }

  return holidaySet
}

function isBusinessDay(date: Date, holidaySet: Set<string>) {
  if (isWeekend(date)) return false
  return !holidaySet.has(toISODate(date))
}

export async function computeLeaveDates(params: {
  supabase: LeaveWorkflowClient
  startDate: string
  daysCount: number
  accrualMode: "calendar_days" | "business_days"
  location?: string | null
}) {
  const start = parseISODate(params.startDate)

  if (params.daysCount <= 0) {
    throw new Error("Number of days must be greater than zero")
  }

  if (params.accrualMode === "calendar_days") {
    const end = addDays(start, params.daysCount - 1)
    const resume = addDays(end, 1)

    return {
      endDate: toISODate(end),
      resumeDate: toISODate(resume),
    }
  }

  const searchEnd = addDays(start, Math.max(120, params.daysCount * 4))
  const holidaySet = await getHolidaySet(
    params.supabase,
    params.location || "global",
    toISODate(start),
    toISODate(searchEnd)
  )

  let current = new Date(start)
  let counted = 0

  while (counted < params.daysCount) {
    if (isBusinessDay(current, holidaySet)) {
      counted += 1
      if (counted === params.daysCount) break
    }
    current = addDays(current, 1)
  }

  const end = current
  let resume = addDays(end, 1)
  while (!isBusinessDay(resume, holidaySet)) {
    resume = addDays(resume, 1)
  }

  return {
    endDate: toISODate(end),
    resumeDate: toISODate(resume),
  }
}

export async function resolveProfileByIdentifier(
  supabase: LeaveWorkflowClient,
  identifier: string,
  label: string
): Promise<{
  id: string
  full_name: string | null
  company_email: string | null
  additional_email: string | null
  department_id: string | null
}> {
  const input = identifier.trim()
  if (!input) throw new Error(`${label} is required`)

  if (isValidUUID(input)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, company_email, additional_email, department_id")
      .eq("id", input)
      .maybeSingle()

    if (error) throw new Error(`Failed to resolve ${label}`)
    if (!data) throw new Error(`${label} not found`)
    return data as MinimalProfileRow
  }

  const isEmail = input.includes("@")
  if (isEmail) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, company_email, additional_email, department_id")
      .ilike("company_email", input)

    if (error) throw new Error(`Failed to resolve ${label}`)
    if (!data?.length) throw new Error(`${label} email not found`)
    if (data.length > 1) throw new Error(`${label} email resolved to multiple records`)
    return data[0] as MinimalProfileRow
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, company_email, additional_email, department_id")
    .ilike("full_name", input)

  if (error) throw new Error(`Failed to resolve ${label}`)
  if (!data?.length) throw new Error(`${label} name not found`)
  if (data.length > 1) throw new Error(`${label} name is ambiguous. Use email or ID.`)
  return data[0] as MinimalProfileRow
}

export async function getSupervisorForUser(supabase: LeaveWorkflowClient, userId: string) {
  const { data: userProfile, error: userProfileError } = await supabase
    .from("profiles")
    .select("department_id")
    .eq("id", userId)
    .single()
  const typedUserProfile = userProfile as Pick<MinimalProfileRow, "department_id"> | null

  if (userProfileError || !typedUserProfile?.department_id) {
    throw new Error("Cannot determine your department for supervisor mapping")
  }

  const { data: supervisor, error: supervisorError } = await supabase
    .from("profiles")
    .select("id, full_name, company_email, additional_email, department_id")
    .eq("department_id", typedUserProfile.department_id)
    .eq("is_department_lead", true)
    .limit(1)
    .maybeSingle()

  if (supervisorError) {
    throw new Error("Failed to resolve supervisor")
  }

  if (!supervisor) {
    throw new Error("No department lead configured for your department")
  }

  return supervisor as MinimalProfileRow
}

export async function getLeavePolicy(supabase: LeaveWorkflowClient, leaveTypeId: string): Promise<LeavePolicyRecord> {
  const { data, error } = await supabase
    .from("leave_policies")
    .select(
      "leave_type_id, annual_days, eligibility, min_tenure_months, notice_days, accrual_mode, is_active, eligibility_conditions, required_documents, frequency_rules, override_allowed"
    )
    .eq("leave_type_id", leaveTypeId)
    .maybeSingle()

  // Backward compatibility: some environments may still run an older leave_policies schema
  // or a partially upgraded one. If the enriched policy query fails, retry a smaller legacy
  // shape before falling all the way back to leave type defaults.
  if (error) {
    log.warn({ leaveTypeId, err: error }, "Failed to load enriched leave policy, retrying legacy shape")

    const { data: legacyData, error: legacyError } = await supabase
      .from("leave_policies")
      .select("leave_type_id, annual_days, eligibility, min_tenure_months, notice_days, accrual_mode, is_active")
      .eq("leave_type_id", leaveTypeId)
      .maybeSingle()

    if (legacyError) {
      log.warn({ leaveTypeId, err: legacyError }, "Failed to load legacy leave policy, using leave type defaults")
    }

    if (!legacyError && legacyData?.is_active) {
      return {
        ...(legacyData as LeavePolicyRecord),
        eligibility_conditions: {},
        required_documents: [],
        frequency_rules: {},
        override_allowed: true,
      }
    }
  }

  if (data?.is_active) {
    return {
      ...(data as LeavePolicyRecord),
      eligibility_conditions: data.eligibility_conditions || {},
      required_documents: toStringArray(data.required_documents),
      frequency_rules: data.frequency_rules || {},
      override_allowed: data.override_allowed ?? true,
    }
  }

  const { data: leaveType, error: leaveTypeError } = await supabase
    .from("leave_types")
    .select("max_days")
    .eq("id", leaveTypeId)
    .single()

  const typedLeaveType = leaveType as LeaveTypeLimitRow | null
  if (leaveTypeError || !typedLeaveType) {
    throw new Error("Leave type not found")
  }

  return {
    leave_type_id: leaveTypeId,
    annual_days: typedLeaveType.max_days,
    eligibility: "all",
    min_tenure_months: 0,
    notice_days: 0,
    accrual_mode: "calendar_days",
    is_active: true,
    eligibility_conditions: {},
    required_documents: [],
    frequency_rules: {},
    override_allowed: true,
  }
}

export async function evaluateLeaveEligibility(params: {
  supabase: LeaveWorkflowClient
  policy: LeavePolicyRecord
  requesterProfile: {
    id: string
    gender: string | null
    employment_date: string | null
    employment_type?: string | null
    marital_status?: string | null
    has_children?: boolean | null
    pregnancy_status?: string | null
  }
  leaveType: { code?: string | null; name?: string | null }
  startDate: string
  daysCount: number
}): Promise<LeaveEligibilityResult> {
  const { supabase, policy, requesterProfile, leaveType, startDate, daysCount } = params
  const missingDocuments = new Set<string>()
  const requiredDocuments = new Set<string>(toStringArray(policy.required_documents))

  const normalizedGender = (requesterProfile.gender || "unspecified").toLowerCase()

  if (policy.eligibility === "female_only" && normalizedGender !== "female") {
    return {
      status: "not_eligible",
      reason: "This leave type is only available to female employees.",
      requiredDocuments: Array.from(requiredDocuments),
      missingDocuments: [],
    }
  }

  if (policy.eligibility === "male_only" && normalizedGender !== "male") {
    return {
      status: "not_eligible",
      reason: "This leave type is only available to male employees.",
      requiredDocuments: Array.from(requiredDocuments),
      missingDocuments: [],
    }
  }

  if (policy.min_tenure_months > 0) {
    if (!requesterProfile.employment_date) {
      return {
        status: "not_eligible",
        reason: "Employment date is required to validate tenure policy.",
        requiredDocuments: Array.from(requiredDocuments),
        missingDocuments: [],
      }
    }

    const hireDate = parseISODate(requesterProfile.employment_date)
    const leaveDate = parseISODate(startDate)
    const months = diffMonths(hireDate, leaveDate)

    if (months < policy.min_tenure_months) {
      return {
        status: "not_eligible",
        reason: `This leave type requires at least ${policy.min_tenure_months} months tenure.`,
        requiredDocuments: Array.from(requiredDocuments),
        missingDocuments: [],
      }
    }
  }

  if (policy.notice_days > 0) {
    const today = new Date()
    const todayIso = toISODate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())))
    const minDate = addDays(parseISODate(todayIso), policy.notice_days)
    const leaveStart = parseISODate(startDate)

    if (leaveStart < minDate) {
      return {
        status: "not_eligible",
        reason: `This leave type requires at least ${policy.notice_days} days notice.`,
        requiredDocuments: Array.from(requiredDocuments),
        missingDocuments: [],
      }
    }
  }

  const conditions = (policy.eligibility_conditions || {}) as Record<string, Json>
  const frequencyRules = (policy.frequency_rules || {}) as Record<string, Json>

  if (Array.isArray(conditions.allowed_employment_types) && conditions.allowed_employment_types.length > 0) {
    if (
      !requesterProfile.employment_type ||
      !conditions.allowed_employment_types.includes(requesterProfile.employment_type)
    ) {
      return {
        status: "not_eligible",
        reason: "Your employment type is not eligible for this leave type.",
        requiredDocuments: Array.from(requiredDocuments),
        missingDocuments: [],
      }
    }
  }

  if (Array.isArray(conditions.requires_marital_status_in) && conditions.requires_marital_status_in.length > 0) {
    if (
      !requesterProfile.marital_status ||
      !conditions.requires_marital_status_in.includes(requesterProfile.marital_status)
    ) {
      return {
        status: "not_eligible",
        reason: "Marital status requirement is not satisfied for this leave type.",
        requiredDocuments: Array.from(requiredDocuments),
        missingDocuments: [],
      }
    }
  }

  if (conditions.requires_has_children === true && !requesterProfile.has_children) {
    return {
      status: "not_eligible",
      reason: "This leave type requires employees with children.",
      requiredDocuments: Array.from(requiredDocuments),
      missingDocuments: [],
    }
  }

  const eventWindow = Number(conditions.event_window_days || 365)

  if (conditions.requires_pregnancy_event === true) {
    const profileSatisfies = ["pregnant", "postpartum"].includes(
      (requesterProfile.pregnancy_status || "").toLowerCase()
    )
    const hasEvent = await hasLifeEvent(supabase, requesterProfile.id, ["pregnancy", "childbirth"], eventWindow)

    if (!profileSatisfies && !hasEvent) {
      missingDocuments.add("medical_confirmation")
      requiredDocuments.add("medical_confirmation")
    }
  }

  if (conditions.requires_childbirth_or_adoption_event === true) {
    const hasEvent = await hasLifeEvent(supabase, requesterProfile.id, ["childbirth", "adoption"], eventWindow)
    if (!hasEvent) {
      missingDocuments.add("birth_or_adoption_proof")
      requiredDocuments.add("birth_or_adoption_proof")
    }
  }

  if (conditions.requires_bereavement_event === true) {
    const hasEvent = await hasLifeEvent(supabase, requesterProfile.id, ["bereavement"], eventWindow)
    if (!hasEvent) {
      missingDocuments.add("bereavement_declaration")
      requiredDocuments.add("bereavement_declaration")
    }
  }

  if (conditions.requires_study_purpose === true) {
    missingDocuments.add("admission_or_exam_letter")
    requiredDocuments.add("admission_or_exam_letter")
  }

  const medicalThreshold = Number(frequencyRules.medical_certificate_after_days || 0)
  if (medicalThreshold > 0 && daysCount > medicalThreshold) {
    requiredDocuments.add("medical_certificate")
    missingDocuments.add("medical_certificate")
  }

  const maxDaysPerRequest = Number(frequencyRules.max_days_per_request || 0)
  if (maxDaysPerRequest > 0 && daysCount > maxDaysPerRequest) {
    return {
      status: "not_eligible",
      reason: `This leave type allows at most ${maxDaysPerRequest} days per request.`,
      requiredDocuments: Array.from(requiredDocuments),
      missingDocuments: [],
    }
  }

  if (missingDocuments.size > 0) {
    const leaveName = leaveType.name || leaveType.code || "this leave type"
    return {
      status: "missing_evidence",
      reason: `Additional evidence is required before ${leaveName} can proceed for approval.`,
      requiredDocuments: Array.from(requiredDocuments),
      missingDocuments: Array.from(missingDocuments),
    }
  }

  return {
    status: "eligible",
    reason: null,
    requiredDocuments: Array.from(requiredDocuments),
    missingDocuments: [],
  }
}

export async function areRequiredDocumentsVerified(
  supabase: SupabaseClient,
  leaveRequestId: string,
  requiredDocuments: string[]
) {
  if (!requiredDocuments.length) {
    return { complete: true, missing: [] as string[] }
  }

  const { data: evidenceRows } = await supabase
    .from("leave_evidence")
    .select("document_type, status")
    .eq("leave_request_id", leaveRequestId)

  const verifiedSet = new Set(
    (evidenceRows || [])
      .filter((row: { status: string }) => row.status === "verified")
      .map((row: { document_type: string }) => row.document_type)
  )

  const missing = requiredDocuments.filter((doc) => !verifiedSet.has(doc))
  return {
    complete: missing.length === 0,
    missing,
  }
}

export async function assertNoOverlap(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDate: string,
  excludeRequestId?: string
) {
  let query = supabase
    .from("leave_requests")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["pending", "pending_evidence", "approved"])
    .lte("start_date", endDate)
    .gte("end_date", startDate)

  if (excludeRequestId) {
    query = query.neq("id", excludeRequestId)
  }

  const { data, error } = await query.limit(1)

  if (error) throw new Error("Failed to validate overlapping leave")
  if (data && data.length > 0) {
    throw new Error("You already have an overlapping leave request for this date range")
  }
}

export async function assertRelieverAvailability(
  supabase: SupabaseClient,
  relieverId: string,
  startDate: string,
  endDate: string,
  excludeRequestId?: string
) {
  let query = supabase
    .from("leave_requests")
    .select("id")
    .eq("user_id", relieverId)
    .in("status", ["pending", "pending_evidence", "approved"])
    .lte("start_date", endDate)
    .gte("end_date", startDate)

  if (excludeRequestId) {
    query = query.neq("id", excludeRequestId)
  }

  const { data, error } = await query.limit(1)

  if (error) throw new Error("Failed to validate reliever availability")
  if (data && data.length > 0) {
    throw new Error("Selected reliever is unavailable in the requested date range")
  }
}

function resolveLeaveNotificationType(emailEvent?: LeaveEmailEvent): { type: string; category: string } {
  switch (emailEvent) {
    case "approved":
      return { type: "approval_granted", category: "approvals" }
    case "rejected":
      return { type: "approval_rejected", category: "approvals" }
    case "sla_reminder":
    case "sla_breached":
    case "lapsed":
      return { type: "system", category: "system" }
    default:
      return { type: "approval_request", category: "approvals" }
  }
}

function buildNotificationRows(params: {
  userIds: string[]
  title: string
  message: string
  actorId?: string
  linkUrl?: string
  entityId?: string
  emailEvent?: LeaveEmailEvent
}) {
  const actionUrl = params.linkUrl || "/leave"
  const { type, category } = resolveLeaveNotificationType(params.emailEvent)
  return params.userIds.map((userId) => ({
    user_id: userId,
    type,
    category,
    title: params.title,
    message: params.message,
    priority: "high",
    action_url: actionUrl,
    data: {
      category,
      actor_id: params.actorId || null,
      entity_type: "leave_request",
      entity_id: params.entityId || null,
      link_url: actionUrl,
    },
  }))
}

export function formatLeaveReference(entityId?: string) {
  if (!entityId) return null
  const raw = entityId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  const compact = raw.slice(0, 8)
  if (!compact) return null
  return `LR-${compact}`
}

function buildLeaveEmailSubject(event: LeaveEmailEvent, entityId?: string) {
  const ref = formatLeaveReference(entityId)
  const suffix = ref ? ` — ${ref}` : ""

  // Every subject names the module. These used to read "Approved - LR-0042",
  // which said nothing about leave once the sender became the generic org
  // identity — the recipient had to open the mail to find out what it was.
  switch (event) {
    case "approval_required":
      return `Leave Request Awaiting Your Approval${suffix}`
    case "approved":
      return `Leave Request Approved${suffix}`
    case "rejected":
      return `Leave Request Rejected${suffix}`
    case "ready_for_approval":
      return `Leave Request Ready for Approval${suffix}`
    case "sla_reminder":
      return `Leave Approval SLA Reminder${suffix}`
    case "sla_breached":
      return `Leave Approval SLA Breached${suffix}`
    case "lapsed":
      return `Leave Request Lapsed${suffix}`
    default:
      return `Leave Notification${suffix}`
  }
}

export async function notifyUsers(
  supabase: SupabaseClient,
  params: {
    userIds: string[]
    title: string
    message: string
    actorId?: string
    linkUrl?: string
    entityId?: string
    emailEvent?: LeaveEmailEvent
    emailSubject?: string
    emailTitle?: string
    emailMessage?: string
    badgeText?: string
    badgeVariant?: LeaveBadgeVariant
    detailsTitle?: string
    details?: LeaveWorkflowDetail[]
    ctaLabel?: string
  }
) {
  const uniqueIds = Array.from(new Set(params.userIds.filter(Boolean)))
  if (!uniqueIds.length) return

  const [inAppUserIds, emailUserIds] = await Promise.all([
    resolveChannelEligibleUserIds(supabase, {
      userIds: uniqueIds,
      notificationKey: "leave",
      channel: "in_app",
    }),
    resolveChannelEligibleUserIds(supabase, {
      userIds: uniqueIds,
      notificationKey: "leave",
      channel: "email",
    }),
  ])

  if (inAppUserIds.length > 0) {
    const rows = buildNotificationRows({
      userIds: inAppUserIds,
      title: params.title,
      message: params.message,
      actorId: params.actorId,
      linkUrl: params.linkUrl,
      entityId: params.entityId,
      emailEvent: params.emailEvent,
    })

    const { error: notifyError } = await supabase.from("notifications").insert(rows)
    if (notifyError) {
      log.error({ err: notifyError }, "Failed to create leave notifications")
    }
  }

  if (emailUserIds.length === 0) return

  const { data: recipients } = await supabase
    .from("profiles")
    .select("company_email, additional_email")
    .in("id", emailUserIds)

  const emails: string[] = Array.from(
    new Set(
      ((recipients || []) as { company_email?: string | null; additional_email?: string | null }[])
        .flatMap((profile) => [profile.company_email, profile.additional_email])
        .filter((email): email is string => typeof email === "string" && email.length > 0)
    )
  )

  if (emails.length) {
    const subject =
      params.emailSubject ||
      (params.emailEvent ? buildLeaveEmailSubject(params.emailEvent, params.entityId) : params.title)

    const defaultBadgeVariant: Record<string, LeaveBadgeVariant> = {
      approved: "success",
      rejected: "destructive",
      approval_required: "warning",
      ready_for_approval: "warning",
      sla_reminder: "warning",
      sla_breached: "destructive",
      lapsed: "default",
    }
    const badgeVariant = params.badgeVariant || (params.emailEvent ? defaultBadgeVariant[params.emailEvent] : undefined)

    await sendLeaveWorkflowEmail({
      to: emails,
      subject,
      title: params.emailTitle || params.title,
      message: params.emailMessage || params.message,
      badgeText: params.badgeText,
      badgeVariant,
      detailsTitle: params.detailsTitle,
      details: params.details,
      ctaPath: params.linkUrl,
      ctaLabel: params.ctaLabel,
    })
  }
}

export async function createApprovalRecord(
  supabase: SupabaseClient,
  params: {
    leaveRequestId: string
    approverId: string
    stage: string
    action: "approved" | "rejected"
    comments?: string | null
  }
) {
  const approvalLevel = APPROVAL_LEVELS[params.stage] || 1

  await supabase.from("leave_approvals").insert({
    leave_request_id: params.leaveRequestId,
    approver_id: params.approverId,
    approval_level: approvalLevel,
    status: params.action,
    comments: params.comments || null,
    approved_at: new Date().toISOString(),
  })
}

export async function syncAttendanceForApprovedLeave(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDate: string,
  mode: "set" | "clear"
) {
  const start = parseISODate(startDate)
  const end = parseISODate(endDate)

  if (mode === "set") {
    const rows = []
    let current = new Date(start)

    while (current <= end) {
      rows.push({
        user_id: userId,
        date: toISODate(current),
        status: "on_leave",
        notes: "Auto-generated from approved leave",
      })
      current = addDays(current, 1)
    }

    if (rows.length) {
      await supabase.from("attendance_records").upsert(rows, { onConflict: "user_id,date", ignoreDuplicates: false })
    }

    return
  }

  await supabase
    .from("attendance_records")
    .delete()
    .eq("user_id", userId)
    .eq("status", "on_leave")
    .gte("date", startDate)
    .lte("date", endDate)
}
