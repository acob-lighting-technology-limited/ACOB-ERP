import type { SupabaseClient } from "@supabase/supabase-js"
import { getDepartmentAliases, normalizeDepartmentName } from "@/shared/departments"

/**
 * Anonymous upward feedback — "my lead, and only my lead".
 *
 * A staff member may submit feedback about a department lead ONLY when that lead
 * leads the staff member's own department. Eligibility is always resolved
 * server-side from the submitter's profile; the client never supplies a
 * department. See supabase/migrations/20260807000000_lead_anonymous_feedback.sql
 * for the storage/anonymity contract.
 */

/**
 * Timestamp for a lead-directed row: the start of the current WAT calendar day.
 *
 * A precise created_at can be correlated against platform request logs to unmask
 * the author, so lead feedback is only ever stamped to the day. The database
 * enforces this too (coarsen_lead_feedback_timestamps trigger); setting it here
 * keeps the guarantee intact even before that migration is applied.
 *
 * WAT is UTC+1 year-round with no DST, so the offset is a constant.
 */
export function watDayStampISO(now: Date = new Date()): string {
  const wat = new Date(now.getTime() + 60 * 60 * 1000)
  const month = String(wat.getUTCMonth() + 1).padStart(2, "0")
  const day = String(wat.getUTCDate()).padStart(2, "0")
  return `${wat.getUTCFullYear()}-${month}-${day}T00:00:00+01:00`
}

export interface EligibleLead {
  id: string
  first_name: string | null
  last_name: string | null
  designation: string | null
  department: string | null
}

interface LeadRow extends EligibleLead {
  is_department_lead: boolean | null
  lead_departments: string[] | null
  employment_status: string | null
}

const LEAD_COLUMNS =
  "id, first_name, last_name, designation, department, is_department_lead, lead_departments, employment_status"

function toPublicLead(row: LeadRow, department: string): EligibleLead {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    designation: row.designation,
    department,
  }
}

/**
 * Returns the department leads the given user is allowed to give feedback about:
 * the lead(s) of their own department, never themselves.
 *
 * Resolves to an empty array when the user has no department, or when their
 * department has no (non-exited) lead.
 */
export async function getEligibleLeadsForUser(db: SupabaseClient, userId: string): Promise<EligibleLead[]> {
  const { data: profile } = await db
    .from("profiles")
    .select("id, department")
    .eq("id", userId)
    .single<{ id: string; department: string | null }>()

  const rawDepartment = profile?.department?.trim()
  if (!rawDepartment) return []

  const myDepartment = normalizeDepartmentName(rawDepartment)
  const myDepartmentAliases = new Set(getDepartmentAliases(rawDepartment).map((d) => normalizeDepartmentName(d)))

  const { data: leads } = await db.from("profiles").select(LEAD_COLUMNS).eq("is_department_lead", true)

  return ((leads || []) as LeadRow[])
    .filter((lead) => {
      if (lead.id === userId) return false
      if (lead.employment_status === "exited") return false

      const leadsOwnDepartment = lead.department ? normalizeDepartmentName(lead.department) : null
      if (leadsOwnDepartment && myDepartmentAliases.has(leadsOwnDepartment)) return true

      const leadDepartments = Array.isArray(lead.lead_departments) ? lead.lead_departments : []
      return leadDepartments.some((d) => myDepartmentAliases.has(normalizeDepartmentName(d)))
    })
    .map((lead) => toPublicLead(lead, lead.department ? normalizeDepartmentName(lead.department) : myDepartment))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
}

/**
 * Validates a submitted target lead id against the submitter's own department.
 * Returns the resolved lead when allowed, or null when the target is not a lead
 * of the submitter's department (or is the submitter themselves).
 */
export async function resolveLeadFeedbackTarget(
  db: SupabaseClient,
  userId: string,
  targetLeadId: string
): Promise<EligibleLead | null> {
  const eligible = await getEligibleLeadsForUser(db, userId)
  return eligible.find((lead) => lead.id === targetLeadId) || null
}
