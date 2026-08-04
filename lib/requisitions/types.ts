export type RequisitionStageCode =
  | "pending_reviewed_by"
  | "pending_authorized_by"
  | "pending_verified_by"
  | "pending_approved_by"
  | "completed"
  | "rejected"

export type RequisitionStatus = "pending" | "approved" | "rejected"

export interface BeneficiaryDetail {
  account_name: string
  account_number: string
  bank_name: string
  amount?: number | string
}

export interface RequisitionAttachment {
  file_name: string
  file_url: string
  file_type?: string
  file_size?: number
}

export interface RequisitionApproverProfile {
  id: string
  full_name: string
  role?: string
  designation?: string | null
}

export interface Requisition {
  id: string
  requisition_number: string
  user_id: string
  department: string
  project_name: string
  amount: number
  amount_in_words: string
  purpose: string
  beneficiary_details: BeneficiaryDetail[]
  attachments: RequisitionAttachment[]
  current_stage_code: RequisitionStageCode
  status: RequisitionStatus

  reviewed_by?: string | null
  reviewed_at?: string | null
  reviewed_comments?: string | null
  reviewer_profile?: RequisitionApproverProfile | null

  authorized_by?: string | null
  authorized_at?: string | null
  authorized_comments?: string | null
  authorizer_profile?: RequisitionApproverProfile | null

  verified_by?: string | null
  verified_at?: string | null
  verified_comments?: string | null
  verifier_profile?: RequisitionApproverProfile | null

  approved_by?: string | null
  approved_at?: string | null
  approved_comments?: string | null
  approver_profile?: RequisitionApproverProfile | null

  rejection_reason?: string | null
  rejected_by?: string | null
  rejected_at?: string | null

  created_at: string
  updated_at: string

  requester?: {
    id: string
    full_name: string
    department: string | null
    designation?: string | null
    company_email?: string | null
  } | null
}

export interface CreateRequisitionPayload {
  department: string
  project_name: string
  amount: number
  amount_in_words: string
  purpose: string
  beneficiary_details: BeneficiaryDetail[]
  attachments: RequisitionAttachment[]
}

export interface ApproveRequisitionPayload {
  action: "approve" | "reject"
  comments?: string
}
