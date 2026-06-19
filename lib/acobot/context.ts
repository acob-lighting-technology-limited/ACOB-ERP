/**
 * AcoBot context builder.
 *
 * Turns a user's question into a permission-safe "CONTEXT" block that is injected
 * into the model prompt. Two tiers:
 *
 *  - Phase 2 (personal): the signed-in user's own leave balances, leave requests,
 *    help-desk tickets and tasks — every query is filtered by their user id, with
 *    Supabase RLS as defence-in-depth.
 *  - Phase 3 (role-scoped): for admins / department leads, light team summaries
 *    (pending leave approvals assigned to them, open tickets within their scope),
 *    bounded by the centralised `getRequestScope()` helper.
 *
 * Nothing here ever fetches another individual's private records for a normal
 * employee. If a query fails it is silently skipped so the chat still works.
 */
import type { NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { normalizeDepartmentName } from "@/shared/departments"
import { taskService } from "@/lib/services/tasks/task.service"
import { toLocalISODate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"

const log = logger("acobot-context")

// Loosely-typed client: we read a handful of columns and type each row shape
// locally rather than relying on the generated Database types (per AGENTS.md).
type AnySupabase = SupabaseClient

export interface AcobotIntent {
  leaveBalance: boolean
  leaveRequests: boolean
  tickets: boolean
  tasks: boolean
  approvals: boolean
  attendance: boolean
  profile: boolean
  assets: boolean
  /** Looking up a colleague's contact details or who leads a department. */
  directory: boolean
  /** The directory question is specifically about a department lead. */
  deptLead: boolean
}

/** Keyword-based intent detection over the latest user message. */
export function detectAcobotIntent(text: string): AcobotIntent {
  const q = text.toLowerCase()
  const has = (...words: string[]) => words.some((w) => q.includes(w))

  const mine = has("my", "mine", "i have", "do i", "am i", "owe", "remaining")

  return {
    leaveBalance:
      has("leave balance", "leave day", "days left", "annual leave", "vacation balance") ||
      (has("leave") && has("balance", "left", "remaining", "how many")),
    leaveRequests:
      has("my leave", "leave request", "leave status", "my request") ||
      (has("leave") && has("status", "pending", "applied", "request")),
    tickets: has("ticket", "help desk", "helpdesk", "support request", "my issue"),
    tasks:
      has("my task", "tasks assigned", "assigned to me", "to-do", "todo", "overdue task", "tasks due") ||
      (has("task") && (mine || has("overdue", "due soon", "open", "pending", "priority"))),
    approvals: has("approve", "approval", "to approve", "awaiting my", "pending my", "queue", "sign off", "sign-off"),
    attendance: has(
      "attendance",
      "clock in",
      "clock-in",
      "clocked in",
      "clock out",
      "come late",
      "came late",
      "late to work",
      "am i late",
      "was i late",
      "on time",
      "arrive",
      "arrived",
      "check in",
      "checked in",
      "present today"
    ),
    profile:
      has(
        "birthday",
        "birthdate",
        "birth date",
        "date of birth",
        "born",
        "how old",
        "my age",
        "years am i",
        "years old",
        "designation",
        "my title",
        "my profile",
        "my details",
        "my phone",
        "phone number",
        "my address",
        "my email",
        "my department",
        "my role",
        "my position"
      ) ||
      (mine && has("department", "role", "position", "designation", "title", "contact", "email", "phone", "address")),
    assets: has("asset", "my laptop", "my device", "equipment", "assigned to me a", "what do i have"),
    directory: directoryIntent(q),
    deptLead: leadIntent(q),
  }
}

/** Markers that the question is about the user's own data, not a colleague's. */
function isAboutSelf(q: string): boolean {
  return /\bmy\b|\bmine\b|\bmy own\b/.test(q)
}

function leadIntent(q: string): boolean {
  // \blead\b catches "ICT lead", "account lead", "the lead", "lead of", etc.
  // Native terms: Igbo (onye na-edu / onye isi), Yoruba (olóri), Hausa (shugaba(n)).
  return /\blead\b|\bleads\b|\bhead of\b|\bhod\b|\bsupervisor\b|\bmanager\b|\bin charge\b|\bwho leads\b|onye na-edu|onye isi|olor[ií]|shugab|oludari/.test(
    q
  )
}

function directoryIntent(q: string): boolean {
  const contact =
    /\bemail\b|\be-mail\b|\bphone\b|\bmobile\b|\bcontact\b|\breach\b|\bwhatsapp\b|\bextension\b|\bnumber\b/.test(q)
  // "who is …" person/role lookups — English plus Igbo/Yoruba/Hausa "who is".
  const whois = /\bwho is\b|\bwho's\b|\bwhos\b|kedu onye|tani\b|wane ne|wanene|ta ne /.test(q)
  // Contact / who-is lookups for a colleague (not "my ..."), or any lead question.
  return ((contact || whois) && !isAboutSelf(q)) || leadIntent(q)
}

export function intentNeedsData(intent: AcobotIntent): boolean {
  return Object.values(intent).some(Boolean)
}

// ---------- row shapes (narrow, local) ----------
type LeaveBalanceRow = {
  leave_type_id: string | null
  allocated_days?: number | null
  used_days?: number | null
  carry_forward_days?: number | null
  balance_days?: number | null
  leave_type?: { name?: string | null } | null
}
type LeaveRequestRow = {
  status: string | null
  start_date: string | null
  end_date: string | null
  days_count: number | null
  leave_type_id: string | null
}
type TicketRow = {
  ticket_number: string | null
  title: string | null
  status: string | null
  created_at: string | null
}
type TaskRow = {
  title: string | null
  status: string | null
  priority: string | null
  due_date: string | null
}
type LeaveTypeRow = { id: string; name: string | null }

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  return d.length >= 10 ? d.slice(0, 10) : d
}

async function leaveTypeNames(supabase: AnySupabase): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const { data } = await supabase.from("leave_types").select("id, name")
    for (const row of (data as unknown as LeaveTypeRow[] | null) ?? []) {
      if (row.id) map.set(row.id, row.name || "Leave")
    }
  } catch (err) {
    log.error({ err: String(err) }, "leave_types lookup failed")
  }
  return map
}

