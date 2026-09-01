"use client"

import { useMemo } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/patterns"
import {
  DetailActionBar,
  DetailCallout,
  DetailField,
  DetailFieldGrid,
  DetailSectionHeading,
  DetailTimelineEntry,
} from "@/components/ui/detail-dialog"
import { PriorityBadge, TicketStatusBadge } from "@/components/dashboard/help-desk/ticket-badges"
import {
  Headset,
  MessageSquare,
  Building2,
  CalendarDays,
  AlertCircle,
  Clock,
  Tag,
  Timer,
  CheckCircle2,
  Send,
  User,
} from "lucide-react"
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
  if (!dateString) return "—"
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
  newComment?: string
  setNewComment?: (value: string) => void
  onAddComment?: () => Promise<void>
  isPostingComment?: boolean
  /** Attachments panel, rendered above the comment box. */
  attachmentsSlot?: React.ReactNode
  /**
   * Service rating control, shown under the details. It lives here rather than in
   * an expandable table row because rating is something you do after reading the
   * ticket, and the row it used to sit in did not exist on a phone.
   */
  ratingSlot?: React.ReactNode
}

/** One row of the merged activity list — events and comments share a timeline. */
type ActivityEntry = {
  key: string
  at: string | null | undefined
  title: React.ReactNode
  body?: React.ReactNode
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
  newComment = "",
  setNewComment,
  onAddComment,
  isPostingComment = false,
  attachmentsSlot,
  ratingSlot,
}: UserHelpDeskTicketDetailsDialogProps) {
  const ticket = detail?.ticket || null
  const events = useMemo(() => detail?.events || [], [detail])
  const comments = useMemo(() => detail?.comments || [], [detail])
  const approvals = useMemo(() => detail?.approvals || [], [detail])

  const nextStatuses = useMemo(() => {
    if (!ticket?.status) return []
    const current = String(ticket.status)
    return [current, ...((STATUS_TRANSITIONS as Record<string, HelpDeskStatus[]>)[current] || [])]
  }, [ticket?.status])

  /**
   * Events and comments in one chronological list. They used to render as two
   * stacked blocks — every status change, then every comment — so a comment
   * answering a status change appeared above the change it answered.
   */
  const activity = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [
      ...events.map((event) => ({
        key: `event-${event.id}`,
        at: event.created_at,
        title: (
          <>
            Status changed to <span className="capitalize">{formatLabel(event.new_status)}</span>
          </>
        ),
      })),
      ...comments.map((comment) => ({
        key: `comment-${comment.id}`,
        at: comment.created_at,
        title: "Comment",
        body: comment.comment || comment.body || "—",
      })),
    ]
    return entries.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
  }, [events, comments])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `max-h`, not a fixed `h`: a two-line ticket gets a short dialog. */}
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-2 border-b px-4 py-4 text-left sm:px-6">
          <div className="flex flex-wrap items-center gap-1.5">
            {ticket?.ticket_number && (
              <Badge variant="outline" className="font-mono text-[11px]">
                {ticket.ticket_number}
              </Badge>
            )}
            {ticket && <TicketStatusBadge status={ticket.status} />}
            {ticket && <PriorityBadge priority={ticket.priority} />}
          </div>

          <DialogTitle className="text-base leading-snug font-semibold">
            {ticket ? ticket.title : "Help desk ticket"}
          </DialogTitle>

          <DialogDescription className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span>{ticket?.service_department || "General service"}</span>
            {ticket?.created_at && (
              <>
                <span aria-hidden>·</span>
                <span>Logged {formatDateTime(ticket.created_at)}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Changing the status is why this dialog gets opened — it sits above the
            scroll rather than inside a tab. */}
        {ticket && (
          <DetailActionBar
            label="Move this ticket to"
            hint={
              canChangeStatus
                ? "Changing the status runs its transitions and notifies the people involved."
                : "Status changes are restricted by your role or this department's ticket workflow."
            }
          >
            <Select
              value={selectedStatus}
              onValueChange={(value) => void onStatusChange(value)}
              disabled={isSaving || !canChangeStatus}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {nextStatuses.map((status) => (
                  <SelectItem key={status} value={status} className="capitalize">
                    {formatLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </DetailActionBar>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-4 py-4 sm:px-6">
            {isLoading ? (
              <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-center text-sm">
                <Clock className="text-primary/60 mb-2 h-8 w-8 animate-spin" />
                <p>Loading ticket details…</p>
              </div>
            ) : loadError ? (
              <div className="space-y-3 py-6 text-center">
                <AlertCircle className="text-destructive mx-auto mb-1 h-8 w-8" />
                <p className="text-destructive text-sm font-medium">{loadError}</p>
                <Button size="sm" variant="outline" onClick={() => void onRetry()}>
                  Retry
                </Button>
              </div>
            ) : !ticket ? (
              <EmptyState
                title="No ticket selected"
                description="Choose a ticket to see its details and history."
                icon={Headset}
                className="border-0 py-8"
              />
            ) : (
              <>
                {/* Anything needing an answer comes before the reference data. */}
                {(showDepartmentRestriction || approvals.length > 0) && (
                  <div className="space-y-2">
                    {showDepartmentRestriction && (
                      <DetailCallout tone="amber" label="Department ticket scope">
                        This ticket is managed by the department&apos;s leads and IT administrators.
                      </DetailCallout>
                    )}
                    {/* The approvals were fetched and then never shown: a procurement
                        ticket could be rejected with a note nobody could read. */}
                    {approvals.map((approval) => (
                      <DetailCallout
                        key={approval.id}
                        tone={
                          approval.status === "rejected" ? "rose" : approval.status === "approved" ? "emerald" : "blue"
                        }
                        label={`${formatLabel(approval.approval_stage)} — ${formatLabel(approval.status)}`}
                      >
                        {approval.decision_notes ||
                          (approval.decided_at
                            ? `Decided ${formatDateTime(approval.decided_at)}`
                            : `Requested ${formatDateTime(approval.requested_at)}`)}
                      </DetailCallout>
                    ))}
                  </div>
                )}

                <section className="space-y-1.5">
                  <DetailSectionHeading>What was reported</DetailSectionHeading>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {ticket.description || <span className="text-muted-foreground">No description provided.</span>}
                  </p>
                </section>

                <section className="space-y-3">
                  <DetailSectionHeading>Details</DetailSectionHeading>
                  <DetailFieldGrid>
                    <DetailField icon={Building2} label="Service department">
                      {ticket.service_department}
                    </DetailField>
                    {ticket.requester_department && (
                      <DetailField icon={User} label="Raised from">
                        {ticket.requester_department}
                      </DetailField>
                    )}
                    <DetailField icon={Tag} label="Request type">
                      <span className="capitalize">{formatLabel(ticket.request_type)}</span>
                      {ticket.category ? ` · ${ticket.category}` : ""}
                    </DetailField>
                    <DetailField icon={CalendarDays} label="Logged">
                      {formatDateTime(ticket.created_at)}
                    </DetailField>
                    {/* Surfaced for the first time — the SLA target was on the record
                        all along and the dialog never showed it. */}
                    {ticket.sla_target_at && (
                      <DetailField icon={Timer} label="SLA target">
                        {formatDateTime(ticket.sla_target_at)}
                      </DetailField>
                    )}
                    {ticket.resolved_at && (
                      <DetailField icon={CheckCircle2} label="Resolved">
                        {formatDateTime(ticket.resolved_at)}
                      </DetailField>
                    )}
                    {ticket.closed_at && (
                      <DetailField icon={CheckCircle2} label="Closed">
                        {formatDateTime(ticket.closed_at)}
                      </DetailField>
                    )}
                  </DetailFieldGrid>
                </section>

                {ratingSlot && (
                  <section className="space-y-3">
                    <DetailSectionHeading>Rate this service</DetailSectionHeading>
                    {ratingSlot}
                  </section>
                )}

                {attachmentsSlot && <section className="space-y-3">{attachmentsSlot}</section>}

                {/* Activity in the same scroll, not behind a tab: it was costing a
                    click just to learn whether anything had happened. */}
                <section className="space-y-3">
                  <DetailSectionHeading count={activity.length}>Activity</DetailSectionHeading>

                  {onAddComment && setNewComment && (
                    <div className="space-y-2">
                      <Textarea
                        value={newComment}
                        onChange={(event) => setNewComment(event.target.value)}
                        placeholder="Post a comment or progress note…"
                        className="min-h-[68px] text-sm"
                        aria-label="Add a comment"
                      />
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={isPostingComment || !newComment.trim()}
                          onClick={() => void onAddComment()}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {isPostingComment ? "Posting…" : "Post comment"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {activity.length > 0 ? (
                    <ul className="space-y-3">
                      {activity.map((entry) => (
                        <DetailTimelineEntry key={entry.key} title={entry.title} timestamp={formatDateTime(entry.at)}>
                          {entry.body}
                        </DetailTimelineEntry>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground flex items-center gap-2 text-sm">
                      <MessageSquare className="h-4 w-4" />
                      No updates yet.
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
