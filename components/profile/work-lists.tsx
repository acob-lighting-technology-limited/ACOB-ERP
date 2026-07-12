"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/patterns"
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, FileCode2, Inbox, Package, Ticket } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { cn } from "@/lib/utils"
import type { Task, Asset, LeaveItem, HelpDeskItem, CorrespondenceItem } from "@/app/(app)/profile/page"
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

/* ----------------------------- Open Items ----------------------------- */

type OpenItem = {
  id: string
  icon: React.ElementType
  href: string
  title: string
  reference: string | null
  status: string
  createdAt: string
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)
}

export function OpenItemsCard({
  helpDesk,
  correspondence,
  leave,
}: {
  helpDesk: HelpDeskItem[]
  correspondence: CorrespondenceItem[]
  leave: LeaveItem[]
}) {
  const items: OpenItem[] = [
    ...helpDesk.filter(isOpenTicket).map((ticket) => ({
      id: `ticket-${ticket.id}`,
      icon: Ticket,
      href: "/help-desk",
      title: ticket.title,
      reference: ticket.ticket_number || null,
      status: ticket.status,
      createdAt: ticket.created_at,
    })),
    ...correspondence.filter(isOpenCorrespondence).map((record) => ({
      id: `corr-${record.id}`,
      icon: FileCode2,
      href: "/correspondence",
      title: record.subject,
      reference: record.reference_number || null,
      status: record.status,
      createdAt: record.created_at,
    })),
    ...leave
      .filter((request) => request.status === "pending")
      .map((request) => ({
        id: `leave-${request.id}`,
        icon: CalendarClock,
        href: "/leave",
        title: looksLikeUuid(request.leave_type) ? "Leave Request" : `${request.leave_type} Leave`,
        reference: `${shortDate(request.start_date)} – ${shortDate(request.end_date)} · ${request.days_requested}d`,
        status: request.status,
        createdAt: request.created_at,
      })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_OPEN_ITEMS)

  return (
    <ListCard title="Open Items" icon={Inbox} count={items.length} viewAllHref="/help-desk" viewAllLabel="Help desk">
      {items.length > 0 ? (
        <ul className="divide-y border-t">
          {items.map((item) => (
            <Row key={item.id} href={item.href}>
              <div className="flex items-center gap-2">
                <item.icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <p className="truncate text-sm font-medium">{item.title}</p>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 pl-[22px]">
                <Badge className={cn("px-1.5 py-0 text-[10px] capitalize", statusBadgeClass(item.status))}>
                  {humanizeStatus(item.status)}
                </Badge>
                {item.reference && <span className="text-muted-foreground truncate text-[10px]">{item.reference}</span>}
              </div>
            </Row>
          ))}
        </ul>
      ) : (
        <div className="border-t px-6 py-8">
          <EmptyState
            title="Nothing waiting on you"
            description="Open tickets, correspondence, and pending leave will show here."
            icon={CheckCircle2}
            className="border-0 py-2"
          />
        </div>
      )}
    </ListCard>
  )
}

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