async function personalLeaveBalances(supabase: AnySupabase, userId: string): Promise<string | null> {
  try {
    const year = new Date().getFullYear()
    const { data, error } = await supabase
      .from("leave_balances")
      .select(
        `leave_type_id, allocated_days, used_days, carry_forward_days, balance_days,
         leave_type:leave_types!leave_balances_leave_type_id_fkey ( name )`
      )
      .eq("user_id", userId)
      .eq("year", year)
    if (error) {
      log.error({ err: error.message }, "leave_balances query error")
      return null
    }
    if (!data || data.length === 0) {
      return `No leave balance records are on file for the signed-in user for ${year}.`
    }

    const rows = data as unknown as LeaveBalanceRow[]
    const lines = rows.map((r) => {
      const name = r.leave_type?.name || "Leave"
      const allocated = r.allocated_days ?? null
      const used = r.used_days ?? null
      const remaining =
        r.balance_days ?? (allocated != null && used != null ? allocated + (r.carry_forward_days ?? 0) - used : null)
      const parts: string[] = []
      if (remaining != null) parts.push(`${remaining} day(s) remaining`)
      if (allocated != null) parts.push(`${allocated} allocated`)
      if (used != null) parts.push(`${used} used`)
      return `- **${name}**: ${parts.join(", ") || "no data"}`
    })
    return `Leave balances for the signed-in user (${year}):\n${lines.join("\n")}`
  } catch (err) {
    log.error({ err: String(err) }, "personal leave balances failed")
    return null
  }
}

async function personalLeaveRequests(
  supabase: AnySupabase,
  userId: string,
  typeNames: Map<string, string>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("leave_requests")
      .select("status, start_date, end_date, days_count, leave_type_id")
      .eq("user_id", userId)
      .order("start_date", { ascending: false })
      .limit(5)
    if (error || !data || data.length === 0) return null

    const rows = data as unknown as LeaveRequestRow[]
    const lines = rows.map((r) => {
      const name = (r.leave_type_id && typeNames.get(r.leave_type_id)) || "Leave"
      return `- **${name}** — ${fmtDate(r.start_date)} to ${fmtDate(r.end_date)} (${
        r.days_count ?? "?"
      } day(s)), status: ${r.status || "unknown"}`
    })
    return `The signed-in user's most recent leave requests:\n${lines.join("\n")}`
  } catch (err) {
    log.error({ err: String(err) }, "personal leave requests failed")
    return null
  }
}

