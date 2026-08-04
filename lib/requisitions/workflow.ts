import type { RequisitionStageCode } from "./types"

export const REQUISITION_STAGES: {
  code: RequisitionStageCode
  label: string
  approverRoleLabel: string
}[] = [
  { code: "pending_reviewed_by", label: "Review", approverRoleLabel: "Admin & HR Lead" },
  { code: "pending_authorized_by", label: "Authorize", approverRoleLabel: "Corporate Services Lead" },
  { code: "pending_verified_by", label: "Verify", approverRoleLabel: "Accounts Lead" },
  { code: "pending_approved_by", label: "Approve", approverRoleLabel: "Executive Management Lead (MD)" },
]

export function getNextStage(currentStage: RequisitionStageCode): RequisitionStageCode {
  switch (currentStage) {
    case "pending_reviewed_by":
      return "pending_authorized_by"
    case "pending_authorized_by":
      return "pending_verified_by"
    case "pending_verified_by":
      return "pending_approved_by"
    case "pending_approved_by":
      return "completed"
    default:
      return "completed"
  }
}

export function getStageLabel(stageCode: string): string {
  switch (stageCode) {
    case "pending_reviewed_by":
      return "Pending Admin & HR Review"
    case "pending_authorized_by":
      return "Pending Corporate Services Authorization"
    case "pending_verified_by":
      return "Pending Accounts Verification"
    case "pending_approved_by":
      return "Pending MD / Executive Approval"
    case "completed":
      return "Fully Approved"
    case "rejected":
      return "Rejected"
    default:
      return stageCode
  }
}
