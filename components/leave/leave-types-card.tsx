"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import type { LeaveBalance, LeaveType } from "@/app/(app)/leave/page"

const ELIGIBILITY_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  eligible: "default",
  missing_evidence: "secondary",
  not_eligible: "destructive",
}

function prettyEligibility(status: string) {
  if (status === "eligible") return "Eligible"
  if (status === "missing_evidence") return "Missing Evidence"
  return "Not Eligible"
}

function prettyDocName(name: string) {
  return name.replaceAll("_", " ")
}

interface LeaveTypesCardProps {
  leaveTypes: LeaveType[]
  balanceMap: Map<string, LeaveBalance>
}

export function LeaveTypesCard({ leaveTypes, balanceMap }: LeaveTypesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Leave Types and Balances</CardTitle>
              <ItemInfoButton
                title="Leave types and balances guide"
                summary="This section explains which leave types you can request and what the current eligibility or evidence rules mean."
                details={[
                  {
                    label: "What you are seeing",
                    value:
                      "Each leave type shows your allocation, usage, remaining balance, and whether you are currently eligible to submit that kind of leave.",
                  },
                  {
                    label: "What missing evidence means",
                    value:
                      "It means the leave type may be allowed, but supporting documents are still required before the approval flow can complete cleanly.",
                  },
                  {
                    label: "How to use this section",
                    value:
                      "Check this first before creating a new leave request so you know which leave type to choose and whether any documents are needed.",
                  },
                ]}
              />
            </div>
            <CardDescription>Professional governance: policy + evidence + transparent eligibility</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {leaveTypes.map((leaveType) => {
          const balance = balanceMap.get(leaveType.id)
          const allocatedDays = balance?.allocated_days ?? leaveType.max_days
          const usedDays = balance?.used_days ?? 0
          const leftDays = balance?.balance_days ?? leaveType.max_days

          return (
            <div key={leaveType.id} className="space-y-1 rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{leaveType.name}</p>
                <Badge variant={ELIGIBILITY_VARIANT[leaveType.eligibility_status] || "outline"}>
                  {prettyEligibility(leaveType.eligibility_status)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">
                {usedDays} used / {allocatedDays} allocated | {leftDays} days left
              </p>
              {leaveType.eligibility_reason && (
                <p className="text-muted-foreground text-xs">{leaveType.eligibility_reason}</p>
              )}
              {leaveType.required_documents?.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Required documents: {leaveType.required_documents.map(prettyDocName).join(", ")}
                </p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
