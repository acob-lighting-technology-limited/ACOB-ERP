"use client"

import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { PromptDialog } from "@/components/ui/prompt-dialog"
import {
  Headset,
  Clock,
  AlertCircle,
  History,
  UserCheck,
  ShieldCheck,
  Check,
  X,
  Shuffle,
  MoveRight,
  Building2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PriorityBadge, TicketStatusBadge } from "@/components/dashboard/help-desk/ticket-badges"
import { isAssignableProfile } from "@/lib/workforce/assignment-policy"
import { formatName } from "@/lib/utils"
import { formatWATDateTime } from "@/lib/utils/date"
import type { HelpDeskTicket, EmployeeOption, LeadDirectoryMember } from "@/components/help-desk/ticket-queue-table"
import { resolveCurrentStage, resolveApproverName } from "@/components/help-desk/ticket-queue-table"
import { apiFetch } from "@/lib/api-client"

interface AdminHelpDeskContentProps {
  initialTickets: HelpDeskTicket[]
  employees: EmployeeOption[]
  leadDirectory: LeadDirectoryMember[]
  viewer: {
    id: string
    role: string
    department: string | null
    is_department_lead: boolean
    lead_departments: string[]
    managed_departments: string[]
  }
  lockedDepartment?: string
  backLinkHref?: string
}

const FINAL_STATUSES = new Set(["resolved", "closed", "cancelled", "rejected"])

