import type { RequisitionStageCode } from "./types"

export const REQUISITION_STAGES: {
  code: RequisitionStageCode
  label: string
  approverRoleLabel: string
}[] = [
  { code: "pending_reviewed_by", label: "Review", approverRoleLabel: "Admin and HR Lead" },
  { code: "pending_authorized_by", label: "Authorize", approverRoleLabel: "Corporate Services Lead" },
  { code: "pending_verified_by", label: "Verify", approverRoleLabel: "Accounts Lead" },
  { code: "pending_approved_by", label: "Approve", approverRoleLabel: "Executive Management Lead (MD)" },
]

/**
 * Stages the expedited "Emergency Requisition" route skips. Urgent site needs go
 * straight to Executive Management (MD) approval; the skipped tiers are recorded
 * on the requisition so the audit trail shows what was bypassed and why.
 */
export const EMERGENCY_BYPASSED_STAGES: RequisitionStageCode[] = [
  "pending_reviewed_by",
  "pending_authorized_by",
  "pending_verified_by",
]

/** Minimum length of the written justification required to raise an emergency requisition. */
export const EMERGENCY_JUSTIFICATION_MIN_LENGTH = 20

/** Where a newly submitted requisition enters the workflow. */
export function getInitialStage(isEmergency: boolean): RequisitionStageCode {
  return isEmergency ? "pending_approved_by" : "pending_reviewed_by"
}

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
      return "Pending Admin and HR Review"
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

/** True when the given stage was skipped by the expedited emergency route. */
export function isStageBypassed(bypassedStages: string[] | null | undefined, stageCode: RequisitionStageCode): boolean {
  return Array.isArray(bypassedStages) && bypassedStages.includes(stageCode)
}
