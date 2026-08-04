import type { Task, HelpDeskItem, CorrespondenceItem, PaymentItem } from "@/app/(app)/profile/page"

export const DUE_SOON_WINDOW_DAYS = 3

export const OPEN_TASK_STATUSES = new Set(["pending", "in_progress"])
const TERMINAL_HELP_DESK_STATUSES = new Set(["resolved", "closed", "cancelled", "rejected"])
const TERMINAL_CORRESPONDENCE_STATUSES = new Set(["filed", "closed", "cancelled"])
const PENDING_PAYMENT_STATUSES = new Set(["due", "overdue"])

export function isOpenTask(task: Task): boolean {
  return OPEN_TASK_STATUSES.has(task.status)
}

export function isOpenTicket(ticket: HelpDeskItem): boolean {
  return !TERMINAL_HELP_DESK_STATUSES.has(ticket.status)
}

export function isOpenCorrespondence(item: CorrespondenceItem): boolean {
  return !TERMINAL_CORRESPONDENCE_STATUSES.has(item.status)
}

export function isPendingPayment(payment: PaymentItem): boolean {
  return PENDING_PAYMENT_STATUSES.has(payment.status)
}

export type TaskUrgency =
  | { kind: "overdue"; days: number }
  | { kind: "due_soon"; days: number }
  | { kind: "scheduled"; dueDate: string }
  | { kind: "no_date" }

const DAY_MS = 24 * 60 * 60 * 1000

export function getTaskUrgency(task: Task, now: Date): TaskUrgency {
  if (!task.due_date) return { kind: "no_date" }
  const dueAt = new Date(task.due_date).getTime()
  const diff = dueAt - now.getTime()
  if (diff < 0) return { kind: "overdue", days: Math.max(1, Math.floor(-diff / DAY_MS)) }
  if (diff <= DUE_SOON_WINDOW_DAYS * DAY_MS) return { kind: "due_soon", days: Math.floor(diff / DAY_MS) }
  return { kind: "scheduled", dueDate: task.due_date }
}

const URGENCY_RANK: Record<TaskUrgency["kind"], number> = {
  overdue: 0,
  due_soon: 1,
  scheduled: 2,
  no_date: 3,
}

/** Open tasks sorted most-urgent first (overdue → due soon → scheduled → undated). */
export function sortTasksByUrgency(tasks: Task[], now: Date): Task[] {
  return tasks
    .filter(isOpenTask)
    .map((task) => ({ task, urgency: getTaskUrgency(task, now) }))
    .sort((a, b) => {
      const rankDiff = URGENCY_RANK[a.urgency.kind] - URGENCY_RANK[b.urgency.kind]
      if (rankDiff !== 0) return rankDiff
      const aDue = a.task.due_date ? new Date(a.task.due_date).getTime() : Infinity
      const bDue = b.task.due_date ? new Date(b.task.due_date).getTime() : Infinity
      return aDue - bDue
    })
    .map(({ task }) => task)
}

export function countOverdueTasks(tasks: Task[], now: Date): number {
  return tasks.filter((task) => isOpenTask(task) && getTaskUrgency(task, now).kind === "overdue").length
}

export function countDueSoonTasks(tasks: Task[], now: Date): number {
  return tasks.filter((task) => isOpenTask(task) && getTaskUrgency(task, now).kind === "due_soon").length
}
