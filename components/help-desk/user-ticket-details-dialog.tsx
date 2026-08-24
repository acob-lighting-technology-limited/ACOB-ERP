"use client"

import { useState, useMemo, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { EmptyState } from "@/components/ui/patterns"
import { PriorityBadge, TicketStatusBadge } from "@/components/dashboard/help-desk/ticket-badges"
import {
  Headset,
  MessageSquare,
  Building2,
  Calendar,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  LifeBuoy,
  FileText,
  HelpCircle,
  Send,
  User,
} from "lucide-react"
import type { HelpDeskTicketDetailResponse } from "@/components/help-desk/help-desk-types"
import type { HelpDeskStatus } from "@/lib/help-desk/server"
import { formatWATDateTime } from "@/lib/utils/date"
import { cn } from "@/lib/utils"

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
  /**
   * Posting a comment used to require a separate dialog, reached only by a
   * different row action than "View Details" — two disconnected entry points
   * for the same ticket. This is now the only one.
   */
  newComment?: string
  setNewComment?: (value: string) => void
  onAddComment?: () => Promise<void>
  isPostingComment?: boolean
  /** Attachments panel, rendered above the comment box. */
  attachmentsSlot?: React.ReactNode
}

type TicketTab = "overview" | "activity"

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
}: UserHelpDeskTicketDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<TicketTab>("overview")
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const handleCopy = useCallback((text: string, fieldName: string) => {
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  const ticket = detail?.ticket || null
  const events = detail?.events || []
  const comments = detail?.comments || []

  const nextStatuses = useMemo(() => {
    if (!ticket?.status) return []
    const current = String(ticket.status)
    return [current, ...((STATUS_TRANSITIONS as Record<string, HelpDeskStatus[]>)[current] || [])]
  }, [ticket?.status])

  const totalActivityCount = events.length + comments.length

  const tabs: Array<{ id: TicketTab; label: string; icon: typeof LifeBuoy; count?: number }> = [
    { id: "overview", label: "Details", icon: LifeBuoy },
    { id: "activity", label: "Activity", icon: MessageSquare, count: totalActivityCount },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88dvh] max-h-[88dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        {/* Modal Header */}
        <DialogHeader className="bg-muted/20 border-b px-5 py-3.5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-10 w-10 shrink-0 border shadow-xs">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                  <Headset className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-base font-semibold">
                    {ticket ? ticket.title : "Help Desk Ticket"}
                  </DialogTitle>
                  {ticket?.ticket_number && (
                    <Badge
                      variant="outline"
                      className="border-blue-200 bg-blue-50/50 font-mono text-[11px] font-medium text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400"
                    >
                      {ticket.ticket_number}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span>{ticket?.service_department || "General Service"}</span>
                  {ticket?.created_at && (
                    <>
                      <span>•</span>
                      <span>Logged: {formatDateTime(ticket.created_at)}</span>
                    </>
                  )}
                </DialogDescription>
              </div>
            </div>

            {/* Quick Status Badges in Header */}
            {ticket && (
              <div className="flex shrink-0 items-center gap-2">
                <TicketStatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Tab Navigation Header */}
        <div className="bg-background border-b px-5 sm:px-6">
          <div className="flex gap-1">
            {tabs.map(({ id, label, icon: TabIcon, count }) => {
              const isActive = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-primary text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground border-transparent"
                  )}
                >
                  <TabIcon className="h-3.5 w-3.5" />
                  {label}
                  {count !== undefined && count > 0 && (
                    <span className="bg-muted text-muted-foreground ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-5 sm:p-6">
              {isLoading ? (
                <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-center text-sm">
                  <Clock className="text-primary/60 mb-2 h-8 w-8 animate-spin" />
                  <p>Loading ticket details...</p>
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
                  title="No Ticket Selected"
                  description="Choose a ticket to inspect full details and activity history."
                  icon={Headset}
                  className="border-0 py-8"
                />
              ) : (
                <>
                  {/* TAB 1: DETAILS */}
                  {activeTab === "overview" && (
                    <div className="space-y-4">
                      {/* Status: moved here from its own tab, same as the task
                          detail dialog — a whole tab for one dropdown was an
                          extra click for no reason. */}
                      <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b pb-2">
                          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                            <ShieldCheck className="text-primary h-3.5 w-3.5" /> Status
                          </span>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            Current: {formatLabel(ticket.status)}
                          </Badge>
                        </div>
                        <div className="space-y-1.5">
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
                            {canChangeStatus
                              ? "Selecting a status will trigger state transitions and automatically notify relevant team members."
                              : "Status changes are restricted based on your role or current department ticket workflow."}
                          </p>
                        </div>
                      </div>

                      {/* Hero Stat Cards */}
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                        <div className="bg-card rounded-lg border p-3 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                              Status
                            </span>
                            <div className="rounded-md bg-blue-500/10 p-1 text-blue-600 dark:text-blue-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </div>
                          </div>
                          <div className="mt-1">
                            <span className="text-foreground block truncate text-sm font-semibold capitalize">
                              {formatLabel(ticket.status)}
                            </span>
                          </div>
                        </div>

                        <div className="bg-card rounded-lg border p-3 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                              Priority
                            </span>
                            <div className="rounded-md bg-amber-500/10 p-1 text-amber-600 dark:text-amber-400">
                              <AlertCircle className="h-3.5 w-3.5" />
                            </div>
                          </div>
                          <div className="mt-1">
                            <span className="text-foreground block truncate text-sm font-semibold capitalize">
                              {ticket.priority}
                            </span>
                          </div>
                        </div>

                        <div className="bg-card rounded-lg border p-3 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                              Department
                            </span>
                            <div className="rounded-md bg-purple-500/10 p-1 text-purple-600 dark:text-purple-400">
                              <Building2 className="h-3.5 w-3.5" />
                            </div>
                          </div>
                          <div className="mt-1">
                            <span className="text-foreground block truncate text-sm font-semibold">
                              {ticket.service_department}
                            </span>
                          </div>
                        </div>

                        <div className="bg-card rounded-lg border p-3 shadow-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                              Logged At
                            </span>
                            <div className="rounded-md bg-emerald-500/10 p-1 text-emerald-600 dark:text-emerald-400">
                              <Calendar className="h-3.5 w-3.5" />
                            </div>
                          </div>
                          <div className="mt-1">
                            <span className="text-foreground block truncate text-xs font-semibold">
                              {formatDateTime(ticket.created_at)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Issue Description Card */}
                      <div className="bg-card space-y-2 rounded-lg border p-4 shadow-xs">
                        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                          <FileText className="text-primary h-3.5 w-3.5" /> Issue Details & Description
                        </span>
                        <div className="bg-muted/30 text-foreground rounded-md border p-3 text-xs leading-relaxed whitespace-pre-wrap">
                          {ticket.description || "No description provided."}
                        </div>
                      </div>

                      {/* Department Restriction Notice if applicable */}
                      {showDepartmentRestriction && (
                        <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3.5 dark:border-amber-500/30 dark:bg-amber-900/10">
                          <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                            <Building2 className="h-4 w-4" />
                            Department Ticket Scope
                          </p>
                          <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                            This department help desk ticket is managed directly by authorized leads and IT
                            administrators.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 2: ACTIVITY & COMMENTS */}
                  {activeTab === "activity" && (
                    <div className="space-y-4">
                      {attachmentsSlot}

                      {onAddComment && setNewComment && (
                        <div className="bg-card space-y-2 rounded-lg border p-4 shadow-xs">
                          <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                            Add a comment
                          </label>
                          <Textarea
                            value={newComment}
                            onChange={(event) => setNewComment(event.target.value)}
                            placeholder="Post a comment or progress note..."
                            className="min-h-[70px] text-xs"
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              disabled={isPostingComment || !newComment.trim()}
                              onClick={() => void onAddComment()}
                            >
                              <Send className="h-3.5 w-3.5" />
                              {isPostingComment ? "Posting..." : "Post comment"}
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b pb-2">
                          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                            <MessageSquare className="text-primary h-3.5 w-3.5" /> Activity & Events Timeline
                          </span>
                          <span className="text-muted-foreground font-mono text-[11px]">
                            {totalActivityCount} {totalActivityCount === 1 ? "entry" : "entries"}
                          </span>
                        </div>

                        {totalActivityCount > 0 ? (
                          <div className="space-y-3">
                            {events.map((event) => (
                              <div key={`event-${event.id}`} className="bg-muted/20 space-y-1 rounded-lg border p-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-foreground text-xs font-semibold">
                                    Status Changed:{" "}
                                    <span className="text-primary capitalize">{formatLabel(event.new_status)}</span>
                                  </span>
                                  <span className="text-muted-foreground font-mono text-[10px]">
                                    {formatDateTime(event.created_at)}
                                  </span>
                                </div>
                              </div>
                            ))}

                            {comments.map((comment) => (
                              <div
                                key={`comment-${comment.id}`}
                                className="bg-muted/20 space-y-1 rounded-lg border p-3"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-foreground text-xs font-medium">Comment</span>
                                  <span className="text-muted-foreground font-mono text-[10px]">
                                    {formatDateTime(comment.created_at)}
                                  </span>
                                </div>
                                <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
                                  {comment.comment || comment.body || "—"}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <EmptyState
                            title="No updates yet"
                            description="Ticket comments and status changes will appear here."
                            icon={MessageSquare}
                            className="border-0 px-0 py-6"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Modal Footer */}
        <DialogFooter className="bg-muted/20 flex flex-row items-center justify-between gap-2 border-t px-5 py-3 sm:px-6">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            {ticket?.ticket_number && (
              <>
                <span className="hidden sm:inline">Ticket ID:</span>
                <button
                  type="button"
                  onClick={() => handleCopy(ticket.ticket_number, "Ticket")}
                  className="hover:text-foreground inline-flex items-center gap-1 font-mono transition-colors"
                  title="Click to copy ticket number"
                >
                  <span>{ticket.ticket_number}</span>
                  {copiedField === "Ticket" ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3 opacity-60" />
                  )}
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs">
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
