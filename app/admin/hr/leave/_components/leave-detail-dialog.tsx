"use client"

import { useState, useCallback } from "react"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Clock,
  User,
  FileCheck,
  FileText,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Copy,
  Check,
  X,
  Layers,
  ExternalLink,
  ShieldCheck,
  MessageSquare,
  Paperclip,
  CalendarCheck2,
} from "lucide-react"
import { LeaveItem, approvalStageKey, resolvePersonName, getStageBadge } from "../view"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { leaveEvidenceHref, leaveHandoverHref } from "@/lib/hr/leave-attachment-links"
import { formatName, cn } from "@/lib/utils"
import { DetailSectionHeading } from "@/components/ui/detail-dialog"

interface LeaveDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  leave: LeaveItem | null
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  showActionButtons?: boolean
}

type ModalTab = "overview" | "timeline" | "documents"

function safeDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return "—"
  try {
    return formatWATDate(dateStr)
  } catch {
    return dateStr
  }
}

function getInitials(name?: string | null): string {
  if (!name) return "LR"
  const clean = name.trim()
  const parts = clean.split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase()
}

export function LeaveDetailDialog({
  open,
  onOpenChange,
  leave,
  onApprove,
  onReject,
  showActionButtons = false,
}: LeaveDetailDialogProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("overview")
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const handleCopy = useCallback((text: string, fieldName: string) => {
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  if (!leave) return null

  const timeline = [...(leave.approvals || [])].sort((left, right) => {
    const leftOrder = Number(left.stage_order || left.approval_level || 999)
    const rightOrder = Number(right.stage_order || right.approval_level || 999)
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return String(left.approved_at || "").localeCompare(String(right.approved_at || ""))
  })

  const stageAuditMap = new Map<string, (typeof timeline)[number]>()
  for (const item of timeline) {
    const key = approvalStageKey(item.stage_code)
    const existing = stageAuditMap.get(key)
    if (!existing) {
      stageAuditMap.set(key, item)
      continue
    }

    const existingTime = existing.approved_at ? new Date(existing.approved_at).getTime() : 0
    const nextTime = item.approved_at ? new Date(item.approved_at).getTime() : 0
    if (nextTime >= existingTime) {
      stageAuditMap.set(key, item)
    }
  }

  const stageOrder = ["reliever", "department_lead", "admin_hr_lead", "hcs", "md"]
  const stageName: Record<string, string> = {
    reliever: "Reliever Review",
    department_lead: "Department Lead",
    admin_hr_lead: "Admin and HR Lead",
    hcs: "Head, Corporate Services",
    md: "Managing Director",
  }
  const currentStageKey = approvalStageKey(leave.current_stage_code || leave.approval_stage)
  const hasRelieverAssignee = Boolean(leave.reliever?.id || leave.reliever_id)
  const relieverHandledByLead =
    Boolean(leave.reliever?.id || leave.reliever_id) &&
    Boolean(leave.supervisor?.id || leave.supervisor_id) &&
    (leave.reliever?.id || leave.reliever_id) === (leave.supervisor?.id || leave.supervisor_id) &&
    Boolean(stageAuditMap.get("department_lead"))
  const departmentLeadApproverName = resolvePersonName(stageAuditMap.get("department_lead")?.approver)
  const advancedPastReliever = ["department_lead", "admin_hr_lead", "hcs", "md"].includes(currentStageKey)

  const statusLower = String(leave.status || "").toLowerCase()
  const isApproved = statusLower === "approved" || statusLower === "completed"
  const isRejected = statusLower === "rejected"
  const isCancelled = statusLower === "cancelled"

  const employeeName = leave.user?.full_name || "Employee"
  const employeeEmail = leave.user?.company_email || ""
  const employeeDept = leave.user?.department || "Unassigned"
  const leaveTypeName = leave.leave_type?.name || "Leave Request"

  const evidenceCount = (leave.evidence?.length || 0) + (leave.handover_checklist_url ? 1 : 0)

  const tabs: Array<{ id: ModalTab; label: string; icon: typeof FileText; count?: number }> = [
    { id: "overview", label: "Overview & Specs", icon: CalendarCheck2 },
    { id: "timeline", label: "Approval Workflow", icon: Layers },
    { id: "documents", label: "Documents & Evidence", icon: Paperclip, count: evidenceCount },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        {/* Modal Header */}
        <DialogHeader className="bg-muted/20 border-b px-5 py-3.5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-10 w-10 shrink-0 border shadow-xs">
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                  {getInitials(employeeName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-base font-semibold">{formatName(employeeName)}</DialogTitle>
                  <Badge
                    variant="outline"
                    className="border-blue-200 bg-blue-50/50 font-mono text-[11px] font-medium text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400"
                  >
                    {leaveTypeName}
                  </Badge>
                </div>
                <DialogDescription className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span>{employeeDept}</span>
                  <span>•</span>
                  <span>
                    {safeDateDisplay(leave.start_date)} – {safeDateDisplay(leave.end_date)} ({leave.days_count}{" "}
                    {leave.days_count === 1 ? "day" : "days"})
                  </span>
                </DialogDescription>
              </div>
            </div>

            {/* Quick Status Badges in Header */}
            <div className="flex shrink-0 items-center gap-2">
              {getStageBadge(leave)}
              <Badge
                className={cn(
                  "px-2.5 py-0.5 text-xs font-medium capitalize",
                  isApproved
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                    : isRejected || isCancelled
                      ? "border-red-500/20 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400"
                      : "border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
                )}
                variant="outline"
              >
                {leave.status}
              </Badge>
            </div>
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
        {/* Plain overflow container, not Radix ScrollArea: its viewport is `h-full`,
            which resolves to `auto` under a max-height (rather than fixed-height)
            dialog, so tall content was clipped with nothing to scroll. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-5 sm:p-6">
            {/* TAB 1: OVERVIEW & SPECS */}
            {activeTab === "overview" && (
              <div className="space-y-4">
                {/* Sections, not cards: the dialog is already a surface, and the
                      four "hero" tiles above these repeated the dates the header and
                      the specifications below both already state. */}
                <div className="grid gap-5 md:grid-cols-2">
                  <section className="space-y-3">
                    <DetailSectionHeading>Employee</DetailSectionHeading>

                    <div className="space-y-2.5 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Employee Name</span>
                        <span className="text-foreground mt-0.5 block font-medium">{formatName(employeeName)}</span>
                      </div>

                      <div>
                        <span className="text-muted-foreground block text-[11px]">Company Email</span>
                        <div className="group mt-0.5 flex items-center justify-between">
                          <span className="text-foreground truncate font-mono font-medium select-all">
                            {employeeEmail || "—"}
                          </span>
                          {employeeEmail && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-60 hover:opacity-100"
                              onClick={() => handleCopy(employeeEmail, "Email")}
                            >
                              {copiedField === "Email" ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="text-muted-foreground block text-[11px]">Department</span>
                        <span className="text-foreground mt-0.5 block font-medium">{employeeDept}</span>
                      </div>

                      <div className="border-t pt-2.5">
                        <span className="text-muted-foreground block text-[11px]">Assigned Reliever</span>
                        <span className="text-foreground mt-0.5 block font-medium">
                          {leave.reliever?.full_name || resolvePersonName(leave.reliever) || "None required"}
                        </span>
                      </div>

                      <div>
                        <span className="text-muted-foreground block text-[11px]">Department Lead / Supervisor</span>
                        <span className="text-foreground mt-0.5 block font-medium">
                          {leave.supervisor?.full_name || resolvePersonName(leave.supervisor) || "Department Lead"}
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <DetailSectionHeading>Leave specifications</DetailSectionHeading>

                    <div className="space-y-2.5 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Leave Category</span>
                          <span className="text-foreground mt-0.5 block font-medium">{leaveTypeName}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Evidence Status</span>
                          <div className="mt-0.5">
                            <Badge
                              variant={leave.evidence_complete ? "outline" : "secondary"}
                              className={cn(
                                "px-1.5 py-0 text-[10px] font-medium",
                                leave.evidence_complete
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {leave.evidence_complete ? "Complete" : "Incomplete / Pending"}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Leave Period</span>
                          <span className="text-foreground mt-0.5 block font-mono text-[11px]">
                            {leave.start_date} to {leave.end_date}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Resume Date</span>
                          <span className="text-foreground mt-0.5 block font-mono text-[11px]">
                            {leave.resume_date || "—"}
                          </span>
                        </div>
                      </div>

                      <div className="border-t pt-2.5">
                        <span className="text-muted-foreground block text-[11px]">Reason / Justification</span>
                        <div className="bg-muted/40 text-foreground/90 mt-1 rounded-md border p-2.5 text-xs italic">
                          &ldquo;{leave.reason || "No explicit reason provided."}&rdquo;
                        </div>
                      </div>

                      {leave.handover_note &&
                        (!leave.handover_checklist_url || !leave.handover_note.startsWith("Attached:")) && (
                          <div className="border-t pt-2">
                            <span className="text-muted-foreground block text-[11px]">Handover Notes</span>
                            <div className="bg-muted/40 text-foreground/90 mt-1 rounded-md border p-2.5 text-xs">
                              {leave.handover_note}
                            </div>
                          </div>
                        )}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* TAB 2: APPROVAL TIMELINE */}
            {activeTab === "timeline" && (
              <div className="space-y-4">
                {/* Status Banner */}
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3.5 text-xs shadow-xs",
                    isApproved
                      ? "border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300"
                      : isRejected
                        ? "border-red-200 bg-red-50/50 text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
                        : isCancelled
                          ? "border-muted bg-muted/40 text-muted-foreground"
                          : "border-amber-200 bg-amber-50/50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
                  )}
                >
                  {isApproved ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : isRejected ? (
                    <XCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                  ) : isCancelled ? (
                    <AlertCircle className="text-muted-foreground h-5 w-5 shrink-0" />
                  ) : (
                    <Clock className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {isApproved
                        ? "Leave Request Approved"
                        : isRejected
                          ? "Leave Request Rejected"
                          : isCancelled
                            ? "Leave Request Cancelled"
                            : `Currently in Progress: Awaiting ${currentStageKey.replace(/_/g, " ").toUpperCase()}`}
                    </p>
                    <p className="mt-0.5 text-[11px] opacity-90">
                      {isApproved
                        ? "All required approvals have been completed. The employee is scheduled for leave."
                        : isRejected
                          ? "This application was rejected and will not proceed further."
                          : isCancelled
                            ? "This application was cancelled by the requester or administrator."
                            : "This leave request is progressing through the organizational endorsement hierarchy."}
                    </p>
                  </div>
                </div>

                {/* Step-by-Step Vertical Timeline */}
                <div className="bg-card rounded-lg border p-4 shadow-xs sm:p-5">
                  <div className="mb-4 flex items-center justify-between border-b pb-3">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                      <Layers className="text-primary h-3.5 w-3.5" /> Approval Stages & Audit Log
                    </span>
                  </div>

                  {stageAuditMap.size === 0 && leave.admin_manual ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                        <div className="rounded-full bg-emerald-500 p-1 text-white shadow-xs">
                          <Check className="h-3.5 w-3.5" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground text-xs font-semibold">Direct Admin Manual Approval</span>
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600"
                            >
                              Approved
                            </Badge>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Approved by{" "}
                            <span className="text-foreground font-medium">
                              {leave.approved_by_profile
                                ? resolvePersonName(leave.approved_by_profile)
                                : "Authorized Admin"}
                            </span>
                          </p>
                          {leave.approved_at && (
                            <p className="text-muted-foreground font-mono text-[11px]">
                              {formatWATDateTime(leave.approved_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="before:bg-muted-foreground/20 relative space-y-6 pl-6 before:absolute before:top-2 before:bottom-2 before:left-2.5 before:w-[2px]">
                      {stageOrder.map((stageKey, idx) => {
                        const item = stageAuditMap.get(stageKey)
                        const stageActorName =
                          resolvePersonName(item?.approver) ||
                          (stageKey === "reliever"
                            ? resolvePersonName(leave.reliever) || null
                            : stageKey === "department_lead"
                              ? resolvePersonName(leave.supervisor) || null
                              : stageKey === "admin_hr_lead"
                                ? resolvePersonName(leave.approved_by_profile) || null
                                : null)

                        const expectedPersonName =
                          stageKey === "reliever"
                            ? resolvePersonName(leave.reliever) || "Assigned Reliever"
                            : stageKey === "department_lead"
                              ? resolvePersonName(leave.supervisor) || "Department Lead"
                              : stageKey === "admin_hr_lead"
                                ? resolvePersonName(leave.approved_by_profile) || "Admin and HR Lead"
                                : stageName[stageKey]

                        const isCurrent = currentStageKey === stageKey
                        const isCompleted = Boolean(item)

                        let nodeColor = "border-muted-foreground/30 bg-background text-muted-foreground"
                        if (isCompleted) {
                          nodeColor = "border-emerald-500 bg-emerald-500 text-white"
                        } else if (isCurrent) {
                          nodeColor = "border-amber-500 bg-amber-500 text-white animate-pulse"
                        }

                        return (
                          <div key={stageKey} className="group relative">
                            {/* Timeline Node Point */}
                            <div
                              className={cn(
                                "absolute top-0.5 -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold shadow-xs transition-colors",
                                nodeColor
                              )}
                            >
                              {isCompleted ? <Check className="h-3 w-3 stroke-[3]" /> : <span>{idx + 1}</span>}
                            </div>

                            {/* Stage Card */}
                            <div className="bg-card space-y-1.5 rounded-lg border p-3 shadow-xs">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span className="text-foreground text-xs font-semibold">{stageName[stageKey]}</span>

                                {item ? (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600 capitalize"
                                  >
                                    {item.status || "Approved"}
                                  </Badge>
                                ) : isCurrent ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600"
                                  >
                                    Awaiting Action
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-[10px]">
                                    {stageKey === "reliever" && !hasRelieverAssignee
                                      ? "Not Required"
                                      : isApproved
                                        ? "Bypassed"
                                        : "Pending"}
                                  </span>
                                )}
                              </div>

                              {item ? (
                                <div className="text-muted-foreground space-y-1 text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-foreground font-medium">
                                      {stageActorName ? `${stageActorName}` : "Authorized Approver"}
                                    </span>
                                    {item.approved_at && (
                                      <>
                                        <span>•</span>
                                        <span className="font-mono text-[11px]">
                                          {formatWATDateTime(item.approved_at)}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {item.comments && (
                                    <div className="bg-muted/40 text-foreground mt-1 flex items-start gap-1.5 rounded border p-2 text-[11px] italic">
                                      <MessageSquare className="text-muted-foreground mt-0.5 h-3 w-3 shrink-0" />
                                      <span>&ldquo;{item.comments}&rdquo;</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-muted-foreground text-xs">
                                  {stageKey === "reliever" && !hasRelieverAssignee ? (
                                    <span className="italic">No reliever assigned for this application</span>
                                  ) : stageKey === "reliever" && relieverHandledByLead ? (
                                    <span className="italic">
                                      Handled by{" "}
                                      {departmentLeadApproverName ||
                                        resolvePersonName(leave.supervisor) ||
                                        "Department Lead"}
                                    </span>
                                  ) : isCancelled ? (
                                    <span className="italic">Not reached (Cancelled)</span>
                                  ) : isRejected ? (
                                    <span className="italic">Not reached (Rejected)</span>
                                  ) : isApproved ||
                                    (stageKey === "reliever" &&
                                      advancedPastReliever &&
                                      currentStageKey !== "reliever") ? (
                                    <span className="italic">Bypassed ({expectedPersonName})</span>
                                  ) : (
                                    <span>
                                      Action expected from:{" "}
                                      <strong className="text-foreground">{expectedPersonName}</strong>
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: DOCUMENTS & EVIDENCE */}
            {activeTab === "documents" && (
              <div className="space-y-4">
                {/* Handover Document Card */}
                <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                      <FileText className="text-primary h-3.5 w-3.5" /> Handover Documentation
                    </span>
                  </div>

                  {leave.handover_checklist_url ? (
                    <div className="bg-muted/20 flex flex-col items-start justify-between gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-600 dark:text-blue-400">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-foreground text-xs font-semibold">Attached Handover Checklist</p>
                          <p className="text-muted-foreground text-[11px]">
                            {leave.handover_note ? leave.handover_note : "Official handover document submission"}
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 text-xs" asChild>
                        <a
                          href={leaveHandoverHref(leave.id, leave.handover_checklist_url)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open Document
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-center">
                      <FileText className="text-muted-foreground/50 mx-auto mb-1.5 h-6 w-6" />
                      <p className="text-muted-foreground text-xs font-medium">No handover document attached</p>
                      {leave.handover_note && (
                        <p className="text-foreground/80 mt-1 text-xs italic">&ldquo;{leave.handover_note}&rdquo;</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Leave Evidence Attachments */}
                <div className="bg-card space-y-3 rounded-lg border p-4 shadow-xs">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                      <ShieldCheck className="text-primary h-3.5 w-3.5" /> Supporting Evidence & Files
                    </span>
                    <Badge
                      variant={leave.evidence_complete ? "outline" : "secondary"}
                      className={cn(
                        "text-[10px] font-medium",
                        leave.evidence_complete
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : ""
                      )}
                    >
                      {leave.evidence_complete ? "All Evidence Complete" : "Pending Evidence"}
                    </Badge>
                  </div>

                  {leave.evidence && leave.evidence.length > 0 ? (
                    <div className="space-y-2.5">
                      {leave.evidence.map((doc) => (
                        <div
                          key={doc.id}
                          className="bg-muted/20 flex flex-col items-start justify-between gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
                        >
                          <div className="flex items-center gap-3">
                            <div className="bg-primary/10 text-primary rounded-lg p-2.5">
                              <FileCheck className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-foreground text-xs font-semibold capitalize">
                                  {doc.document_type.replace(/_/g, " ")}
                                </p>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "px-1.5 py-0 text-[9px] uppercase",
                                    doc.status === "verified"
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      : doc.status === "rejected"
                                        ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                                        : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  )}
                                >
                                  {doc.status}
                                </Badge>
                              </div>
                              {doc.notes && (
                                <p className="text-muted-foreground mt-0.5 text-[11px] italic">{doc.notes}</p>
                              )}
                            </div>
                          </div>

                          <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 text-xs" asChild>
                            <a href={leaveEvidenceHref(doc.id, doc.file_url)} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                              View File
                            </a>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-center">
                      <Paperclip className="text-muted-foreground/40 mx-auto mb-2 h-7 w-7" />
                      <p className="text-foreground text-xs font-medium">No evidence documents uploaded</p>
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        Supporting documents (e.g. medical certificates, travel tickets) appear here once uploaded.
                      </p>
                    </div>
                  )}
                </div>

                {/* Required Documents Checklist (if specified) */}
                {leave.required_documents && leave.required_documents.length > 0 && (
                  <div className="bg-card space-y-2 rounded-lg border p-4 shadow-xs">
                    <span className="text-muted-foreground block text-[11px] font-semibold tracking-wider uppercase">
                      Required Documents Policy
                    </span>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {leave.required_documents.map((reqDoc) => (
                        <Badge key={reqDoc} variant="secondary" className="text-[11px] font-normal">
                          {reqDoc}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <DialogFooter className="bg-muted/20 flex flex-row items-center justify-between gap-2 border-t px-5 py-3 sm:px-6">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <span className="hidden sm:inline">Request ID:</span>
            <button
              type="button"
              onClick={() => handleCopy(leave.id, "ID")}
              className="hover:text-foreground inline-flex items-center gap-1 font-mono transition-colors"
              title="Click to copy request ID"
            >
              <span>{leave.id.slice(0, 8)}...</span>
              {copiedField === "ID" ? (
                <Check className="h-3 w-3 text-emerald-600" />
              ) : (
                <Copy className="h-3 w-3 opacity-60" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs">
              Close
            </Button>

            {showActionButtons && (onApprove || onReject) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReject?.(leave.id)}
                  className="h-8 gap-1.5 border-red-200 text-xs text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:border-red-900"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => onApprove?.(leave.id)}
                  className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                >
                  <Check className="h-3.5 w-3.5" /> Endorse
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
