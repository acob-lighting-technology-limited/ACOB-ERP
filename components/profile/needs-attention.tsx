"use client"

import Link from "next/link"
import { AlertTriangle, CalendarClock, Clock, FileCode2, Ticket } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import type { Task, LeaveItem, HelpDeskItem, CorrespondenceItem } from "@/app/(app)/profile/page"

const OPEN_TASK_STATUSES = new Set(["pending", "in_progress"])
const TERMINAL_HELP_DESK_STATUSES = new Set(["resolved", "closed", "cancelled", "rejected"])
const TERMINAL_CORRESPONDENCE_STATUSES = new Set(["filed", "closed", "cancelled"])
const DUE_SOON_WINDOW_DAYS = 3

function isOverdue(task: Task, now: Date): boolean {
  if (!task.due_date || !OPEN_TASK_STATUSES.has(task.status)) return false
  return new Date(task.due_date).getTime() < now.getTime()
}

function isDueSoon(task: Task, now: Date): boolean {
  if (!task.due_date || !OPEN_TASK_STATUSES.has(task.status)) return false
  const dueAt = new Date(task.due_date).getTime()
  const windowEnd = now.getTime() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return dueAt >= now.getTime() && dueAt <= windowEnd
}

interface NeedsAttentionProps {
  tasks: Task[]
  leave: LeaveItem[]
  helpDesk: HelpDeskItem[]
  correspondence: CorrespondenceItem[]
}

export function NeedsAttention({ tasks, leave, helpDesk, correspondence }: NeedsAttentionProps) {
  const now = new Date()

  const overdueTasks = tasks.filter((task) => isOverdue(task, now)).length
  const dueSoonTasks = tasks.filter((task) => isDueSoon(task, now)).length
  const pendingLeave = leave.filter((item) => item.status === "pending").length
  const openTickets = helpDesk.filter((item) => !TERMINAL_HELP_DESK_STATUSES.has(item.status)).length
  const openCorrespondence = correspondence.filter((item) => !TERMINAL_CORRESPONDENCE_STATUSES.has(item.status)).length

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Link href="/tasks">
        <StatCard
          title="Overdue Tasks"
          value={overdueTasks}
          icon={AlertTriangle}
          iconBgColor="bg-red-500/10"
          iconColor="text-red-600"
        />
      </Link>
      <Link href="/tasks">
        <StatCard
          title="Due Soon"
          value={dueSoonTasks}
          icon={Clock}
          iconBgColor="bg-amber-500/10"
          iconColor="text-amber-600"
          description="Next 3 days"
        />
      </Link>
      <Link href="/leave">
        <StatCard
          title="Pending Leave"
          value={pendingLeave}
          icon={CalendarClock}
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-600"
        />
      </Link>
      <Link href="/help-desk">
        <StatCard title="Open Tickets" value={openTickets} icon={Ticket} />
      </Link>
      <Link href="/correspondence">
        <StatCard title="Open Correspondence" value={openCorrespondence} icon={FileCode2} />
      </Link>
    </div>
  )
}
