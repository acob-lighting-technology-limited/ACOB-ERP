"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { Headset, Eye, Play, CheckCircle2, LifeBuoy, MessageSquare } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import { PendingApprovalsCard } from "@/components/help-desk/pending-approvals-card"
import { CreateTicketDialog, type CreateTicketForm } from "@/components/help-desk/create-ticket-dialog"
import type { HelpDeskTicket, HelpDeskContentProps } from "@/components/help-desk/help-desk-types"
import type { HelpDeskTicketDetailResponse } from "@/components/help-desk/help-desk-types"
import { UserHelpDeskTicketDetailsDialog } from "@/components/help-desk/user-ticket-details-dialog"
import { UserHelpDeskTicketCommentDialog } from "@/components/help-desk/user-ticket-comment-dialog"
import { PriorityBadge, TicketStatusBadge } from "@/components/dashboard/help-desk/ticket-badges"
import { formatName } from "@/lib/utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"
import { TicketAttachmentsPanel } from "@/components/help-desk/ticket-attachments-panel"

type ErrorPayload = {
  error?: string
  message?: string
}
type CommentCreateResponse = {
  id: string
  comment?: string | null
  body?: string | null
  created_at?: string | null
  author_id?: string | null
  actor_id?: string | null
}

type TicketTab = "my_requests" | "assigned_to_me" | "department_assigned"

const DEPARTMENT_FLOW_STATUSES = new Set([
  "department_queue",
  "department_assigned",
  "pending_lead_review",
  "pending_approval",
  "approved_for_procurement",
])

function belongsToTab(ticket: HelpDeskTicket, tab: TicketTab, userId: string, userDepartment: string | null) {
  if (tab === "my_requests") return ticket.requester_id === userId
  if (tab === "assigned_to_me") return ticket.assigned_to === userId
  if (tab === "department_assigned") {
    return (
      Boolean(userDepartment && ticket.service_department === userDepartment) &&
      (String(ticket.handling_mode || "") === "queue" ||
        String(ticket.handling_mode || "") === "department" ||
        DEPARTMENT_FLOW_STATUSES.has(String(ticket.status || "")))
    )
  }
  return false
}

