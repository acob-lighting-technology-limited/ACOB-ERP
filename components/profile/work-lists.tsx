"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/patterns"
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileCode2,
  Inbox,
  Package,
  Ticket,
  Utensils,
} from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import type { Task, Asset, LeaveItem, HelpDeskItem, CorrespondenceItem, LunchLogItem } from "@/app/(app)/profile/page"
import { getTaskUrgency, isOpenCorrespondence, isOpenTicket, sortTasksByUrgency } from "./work-items"

const MAX_TASKS = 6
const MAX_OPEN_ITEMS = 7
const MAX_ASSETS = 4

function shortDate(dateString: string): string {
  return formatWATDate(dateString, { month: "short", day: "numeric" })
}

function statusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
    case "completed":
    case "resolved":
    case "approved":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
    case "under_review":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "pending":
    case "open":
    case "new":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "assigned":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
    case "rejected":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function humanizeStatus(status: string): string {
  return String(status || "").replaceAll("_", " ")
}

interface ListCardProps {
  title: string
  icon: React.ElementType
  count?: number
  viewAllHref: string
  viewAllLabel: string
  children: React.ReactNode
}

function ListCard({ title, icon: Icon, count, viewAllHref, viewAllLabel, children }: ListCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="text-muted-foreground h-4 w-4" />
          {title}
          {typeof count === "number" && count > 0 && (
            <span className="text-muted-foreground text-xs font-normal tabular-nums">({count})</span>
          )}
        </CardTitle>
        <Link href={viewAllHref} className="text-muted-foreground hover:text-foreground text-xs transition-colors">
          {viewAllLabel} →
        </Link>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  )
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li className="hover:bg-muted/40 transition-colors">
      <Link href={href} className="flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">{children}</div>
        <ArrowRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      </Link>
    </li>
  )
}

/* ------------------------------ My Tasks ------------------------------ */

function TaskDueBadge({ task, now }: { task: Task; now: Date }) {
  const urgency = getTaskUrgency(task, now)
  if (urgency.kind === "overdue") {
    return <span className="text-xs font-medium text-red-600 dark:text-red-400">{urgency.days}d overdue</span>
  }
  if (urgency.kind === "due_soon") {
    return (
      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
        {urgency.days === 0 ? "Due today" : `Due in ${urgency.days}d`}
      </span>
    )
  }
  if (urgency.kind === "scheduled") {
    return <span className="text-muted-foreground text-xs">Due {shortDate(urgency.dueDate)}</span>
  }
  return <span className="text-muted-foreground text-xs">No due date</span>
}

