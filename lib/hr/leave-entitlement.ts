import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { evaluateLeaveEligibility, getLeavePolicy } from "@/lib/hr/leave-workflow"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("hr-leave-entitlement")

/**
 * Leave entitlement, derived rather than stored.
 *
 * The allocation never varies: it is whatever the leave type says, and it resets on 1 January.
 * Storing that as rows per person, per type, per year meant something had to create those rows
 * every year — which nothing did, so staff onboarded between manual imports had no entitlement
 * at all and 1 January would have left the whole company with none.
 *
 * Here the allocation comes from the leave type and usage is summed from the employee's own
 * leave requests. Nothing to seed, nothing to roll over, and a cancelled request frees its days
 * automatically because the sum simply changes.
 *
 * In-flight requests (pending / pending_evidence) count against the remaining figure so someone
 * cannot submit two requests that only fit one at a time. `usedDays` reports approved leave
 * alone, which is what payroll and reporting care about.
 */

/** Statuses that consume entitlement — approved leave plus anything still in the pipeline. */
export const COMMITTED_LEAVE_STATUSES = ["pending", "pending_evidence", "approved"] as const

export type LeaveEntitlement = {
  leaveTypeId: string
  name: string
  code: string | null
  /** Days the leave type grants for a full year. */
  entitlementDays: number
  /** Days already taken (approved requests only). */
  usedDays: number
  /** Days committed to requests still awaiting a decision. */
  pendingDays: number
  /** entitlementDays − usedDays − pendingDays, floored at zero. */
  remainingDays: number
  /**
   * True for types with no policy rules — granted case by case rather than allocated yearly
   * (LWOP). Selectable like any other type; there is simply no annual allowance to count down,
   * so `remainingDays` is not a meaningful figure to show.
   */
  uncapped: boolean
  /** Policy requires documents the employee has not supplied. */
  needsEvidence: boolean
}

type LeaveTypeRow = { id: string; name: string; code: string | null; max_days: number | null; lead_max_days: number | null }
type RequestRow = { leave_type_id: string; days_count: number | null; status: string }

/** Leads get a higher entitlement on types with a lead_max_days override (e.g. Annual Leave). */
function resolveEntitlementDays(
  leaveType: { max_days: number | null; lead_max_days?: number | null },
  isLead: boolean
): number {
  if (isLead && leaveType.lead_max_days != null) return Number(leaveType.lead_max_days)
  return Number(leaveType.max_days ?? 0)
}

function isLeadProfile(profile: { is_department_lead?: boolean | null; lead_departments?: string[] | null } | null) {
  return Boolean(profile?.is_department_lead) || Boolean(profile?.lead_departments?.length)
}

function yearBounds(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

/**
 * Sum committed days per leave type for one employee in one year, split by approved vs pending.
 * Leave is attributed to the year it starts in, matching how the balances were tracked before.
 */
async function getCommittedDays(
  client: SupabaseClient,
  userId: string,
  year: number,
  options?: { excludeRequestId?: string }
): Promise<Map<string, { used: number; pending: number }>> {
  const { from, to } = yearBounds(year)
  let query = client
    .from("leave_requests")
    .select("leave_type_id, days_count, status, start_date, end_date")
    .eq("user_id", userId)
    .in("status", COMMITTED_LEAVE_STATUSES as unknown as string[])
    .gte("start_date", from)
    .lte("start_date", to)

  if (options?.excludeRequestId) query = query.neq("id", options.excludeRequestId)

  const { data, error } = await query
  if (error) {
    log.error({ userId, year, err: String(error) }, "Failed to load leave requests for entitlement")
    throw new Error("Failed to load leave requests")
  }

  const totals = new Map<string, { used: number; pending: number }>()
  for (const row of (data ?? []) as Array<RequestRow & { start_date: string; end_date: string }>) {
    const days = Number(row.days_count ?? 0) || inclusiveDays(row.start_date, row.end_date)
    const entry = totals.get(row.leave_type_id) ?? { used: 0, pending: 0 }
    if (row.status === "approved") entry.used += days
    else entry.pending += days
    totals.set(row.leave_type_id, entry)
  }
  return totals
}

/** Fallback when days_count was never written — mirrors the leave request route's own fallback. */
function inclusiveDays(start: string, end: string): number {
  if (!start || !end) return 0
  const ms = new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000) + 1)
}

