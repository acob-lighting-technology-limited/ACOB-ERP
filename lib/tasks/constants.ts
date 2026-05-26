export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_ASSIGNMENT_TYPES = ["individual", "department"] as const
export type TaskAssignmentType = (typeof TASK_ASSIGNMENT_TYPES)[number]