export function MyTasksCard({ tasks }: { tasks: Task[] }) {
  const now = new Date()
  const openTasks = sortTasksByUrgency(tasks, now)
  const visible = openTasks.slice(0, MAX_TASKS)

  return (
    <ListCard
      title="My Tasks"
      icon={ClipboardList}
      count={openTasks.length}
      viewAllHref="/tasks"
      viewAllLabel="All tasks"
    >
      {visible.length > 0 ? (
        <ul className="divide-y border-t">
          {visible.map((task) => (
            <Row key={task.id} href={`/tasks?taskId=${task.id}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium">{task.title}</p>
                <div className="shrink-0">
                  <TaskDueBadge task={task} now={now} />
                </div>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Badge className={cn("px-1.5 py-0 text-[10px] capitalize", statusBadgeClass(task.status))}>
                  {humanizeStatus(task.status)}
                </Badge>
                {task.priority && (
                  <span className="text-muted-foreground text-[10px] capitalize">{task.priority} priority</span>
                )}
              </div>
            </Row>
          ))}
        </ul>
      ) : (
        <div className="border-t px-6 py-8">
          <EmptyState
            title="All caught up"
            description="No open tasks assigned to you right now."
            icon={CheckCircle2}
            className="border-0 py-2"
          />
        </div>
      )}
    </ListCard>
  )
}

/* -------------------------------- Tickets -------------------------------- */

export function TicketsCard({
  helpDesk,
  tickets,
}: {
  helpDesk?: HelpDeskItem[]
  tickets?: HelpDeskItem[]
  correspondence?: CorrespondenceItem[]
  leave?: LeaveItem[]
}) {
  const ticketList = helpDesk || tickets || []
  const openTickets = ticketList.filter(isOpenTicket)
  const visible = openTickets.slice(0, MAX_OPEN_ITEMS)

  return (
    <ListCard title="Ticket" icon={Ticket} count={openTickets.length} viewAllHref="/help-desk" viewAllLabel="Help desk">
      {visible.length > 0 ? (
        <ul className="divide-y border-t">
          {visible.map((ticket) => (
            <Row key={ticket.id} href="/help-desk">
              <div className="flex items-center gap-2">
                <Ticket className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <p className="truncate text-sm font-medium">{ticket.title}</p>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 pl-[22px]">
                <Badge className={cn("px-1.5 py-0 text-[10px] capitalize", statusBadgeClass(ticket.status))}>
                  {humanizeStatus(ticket.status)}
                </Badge>
                {ticket.ticket_number && (
                  <span className="text-muted-foreground truncate text-[10px]">{ticket.ticket_number}</span>
                )}
              </div>
            </Row>
          ))}
        </ul>
      ) : (
        <div className="border-t px-6 py-8">
          <EmptyState
            title="No open tickets"
            description="Open help desk tickets will appear here."
            icon={CheckCircle2}
            className="border-0 py-2"
          />
        </div>
      )}
    </ListCard>
  )
}

export const OpenItemsCard = TicketsCard

/* ------------------------------ My Assets ----------------------------- */

export function AssetsCard({ assets }: { assets: Asset[] }) {
  const visible = assets.slice(0, MAX_ASSETS)

  return (
    <ListCard title="My Assets" icon={Package} count={assets.length} viewAllHref="/assets" viewAllLabel="All assets">
      {visible.length > 0 ? (
        <ul className="divide-y border-t">
          {visible.map((asset) => (
            <Row key={`${asset.id}-${asset.assignment_type ?? "own"}`} href="/assets">
              <p className="truncate text-sm font-medium">
                {asset.asset_type}
                {asset.asset_model ? ` — ${asset.asset_model}` : ""}
              </p>
              <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">{asset.unique_code || "—"}</p>
            </Row>
          ))}
        </ul>
      ) : (
        <div className="border-t px-6 py-8">
          <EmptyState
            title="No assets assigned"
            description="Company assets assigned to you will appear here."
            icon={Package}
            className="border-0 py-2"
          />
        </div>
      )}
    </ListCard>
  )
}

/* ------------------------------ My Lunch History ----------------------------- */

export function LunchHistoryCard({ lunchLogs }: { lunchLogs: LunchLogItem[] }) {
  const currentMonthName = new Date().toLocaleString("en-US", { month: "long" })
  const thisMonthLogs = lunchLogs.filter((log) => {
    const logDate = new Date(log.date)
    const now = new Date()
    return logDate.getMonth() === now.getMonth() && logDate.getFullYear() === now.getFullYear()
  })

  const totalDeduction = thisMonthLogs.reduce((sum, log) => sum + Number(log.employee_deduction), 0)

  return (
    <ListCard
      title="Lunch History"
      icon={Utensils}
      count={thisMonthLogs.length}
      viewAllHref="/payroll"
      viewAllLabel={`${currentMonthName} Logs`}
    >
      <div className="bg-muted/30 flex items-center justify-between border-t border-b px-4 py-3 text-sm">
        <span className="text-muted-foreground font-medium">Monthly Surcharge:</span>
        <span className="font-bold text-red-600">
          ₦{totalDeduction.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      </div>
      {thisMonthLogs.length > 0 ? (
        <ul className="max-h-[220px] divide-y overflow-y-auto">
          {thisMonthLogs.slice(0, 5).map((log) => (
            <li key={log.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
              <div>
                <p className="text-foreground font-semibold">
                  {new Date(log.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </p>
                <p className="text-muted-foreground text-[10px]">Meal price: ₦{Number(log.cost).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="font-mono font-medium text-red-500">
                  -₦{Number(log.employee_deduction).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
                <p className="text-[10px] text-emerald-600">50% Subsidized</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t px-6 py-8 text-center">
          <EmptyState
            title="No lunch entries"
            description="Your lunch registers for this month will appear here."
            icon={Utensils}
            className="border-0 py-2"
          />
        </div>
      )}
    </ListCard>
  )
}
