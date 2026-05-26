"use client"

import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { EmptyState } from "@/components/ui/patterns"
import { PriorityBadge, TicketStatusBadge } from "@/components/dashboard/help-desk/ticket-badges"
import { MessageSquare, Building2 } from "lucide-react"
import type { HelpDeskTicketDetailResponse } from "@/components/help-desk/help-desk-types"
import type { HelpDeskStatus } from "@/lib/help-desk/server"
import { formatWATDateTime } from "@/lib/utils/date"

const STATUS_TRANSITIONS: Partial<Record<HelpDeskStatus, HelpDeskStatus[]>> = {
  new: ["assigned", "department_queue", "cancelled"],
  department_queue: ["department_assigned", "assigned", "cancelled"],
  department_assigned: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["resolved", "returned", "cancelled", "paused"],
  paused: ["in_progress", "cancelled"],
  resolved: ["closed", "in_progress"],
  returned: ["in_progress"],
  closed: [],
  cancelled: [],
  pending_approval: ["approved_for_procurement", "rejected"],
  approved_for_procurement: ["assigned", "cancelled"],
  rejected: ["new"],
  pending_lead_review: ["department_queue", "assigned", "cancelled"],
}

function formatLabel(value: string | null | undefined) {
  return String(value || "unknown").replaceAll("_", " ")
}

function formatDateTime(dateString: string | null | undefined) {
  if (!dateString) return "-"
  return formatWATDateTime(dateString)
}

interface UserHelpDeskTicketDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: HelpDeskTicketDetailResponse | null
  isLoading: boolean
  loadError: string | null
  onRetry: () => Promise<void>
  selectedStatus: string
  onStatusChange: (status: string) => Promise<void>
  isSaving: boolean
  canChangeStatus: boolean
  showDepartmentRestriction: boolean
}

export function UserHelpDeskTicketDetailsDialog({
  open,
  onOpenChange,
  detail,
  isLoading,
  loadError,
  onRetry,
  selectedStatus,
  onStatusChange,
  isSaving,
  canChangeStatus,
  showDepartmentRestriction,
}: UserHelpDeskTicketDetailsDialogProps) {
  const ticket = detail?.ticket || null
  const events = detail?.events || []
  const comments = detail?.comments || []
  const nextStatuses = useMemo(() => {
    if (!ticket?.status) return []
    const current = String(ticket.status)
    return [current, ...((STATUS_TRANSITIONS as Record<string, HelpDeskStatus[]>)[current] || [])]
  }, [ticket?.status])

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Ticket Details"
      description="Review and update quickly."
      desktopClassName="max-w-2xl"
    >
      {isLoading ? (
        <div className="text-muted-foreground py-4 text-sm">Loading ticket details...</div>
      ) : loadError ? (
        <div className="space-y-3 py-2">
          <p className="text-sm text-red-500">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void onRetry()}>
            Retry
          </Button>
        </div>
      ) : !ticket ? (
        <div className="text-muted-foreground py-4 text-sm">No ticket selected.</div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1 border-b pb-3">
            <div className="font-mono text-xs font-semibold">{ticket.ticket_number}</div>
            <h3 className="text-sm font-semibold">{ticket.title}</h3>
            <p className="text-muted-foreground text-xs">{ticket.description || "No description provided."}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <TicketStatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Activity Timeline</h4>
              {events.length || comments.length ? (
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {events.map((event) => (
                    <div key={`event-${event.id}`} className="border-l-2 pl-3">
                      <p className="text-xs font-medium">Status: {formatLabel(event.new_status)}</p>
                      <p className="text-muted-foreground text-[11px]">{formatDateTime(event.created_at)}</p>
                    </div>
                  ))}
                  {comments.map((comment) => (
                    <div key={`comment-${comment.id}`} className="border-l-2 pl-3">
                      <p className="text-xs">{comment.comment || comment.body || "-"}</p>
                      <p className="text-muted-foreground text-[11px]">{formatDateTime(comment.created_at)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No updates yet"
                  description="Ticket comments and status changes will appear here."
                  icon={MessageSquare}
                  className="border-0 px-0 py-2"
                />
              )}
            </div>

            <div className="space-y-3">
              {showDepartmentRestriction && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-2 dark:border-amber-500/30 dark:bg-amber-900/10">
                  <p className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <Building2 className="h-3.5 w-3.5" />
                    Department Ticket Restriction
                  </p>
                  <p className="mt-1 text-[11px] text-amber-700/90 dark:text-amber-300/90">
                    Department help desk tickets can only be updated by leads/admin from Admin Help Desk.
                  </p>
                </div>
              )}
              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Update Status</h4>
                <Select
                  value={selectedStatus}
                  onValueChange={(value) => void onStatusChange(value)}
                  disabled={isSaving || !canChangeStatus}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {nextStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {formatLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-[11px]">
                  Status updates are only available here for eligible tickets and roles.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </ResponsiveModal>
  )
}