const TABS: DataTableTab[] = [
  { key: "my-actions", label: "My Actions", icon: UserCheck },
  { key: "pending", label: "Global Queue", icon: Clock },
  { key: "history", label: "History", icon: History },
]

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function AdminHelpDeskContent({
  initialTickets,
  employees,
  leadDirectory,
  viewer,
  lockedDepartment,
  backLinkHref = "/admin",
}: AdminHelpDeskContentProps) {
  const [tickets, setTickets] = useState(initialTickets)
  const [activeTab, setActiveTab] = useState("my-actions")
  const [assignmentMap, setAssignmentMap] = useState<Record<string, string>>({})
  const [loadingTicketId, setLoadingTicketId] = useState<string | null>(null)
  const [approvalPrompt, setApprovalPrompt] = useState<{ ticketId: string; decision: "approved" | "rejected" } | null>(
    null
  )

  const stats = useMemo(() => {
    const now = Date.now()
    const breached = tickets.filter(
      (t) => t.sla_target_at && new Date(t.sla_target_at).getTime() < now && !["resolved", "closed"].includes(t.status)
    ).length
    return {
      total: tickets.length,
      pendingApproval: tickets.filter((t) => t.status === "pending_approval").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      breached,
    }
  }, [tickets])

  const managedDepartments = useMemo(
    () =>
      (Array.isArray(viewer.managed_departments) && viewer.managed_departments.length > 0
        ? viewer.managed_departments
        : viewer.lead_departments) || [],
    [viewer.lead_departments, viewer.managed_departments]
  )

  const canLeadDepartment = useCallback(
    (department: string | null) =>
      Boolean(viewer.is_department_lead && department && managedDepartments.includes(department)),
    [managedDepartments, viewer.is_department_lead]
  )

  const canAssignTicket = useCallback(
    (ticket: HelpDeskTicket) => {
      if (!canLeadDepartment(ticket.service_department)) return false
      return ["new", "pending_lead_review", "department_queue", "department_assigned"].includes(ticket.status)
    },
    [canLeadDepartment]
  )

  const allPendingTickets = useMemo(() => tickets.filter((ticket) => !FINAL_STATUSES.has(ticket.status)), [tickets])
  const historyTickets = useMemo(() => tickets.filter((ticket) => FINAL_STATUSES.has(ticket.status)), [tickets])

  const myActionQueue = useMemo(() => {
    return allPendingTickets.filter((ticket) => {
      if (ticket.status === "pending_approval") {
        if (ticket.current_approval_stage === "department_lead") {
          return canLeadDepartment(ticket.service_department)
        }
        if (ticket.current_approval_stage === "requester_department_lead") {
          return canLeadDepartment(ticket.requester_department)
        }
        if (ticket.current_approval_stage === "service_department_lead") {
          return canLeadDepartment(ticket.service_department)
        }
        if (ticket.current_approval_stage === "head_corporate_services") {
          return canLeadDepartment("Corporate Services")
        }
        if (ticket.current_approval_stage === "managing_director") {
          return canLeadDepartment("Executive Management")
        }
      }
      if (ticket.status === "pending_lead_review" || ticket.status === "department_queue") {
        return canLeadDepartment(ticket.service_department)
      }
      return ticket.assigned_to === viewer.id
    })
  }, [allPendingTickets, canLeadDepartment, viewer.id])

  const myActionQueueIds = useMemo(() => new Set(myActionQueue.map((t) => t.id)), [myActionQueue])

  const activeData = useMemo(() => {
    if (activeTab === "my-actions") return myActionQueue
    if (activeTab === "pending") return allPendingTickets
    return historyTickets
  }, [activeTab, myActionQueue, allPendingTickets, historyTickets])

  const filters = useMemo(() => {
    const statuses = Array.from(
      new Set(
        [...tickets.map((t) => t.status), "new", "in_progress", "pending_approval", "resolved", "closed"].filter(
          Boolean
        )
      )
    )
    const priorities = Array.from(
      new Set([...tickets.map((t) => t.priority), "low", "normal", "high", "urgent"].filter(Boolean))
    )
    const departments = Array.from(new Set(tickets.map((t) => t.service_department).filter(Boolean)))
    const types = Array.from(new Set(tickets.map((t) => t.request_type).filter(Boolean)))

    return [
      {
        key: "status",
        label: "Status",
        options: statuses.map((s) => ({ value: s, label: formatName(s) })),
      },
      {
        key: "priority",
        label: "Priority",
        options: priorities.map((p) => ({ value: p, label: formatName(p) })),
      },
      {
        key: "service_department",
        label: "Department",
        options: departments.map((d) => ({ value: d, label: d })),
        hidden: departments.length === 0,
      },
      {
        key: "request_type",
        label: "Request Type",
        options: types.map((t) => ({ value: t, label: formatName(t) })),
        hidden: types.length === 0,
      },
    ] as DataTableFilter<HelpDeskTicket>[]
  }, [tickets])

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ scope: "department" })
    if (lockedDepartment) params.set("department", lockedDepartment)
    const res = await apiFetch(`/api/help-desk/tickets?${params.toString()}`, { cache: "no-store" })
    const json = await res.json()
    if (!res.ok) {
      toast.error(json?.error || "Failed to refresh help desk queue")
      return
    }
    setTickets(json.data || [])
  }, [lockedDepartment])

  const assign = useCallback(
    async (ticketId: string) => {
      const assignedTo = assignmentMap[ticketId]
      if (!assignedTo) {
        toast.error("Choose a staff member first")
        return
      }
      setLoadingTicketId(ticketId)
      try {
        const res = await apiFetch(`/api/help-desk/tickets/${ticketId}/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "assign_staff", assigned_to: assignedTo }),
        })
        if (!res.ok) {
          const body = await res.json()
          throw new Error(body.error || "Assignment failed")
        }
        toast.success("Ticket assigned")
        await refresh()
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, "Assignment failed"))
      } finally {
        setLoadingTicketId(null)
      }
    },
    [assignmentMap, refresh]
  )

  async function routeTicket(ticketId: string, action: "send_to_queue" | "assign_department" | "assign_me") {
    setLoadingTicketId(ticketId)
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || "Routing failed")
      }
      toast.success("Ticket updated")
      await refresh()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Routing failed"))
    } finally {
      setLoadingTicketId(null)
    }
  }

  async function pivot(ticketId: string) {
    setLoadingTicketId(ticketId)
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}/pivot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Requires procurement support" }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || "Pivot failed")
      }
      toast.success("Ticket moved to procurement approval")
      await refresh()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Pivot failed"))
    } finally {
      setLoadingTicketId(null)
    }
  }

  async function submitApproval(comments: string) {
    if (!approvalPrompt) return
    const { ticketId, decision } = approvalPrompt
    setLoadingTicketId(ticketId)
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comments: comments || null }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || "Decision failed")
      }
      toast.success(decision === "approved" ? "Approval recorded" : "Rejection recorded")
      await refresh()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Decision failed"))
    } finally {
      setLoadingTicketId(null)
      setApprovalPrompt(null)
    }
  }

  const columns: DataTableColumn<HelpDeskTicket>[] = useMemo(
    () => [
      {
        key: "ticket_number",
        label: "Ticket #",
        sortable: true,
        resizable: true,
        initialWidth: 120,
        accessor: (r) => r.ticket_number,
        hideOnMobile: true,
        render: (r) => <span className="text-muted-foreground font-mono text-xs font-semibold">{r.ticket_number}</span>,
      },
      {
        key: "title",
        label: "Subject",
        sortable: true,
        resizable: true,
        initialWidth: 300,
        accessor: (r) => r.title,
        render: (r) => (
          <div className="flex max-w-[300px] flex-col">
            <span className="truncate font-medium">{r.title}</span>
            <span className="text-muted-foreground text-[10px] tracking-widest uppercase">{r.request_type}</span>
          </div>
        ),
      },
      {
        key: "service_department",
        label: "Service Dept",
        sortable: true,
        resizable: true,
        initialWidth: 150,
        accessor: (r) => r.service_department,
        hideOnMobile: true,
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        accessor: (r) => r.priority,
        render: (r) => <PriorityBadge priority={r.priority} />,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => <TicketStatusBadge status={r.status} />,
      },
      {
        key: "stage",
        label: "Workflow Stage",
        accessor: (r) => resolveCurrentStage(r),
        render: (r) => (
          <Badge variant="outline" className="font-normal">
            {resolveCurrentStage(r)}
          </Badge>
        ),
      },
      {
        key: "approver",
        label: "Current Owner",
        resizable: true,
        initialWidth: 150,
        accessor: (r) => resolveApproverName(r, leadDirectory),
        hideOnMobile: true,
        render: (r) => <span className="text-xs">{resolveApproverName(r, leadDirectory)}</span>,
      },
    ],
    [leadDirectory]
  )

  const finalColumns = useMemo(() => {
    const cols = [...columns]
    if (activeTab === "my-actions") {
      cols.push({
        key: "assignment",
        label: "Assign Staff",
        render: (r) => {
          if (!canAssignTicket(r)) {
            return <span className="text-muted-foreground text-[10px] italic">Restricted stage</span>
          }
          return (
            <div className="flex items-center gap-2">
              <Select
                value={assignmentMap[r.id] || ""}
                onValueChange={(val) => setAssignmentMap((prev) => ({ ...prev, [r.id]: val }))}
              >
                <SelectTrigger className="h-8 w-[160px] text-xs">
                  <SelectValue placeholder="Staff..." />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter(
                      (e) =>
                        isAssignableProfile(e, { allowLegacyNullStatus: false }) &&
                        (!e.department || e.department === r.service_department)
                    )
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id} className="text-xs">
                        {e.first_name} {e.last_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 px-2" onClick={() => assign(r.id)} disabled={loadingTicketId === r.id}>
                Assign
              </Button>
            </div>
          )
        },
      })
    }
    return cols
  }, [activeTab, assignmentMap, assign, canAssignTicket, columns, employees, loadingTicketId])

  return (
    <DataTablePage
      title="Help Desk Workflow"
      description="Manage ticket routing, department approvals, and technical escalations."
      icon={Headset}
      backLink={{
        href: backLinkHref,
        label: lockedDepartment ? "Back to Department" : "Back to Admin",
      }}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total Tickets"
            value={stats.total}
            icon={Headset}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="In Progress"
            value={stats.inProgress}
            icon={Clock}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Pending Review"
            value={stats.pendingApproval}
            icon={AlertCircle}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="SLA Breached"
            value={stats.breached}
            icon={ShieldCheck}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <DataTable<HelpDeskTicket>
        data={activeData}
        columns={finalColumns}
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        isLoading={loadingTicketId !== null && loadingTicketId === "REFRESH"}
        onRetry={refresh}
        searchPlaceholder="Search ticket number, subject or requester department..."
        searchFn={(r, q) =>
          `${r.ticket_number} ${r.title} ${r.requester_department} ${r.service_department}`.toLowerCase().includes(q)
        }
        filters={filters}
        rowActions={
          activeTab === "my-actions"
            ? [
                {
                  label: "Send to Queue",
                  icon: MoveRight,
                  onClick: (r) => routeTicket(r.id, "send_to_queue"),
                  hidden: (r) => r.status !== "pending_lead_review" && r.status !== "department_assigned",
                },
                {
                  label: "Assign to Dept",
                  icon: Building2,
                  onClick: (r) => routeTicket(r.id, "assign_department"),
                  hidden: (r) => r.status !== "pending_lead_review" && r.status !== "department_queue",
                },
                {
                  label: "Claim Ticket",
                  icon: UserCheck,
                  onClick: (r) => routeTicket(r.id, "assign_me"),
                  hidden: (r) => r.status !== "pending_lead_review" && r.status !== "department_queue",
                },
                {
                  label: "Pivot to Procurement",
                  icon: Shuffle,
                  onClick: (r) => pivot(r.id),
                  hidden: (r) => !(["in_progress", "assigned"].includes(r.status) && r.assigned_to === viewer.id),
                },
                {
                  label: "Approve",
                  icon: Check,
                  onClick: (r) => setApprovalPrompt({ ticketId: r.id, decision: "approved" }),
                  hidden: (r) => !(r.status === "pending_approval" && myActionQueueIds.has(r.id)),
                },
                {
                  label: "Reject",
                  icon: X,
                  variant: "destructive",
                  onClick: (r) => setApprovalPrompt({ ticketId: r.id, decision: "rejected" }),
                  hidden: (r) => !(r.status === "pending_approval" && myActionQueueIds.has(r.id)),
                },
              ]
            : []
        }
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 space-y-4 border-t p-6">
              <div>
                <h4 className="text-muted-foreground mb-2 text-[10px] font-black tracking-widest uppercase">
                  Requester Info
                </h4>
                <div className="flex gap-4 text-sm">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground text-xs font-medium">Department</span>
                    <span>{r.requester_department || "Unknown"}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground text-xs font-medium">Type</span>
                    <span className="capitalize">{r.request_type}</span>
                  </div>
                </div>
              </div>
              {r.sla_target_at && (
                <div>
                  <h4 className="text-muted-foreground mb-2 text-[10px] font-black tracking-widest uppercase">
                    SLA Status
                  </h4>
                  <p className="text-sm">
                    Target Date: {formatWATDateTime(r.sla_target_at)}
                    {new Date(r.sla_target_at).getTime() < Date.now() && (
                      <span className="ml-2 font-medium text-red-600">(Breached)</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(r) => (
          <div className="bg-card space-y-4 rounded-xl border p-4 transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <span className="text-muted-foreground font-mono text-[10px]">{r.ticket_number}</span>
              <PriorityBadge priority={r.priority} />
            </div>
            <div>
              <h4 className="line-clamp-1 font-semibold">{r.title}</h4>
              <p className="text-muted-foreground mt-1 text-[10px] uppercase">{r.service_department}</p>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <TicketStatusBadge status={r.status} />
              <Badge variant="outline" className="text-[10px] font-normal">
                {resolveCurrentStage(r)}
              </Badge>
            </div>
          </div>
        )}
        urlSync
      />

      <PromptDialog
        open={approvalPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setApprovalPrompt(null)
        }}
        title={approvalPrompt?.decision === "rejected" ? "Reject Ticket" : "Approve Ticket"}
        description={
          approvalPrompt?.decision === "rejected"
            ? "Provide a reason for rejecting this service request."
            : "Add optional comments for this approval."
        }
        label="Comments"
        placeholder="Write your note here..."
        inputType="textarea"
        required={approvalPrompt?.decision === "rejected"}
        confirmLabel="Confirm Decision"
        confirmVariant={approvalPrompt?.decision === "rejected" ? "destructive" : "default"}
        onConfirm={submitApproval}
      />
    </DataTablePage>
  )
}
