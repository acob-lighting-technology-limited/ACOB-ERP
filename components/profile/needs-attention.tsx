"use client"

import Link from "next/link"
import { AlertTriangle, CalendarClock, FileCode2, Ticket, Wallet } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Task, LeaveItem, HelpDeskItem, CorrespondenceItem, PaymentItem } from "@/app/(app)/profile/page"
import { countOverdueTasks, isOpenCorrespondence, isOpenTicket, isPendingPayment } from "./work-items"

interface NeedsAttentionProps {
  tasks: Task[]
  leave?: LeaveItem[]
  helpDesk: HelpDeskItem[]
  correspondence: CorrespondenceItem[]
  payments: PaymentItem[]
  annualLeaveRemaining?: number
}

function AttentionTile({ href, hint, children }: { href: string; hint: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={href}>{children}</Link>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

export function NeedsAttention({
  tasks,
  helpDesk,
  correspondence,
  payments,
  annualLeaveRemaining = 0,
}: NeedsAttentionProps) {
  const now = new Date()

  const overdueTasks = countOverdueTasks(tasks, now)
  const openTickets = helpDesk.filter(isOpenTicket).length
  const openCorrespondence = correspondence.filter(isOpenCorrespondence).length
  const duePayments = payments.filter(isPendingPayment).length

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <AttentionTile href="/tasks" hint="Open tasks past their due date">
        <StatCard
          title="Overdue Tasks"
          value={overdueTasks}
          icon={AlertTriangle}
          iconBgColor={overdueTasks > 0 ? "bg-red-500/10" : "bg-muted"}
          iconColor={overdueTasks > 0 ? "text-red-600" : "text-muted-foreground"}
          description={overdueTasks > 0 ? "Needs immediate action" : "All caught up"}
        />
      </AttentionTile>
      <AttentionTile href="/leave" hint="Your annual leave days remaining for this year">
        <StatCard
          title="Annual Leave Left"
          value={`${annualLeaveRemaining}d`}
          icon={CalendarClock}
          iconBgColor={annualLeaveRemaining > 0 ? "bg-blue-500/10" : "bg-muted"}
          iconColor={annualLeaveRemaining > 0 ? "text-blue-600" : "text-muted-foreground"}
          description={annualLeaveRemaining > 0 ? `${annualLeaveRemaining} days remaining` : "None left"}
        />
      </AttentionTile>
      <AttentionTile href="/payments" hint="Payments with status Due or Overdue">
        <StatCard
          title="Payments Due"
          value={duePayments}
          icon={Wallet}
          iconBgColor={duePayments > 0 ? "bg-amber-500/10" : "bg-muted"}
          iconColor={duePayments > 0 ? "text-amber-600" : "text-muted-foreground"}
          description={duePayments > 0 ? "Due or overdue" : "Nothing due"}
        />
      </AttentionTile>
      <AttentionTile href="/help-desk" hint="Help desk tickets not yet resolved, closed, or cancelled">
        <StatCard
          title="Open Tickets"
          value={openTickets}
          icon={Ticket}
          iconBgColor={openTickets > 0 ? "bg-blue-500/10" : "bg-muted"}
          iconColor={openTickets > 0 ? "text-blue-600" : "text-muted-foreground"}
          description={openTickets > 0 ? "Awaiting resolution" : "No open tickets"}
        />
      </AttentionTile>
      <AttentionTile href="/correspondence" hint="Correspondence not yet filed, closed, or cancelled">
        <StatCard
          title="Correspondence"
          value={openCorrespondence}
          icon={FileCode2}
          iconBgColor={openCorrespondence > 0 ? "bg-blue-500/10" : "bg-muted"}
          iconColor={openCorrespondence > 0 ? "text-blue-600" : "text-muted-foreground"}
          description={openCorrespondence > 0 ? "Open items" : "Nothing open"}
        />
      </AttentionTile>
    </div>
  )
}