async function personalTickets(supabase: AnySupabase, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("help_desk_tickets")
      .select("ticket_number, title, status, created_at")
      .or(`requester_id.eq.${userId},assigned_to.eq.${userId},created_by.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(8)
    if (error || !data || data.length === 0) return null

    const rows = data as unknown as TicketRow[]
    const lines = rows.map(
      (r) => `- #${r.ticket_number ?? "?"} **${r.title || "Untitled"}** — status: ${r.status || "unknown"}`
    )
    return `The signed-in user's help-desk tickets (raised by, assigned to, or created by them):\n${lines.join("\n")}`
  } catch (err) {
    log.error({ err: String(err) }, "personal tickets failed")
    return null
  }
}

async function personalTasks(userId: string): Promise<string | null> {
  try {
    // Reuses the canonical service: individual (assigned_to) + multiple (via
    // task_assignments) tasks, so department/group tasks are included too.
    const all = (await taskService.getByAssignedUser(userId)) as unknown as TaskRow[]
    const open = all
      .filter((t) => t.status !== "completed" && t.status !== "cancelled")
      .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
      .slice(0, 8)
    if (open.length === 0) {
      return "The signed-in user currently has no open tasks assigned to them."
    }
    const lines = open.map(
      (r) =>
        `- **${r.title || "Untitled"}** — ${r.status || "open"}, priority ${r.priority || "—"}, due ${fmtDate(
          r.due_date
        )}`
    )
    return `Open tasks assigned to the signed-in user:\n${lines.join("\n")}`
  } catch (err) {
    log.error({ err: String(err) }, "personal tasks failed")
    return null
  }
}

type AttendanceTodayRow = {
  date: string | null
  clock_in: string | null
  clock_out: string | null
  status: string | null
}

async function attendanceToday(supabase: AnySupabase, userId: string): Promise<string | null> {
  try {
    const today = toLocalISODate(new Date())
    const { data, error } = await supabase
      .from("attendance_records")
      .select("date, clock_in, clock_out, status")
      .eq("user_id", userId)
      .eq("date", today)
      .limit(1)
    if (error) return null
    const rows = (data as unknown as AttendanceTodayRow[] | null) ?? []
    if (rows.length === 0) {
      return `No attendance record has been logged for the signed-in user today (${today}). If they have clocked in, it may not be synced yet.`
    }
    const row = rows[0]
    const clockIn = row.clock_in ? row.clock_in.slice(11, 16) || row.clock_in : "not clocked in"
    const clockOut = row.clock_out ? row.clock_out.slice(11, 16) || row.clock_out : "not clocked out"
    return `Today's attendance for the signed-in user (${today}): clock-in ${clockIn}, clock-out ${clockOut}, recorded status: **${
      row.status || "unknown"
    }**. The "status" field already reflects whether they were on time or late.`
  } catch (err) {
    log.error({ err: String(err) }, "attendance today failed")
    return null
  }
}

type ProfileDetailRow = {
  first_name: string | null
  last_name: string | null
  full_name: string | null
  date_of_birth: string | null
  birthday: string | null
  phone_number: string | null
  residential_address: string | null
  department: string | null
  designation: string | null
  role: string | null
  company_email: string | null
}

async function profileDetails(supabase: AnySupabase, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "first_name, last_name, full_name, date_of_birth, birthday, phone_number, residential_address, department, designation, role, company_email"
      )
      .eq("id", userId)
      .maybeSingle()
    if (error || !data) return null
    const p = data as unknown as ProfileDetailRow
    const dob = p.date_of_birth || (p.birthday ? `${p.birthday} (month-day; birth year not on file)` : null)
    const fullName = p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null
    const lines = [
      // Use this EXACT name — never guess or shorten the surname.
      fullName ? `- Full name: ${fullName}` : null,
      dob ? `- Date of birth: ${dob}` : null,
      // Designation = job title (e.g. "Graduate Trainee"). Distinct from the system
      // access role below — never conflate the two.
      p.designation ? `- Designation (job title): ${p.designation}` : null,
      p.department ? `- Department: ${p.department}` : null,
      p.role ? `- System access role: ${p.role}` : null,
      p.company_email ? `- Company email: ${p.company_email}` : null,
      p.phone_number ? `- Phone: ${p.phone_number}` : null,
      p.residential_address ? `- Address: ${p.residential_address}` : null,
    ].filter((l): l is string => l !== null)
    if (lines.length === 0) return null
    return `Profile details for the signed-in user:\n${lines.join("\n")}`
  } catch (err) {
    log.error({ err: String(err) }, "profile details failed")
    return null
  }
}

