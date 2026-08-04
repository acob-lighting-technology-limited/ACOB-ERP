export type CorrespondenceStatus =
  | "draft"
  | "under_review"
  | "approved"
  | "rejected"
  | "returned_for_correction"
  | "sent"
  | "filed"
  | "assigned_action_pending"
  | "open"
  | "closed"
  | "cancelled"

export type ApprovalStatus = "pending" | "approved" | "rejected" | "returned_for_correction"

export type DispatchMethod = "email" | "courier" | "hand_delivery" | "regulatory_portal"

export type SourceMode = "email" | "physical" | "portal" | "courier"

export type LetterType = "internal" | "external"

/** Category is now open-ended — values come from the correspondence_categories table. */
export type LetterCategory = string

export interface CorrespondenceRecord {
  id: string
  reference_number: string | null
  company_code: string
  department_name: string | null
  department_code: string | null
  letter_type: LetterType | null
  category: string | null
  subject: string
  recipient_name: string | null
  recipient_code: string | null
  sender_name: string | null
  status: CorrespondenceStatus
  action_required: boolean
  due_date: string
  responsible_officer_id: string | null
  originator_id: string
  created_by_id: string | null
  created_by_name: string | null
  assigned_department_name: string | null
  source_mode: SourceMode | null
  dispatch_method: DispatchMethod | null
  proof_of_delivery_path: string | null
  submitted_at: string | null
  approved_at: string | null
  sent_at: string | null
  received_at: string | null
  current_version: number
  is_locked: boolean
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
  simulated_sequence?: number | null
}

export interface CorrespondenceApproval {
  id: string
  correspondence_id: string
  approval_stage: string
  approver_id: string | null
  status: ApprovalStatus
  comments: string | null
  requested_at: string
  decided_at: string | null
  created_at: string
  updated_at: string
}

export interface CorrespondenceEvent {
  id: string
  correspondence_id: string
  actor_id: string | null
  event_type: string
  old_status: string | null
  new_status: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export interface CorrespondenceVersion {
  id: string
  correspondence_id: string
  version_no: number
  file_path: string | null
  change_summary: string | null
  uploaded_by: string | null
  created_at: string
}

export interface CorrespondenceCategory {
  id: string
  name: string
  code: string
  created_by: string | null
  created_at: string
}

export interface CreateCorrespondenceInput {
  department_name?: string | null
  letter_type?: LetterType | null
  category?: string | null
  subject: string
  recipient_name?: string | null
  recipient_code: string
  sender_name?: string | null
  originator_id?: string | null
  action_required?: boolean
  due_date: string
  responsible_officer_id?: string | null
  assigned_department_name?: string | null
  source_mode?: SourceMode | null
  metadata?: Record<string, unknown> | null
}

export interface UpdateCorrespondenceInput {
  status?: CorrespondenceStatus
  letter_type?: LetterType | null
  category?: string | null
  subject?: string
  recipient_name?: string | null
  recipient_code?: string | null
  sender_name?: string | null
  action_required?: boolean
  due_date?: string | null
  responsible_officer_id?: string | null
  assigned_department_name?: string | null
  source_mode?: SourceMode | null
  metadata?: Record<string, unknown> | null
  is_locked?: boolean
}

export interface ApprovalDecisionInput {
  decision: ApprovalStatus
  comments?: string | null
}

export interface DispatchInput {
  final_status: "sent" | "filed"
  dispatch_method: DispatchMethod
  proof_of_delivery_path?: string | null
  recipient_name?: string | null
}