function buildFetchDebugLabel(source: string, status: number, payload: unknown) {
  const p = payload as ErrorPayload
  const detail = p?.error || p?.message || (typeof payload === "string" ? payload : "") || "Unknown error"
  return `${source} failed (${status}): ${detail}`
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isDepartmentTicket(ticket: HelpDeskTicket) {
  return ticket.handling_mode === "queue" || DEPARTMENT_FLOW_STATUSES.has(ticket.status)
}

function canUserChangeTicketStatus(ticket: HelpDeskTicket, userId: string) {
  if (isDepartmentTicket(ticket)) return false
  return ticket.assigned_to === userId
}

export function HelpDeskContent({
  userId,
  userDepartment,
  canReviewPendingApprovals,
  initialDepartments,
  initialTickets,
  initialError,
}: HelpDeskContentProps) {
  const queryClient = useQueryClient()
  const [tickets, setTickets] = useState<HelpDeskTicket[]>(initialTickets)
  const [isSaving, setIsSaving] = useState(false)
  const [isDetailSaving, setIsDetailSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [availableDepartments] = useState<string[]>(initialDepartments || [])
  const [pendingApprovalsOpen, setPendingApprovalsOpen] = useState(false)
  const [processingApprovalId, setProcessingApprovalId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TicketTab>("my_requests")
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, string>>({})
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [selectedTicketStatus, setSelectedTicketStatus] = useState("")
  const [selectedTicketDetail, setSelectedTicketDetail] = useState<HelpDeskTicketDetailResponse | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [commentOpen, setCommentOpen] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailComment, setDetailComment] = useState("")
  const [commentFeedback, setCommentFeedback] = useState<string | null>(null)
  const [commentFeedbackTone, setCommentFeedbackTone] = useState<"success" | "error" | null>(null)
  const [form, setForm] = useState<CreateTicketForm>({
    title: "",
    description: "",
    service_department: "IT and Communications",
    priority: "medium",
    request_type: "support",
  })

  useEffect(() => {
    if (initialError) {
      toast.error(initialError)
    }
  }, [initialError])

  const pendingApprovalsPath = canReviewPendingApprovals
    ? "/api/help-desk/tickets?scope=department&status=pending_approval"
    : "/api/help-desk/tickets?scope=mine&status=pending_approval"

  const { data: pendingApprovalsData } = useQuery({
    queryKey: QUERY_KEYS.tickets({
      scope: canReviewPendingApprovals ? "department" : "mine",
      status: "pending_approval",
    }),
    queryFn: async () => {
      const res = await apiFetch(pendingApprovalsPath, { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(buildFetchDebugLabel("Pending approvals load", res.status, json))
      return json.data || []
    },
  })
  const pendingApprovals: HelpDeskTicket[] = pendingApprovalsData || []

  const filteredByTab = useMemo(
    () => tickets.filter((ticket) => belongsToTab(ticket, activeTab, userId, userDepartment)),
    [tickets, activeTab, userId, userDepartment]
  )

  const myOpenTickets = useMemo(
    () => filteredByTab.filter((t) => !["resolved", "closed", "cancelled"].includes(t.status)).length,
    [filteredByTab]
  )
  const pendingReviewCount = pendingApprovals.length

  const departmentOptions = useMemo(() => {
    const options = new Set<string>()
    options.add(form.service_department)
    for (const department of availableDepartments) {
      if (department) options.add(department)
    }
    for (const ticket of tickets) {
      if (ticket.service_department) options.add(ticket.service_department)
    }
    return Array.from(options).filter((department) => Boolean(department))
  }, [availableDepartments, form.service_department, tickets])

  const avgCsat = useMemo(() => {
    const rated = filteredByTab.filter((t) => t.csat_rating)
    if (!rated.length) return "-"
    return (rated.reduce((sum, t) => sum + Number(t.csat_rating), 0) / rated.length).toFixed(1)
  }, [filteredByTab])

  const tabCounts = useMemo(
    () => ({
      my_requests: tickets.filter((ticket) => belongsToTab(ticket, "my_requests", userId, userDepartment)).length,
      assigned_to_me: tickets.filter((ticket) => belongsToTab(ticket, "assigned_to_me", userId, userDepartment)).length,
      department_assigned: tickets.filter((ticket) =>
        belongsToTab(ticket, "department_assigned", userId, userDepartment)
      ).length,
    }),
    [tickets, userId, userDepartment]
  )

  const tabs: DataTableTab[] = useMemo(
    () => [
      { key: "my_requests", label: `My Requests (${tabCounts.my_requests})` },
      { key: "assigned_to_me", label: `Assigned To Me (${tabCounts.assigned_to_me})` },
      { key: "department_assigned", label: `Department Assigned (${tabCounts.department_assigned})` },
    ],
    [tabCounts]
  )

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(tickets.map((ticket) => ticket.status).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((status) => ({ value: status, label: formatName(status) })),
    [tickets]
  )

  const departmentFilterOptions = useMemo(
    () =>
      Array.from(new Set(tickets.map((ticket) => ticket.service_department).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((department) => ({ value: department, label: department })),
    [tickets]
  )

  const columns: DataTableColumn<HelpDeskTicket>[] = [
    {
      key: "ticket_number",
      label: "Ticket",
      sortable: true,
      accessor: (ticket) => ticket.ticket_number,
      render: (ticket) => <span className="font-mono text-xs font-bold">{ticket.ticket_number}</span>,
      hideOnMobile: true,
    },
    {
      key: "title",
      label: "Title",
      sortable: true,
      resizable: true,
      initialWidth: 280,
      accessor: (ticket) => ticket.title,
      render: (ticket) => (
        <div className="flex flex-col">
          <span className="line-clamp-1 font-medium">{ticket.title}</span>
          <span className="text-muted-foreground text-[10px] uppercase">{ticket.service_department}</span>
        </div>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      sortable: true,
      accessor: (ticket) => ticket.priority,
      render: (ticket) => <PriorityBadge priority={ticket.priority} />,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (ticket) => ticket.status,
      render: (ticket) => <TicketStatusBadge status={ticket.status} />,
    },
    {
      key: "goal",
      label: "Goal",
      sortable: true,
      accessor: (ticket) => ticket.goal_title || "",
      render: (ticket) =>
        ticket.goal_title ? (
          <span className="line-clamp-1 text-xs font-medium">{ticket.goal_title}</span>
        ) : (
          <span className="text-muted-foreground text-xs">Not linked</span>
        ),
      hideOnMobile: true,
    },
    {
      key: "comments",
      label: "Comments",
      sortable: true,
      accessor: (ticket) => ticket.comment_count || 0,
      render: (ticket) =>
        (ticket.comment_count || 0) > 0 ? (
          <button
            type="button"
            className="inline-flex"
            onClick={(event) => {
              event.stopPropagation()
              void openTicketCommentDialog(ticket.id)
            }}
            title="View comments"
          >
            <Badge variant="outline" className="gap-1 text-xs">
              <MessageSquare className="h-3 w-3" />
              {ticket.comment_count}
            </Badge>
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        ),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      accessor: (ticket) => ticket.created_at,
      render: (ticket) => <span className="text-muted-foreground text-xs">{formatWATDate(ticket.created_at)}</span>,
      hideOnMobile: true,
    },
  ]

  const filters: DataTableFilter<HelpDeskTicket>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: statusOptions,
      },
      {
        key: "priority",
        label: "Priority",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ],
      },
      {
        key: "service_department",
        label: "Department",
        options: departmentFilterOptions,
      },
    ],
    [statusOptions, departmentFilterOptions]
  )

  async function refreshTickets() {
    const [mineRes, deptRes] = await Promise.all([
      apiFetch("/api/help-desk/tickets?scope=mine", { cache: "no-store" }),
      apiFetch("/api/help-desk/tickets?scope=service_department", { cache: "no-store" }),
    ])
    const mineJson = await mineRes.json().catch(() => ({}))
    const deptJson = await deptRes.json().catch(() => ({}))

    if (!mineRes.ok) {
      toast.error(buildFetchDebugLabel("Tickets refresh", mineRes.status, mineJson))
      return
    }
    if (!deptRes.ok) {
      toast.error(buildFetchDebugLabel("Department tickets refresh", deptRes.status, deptJson))
      return
    }
    const merged = Array.from(
      new Map(
        [...(mineJson.data || []), ...(deptJson.data || [])].map((ticket: HelpDeskTicket) => [ticket.id, ticket])
      ).values()
    ) as HelpDeskTicket[]
    setTickets(merged)
    queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.tickets({
        scope: canReviewPendingApprovals ? "department" : "mine",
        status: "pending_approval",
      }),
    })
  }

  async function createTicket(e: React.FormEvent) {
    e.preventDefault()

    if (!form.title.trim()) {
      toast.error("Title is required")
      return
    }
    if (userDepartment && form.service_department === userDepartment) {
      toast.error("You cannot submit help desk requests to your own department.")
      return
    }

    setIsSaving(true)
    try {
      const res = await apiFetch("/api/help-desk/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || "Failed to create ticket")
      }

      toast.success("Ticket submitted")
      setCreateOpen(false)
      setForm({
        title: "",
        description: "",
        service_department: "IT and Communications",
        priority: "medium",
        request_type: "support",
      })
      await refreshTickets()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to create ticket"))
    } finally {
      setIsSaving(false)
    }
  }

  async function setStatus(ticketId: string, status: string) {
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || "Failed to update")
      }

      toast.success("Ticket updated")
      await refreshTickets()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Update failed"))
    }
  }

  async function rateTicket(ticketId: string, rating: number) {
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csat_rating: rating }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || "Failed to rate")
      }

      toast.success("Thanks for your feedback")
      await refreshTickets()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to submit rating"))
    }
  }

  const loadTicketDetails = useCallback(async (ticketId: string) => {
    setDetailsLoading(true)
    setDetailsError(null)
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}`, { cache: "no-store" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const message = (json as ErrorPayload | null)?.error || "Failed to load ticket details"
        throw new Error(message)
      }
      const detail = (json as { data?: HelpDeskTicketDetailResponse } | null)?.data || null
      setSelectedTicketDetail(detail)
      setSelectedTicketStatus(String(detail?.ticket?.status || ""))
    } catch (error: unknown) {
      setDetailsError(getErrorMessage(error, "Failed to load ticket details"))
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  const openTicketDetails = useCallback(
    async (ticketId: string) => {
      setSelectedTicketId(ticketId)
      setDetailsOpen(true)
      setDetailComment("")
      await loadTicketDetails(ticketId)
    },
    [loadTicketDetails]
  )

  const openTicketCommentDialog = useCallback(
    async (ticketId: string) => {
      setSelectedTicketId(ticketId)
      setCommentOpen(true)
      setDetailComment("")
      setCommentFeedback(null)
      setCommentFeedbackTone(null)
      await loadTicketDetails(ticketId)
    },
    [loadTicketDetails]
  )

  async function updateTicketStatusFromModal(status: string) {
    if (!selectedTicketId) return

    // The API requires a reason on rejection; catch it here so the user is told
    // what to do before the round-trip rather than after it.
    if (status === "rejected" && !detailComment.trim()) {
      toast.error("Add a comment explaining why this ticket is being rejected.")
      return
    }

    setSelectedTicketStatus(status)
    setIsDetailSaving(true)
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${selectedTicketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, status_note: detailComment.trim() || null }),
      })
      const payload = (await res.json().catch(() => null)) as ErrorPayload | null
      if (!res.ok) throw new Error(payload?.error || "Failed to update ticket")
      toast.success("Ticket updated")
      setDetailComment("")
      await Promise.all([refreshTickets(), loadTicketDetails(selectedTicketId)])
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to update ticket"))
    } finally {
      setIsDetailSaving(false)
    }
  }

  async function addTicketCommentFromModal() {
    if (!selectedTicketId || !detailComment.trim()) return
    setIsDetailSaving(true)
    setCommentFeedback(null)
    setCommentFeedbackTone(null)
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${selectedTicketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: detailComment.trim() }),
      })
      const payload = (await res.json().catch(() => null)) as (ErrorPayload & { data?: CommentCreateResponse }) | null
      if (!res.ok) throw new Error(payload?.error || "Failed to add comment")
      const created = payload?.data || null
      toast.success("Comment added")
      setDetailComment("")
      setCommentFeedback("Comment posted.")
      setCommentFeedbackTone("success")
      if (created) {
        setSelectedTicketDetail((previous) => {
          if (!previous || previous.ticket.id !== selectedTicketId) return previous
          return {
            ...previous,
            comments: [...(previous.comments || []), created],
          }
        })
      }
      setTickets((previous) =>
        previous.map((ticket) =>
          ticket.id === selectedTicketId ? { ...ticket, comment_count: (ticket.comment_count || 0) + 1 } : ticket
        )
      )
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Failed to add comment")
      toast.error(message)
      setCommentFeedback(message)
      setCommentFeedbackTone("error")
    } finally {
      setIsDetailSaving(false)
    }
  }

  async function decideApproval(ticketId: string, decision: "approved" | "rejected", comments?: string) {
    setProcessingApprovalId(ticketId)
    try {
      const response = await apiFetch(`/api/help-desk/tickets/${ticketId}/approvals`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comments: comments || null }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to process approval")
      toast.success(`Ticket ${decision === "approved" ? "approved" : "rejected"}`)
      await refreshTickets()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to process approval"))
    } finally {
      setProcessingApprovalId(null)
    }
  }

  return (
    <DataTablePage
      title="Help Desk"
      description="Submit and track support/procurement tickets."
      icon={Headset}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as TicketTab)}
      actions={
        <>
          {pendingReviewCount > 0 && (
            <Button variant="outline" onClick={() => setPendingApprovalsOpen(true)}>
              Pending Reviews ({pendingReviewCount})
            </Button>
          )}
          <CreateTicketDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            form={form}
            onFormChange={setForm}
            onSubmit={createTicket}
            isSaving={isSaving}
            departmentOptions={departmentOptions}
            userDepartment={userDepartment}
          />
        </>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Open Tickets"
            value={myOpenTickets}
            icon={LifeBuoy}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Resolved"
            value={filteredByTab.filter((ticket) => ticket.status === "resolved").length}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Pending Review"
            value={pendingReviewCount}
            icon={Headset}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Avg CSAT"
            value={avgCsat}
            icon={Headset}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      {pendingReviewCount > 0 && (
        <PendingApprovalsCard
          open={pendingApprovalsOpen}
          onOpenChange={setPendingApprovalsOpen}
          tickets={pendingApprovals}
          processingId={processingApprovalId}
          onDecision={decideApproval}
        />
      )}

      <DataTable<HelpDeskTicket>
        data={filteredByTab}
        columns={columns}
        getRowId={(ticket) => ticket.id}
        filters={filters}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search ticket number, title, or department..."
        searchFn={(ticket, query) =>
          `${ticket.ticket_number} ${ticket.title} ${ticket.service_department}`.toLowerCase().includes(query)
        }
        rowActions={[
          { label: "View Details", icon: Eye, onClick: (ticket) => void openTicketDetails(ticket.id) },
          { label: "Add Comment", icon: MessageSquare, onClick: (ticket) => void openTicketCommentDialog(ticket.id) },
          {
            label: "Start",
            icon: Play,
            onClick: (ticket) => void setStatus(ticket.id, "in_progress"),
            hidden: (ticket) => !(canUserChangeTicketStatus(ticket, userId) && ticket.status === "assigned"),
          },
          {
            label: "Resolve",
            icon: CheckCircle2,
            onClick: (ticket) => void setStatus(ticket.id, "resolved"),
            hidden: (ticket) => !(canUserChangeTicketStatus(ticket, userId) && ticket.status === "in_progress"),
          },
        ]}
        expandable={{
          render: (ticket) => (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Description</p>
                <p className="mt-1 text-sm">{ticket.description || "No description provided."}</p>
                <div className="text-muted-foreground mt-3 space-y-1 text-xs">
                  <p>Request Type: {formatName(ticket.request_type)}</p>
                  <p>SLA Target: {ticket.sla_target_at ? formatWATDateTime(ticket.sla_target_at) : "-"}</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Goal</span>
                  <span className="max-w-[65%] truncate font-medium">{ticket.goal_title || "Not linked"}</span>
                </div>
                {ticket.requester_id === userId && ticket.status === "resolved" && (
                  <div className="space-y-2 rounded-md border p-2">
                    <p className="text-muted-foreground text-xs">Rate service</p>
                    <div className="flex items-center gap-2">
                      <Select
                        value={ratingDrafts[ticket.id] || ""}
                        onValueChange={(value) =>
                          setRatingDrafts((previous) => ({
                            ...previous,
                            [ticket.id]: value,
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-[120px] text-xs">
                          <SelectValue placeholder="Rate 1-5" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3</SelectItem>
                          <SelectItem value="4">4</SelectItem>
                          <SelectItem value="5">5</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!ratingDrafts[ticket.id]}
                        onClick={async () => {
                          const selected = Number(ratingDrafts[ticket.id])
                          if (!selected || Number.isNaN(selected)) return
                          await rateTicket(ticket.id, selected)
                          setRatingDrafts((previous) => {
                            const next = { ...previous }
                            delete next[ticket.id]
                            return next
                          })
                        }}
                      >
                        Submit
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(ticket) => (
          <div
            className="bg-card hover:border-primary cursor-pointer rounded-xl border-2 p-4 transition-all"
            onClick={() => void openTicketDetails(ticket.id)}
          >
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-[10px] font-bold">{ticket.ticket_number}</span>
                {(ticket.comment_count || 0) > 0 && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <MessageSquare className="h-3 w-3" />
                    {ticket.comment_count}
                  </Badge>
                )}
              </div>
              <PriorityBadge priority={ticket.priority} />
            </div>
            <h4 className="line-clamp-1 text-sm font-semibold">{ticket.title}</h4>
            <p className="text-muted-foreground mt-1 mb-3 text-[10px] uppercase">{ticket.service_department}</p>
            <div className="flex items-center justify-between border-t pt-2">
              <TicketStatusBadge status={ticket.status} />
              <span className="text-muted-foreground text-[10px]">{formatWATDate(ticket.created_at)}</span>
            </div>
          </div>
        )}
        urlSync
      />

      <UserHelpDeskTicketDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        detail={selectedTicketDetail}
        isLoading={detailsLoading}
        loadError={detailsError}
        onRetry={async () => {
          if (!selectedTicketId) return
          await loadTicketDetails(selectedTicketId)
        }}
        selectedStatus={selectedTicketStatus}
        onStatusChange={updateTicketStatusFromModal}
        isSaving={isDetailSaving}
        canChangeStatus={
          selectedTicketDetail?.ticket ? canUserChangeTicketStatus(selectedTicketDetail.ticket, userId) : false
        }
        showDepartmentRestriction={
          selectedTicketDetail?.ticket
            ? isDepartmentTicket(selectedTicketDetail.ticket) &&
              !canUserChangeTicketStatus(selectedTicketDetail.ticket, userId)
            : false
        }
      />
      <UserHelpDeskTicketCommentDialog
        open={commentOpen}
        onOpenChange={setCommentOpen}
        detail={selectedTicketDetail}
        isLoading={detailsLoading}
        loadError={detailsError}
        onRetry={async () => {
          if (!selectedTicketId) return
          await loadTicketDetails(selectedTicketId)
        }}
        newComment={detailComment}
        setNewComment={(value) => {
          setDetailComment(value)
          if (commentFeedback) {
            setCommentFeedback(null)
            setCommentFeedbackTone(null)
          }
        }}
        onAddComment={addTicketCommentFromModal}
        isSaving={isDetailSaving}
        feedbackMessage={commentFeedback}
        feedbackTone={commentFeedbackTone}
        attachmentsSlot={<TicketAttachmentsPanel ticketId={selectedTicketId} currentUserId={userId} />}
      />
    </DataTablePage>
  )
}