// ---------- company directory (org-wide contact info) ----------
type DirectoryContactRow = {
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_email: string | null
  additional_email: string | null
  phone_number: string | null
  additional_phone: string | null
  department: string | null
  designation: string | null
  office_location: string | null
  is_department_lead: boolean | null
  lead_departments: string[] | null
  employment_status: string | null
}

const DIRECTORY_SELECT =
  "first_name, last_name, full_name, company_email, additional_email, phone_number, additional_phone, department, designation, office_location, is_department_lead, lead_departments, employment_status"

const DIRECTORY_STOPWORDS = new Set([
  "what",
  "whats",
  "what's",
  "is",
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "me",
  "my",
  "mine",
  "do",
  "does",
  "did",
  "i",
  "you",
  "your",
  "give",
  "tell",
  "get",
  "find",
  "know",
  "need",
  "please",
  "can",
  "could",
  "would",
  "email",
  "emails",
  "mail",
  "e-mail",
  "address",
  "phone",
  "number",
  "mobile",
  "contact",
  "details",
  "detail",
  "reach",
  "whatsapp",
  "call",
  "line",
  "extension",
  "his",
  "her",
  "their",
  "name",
  "who",
  "whos",
  "who's",
  "lead",
  "leads",
  "head",
  "hod",
  "department",
  "dept",
  "team",
  "manager",
  "and",
  "or",
  "in",
  "on",
  "at",
  "with",
  "from",
  "by",
  "that",
  "this",
  "please",
  "kindly",
  "like",
  "want",
  "show",
])

function extractNameTokens(q: string): string[] {
  return (
    q
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !DIRECTORY_STOPWORDS.has(t))
      // Strip a trailing possessive "s" ("emmanuels" / "jeromes" → "emmanuel" / "jerome").
      // ilike is substring-based, so this only broadens and still matches the original.
      .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
      .slice(0, 5)
  )
}

