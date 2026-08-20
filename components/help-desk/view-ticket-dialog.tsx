"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { EmptyState } from "@/components/ui/patterns"
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
import {
  Headset,
  LifeBuoy,
  MessageSquare,
  Building2,
  Calendar,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  FileText,
} from "lucide-react"
import { formatWATDateTime } from "@/lib/utils/date"
import { cn } from "@/lib/utils"

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

type TicketTab = "overview" | "workflow" | "activity"

function formatLabel(value: string | null | undefined) {
  return String(value || "unknown").replaceAll("_", " ")
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
  const [activeTab, setActiveTab] = useState<TicketTab>("overview")
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const handleCopy = useCallback((text: string, fieldName: string) => {
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  const isStatusChanged = Boolean(ticket && currentStatus && currentStatus !== ticket.status)

  const tabs: Array<{ id: TicketTab; label: string; icon: typeof LifeBuoy; count?: number }> = [
    { id: "overview", label: "Overview & Issue", icon: LifeBuoy },
    { id: "workflow", label: "Status & Workflow", icon: ShieldCheck },
    { id: "activity", label: "Recent Activity", icon: MessageSquare, count: events.length },
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
                    {ticket ? ticket.title : "Ticket Details"}
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
                  <span>{ticket?.service_department || "Service"}</span>
                  {ticket?.created_at && (
                    <>
                      <span>•</span>
                      <span>Logged: {formatWATDateTime(ticket.created_at)}</span>
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
              {loading ? (
                <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-center text-sm">
                  <Clock className="text-primary/60 mb-2 h-8 w-8 animate-spin" />
                  <p>Loading ticket details...</p>
                </div>
              ) : !ticket ? (
                <EmptyState
                  title="No ticket details"
                  description="Ticket information could not be retrieved."
                  icon={Headset}
                  className="border-0 py-8"
                />
              ) : (
                <>
                  {/* TAB 1: OVERVIEW & DETAILS */}
                  {activeTab === "overview" && (
                    <div className="space-y-4">
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
                              {ticket.created_at ? formatWATDateTime(ticket.created_at) : "—"}
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
                    </div>
                  )}

                  {/* TAB 2: STATUS & WORKFLOW */}
                  {activeTab === "workflow" && (
                    <div className="space-y-4">
                      <div className="bg-card space-y-4 rounded-lg border p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b pb-2">
                          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                            <ShieldCheck className="text-primary h-3.5 w-3.5" /> Ticket Status Administration
                          </span>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            Current: {formatLabel(ticket.status)}
                          </Badge>
                        </div>

                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-foreground text-xs font-medium">Select New Status</Label>
                            <Select value={currentStatus} onValueChange={onStatusChange} disabled={isSaving}>
                              <SelectTrigger className="h-9 text-xs">
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                              <SelectContent>
                                {TICKET_STATUS_OPTIONS.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {formatLabel(status)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex justify-end pt-2">
                            <Button
                              size="sm"
                              onClick={onSave}
                              disabled={!isStatusChanged || isSaving}
                              className="h-8 gap-1.5 text-xs"
                            >
                              {isSaving ? "Saving..." : "Apply Status Change"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: ACTIVITY HISTORY */}
                  {activeTab === "activity" && (
                    <div className="space-y-4">
                      <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b pb-2">
                          <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                            <MessageSquare className="text-primary h-3.5 w-3.5" /> Recent Events Log
                          </span>
                          <span className="text-muted-foreground font-mono text-[11px]">
                            {events.length} {events.length === 1 ? "event" : "events"}
                          </span>
                        </div>

                        {events.length > 0 ? (
                          <div className="space-y-3">
                            {events
                              .slice(-12)
                              .reverse()
                              .map((event) => (
                                <div key={event.id} className="bg-muted/20 space-y-1 rounded-lg border p-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-foreground text-xs font-semibold">
                                      {formatLabel(event.event_type || "Status Change")}
                                    </span>
                                    <span className="text-muted-foreground font-mono text-[10px]">
                                      {event.created_at ? formatWATDateTime(event.created_at) : "—"}
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground text-xs">
                                    From{" "}
                                    <span className="text-foreground font-medium capitalize">
                                      {formatLabel(event.old_status || "—")}
                                    </span>{" "}
                                    to{" "}
                                    <span className="text-primary font-medium capitalize">
                                      {formatLabel(event.new_status || "—")}
                                    </span>
                                  </p>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <EmptyState
                            title="No events yet"
                            description="Recent status changes and automated actions will be tracked here."
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
            {isStatusChanged && (
              <Button size="sm" onClick={onSave} disabled={isSaving} className="h-8 text-xs">
                {isSaving ? "Saving..." : "Update Status"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
