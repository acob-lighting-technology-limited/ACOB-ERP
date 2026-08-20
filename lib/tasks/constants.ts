export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "submitted_for_review",
  "completed",
  "unable_to_complete",
  "reassigned",
  "failed",
  "cancelled",
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_ASSIGNMENT_TYPES = ["individual", "multiple", "department"] as const
export type TaskAssignmentType = (typeof TASK_ASSIGNMENT_TYPES)[number]

export interface TaskStatusConfig {
  label: string
  color: string
  badgeVariant: "default" | "secondary" | "destructive" | "outline"
  description: string
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, TaskStatusConfig> = {
  pending: {
    label: "Pending",
    color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
    badgeVariant: "outline",
    description: "Task is assigned and awaiting commencement.",
  },
  in_progress: {
    label: "In Progress",
    color: "text-blue-600 bg-blue-500/10 border-blue-500/20",
    badgeVariant: "default",
    description: "Task is actively being worked on.",
  },
  submitted_for_review: {
    label: "Submitted for Review",
    color: "text-purple-600 bg-purple-500/10 border-purple-500/20",
    badgeVariant: "secondary",
    description: "Employee has submitted work for lead/admin approval.",
  },
  completed: {
    label: "Completed",
    color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
    badgeVariant: "default",
    description: "Task has been approved and completed.",
  },
  unable_to_complete: {
    label: "Unable to Complete",
    color: "text-orange-600 bg-orange-500/10 border-orange-500/20",
    badgeVariant: "destructive",
    description: "Employee reported an issue blocking completion.",
  },
  reassigned: {
    label: "Reassigned",
    color: "text-sky-600 bg-sky-500/10 border-sky-500/20",
    badgeVariant: "outline",
    description: "Task was reassigned to another person (neutral for employee KPI).",
  },
  failed: {
    label: "Failed",
    color: "text-rose-600 bg-rose-500/10 border-rose-500/20",
    badgeVariant: "destructive",
    description: "Task was marked as failed / expired without completion.",
  },
  cancelled: {
    label: "Cancelled",
    color: "text-muted-foreground bg-muted border-border",
    badgeVariant: "outline",
    description: "Task was cancelled.",
  },
}

export function formatTaskStatus(status: string | null | undefined): string {
  if (!status) return "Pending"
  const normalized = status.toLowerCase() as TaskStatus
  return TASK_STATUS_CONFIG[normalized]?.label || status.replaceAll("_", " ")
}