function formatContact(r: DirectoryContactRow): string {
  const name = r.full_name?.trim() || [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "Unknown"
  const bits: string[] = []
  if (r.designation) bits.push(r.designation)
  if (r.department) bits.push(normalizeDepartmentName(r.department))
  const meta: string[] = []
  if (r.company_email) meta.push(`email: ${r.company_email}`)
  if (r.additional_email) meta.push(`alt email: ${r.additional_email}`)
  if (r.phone_number) meta.push(`phone: ${r.phone_number}`)
  if (r.additional_phone) meta.push(`alt phone: ${r.additional_phone}`)
  if (r.office_location) meta.push(`office: ${r.office_location}`)
  if (r.is_department_lead) {
    const leads = (r.lead_departments?.length ? r.lead_departments.join(", ") : r.department) || ""
    meta.push(`department lead${leads ? ` of ${leads}` : ""}`)
  }
  const head = bits.length ? `**${name}** (${bits.join(", ")})` : `**${name}**`
  return `- ${head} — ${meta.join("; ") || "no contact details on file"}`
}

/**
 * Look up colleagues in the company directory. Contact details are org-wide and
 * shareable, so this returns matches for any staff member (excluding people who
 * have left). Handles two shapes: "what is X's email" and "who leads dept Y".
 */
async function directoryLookup(
  supabase: AnySupabase,
  message: string,
  isLeadQuestion: boolean
): Promise<string | null> {
  try {
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const tokens = extractNameTokens(message)
    const matches = new Map<string, DirectoryContactRow>()
    const keyOf = (r: DirectoryContactRow) => `${r.full_name || ""}|${r.company_email || ""}|${r.phone_number || ""}`

    // Name search — match colleagues by any name token.
    if (tokens.length > 0) {
      const orParts = tokens.flatMap((t) => [
        `first_name.ilike.%${t}%`,
        `last_name.ilike.%${t}%`,
        `full_name.ilike.%${t}%`,
      ])
      const { data } = await dataClient.from("profiles").select(DIRECTORY_SELECT).or(orParts.join(",")).limit(12)
      for (const r of (data as unknown as DirectoryContactRow[] | null) ?? []) {
        if (r.employment_status !== "exited") matches.set(keyOf(r), r)
      }
    }

    // Department-lead question — pull the leads (optionally narrowed by a dept token).
    if (isLeadQuestion && matches.size === 0) {
      const { data } = await dataClient
        .from("profiles")
        .select(DIRECTORY_SELECT)
        .eq("is_department_lead", true)
        .limit(40)
      let leads = ((data as unknown as DirectoryContactRow[] | null) ?? []).filter(
        (r) => r.employment_status !== "exited"
      )
      if (tokens.length > 0) {
        const narrowed = leads.filter((r) => {
          const deptNorm = r.department ? normalizeDepartmentName(r.department) : ""
          const hay = `${r.department || ""} ${deptNorm} ${(r.lead_departments || []).join(" ")}`.toLowerCase()
          return tokens.some((t) => {
            if (hay.includes(t)) return true
            // Resolve abbreviations like "ICT" → "IT and Communications".
            const tn = normalizeDepartmentName(t).toLowerCase()
            return tn !== t && hay.includes(tn)
          })
        })
        if (narrowed.length > 0) leads = narrowed
      }
      for (const r of leads) matches.set(keyOf(r), r)
    }

    if (matches.size === 0) return null
    const lines = Array.from(matches.values()).slice(0, 10).map(formatContact)
    return `Company directory matches (contact details are org-wide and shareable with the user):\n${lines.join("\n")}`
  } catch (err) {
    log.error({ err: String(err) }, "directory lookup failed")
    return null
  }
}

type AssetRow = {
  asset_type: string | null
  asset_model: string | null
  serial_number: string | null
  unique_code: string | null
  status: string | null
}
type AssignmentRow = { asset_id: string | null }

async function personalAssets(supabase: AnySupabase, userId: string): Promise<string | null> {
  try {
    // Individual assignments live in asset_assignments (is_current=true), then we
    // resolve details from assets — matching the /assets page. Use the service
    // client (like the page does), still strictly scoped to this user's id.
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { data: assignments, error: aErr } = await dataClient
      .from("asset_assignments")
      .select("asset_id")
      .eq("assigned_to", userId)
      .eq("is_current", true)
    if (aErr) {
      log.error({ err: aErr.message }, "asset_assignments query error")
      return null
    }
    const ids = ((assignments as AssignmentRow[] | null) ?? [])
      .map((a) => a.asset_id)
      .filter((id): id is string => Boolean(id))
    if (ids.length === 0) {
      return "No assets are currently assigned to the signed-in user."
    }

    const { data, error } = await dataClient
      .from("assets")
      .select("asset_type, asset_model, serial_number, unique_code, status")
      .in("id", ids)
      .limit(30)
    if (error) return null
    const rows = (data as unknown as AssetRow[] | null) ?? []
    if (rows.length === 0) {
      return "No assets are currently assigned to the signed-in user."
    }
    const lines = rows.map((r) => {
      const label = [r.asset_type, r.asset_model].filter(Boolean).join(" ") || "Asset"
      const tag = r.unique_code ? ` [${r.unique_code}]` : ""
      const serial = r.serial_number ? ` (S/N ${r.serial_number})` : ""
      return `- **${label}**${tag}${serial} — ${r.status || "assigned"}`
    })
    return `Assets currently assigned to the signed-in user:\n${lines.join("\n")}`
  } catch (err) {
    log.error({ err: String(err) }, "personal assets failed")
    return null
  }
}

/** Phase 3 — pending leave approvals assigned to this user, via the existing scoped endpoint. */
async function pendingApprovals(request: NextRequest, cookieHeader: string | null): Promise<string | null> {
  try {
    const origin = new URL(request.url).origin
    const res = await fetch(`${origin}/api/hr/leave/queue`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: unknown[] }
    const count = Array.isArray(json.data) ? json.data.length : 0
    if (count === 0) return "The signed-in user has no leave requests awaiting their approval right now."
    return `The signed-in user has **${count}** leave request(s) awaiting their approval. They can review them under Leave → Approval queue.`
  } catch (err) {
    log.error({ err: String(err) }, "pending approvals failed")
    return null
  }
}

/** Phase 3 — open tickets within the user's admin/lead scope. */
async function scopedOpenTickets(supabase: AnySupabase, depts: string[] | null): Promise<string | null> {
  try {
    let query = supabase.from("help_desk_tickets").select("*", { count: "exact", head: true }).neq("status", "closed")
    if (depts !== null) {
      if (depts.length === 0) return null
      const list = depts.map((d) => `"${d}"`).join(",")
      query = query.or(`service_department.in.(${list}),requester_department.in.(${list})`)
    }
    const { count, error } = await query
    if (error || count == null) return null
    const where = depts === null ? "across the organisation" : `in their department scope (${depts.join(", ")})`
    return `There are **${count}** open (not closed) help-desk ticket(s) ${where}.`
  } catch (err) {
    log.error({ err: String(err) }, "scoped open tickets failed")
    return null
  }
}

export interface BuildContextArgs {
  request: NextRequest
  supabase: AnySupabase
  userId: string
  message: string
}

/**
 * Build the CONTEXT block for a message, or null if nothing relevant/authorised.
 */
export async function buildAcobotContext({
  request,
  supabase,
  userId,
  message,
}: BuildContextArgs): Promise<string | null> {
  const intent = detectAcobotIntent(message)
  if (!intentNeedsData(intent)) return null

  const sections: string[] = []
  const typeNames = intent.leaveRequests ? await leaveTypeNames(supabase) : new Map<string, string>()

  // Phase 2 — personal data (always safe; filtered by the user's own id).
  const personalJobs: Array<Promise<string | null>> = []
  if (intent.leaveBalance) personalJobs.push(personalLeaveBalances(supabase, userId))
  if (intent.leaveRequests) personalJobs.push(personalLeaveRequests(supabase, userId, typeNames))
  if (intent.tickets) personalJobs.push(personalTickets(supabase, userId))
  if (intent.tasks) personalJobs.push(personalTasks(userId))
  if (intent.attendance) personalJobs.push(attendanceToday(supabase, userId))
  if (intent.profile) personalJobs.push(profileDetails(supabase, userId))
  if (intent.assets) personalJobs.push(personalAssets(supabase, userId))

  // Phase 3 — role-scoped team data (only when the user actually has scope).
  if (intent.approvals || intent.tickets) {
    const scope = await getRequestScope()
    if (scope) {
      const cookieHeader = request.headers.get("cookie")
      if (intent.approvals) {
        personalJobs.push(pendingApprovals(request, cookieHeader))
      }
      if (intent.tickets && scope.isAdminLike) {
        const depts = getScopedDepartments(scope)
        personalJobs.push(scopedOpenTickets(supabase, depts))
      }
    }
  }

  const results = await Promise.all(personalJobs)
  for (const r of results) {
    if (r) sections.push(r)
  }

  // Directory is handled explicitly: on a no-match we MUST emit an anti-fabrication
  // note, otherwise the model invents fake colleagues (names/emails/phones).
  if (intent.directory) {
    const dir = await directoryLookup(supabase, message, intent.deptLead)
    if (dir) {
      sections.push(dir)
    } else {
      sections.push(
        "DIRECTORY LOOKUP RESULT: No matching staff member or department lead was found for this request. Do NOT invent, guess, or fabricate any name, email, phone, office, or department under any circumstances. Tell the user you could not find that person/role in the staff directory and point them to the [Directory](/directory)."
      )
    }
  }

  // If a data intent fired but nothing came back, still return an explicit
  // no-data instruction rather than null — an empty context lets the model
  // hallucinate to fill the gap.
  if (sections.length === 0) {
    return [
      "CONTEXT — the user asked for personal or directory data, but no matching record was found for them.",
      "Do NOT invent, guess, or fabricate any names, numbers, dates, emails, phones, balances, or records. Tell the user you couldn't find that information and point them to the relevant page.",
    ].join("\n")
  }

  return [
    "CONTEXT — live data the signed-in user is authorised to see. Use ONLY this for any specific names, numbers, emails, phones, dates, or records. Never add, invent, guess, or complete anything (including surnames or contact details) that is not explicitly present below.",
    "",
    sections.join("\n\n"),
  ].join("\n")
}
