import type { SupabaseClient } from "@supabase/supabase-js"

export type ActionTrackerClient = Pick<SupabaseClient, "from">

export type ActionTrackerTaskRow = {
  id: string
  title: string | null
  description: string | null
  status: string | null
  priority: string | null
  department: string | null
  due_date: string | null
  week_number: number | null
  year: number | null
  work_item_number: string | null
  created_at?: string | null
}

export type LegacyActionItemRow = {
  id: string
  title: string | null
  description: string | null
  status: string | null
  department: string | null
  week_number: number | null
  year: number | null
  original_week?: number | null
  created_at?: string | null
  position?: number | null
  origin?: string | null
  meeting_date?: string | null
  timeline_text?: string | null
  blocker_note?: string | null
  blocker_reported_at?: string | null
  blocker_reported_by?: string | null
}

export type ActionItemOrigin = "weekly_report" | "management_directive"

export type ActionTrackerAssignee = {
  id: string
  name: string
  department?: string
}

export type ActionTrackerItem = {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  department: string
  due_date?: string
  week_number: number
  year: number
  original_week?: number
  work_item_number?: string
  source: "tasks" | "action_items"
  position: number
  origin: ActionItemOrigin
  meeting_date?: string
  timeline_text?: string
  assignees: ActionTrackerAssignee[]
  /** What is preventing completion. Undefined when nothing has been reported. */
  blocker_note?: string
  blocker_reported_at?: string
  blocker_reported_by?: string
  blocker_reported_by_name?: string
  /** Supporting evidence is optional, so this is 0 for most reported hindrances. */
  evidence_count: number
}

type FetchActionTrackerItemsParams = {
  week: number
  year: number
  department?: string
  scopedDepartments?: string[]
  /** Narrow to one category. Omit to return weekly action points and directives together. */
  origin?: ActionItemOrigin
}

function applyDepartmentScope<Query>(query: Query, params: FetchActionTrackerItemsParams) {
  let scopedQuery = query as Query & {
    in: (column: string, values: string[]) => Query
    eq: (column: string, value: string) => Query
  }

  if (params.scopedDepartments && params.scopedDepartments.length > 0) {
    scopedQuery = scopedQuery.in("department", params.scopedDepartments) as typeof scopedQuery
  }

  if (params.department && params.department !== "all") {
    scopedQuery = scopedQuery.eq("department", params.department) as typeof scopedQuery
  }

  return scopedQuery
}

export function normalizeActionTrackerTaskRow(row: ActionTrackerTaskRow): ActionTrackerItem {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    description: row.description || undefined,
    status: String(row.status || "pending"),
    priority: String(row.priority || "medium"),
    department: String(row.department || ""),
    due_date: row.due_date || undefined,
    week_number: Number(row.week_number || 0),
    year: Number(row.year || 0),
    work_item_number: row.work_item_number || undefined,
    source: "tasks",
    position: 0,
    origin: "weekly_report",
    assignees: [],
    evidence_count: 0,
  }
}

function normalizeOrigin(value: string | null | undefined): ActionItemOrigin {
  return value === "management_directive" ? "management_directive" : "weekly_report"
}

export function normalizeLegacyActionItemRow(row: LegacyActionItemRow): ActionTrackerItem {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    description: row.description || undefined,
    status: String(row.status || "pending"),
    priority: "medium",
    department: String(row.department || ""),
    due_date: undefined,
    week_number: Number(row.week_number || 0),
    year: Number(row.year || 0),
    original_week: row.original_week ?? undefined,
    work_item_number: undefined,
    source: "action_items",
    position: Number(row.position ?? 0),
    origin: normalizeOrigin(row.origin),
    meeting_date: row.meeting_date || undefined,
    timeline_text: row.timeline_text || undefined,
    assignees: [],
    blocker_note: row.blocker_note || undefined,
    blocker_reported_at: row.blocker_reported_at || undefined,
    blocker_reported_by: row.blocker_reported_by || undefined,
    evidence_count: 0,
  }
}

type AssigneeRow = { action_item_id: string; profile_id: string }
type DirectoryRow = { id: string; full_name: string | null; department: string | null }
type EvidenceCountRow = { action_item_id: string }

