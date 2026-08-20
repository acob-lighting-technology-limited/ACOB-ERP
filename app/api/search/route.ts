import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const log = logger("search")

// Mark this route as dynamic since it uses search params
export const dynamic = "force-dynamic"

type SearchType =
  | "profile"
  | "asset"
  | "task"
  | "documentation"
  | "feedback"
  | "helpdesk"
  | "leave"
  | "correspondence"
  | "payment"
  | "department"
  | "office_location"

interface SearchResult {
  id: string
  type: SearchType
  title: string
  subtitle?: string
  description?: string
  href: string
  metadata?: Record<string, unknown>
}

type Tier = "admin" | "lead" | "employee"

interface Scope {
  tier: Tier
  userId: string
  deptNames: string[]
  deptIds: string[]
  deptNameToId: Map<string, string>
  primaryDeptId: string
}

/** Resolve the lead's dept-console id for a given result department (falls back to primary). */
function leadDeptId(scope: Scope, departmentName?: string | null): string {
  if (departmentName && scope.deptNameToId.has(departmentName)) {
    return scope.deptNameToId.get(departmentName)!
  }
  return scope.primaryDeptId
}

/** Strip characters that break PostgREST `.or()` filter syntax. */
function sanitize(value: string): string {
  return value.replace(/[%,()]/g, " ").trim()
}

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`search:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 })
  }

  try {
    const rawQuery = request.nextUrl.searchParams.get("q")
    if (!rawQuery || rawQuery.trim().length < 2) {
      return NextResponse.json({ results: [] })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // -----------------------------------------------------------------------
    // Resolve the searcher's tier + department scope.
    // Everyone authenticated can search; results are scoped per tier and RLS
    // remains the backstop (the session client is used for every query).
    // -----------------------------------------------------------------------
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, department, department_id, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single<{
        id: string
        role: string | null
        department: string | null
        department_id: string | null
        is_department_lead: boolean | null
        lead_departments: string[] | null
      }>()

    if (!profile) {
      return NextResponse.json({ results: [] })
    }

    const role = String(profile.role || "").toLowerCase()
    const isAdminLike = ["developer", "admin", "super_admin"].includes(role)
    const isLead = Boolean(profile.is_department_lead)

    // Departments this user leads (name list) — used both for natural-lead
    // scoping and to authorize a `dept` context param.
    const leadNames =
      profile.lead_departments && profile.lead_departments.length > 0
        ? profile.lead_departments
        : profile.department
          ? [profile.department]
          : []

    // Surface-aware tier. When the search is fired from inside the dept console
    // the client sends `?dept=<id>`; if the user may act there (admin-like, or
    // actually leads that dept) we scope results to that single department and
    // route links into /dept/[id]. Otherwise tier derives from role alone.
    const deptParam = request.nextUrl.searchParams.get("dept")
    let tier: Tier = isAdminLike ? "admin" : isLead ? "lead" : "employee"

    const scope: Scope = {
      tier,
      userId: user.id,
      deptNames: [],
      deptIds: [],
      deptNameToId: new Map<string, string>(),
      primaryDeptId: "",
    }

    if (deptParam) {
      const { data: deptRow } = await supabase
        .from("departments")
        .select("id, name")
        .eq("id", deptParam)
        .single<{ id: string; name: string }>()
      const leadsThis = deptRow ? leadNames.includes(deptRow.name) || profile.department_id === deptParam : false
      if (deptRow && (isAdminLike || (isLead && leadsThis))) {
        tier = "lead"
        scope.tier = "lead"
        scope.deptNames = [deptRow.name]
        scope.deptIds = [deptRow.id]
        scope.deptNameToId.set(deptRow.name, deptRow.id)
        scope.primaryDeptId = deptRow.id
      }
    }

    // Natural lead (no usable dept param): scope to every department they lead.
    if (tier === "lead" && scope.deptNames.length === 0) {
      scope.deptNames = leadNames
      if (scope.deptNames.length > 0) {
        const { data: ledDepts } = await supabase.from("departments").select("id, name").in("name", scope.deptNames)
        for (const d of (ledDepts || []) as Array<{ id: string; name: string }>) {
          scope.deptNameToId.set(d.name, d.id)
        }
        scope.deptIds = Array.from(
          new Set([
            ...(ledDepts || []).map((d: { id: string }) => d.id),
            ...(profile.department_id ? [profile.department_id] : []),
          ])
        )
        scope.primaryDeptId = (ledDepts?.[0] as { id: string } | undefined)?.id ?? profile.department_id ?? ""
      } else if (profile.department_id) {
        scope.deptIds = [profile.department_id]
        scope.primaryDeptId = profile.department_id
      }
    }

    // Member ids for the lead's department(s) — used to scope user-owned tables
    // (e.g. leave requests) to the team rather than just the lead themselves.
    let deptMemberIds: string[] = []
    if (tier === "lead" && scope.deptNames.length > 0) {
      const { data: members } = await supabase.from("profiles").select("id").in("department", scope.deptNames)
      deptMemberIds = (members || []).map((m: { id: string }) => m.id)
    }

    const q = sanitize(rawQuery)
    if (q.length < 2) {
      return NextResponse.json({ results: [] })
    }
    const like = `%${q}%`

    // Convenience flags
    const canSeeDept = tier !== "employee"

    // -----------------------------------------------------------------------
    // Build the per-entity query set. Each entry is a promise resolving to
    // { data } or null when that entity is disabled for the current tier.
    // RLS scopes profiles/documentation automatically; the rest get explicit
    // tier filters below.
    // -----------------------------------------------------------------------
    const profilesQ = supabase
      .from("profiles")
      .select("id, first_name, last_name, company_email, department, role")
      .or(`first_name.ilike.${like},last_name.ilike.${like},company_email.ilike.${like},department.ilike.${like}`)
      .limit(5)

    // Assets — admin & lead only; leads are scoped to their department(s).
    let assetsQ = null
    if (canSeeDept) {
      let assetBuilder = supabase
        .from("assets")
        .select("id, unique_code, asset_type, asset_model, serial_number, status, department")
        .is("deleted_at", null)
        .or(`unique_code.ilike.${like},asset_type.ilike.${like},asset_model.ilike.${like},serial_number.ilike.${like}`)
      if (tier === "lead" && scope.deptNames.length > 0) assetBuilder = assetBuilder.in("department", scope.deptNames)
      assetsQ = assetBuilder.limit(5)
    }

    // Tasks — admin: all; lead: by department; employee: assigned to them.
    let tasksBuilder = supabase
      .from("tasks")
      .select("id, title, description, status, department, priority, assigned_to")
      .or(`title.ilike.${like},description.ilike.${like},department.ilike.${like}`)
    if (tier === "lead" && scope.deptNames.length > 0) tasksBuilder = tasksBuilder.in("department", scope.deptNames)
    if (tier === "employee") tasksBuilder = tasksBuilder.eq("assigned_to", scope.userId)
    const tasksQ = tasksBuilder.limit(5)

    // Documentation — all tiers (RLS scopes ownership/visibility).
    const docsQ = supabase
      .from("user_documentation")
      .select("id, title, content, category, user_id")
      .or(`title.ilike.${like},content.ilike.${like},category.ilike.${like}`)
      .limit(5)

    // Feedback — admin only (avoid cross-user leakage).
    const feedbackQ =
      tier === "admin"
        ? supabase
            .from("feedback")
            .select("id, title, description, feedback_type, status")
            .or(`title.ilike.${like},description.ilike.${like}`)
            .limit(5)
        : null

    // Help desk tickets — admin: all; lead: requester dept; employee: own.
    let helpdeskBuilder = supabase
      .from("help_desk_tickets")
      .select("id, ticket_number, title, description, status, priority, requester_department, requester_id")
      .or(`title.ilike.${like},description.ilike.${like},ticket_number.ilike.${like}`)
    if (tier === "lead" && scope.deptNames.length > 0)
      helpdeskBuilder = helpdeskBuilder.in("requester_department", scope.deptNames)
    if (tier === "employee") helpdeskBuilder = helpdeskBuilder.eq("requester_id", scope.userId)
    const helpdeskQ = helpdeskBuilder.limit(5)

    // Leave requests — admin: all; lead: their team's; employee: own.
    let leaveBuilder = supabase
      .from("leave_requests")
      .select("id, reason, status, user_id, start_date, end_date")
      .ilike("reason", like)
    if (tier === "lead") {
      leaveBuilder =
        deptMemberIds.length > 0 ? leaveBuilder.in("user_id", deptMemberIds) : leaveBuilder.eq("user_id", scope.userId)
    } else if (tier === "employee") {
      leaveBuilder = leaveBuilder.eq("user_id", scope.userId)
    }
    const leaveQ = leaveBuilder.limit(5)

    // Correspondence — admin: all; lead: by dept; employee: own created.
    let corrBuilder = supabase
      .from("correspondence_records")
      .select("id, reference_number, subject, recipient_name, sender_name, department_name, status, created_by_id")
      .or(`subject.ilike.${like},reference_number.ilike.${like},recipient_name.ilike.${like},sender_name.ilike.${like}`)
    if (tier === "lead" && scope.deptNames.length > 0) corrBuilder = corrBuilder.in("department_name", scope.deptNames)
    if (tier === "employee") corrBuilder = corrBuilder.eq("created_by_id", scope.userId)
    const corrQ = corrBuilder.limit(5)

    // Department payments — admin: all; lead: by dept id; employee: none.
    let paymentsQ = null
    if (canSeeDept) {
      let payBuilder = supabase
        .from("department_payments")
        .select("id, title, description, invoice_number, payment_reference, status, department_id, amount")
        .or(
          `title.ilike.${like},description.ilike.${like},invoice_number.ilike.${like},payment_reference.ilike.${like}`
        )
      if (tier === "lead" && scope.deptIds.length > 0) payBuilder = payBuilder.in("department_id", scope.deptIds)
      paymentsQ = payBuilder.limit(5)
    }

    // Departments — admin: all; lead: only the department(s) they lead.
    let departmentsQ = null
    if (canSeeDept) {
      let deptBuilder = supabase
        .from("departments")
        .select("id, name, description, department_code")
        .or(`name.ilike.${like},description.ilike.${like},department_code.ilike.${like}`)
      if (tier === "lead" && scope.deptNames.length > 0) deptBuilder = deptBuilder.in("name", scope.deptNames)
      departmentsQ = deptBuilder.limit(5)
    }

    // Office locations — admin: all; lead: by dept.
    let officeQ = null
    if (canSeeDept) {
      let officeBuilder = supabase
        .from("office_locations")
        .select("id, name, type, department, description")
        .or(`name.ilike.${like},department.ilike.${like},description.ilike.${like}`)
      if (tier === "lead" && scope.deptNames.length > 0) officeBuilder = officeBuilder.in("department", scope.deptNames)
      officeQ = officeBuilder.limit(5)
    }

    const [
      profilesRes,
      assetsRes,
      tasksRes,
      docsRes,
      feedbackRes,
      helpdeskRes,
      leaveRes,
      corrRes,
      paymentsRes,
      departmentsRes,
      officeRes,
    ] = await Promise.all([
      profilesQ,
      assetsQ,
      tasksQ,
      docsQ,
      feedbackQ,
      helpdeskQ,
      leaveQ,
      corrQ,
      paymentsQ,
      departmentsQ,
      officeQ,
    ])

    const results: SearchResult[] = []

    // --- Profiles -----------------------------------------------------------
    for (const p of (profilesRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(p.id)
      const name =
        `${(p.first_name as string) || ""} ${(p.last_name as string) || ""}`.trim() ||
        (p.company_email as string) ||
        "Unknown"
      const href =
        tier === "admin"
          ? `/admin/hr/employees/${id}`
          : tier === "lead"
            ? `/dept/${leadDeptId(scope, p.department as string)}/hr/employees`
            : `/profile`
      results.push({
        id,
        type: "profile",
        title: name,
        subtitle: (p.company_email as string) || undefined,
        description: `${(p.department as string) || ""} ${(p.role as string) || ""}`.trim() || undefined,
        href,
      })
    }

    // --- Assets -------------------------------------------------------------
    for (const a of (assetsRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(a.id)
      const href =
        tier === "admin" ? `/admin/assets?assetId=${id}` : `/dept/${leadDeptId(scope, a.department as string)}/assets`
      results.push({
        id,
        type: "asset",
        title: (a.unique_code as string) || (a.asset_type as string) || "Asset",
        subtitle: (a.asset_type as string) || undefined,
        description: (a.asset_model as string)
          ? `Model: ${a.asset_model}`
          : (a.serial_number as string)
            ? `SN: ${a.serial_number}`
            : (a.status as string) || undefined,
        href,
      })
    }

    // --- Tasks --------------------------------------------------------------
    for (const t of (tasksRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(t.id)
      const href =
        tier === "admin"
          ? `/admin/tasks?taskId=${id}`
          : tier === "lead"
            ? `/dept/${leadDeptId(scope, t.department as string)}/tasks`
            : `/tasks`
      results.push({
        id,
        type: "task",
        title: (t.title as string) || "Task",
        subtitle: (t.department as string) || undefined,
        description: (t.status as string) ? `Status: ${t.status}` : undefined,
        href,
      })
    }

    // --- Documentation ------------------------------------------------------
    for (const d of (docsRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(d.id)
      const href =
        tier === "admin"
          ? `/admin/documentation/internal?docId=${id}`
          : tier === "lead"
            ? `/dept/${scope.primaryDeptId}/documentation/internal`
            : `/documentation`
      results.push({
        id,
        type: "documentation",
        title: (d.title as string) || "Documentation",
        subtitle: (d.category as string) || undefined,
        description: (d.content as string) ? String(d.content).substring(0, 100).replace(/[#*`]/g, "") : undefined,
        href,
      })
    }

    // --- Feedback (admin) ---------------------------------------------------
    for (const f of (feedbackRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(f.id)
      results.push({
        id,
        type: "feedback",
        title: (f.title as string) || "Feedback",
        subtitle: (f.feedback_type as string) || undefined,
        description: (f.description as string) ? String(f.description).substring(0, 100) : undefined,
        href: `/admin/feedback?feedbackId=${id}`,
      })
    }

    // --- Help desk ----------------------------------------------------------
    for (const h of (helpdeskRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(h.id)
      const href =
        tier === "admin"
          ? `/admin/help-desk?ticketId=${id}`
          : tier === "lead"
            ? `/dept/${leadDeptId(scope, h.requester_department as string)}/help-desk`
            : `/help-desk`
      results.push({
        id,
        type: "helpdesk",
        title: (h.title as string) || "Help desk ticket",
        subtitle: (h.ticket_number as string) || undefined,
        description:
          `${(h.priority as string) || ""} ${(h.status as string) ? `• ${h.status}` : ""}`.trim() || undefined,
        href,
      })
    }

    // --- Leave --------------------------------------------------------------
    for (const l of (leaveRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(l.id)
      const href =
        tier === "admin"
          ? `/admin/hr/leave/approve?requestId=${id}`
          : tier === "lead"
            ? `/dept/${scope.primaryDeptId}/hr/leave`
            : `/leave`
      results.push({
        id,
        type: "leave",
        title: (l.reason as string) || "Leave request",
        subtitle: (l.status as string) || undefined,
        description: (l.start_date as string) && (l.end_date as string) ? `${l.start_date} → ${l.end_date}` : undefined,
        href,
      })
    }

    // --- Correspondence -----------------------------------------------------
    for (const c of (corrRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(c.id)
      const href =
        tier === "admin"
          ? `/admin/correspondence?recordId=${id}`
          : tier === "lead"
            ? `/dept/${leadDeptId(scope, c.department_name as string)}/correspondence`
            : `/correspondence`
      results.push({
        id,
        type: "correspondence",
        title: (c.subject as string) || (c.reference_number as string) || "Correspondence",
        subtitle: (c.reference_number as string) || undefined,
        description:
          `${(c.sender_name as string) || ""}${c.recipient_name ? ` → ${c.recipient_name}` : ""}`.trim() || undefined,
        href,
      })
    }

    // --- Department payments ------------------------------------------------
    for (const p of (paymentsRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(p.id)
      const href =
        tier === "admin" ? `/admin/accounts/payments?paymentId=${id}` : `/dept/${scope.primaryDeptId}/accounts/payments`
      results.push({
        id,
        type: "payment",
        title: (p.title as string) || (p.invoice_number as string) || "Payment",
        subtitle: (p.invoice_number as string) || (p.payment_reference as string) || undefined,
        description: (p.status as string) || undefined,
        href,
      })
    }

    // --- Departments --------------------------------------------------------
    for (const d of (departmentsRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(d.id)
      const name = (d.name as string) || "Department"
      const href = tier === "admin" ? `/admin/hr/departments` : `/dept/${leadDeptId(scope, name)}/hr/departments`
      results.push({
        id,
        type: "department",
        title: name,
        subtitle: (d.department_code as string) || undefined,
        description: (d.description as string) || undefined,
        href,
      })
    }

    // --- Office locations ---------------------------------------------------
    for (const o of (officeRes?.data || []) as Array<Record<string, unknown>>) {
      const id = String(o.id)
      const href = tier === "admin" ? `/admin/hr/office-location` : `/dept/${scope.primaryDeptId}/hr/office-location`
      results.push({
        id,
        type: "office_location",
        title: (o.name as string) || "Office location",
        subtitle: (o.type as string) || undefined,
        description: (o.department as string) || undefined,
        href,
      })
    }

    // Deduplicate by type+id
    const seen = new Set<string>()
    const deduped = results.filter((r) => {
      const key = `${r.type}-${r.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Sort: title-start matches first, then partial, then rest
    const queryLower = q.toLowerCase()
    deduped.sort((a, b) => {
      const aStart = a.title.toLowerCase().startsWith(queryLower)
      const bStart = b.title.toLowerCase().startsWith(queryLower)
      if (aStart && !bStart) return -1
      if (!aStart && bStart) return 1
      const aContains = a.title.toLowerCase().includes(queryLower)
      const bContains = b.title.toLowerCase().includes(queryLower)
      if (aContains && !bContains) return -1
      if (!aContains && bContains) return 1
      return 0
    })

    return NextResponse.json({ results: deduped.slice(0, 25) })
  } catch (error) {
    log.error({ err: String(error) }, "Search error")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
