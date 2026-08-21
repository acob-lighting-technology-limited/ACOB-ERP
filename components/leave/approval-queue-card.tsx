"use client"

import { forwardRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import type { LeaveRequest } from "@/app/(app)/leave/page"

const STAGE_LABELS: Record<string, string> = {
  pending_reliever: "Waiting Reliever",
  pending_department_lead: "Waiting Department Lead",
  pending_admin_hr_lead: "Waiting Admin and HR Lead",
  pending_md: "Waiting MD",
  pending_hcs: "Waiting HCS",
  reliever_pending: "Waiting Reliever",
  supervisor_pending: "Waiting Department Lead",
  hr_pending: "Waiting Admin and HR Lead",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
}

interface ApprovalQueueCardProps {
  approverQueue: LeaveRequest[]
  onAction: (requestId: string, action: "approve" | "reject") => void
}

function buildLeaveInfo(item: LeaveRequest) {
  const stageLabel =
    STAGE_LABELS[item.current_stage_code || item.approval_stage] ||
    item.current_stage_code ||
    item.approval_stage ||
    "In review"

  return {
    title: `${item.leave_type?.name || "Leave"} request guide`,
    summary: "This explains why the leave request is in your queue and what decision is needed from you.",
    details: [
      {
        label: "Why you are seeing this",
        value: `This request is currently at ${stageLabel.toLowerCase()} and needs approval workflow attention.`,
      },
      {
        label: "What to review",
        value:
          "Check the leave dates, reason, reliever, and any handover note so you can tell whether the request is workable for the business.",
      },
      {
        label: "What to do next",
        value:
          "Approve if the request is acceptable and well covered, or reject it with a clear reason so the requester knows what must change.",
      },
    ],
  }
}

export const ApprovalQueueCard = forwardRef<HTMLDivElement, ApprovalQueueCardProps>(
  ({ approverQueue, onAction }, ref) => {
    if (approverQueue.length === 0) return null

    return (
      <Card ref={ref}>
        <CardHeader>
          <CardTitle>My Approval Queue</CardTitle>
          <CardDescription>Requests awaiting your action</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {approverQueue.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <p className="font-medium">{item.leave_type?.name || "Leave Request"}</p>
                  <ItemInfoButton {...buildLeaveInfo(item)} />
                </div>
                <p className="text-muted-foreground text-sm">
                  {item.start_date} to {item.end_date} ({item.days_count} days)
                </p>
                <p className="text-muted-foreground text-sm">
                  Requester: {item.user?.full_name || item.user?.company_email || "Unknown"}
                </p>
                <p className="text-muted-foreground text-sm">
                  Reliever: {item.reliever?.full_name || item.reliever?.company_email || "Not set"}
                </p>
                <p className="text-sm">Reason: {item.reason || "No reason provided"}</p>
                {item.handover_note && <p className="text-muted-foreground text-sm">Handover: {item.handover_note}</p>}
                <Badge variant="outline">
                  {STAGE_LABELS[item.current_stage_code || item.approval_stage] ||
                    item.current_stage_code ||
                    item.approval_stage}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onAction(item.id, "approve")}>
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => onAction(item.id, "reject")}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }
)
ApprovalQueueCard.displayName = "ApprovalQueueCard"
