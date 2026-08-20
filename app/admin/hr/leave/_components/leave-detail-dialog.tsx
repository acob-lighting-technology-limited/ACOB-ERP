"use client"

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
import { Check, X, Clock, FileText, Calendar, User, FileCheck, Layers } from "lucide-react"
import { LeaveItem, approvalStageKey, approvalStageLabel, resolvePersonName, getStageBadge } from "../view"
import { formatWATDateTime } from "@/lib/utils/date"
import { leaveEvidenceHref, leaveHandoverHref } from "@/lib/hr/leave-attachment-links"

interface LeaveDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  leave: LeaveItem | null
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  showActionButtons?: boolean
}

export function LeaveDetailDialog({
  open,
  onOpenChange,
  leave,
  onApprove,
  onReject,
  showActionButtons = false,
}: LeaveDetailDialogProps) {
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
    reliever: "Reliever",
    department_lead: "Department Lead",
    admin_hr_lead: "Admin & HR Lead",
    hcs: "HCS",
    md: "MD",
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto sm:max-w-2xl md:max-w-3xl lg:max-w-4xl">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Calendar className="h-5 w-5 text-blue-500" />
            Leave Request Details
          </DialogTitle>
          <DialogDescription>Detailed status, timeline, and associated documents for this request.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4 md:grid-cols-2">
          {/* Left Column: Request Details */}
          <div className="space-y-4">
            <h3 className="text-muted-foreground flex items-center gap-2 text-sm font-semibold tracking-wider uppercase">
              <User className="text-muted-foreground h-4 w-4" /> Employee Information
            </h3>
            <div className="bg-muted/30 space-y-3 rounded-lg border p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Employee:</span>
                <span className="text-foreground font-semibold">{leave.user?.full_name || "Employee"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email:</span>
                <span className="text-foreground font-medium">{leave.user?.company_email || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Department:</span>
                <span className="text-foreground font-medium">{leave.user?.department || "-"}</span>
              </div>
            </div>

            <h3 className="text-muted-foreground flex items-center gap-2 text-sm font-semibold tracking-wider uppercase">
              <FileCheck className="text-muted-foreground h-4 w-4" /> Leave Specifications
            </h3>
            <div className="bg-muted/30 space-y-3 rounded-lg border p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leave Type:</span>
                <span className="text-foreground font-semibold">{leave.leave_type?.name || "Leave Request"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period:</span>
                <span className="text-foreground font-medium">
                  {leave.start_date} to {leave.end_date}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration:</span>
                <span className="text-foreground font-semibold">{leave.days_count} day(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Resume Date:</span>
                <span className="text-foreground font-medium">{leave.resume_date || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Stage:</span>
                <span>{getStageBadge(leave)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status:</span>
                <Badge
                  variant={
                    leave.status === "approved" || leave.status === "completed"
                      ? "default"
                      : leave.status === "rejected" || leave.status === "cancelled"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {leave.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Evidence:</span>
                <Badge
                  variant={leave.evidence_complete ? "outline" : "secondary"}
                  className={leave.evidence_complete ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500" : ""}
                >
                  {leave.evidence_complete ? "Complete" : "Incomplete"}
                </Badge>
              </div>
              <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                <span className="text-muted-foreground text-xs">Reason:</span>
                <span className="text-foreground bg-background rounded border p-2 font-medium">
                  {leave.reason || "-"}
                </span>
              </div>
              {leave.handover_checklist_url && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Handover Doc:</span>
                  <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                    <a
                      href={leaveHandoverHref(leave.id, leave.handover_checklist_url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      View Handover File
                    </a>
                  </Button>
                </div>
              )}
              {leave.handover_note &&
                (!leave.handover_checklist_url || !leave.handover_note.startsWith("Attached:")) && (
                  <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                    <span className="text-muted-foreground text-xs">Handover Note:</span>
                    <span className="text-foreground bg-background rounded border p-2 font-medium">
                      {leave.handover_note}
                    </span>
                  </div>
                )}
              {leave.required_documents && leave.required_documents.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Required Docs:</span>
                  <span className="text-foreground font-medium">{leave.required_documents.join(", ")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Timeline & Evidence */}
          <div className="space-y-4">
            <h3 className="text-muted-foreground flex items-center gap-2 text-sm font-semibold tracking-wider uppercase">
              <Layers className="text-muted-foreground h-4 w-4" /> Approval Timeline
            </h3>
            <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
              {stageAuditMap.size === 0 ? (
                leave.admin_manual ? (
                  <ul className="before:bg-muted-foreground/20 relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-2.5 before:w-[2px]">
                    <li className="relative flex items-start gap-3 pl-6 text-xs">
                      <span className="absolute top-[2px] left-[3px] h-[10px] w-[10px] rounded-full border-2 border-emerald-500 bg-emerald-500" />
                      <div className="space-y-0.5">
                        <span className="text-foreground block text-sm font-semibold">Manually Approved</span>
                        <div className="text-muted-foreground">
                          <span className="font-medium text-emerald-500 capitalize">approved</span>
                          {leave.approved_by_profile ? ` by ${resolvePersonName(leave.approved_by_profile)}` : ""}
                          {leave.approved_at && (
                            <span className="text-muted-foreground/80 mt-0.5 block text-[10px]">
                              {formatWATDateTime(leave.approved_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-xs italic">No approvals recorded yet.</p>
                )
              ) : (
                <ul className="before:bg-muted-foreground/20 relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-2.5 before:w-[2px]">
                  {stageOrder.map((stageKey) => {
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

                    const statusLower = String(leave.status || "").toLowerCase()
                    const isApprovedOrCompleted = ["approved", "completed"].includes(statusLower)
                    const isCancelled = statusLower === "cancelled"
                    const isRejected = statusLower === "rejected"
                    const expectedPersonName =
                      stageKey === "reliever"
                        ? resolvePersonName(leave.reliever) || "Assigned Reliever"
                        : stageKey === "department_lead"
                          ? resolvePersonName(leave.supervisor) || "Department Lead"
                          : stageKey === "admin_hr_lead"
                            ? resolvePersonName(leave.approved_by_profile) || "Admin & HR Lead"
                            : stageName[stageKey]

                    const isCurrent = currentStageKey === stageKey
                    const isCompleted = !!item

                    return (
                      <li key={stageKey} className="relative flex items-start gap-3 pl-6 text-xs">
                        <span
                          className={`absolute top-[2px] left-[3px] h-[10px] w-[10px] rounded-full border-2 ${
                            isCompleted
                              ? "border-emerald-500 bg-emerald-500"
                              : isCurrent
                                ? "animate-pulse border-amber-500 bg-amber-500"
                                : "bg-background border-muted-foreground/30"
                          }`}
                        />
                        <div className="space-y-0.5">
                          <span className="text-foreground block text-sm font-semibold">{stageName[stageKey]}</span>
                          {item ? (
                            <div className="text-muted-foreground">
                              <span className="font-medium text-emerald-500 capitalize">{item.status}</span>
                              {stageActorName && ` by ${stageActorName}`}
                              {item.approved_at && (
                                <span className="text-muted-foreground/80 mt-0.5 block text-[10px]">
                                  {formatWATDateTime(item.approved_at)}
                                </span>
                              )}
                              {item.comments && (
                                <p className="bg-background text-foreground mt-1 rounded border p-1.5 text-[11px] italic">
                                  &ldquo;{item.comments}&rdquo;
                                </p>
                              )}
                            </div>
                          ) : stageKey === "reliever" && !hasRelieverAssignee ? (
                            <span className="text-muted-foreground/75 italic">Not required for this request</span>
                          ) : stageKey === "reliever" && relieverHandledByLead ? (
                            <span className="text-muted-foreground/75 italic">
                              {`Handled by ${departmentLeadApproverName || resolvePersonName(leave.supervisor) || "Department Lead"}`}
                            </span>
                          ) : isCancelled ? (
                            <span className="text-muted-foreground/75 italic">Not reached (Cancelled)</span>
                          ) : isRejected ? (
                            <span className="text-muted-foreground/75 italic">Not reached (Rejected)</span>
                          ) : isApprovedOrCompleted ||
                            (stageKey === "reliever" && advancedPastReliever && currentStageKey !== "reliever") ? (
                            <span className="text-muted-foreground/75 italic">Bypassed ({expectedPersonName})</span>
                          ) : (
                            <span className="text-muted-foreground/60">Pending action ({expectedPersonName})</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <h3 className="text-muted-foreground flex items-center gap-2 text-sm font-semibold tracking-wider uppercase">
              <FileText className="text-muted-foreground h-4 w-4" /> Evidence & Attachments
            </h3>
            <div className="bg-muted/30 space-y-2 rounded-lg border p-4">
              {leave.evidence && leave.evidence.length > 0 ? (
                leave.evidence.map((doc) => (
                  <div key={doc.id} className="bg-card flex items-center justify-between rounded-md border p-2 text-xs">
                    <div className="flex flex-col">
                      <span className="text-foreground font-semibold">{doc.document_type}</span>
                      <Badge variant="outline" className="mt-1 w-fit text-[9px] uppercase">
                        {doc.status}
                      </Badge>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                      <a href={leaveEvidenceHref(doc.id, doc.file_url)} target="_blank" rel="noreferrer">
                        View File
                      </a>
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground bg-background rounded-md border border-dashed p-4 text-center text-xs italic">
                  No evidence uploaded yet.
                </p>
              )}
            </div>
          </div>
        </div>

        {showActionButtons && (onApprove || onReject) && (
          <DialogFooter className="flex gap-2 border-t pt-4 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => onReject?.(leave.id)}
              className="gap-1 border-red-200 text-red-500 hover:bg-red-500/10 hover:text-red-600"
            >
              <X className="h-4 w-4" /> Reject
            </Button>
            <Button
              onClick={() => onApprove?.(leave.id)}
              className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Check className="h-4 w-4" /> Endorse
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