/**
 * Fills in the three things the action_items row alone cannot answer: named
 * responsible staff (directives only), how many evidence files are attached, and
 * who reported the hindrance. All three name lookups share one directory query.
 */
async function enrichItems(
  supabase: ActionTrackerClient,
  items: ActionTrackerItem[],
  reporterIds: Map<string, string>
): Promise<ActionTrackerItem[]> {
  if (items.length === 0) return items

  const directiveIds = items.filter((item) => item.origin === "management_directive").map((item) => item.id)
  const itemIds = items.map((item) => item.id)

  const [assigneeResult, evidenceResult] = await Promise.all([
    directiveIds.length > 0
      ? supabase
          .from("action_item_assignees")
          .select("action_item_id, profile_id")
          .in("action_item_id", directiveIds)
          .returns<AssigneeRow[]>()
      : Promise.resolve({ data: [] as AssigneeRow[] }),
    supabase
      .from("action_item_evidence")
      .select("action_item_id")
      .in("action_item_id", itemIds)
      .returns<EvidenceCountRow[]>(),
  ])

  const assigneeRows = assigneeResult.data || []
  const evidenceRows = evidenceResult.data || []

  const evidenceCounts = new Map<string, number>()
  evidenceRows.forEach((row) => {
    evidenceCounts.set(row.action_item_id, (evidenceCounts.get(row.action_item_id) || 0) + 1)
  })

  const neededProfileIds = Array.from(
    new Set([...assigneeRows.map((row) => row.profile_id), ...Array.from(reporterIds.values())])
  )

  // staff_directory, not profiles: profiles RLS shows a plain employee only their
  // own row, which would blank out every other name here.
  const peopleById = new Map<string, DirectoryRow>()
  if (neededProfileIds.length > 0) {
    const { data: people } = await supabase
      .from("staff_directory")
      .select("id, full_name, department")
      .in("id", neededProfileIds)
      .returns<DirectoryRow[]>()
    ;(people || []).forEach((person) => peopleById.set(person.id, person))
  }

  const assigneesByItem = new Map<string, ActionTrackerAssignee[]>()
  assigneeRows.forEach((row) => {
    const person = peopleById.get(row.profile_id)
    const existing = assigneesByItem.get(row.action_item_id) || []
    existing.push({
      id: row.profile_id,
      name: person?.full_name || "Unknown",
      department: person?.department || undefined,
    })
    assigneesByItem.set(row.action_item_id, existing)
  })

  return items.map((item) => {
    const reporterId = reporterIds.get(item.id)
    return {
      ...item,
      assignees: (assigneesByItem.get(item.id) || []).sort((a, b) => a.name.localeCompare(b.name)),
      evidence_count: evidenceCounts.get(item.id) || 0,
      blocker_reported_by_name: reporterId ? peopleById.get(reporterId)?.full_name || undefined : undefined,
    }
  })
}

export async function fetchActionTrackerItems(
  supabase: ActionTrackerClient,
  params: FetchActionTrackerItemsParams
): Promise<ActionTrackerItem[]> {
  let legacyQuery = supabase
    .from("action_items")
    .select(
      "id, title, department, description, status, week_number, year, original_week, created_at, position, origin, meeting_date, timeline_text, blocker_note, blocker_reported_at, blocker_reported_by"
    )
    .eq("week_number", params.week)
    .eq("year", params.year)
    .order("department", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })

  legacyQuery = applyDepartmentScope(legacyQuery, params)

  if (params.origin) {
    legacyQuery = legacyQuery.eq("origin", params.origin)
  }

  const { data: legacyRows, error: legacyError } = await legacyQuery.returns<LegacyActionItemRow[]>()
  if (legacyError) throw new Error(legacyError.message)

  const rows = legacyRows || []
  const reporterIds = new Map<string, string>()
  rows.forEach((row) => {
    if (row.blocker_reported_by) reporterIds.set(String(row.id), String(row.blocker_reported_by))
  })

  return enrichItems(supabase, rows.map(normalizeLegacyActionItemRow), reporterIds)
}
