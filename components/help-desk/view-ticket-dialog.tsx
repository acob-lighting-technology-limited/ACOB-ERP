"use client"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PriorityBadge, TicketStatusBadge } from "@/components/dashboard/help-desk/ticket-badges"
import { formatWATDateTime } from "@/lib/utils/date"

const TICKET_STATUS_OPTIONS = [
  "new",
  "pending_lead_review",
  "department_queue",
  "department_assigned",
  "assigned",
  "in_progress",
  "pending_approval",
  "approved_for_procurement",
  "rejected",
  "returned",
  "resolved",
  "closed",
  "cancelled",
] as const

interface TicketDetail {
  ticket_number: string
  title: string
  description?: string | null
  service_department: string
  priority: "low" | "medium" | "high" | "urgent"
  status: string
  created_at?: string | null
}

interface TicketEvent {
  id: string
  event_type?: string | null
  old_status?: string | null
  new_status?: string | null
  created_at?: string | null
}

interface ViewTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  ticket: TicketDetail | null
  events: TicketEvent[]
  currentStatus: string
  onStatusChange: (status: string) => void
  onSave: () => void
  isSaving: boolean
}

export function ViewTicketDialog({
  open,
  onOpenChange,
  loading,
  ticket,
  events,
  currentStatus,
  onStatusChange,
  onSave,
  isSaving,
}: ViewTicketDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ticket Details</DialogTitle>
          <DialogDescription>View full ticket information and update status.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground text-sm">Loading ticket details...</p>
        ) : ticket ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase">Ticket Number</p>
                <p className="font-medium">{ticket.ticket_number}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase">Department</p>
                <p className="font-medium">{ticket.service_department}</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase">Priority</p>
                <PriorityBadge priority={ticket.priority} />
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase">Status</p>
                <TicketStatusBadge status={ticket.status} />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs uppercase">Title</p>
              <p className="font-medium">{ticket.title || "-"}</p>
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs uppercase">Description</p>
              <p className="text-sm whitespace-pre-wrap">{ticket.description || "-"}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={currentStatus} onValueChange={onStatusChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs uppercase">Created</p>
                <p className="text-sm">{ticket.created_at ? formatWATDateTime(ticket.created_at) : "-"}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs uppercase">Recent Activity</p>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded border p-3">
                {events.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No events yet.</p>
                ) : (
                  events
                    .slice(-8)
                    .reverse()
                    .map((event) => (
                      <div key={event.id} className="text-sm">
                        <p className="font-medium">{event.event_type?.replaceAll("_", " ") || "event"}</p>
                        <p className="text-muted-foreground text-xs">
                          {(event.old_status || "-").replaceAll("_", " ")} to{" "}
                          {(event.new_status || "-").replaceAll("_", " ")} at{" "}
                          {event.created_at ? formatWATDateTime(event.created_at) : "-"}
                        </p>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Ticket details could not be loaded.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onSave} disabled={!ticket || !currentStatus || currentStatus === ticket?.status || isSaving}>
            {isSaving ? "Saving..." : "Update Status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
