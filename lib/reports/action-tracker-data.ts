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
}

type FetchActionTrackerItemsParams = {
  week: number
  year: number
  department?: string
  scopedDepartments?: string[]
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
  }
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
  }
}

export async function fetchActionTrackerItems(
  supabase: ActionTrackerClient,
  params: FetchActionTrackerItemsParams
): Promise<ActionTrackerItem[]> {
  let legacyQuery = supabase
    .from("action_items")
    .select("id, title, department, description, status, week_number, year, original_week, created_at")
    .eq("week_number", params.week)
    .eq("year", params.year)
    .order("department", { ascending: true })
    .order("created_at", { ascending: true })

  legacyQuery = applyDepartmentScope(legacyQuery, params)
  const { data: legacyRows, error: legacyError } = await legacyQuery.returns<LegacyActionItemRow[]>()
  if (legacyError) throw new Error(legacyError.message)

  return (legacyRows || []).map(normalizeLegacyActionItemRow)
}
