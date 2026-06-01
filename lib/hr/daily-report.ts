// Shared constants + helpers for the Daily Activity Report (DAR) feature.
// Kept framework-agnostic so both API routes and client components can import it.

export const DAILY_TASK_STATUSES = ["not_started", "in_progress", "completed"] as const
export type DailyTaskStatus = (typeof DAILY_TASK_STATUSES)[number]

export const DAILY_TASK_STATUS_LABELS: Record<DailyTaskStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
}

export const DAILY_TASK_STATUS_COLORS: Record<DailyTaskStatus, string> = {
  not_started: "bg-gray-100 text-gray-700",
  in_progress: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
}

export const DAILY_TASK_TYPES = ["planned", "unforeseen"] as const
export type DailyTaskType = (typeof DAILY_TASK_TYPES)[number]

export const DAILY_TASK_TYPE_LABELS: Record<DailyTaskType, string> = {
  planned: "Planned",
  unforeseen: "Unforeseen",
}

export const DAILY_REPORT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
}

export const DAILY_REPORT_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-800",
}

/**
 * The two rollup metrics shown on the original spreadsheet:
 *  - total_completed:       tasks whose status is "completed"
 *  - unforeseen_completed:  completed tasks whose type is "unforeseen"
 */
export function computeDailyTotals(tasks: { status: string; task_type: string | null }[]) {
  let total_completed = 0
  let unforeseen_completed = 0
  for (const t of tasks) {
    if (t.status === "completed") {
      total_completed += 1
      if (t.task_type === "unforeseen") unforeseen_completed += 1
    }
  }
  return { total_completed, unforeseen_completed }
}
