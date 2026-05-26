"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ListToolbar } from "@/components/ui/patterns"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { PriorityBadge, TicketStatusBadge } from "@/components/dashboard/help-desk/ticket-badges"
import { HELP_DESK_STATUSES } from "@/lib/help-desk/server"

export interface MyHelpDeskTicket {
  id: string
  ticket_number: string
  title: string
  service_department: string
  priority: "low" | "medium" | "high" | "urgent"
  status: string
  assigned_to: string | null
  requester_id: string
}

type TicketTab = "all" | "open" | "pending" | "resolved" | "closed"

interface MyTicketsTableProps {
  tickets: MyHelpDeskTicket[]
  userId: string
  onSetStatus: (ticketId: string, status: string) => Promise<void> | void
  onRateTicket: (ticketId: string, rating: number) => Promise<void> | void
  onViewTicket: (ticketId: string) => void
}

const s = HELP_DESK_STATUSES
const PENDING_STATUSES = new Set<string>(
  s.filter((x) => ["new", "pending_lead_review", "department_queue", "pending_approval", "assigned"].includes(x))
)
const OPEN_STATUSES = new Set<string>(
  s.filter((x) =>
    ["new", "pending_lead_review", "department_queue", "department_assigned", "assigned", "in_progress"].includes(x)
  )
)
const RESOLVED_STATUSES = new Set<string>(s.filter((x) => x === "resolved"))
const CLOSED_STATUSES = new Set<string>(s.filter((x) => ["closed", "cancelled", "rejected"].includes(x)))

function belongsToTab(ticket: MyHelpDeskTicket, tab: TicketTab) {
  if (tab === "all") return true
  if (tab === "open") return OPEN_STATUSES.has(ticket.status)
  if (tab === "pending") return PENDING_STATUSES.has(ticket.status)
  if (tab === "resolved") return RESOLVED_STATUSES.has(ticket.status)
  return CLOSED_STATUSES.has(ticket.status)
}

function buildHelpDeskInfo(ticket: MyHelpDeskTicket) {
  const nextStep =
    ticket.status === "resolved"
      ? "The requester should confirm the fix worked or give a rating and close the loop."
      : ticket.status === "closed" || ticket.status === "cancelled" || ticket.status === "rejected"
        ? "This request is no longer active. Review its history before reopening or recreating it."
        : "The assigned handler or reviewing department should act on the request, then update the ticket status with progress."

  return {
    title: `${ticket.ticket_number} help desk guide`,
    summary: "This explains what the help desk ticket means and what should happen next.",
    details: [
      {
        label: "What this item is",
        value: `${ticket.title} is a help desk request sent to ${ticket.service_department}.`,
      },
      {
        label: "Current workflow meaning",
        value: `Status is ${ticket.status.replaceAll("_", " ")}. Priority is ${ticket.priority}.`,
      },
      {
        label: "What to do next",
        value: nextStep,
      },
    ],
  }
}

export function MyTicketsTable({ tickets, userId, onSetStatus, onRateTicket, onViewTicket }: MyTicketsTableProps) {
  const [activeTab, setActiveTab] = useState<TicketTab>("all")
  const [search, setSearch] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, string>>({})

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(tickets.map((ticket) => ticket.status).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tickets]
  )

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tickets.filter((ticket) => {
      if (!belongsToTab(ticket, activeTab)) return false
      if (priorityFilter !== "all" && ticket.priority !== priorityFilter) return false
      if (statusFilter !== "all" && ticket.status !== statusFilter) return false
      if (!query) return true

      return (
        ticket.ticket_number.toLowerCase().includes(query) ||
        ticket.title.toLowerCase().includes(query) ||
        ticket.service_department.toLowerCase().includes(query)
      )
    })
  }, [activeTab, priorityFilter, search, statusFilter, tickets])

  const counts = useMemo(
    () => ({
      all: tickets.length,
      open: tickets.filter((ticket) => belongsToTab(ticket, "open")).length,
      pending: tickets.filter((ticket) => belongsToTab(ticket, "pending")).length,
      resolved: tickets.filter((ticket) => belongsToTab(ticket, "resolved")).length,
      closed: tickets.filter((ticket) => belongsToTab(ticket, "closed")).length,
    }),
    [tickets]
  )

  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TicketTab)}>
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="open">Open ({counts.open})</TabsTrigger>
          <TabsTrigger value="pending">Pending ({counts.pending})</TabsTrigger>
          <TabsTrigger value="resolved">Resolved ({counts.resolved})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({counts.closed})</TabsTrigger>
        </TabsList>
      </Tabs>

      <ListToolbar
        search={
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by ticket no, title, or department"
            className="w-full sm:max-w-[320px]"
          />
        }
        filters={
          <div className="flex flex-wrap gap-2">
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S/N</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTickets.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  No tickets match your filters.
                </TableCell>
              </TableRow>
            )}
            {filteredTickets.map((ticket, index) => (
              <TableRow key={ticket.id}>
                <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                <TableCell>
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => onViewTicket(ticket.id)}
                      className="text-left font-medium underline-offset-2 hover:underline"
                    >
                      {ticket.ticket_number}
                    </button>
                    <ItemInfoButton {...buildHelpDeskInfo(ticket)} />
                  </div>
                  <div className="text-muted-foreground text-xs">{ticket.title}</div>
                </TableCell>
                <TableCell>{ticket.service_department}</TableCell>
                <TableCell>
                  <PriorityBadge priority={ticket.priority} />
                </TableCell>
                <TableCell>
                  <TicketStatusBadge status={ticket.status} />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-[230px] flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => onViewTicket(ticket.id)}>
                      View
                    </Button>
                    {ticket.assigned_to === userId && ticket.status === "assigned" && (
                      <Button size="sm" variant="outline" onClick={() => onSetStatus(ticket.id, "in_progress")}>
                        Start
                      </Button>
                    )}
                    {ticket.assigned_to === userId && ticket.status === "in_progress" && (
                      <Button size="sm" variant="outline" onClick={() => onSetStatus(ticket.id, "resolved")}>
                        Resolve
                      </Button>
                    )}
                    {ticket.requester_id === userId && ticket.status === "resolved" && (
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
                          <SelectTrigger className="h-8 w-[110px]">
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
                            await onRateTicket(ticket.id, selected)
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
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