/**
 * Every leave type available to this employee, with days used and remaining.
 *
 * Types the employee is not eligible for are omitted, so men get no maternity and women no
 * paternity. Types with no policy rules (LWOP) are still listed — they are real leave people
 * take — but flagged `uncapped`, because they are granted case by case rather than allocated
 * as a yearly allowance.
 */
export async function getLeaveEntitlements(
  client: SupabaseClient,
  userId: string,
  options?: { year?: number; excludeRequestId?: string }
): Promise<LeaveEntitlement[]> {
  const year = options?.year ?? new Date().getUTCFullYear()

  const [{ data: profile }, { data: leaveTypes }, { data: activePolicies }, committed] = await Promise.all([
    client
      .from("profiles")
      .select(
        "id, gender, employment_date, employment_type, marital_status, has_children, pregnancy_status, is_department_lead, lead_departments"
      )
      .eq("id", userId)
      .maybeSingle(),
    client.from("leave_types").select("id, name, code, max_days, lead_max_days").eq("is_active", true).order("name"),
    client.from("leave_policies").select("leave_type_id").eq("is_active", true),
    getCommittedDays(client, userId, year, { excludeRequestId: options?.excludeRequestId }),
  ])

  const requesterProfile = profile ?? {
    id: userId,
    gender: "unspecified",
    employment_date: null,
    employment_type: null,
    marital_status: "unspecified",
    has_children: false,
    pregnancy_status: "unspecified",
  }

  const allocatable = new Set((activePolicies ?? []).map((p) => p.leave_type_id as string))
  const today = toLocalISODate()
  const entitlements: LeaveEntitlement[] = []
  const isLead = isLeadProfile(requesterProfile as { is_department_lead?: boolean; lead_departments?: string[] })

  for (const lt of (leaveTypes ?? []) as LeaveTypeRow[]) {
    const uncapped = !allocatable.has(lt.id)

    let needsEvidence = false
    try {
      const policy = await getLeavePolicy(client, lt.id)
      const evaluation = await evaluateLeaveEligibility({
        supabase: client,
        policy,
        requesterProfile,
        leaveType: lt,
        startDate: today,
        daysCount: 1,
      })
      if (evaluation.status === "not_eligible") continue
      needsEvidence = evaluation.status === "missing_evidence"
    } catch (err) {
      log.warn({ userId, leaveTypeId: lt.id, err: String(err) }, "Skipping leave type with unresolvable policy")
      continue
    }

    const totals = committed.get(lt.id) ?? { used: 0, pending: 0 }
    const entitlementDays = resolveEntitlementDays(lt, isLead)

    entitlements.push({
      leaveTypeId: lt.id,
      name: lt.name,
      code: lt.code,
      entitlementDays,
      usedDays: totals.used,
      pendingDays: totals.pending,
      remainingDays: Math.max(0, entitlementDays - totals.used - totals.pending),
      uncapped,
      needsEvidence,
    })
  }

  return entitlements
}

/** Remaining days for a single leave type — the check used before accepting a request. */
export async function getRemainingDays(
  client: SupabaseClient,
  userId: string,
  leaveTypeId: string,
  options?: { year?: number; excludeRequestId?: string }
): Promise<number> {
  const year = options?.year ?? new Date().getUTCFullYear()

  const [{ data: leaveType }, { data: policy }, { data: profile }, committed] = await Promise.all([
    client
      .from("leave_types")
      .select("max_days, lead_max_days")
      .eq("id", leaveTypeId)
      .maybeSingle<{ max_days: number | null; lead_max_days: number | null }>(),
    client
      .from("leave_policies")
      .select("leave_type_id")
      .eq("leave_type_id", leaveTypeId)
      .eq("is_active", true)
      .maybeSingle(),
    client
      .from("profiles")
      .select("is_department_lead, lead_departments")
      .eq("id", userId)
      .maybeSingle<{ is_department_lead: boolean | null; lead_departments: string[] | null }>(),
    getCommittedDays(client, userId, year, { excludeRequestId: options?.excludeRequestId }),
  ])

  const maxDays = leaveType ? resolveEntitlementDays(leaveType, isLeadProfile(profile)) : 0
  // Uncapped types (LWOP) have no yearly allowance to exhaust — only the type's own per-request
  // ceiling applies, so the request check must not reject on days already taken.
  if (!policy) return maxDays

  const totals = committed.get(leaveTypeId) ?? { used: 0, pending: 0 }
  return Math.max(0, maxDays - totals.used - totals.pending)
}
