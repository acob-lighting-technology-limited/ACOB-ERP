export type FleetResource = {
  id: string
  name: string
  resource_type: string
  description?: string | null
  is_active: boolean
}

export type FleetReviewer = {
  id: string
  full_name?: string | null
  department?: string | null
  designation?: string | null
}

export type FleetBooking = {
  id: string
  resource_id: string
  start_at: string
  end_at: string
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  admin_note?: string | null
  /** When the approver decided (approved or rejected). */
  reviewed_at?: string | null
  reviewed_by?: string | null
  created_at?: string | null
  requester?: {
    id: string
    full_name?: string | null
    company_email?: string | null
    department?: string | null
  } | null
  reviewer?: FleetReviewer | null
  resource?: FleetResource | null
  attachment_count?: number
}

export type FleetAttachment = {
  id: string
  file_name: string
  mime_type: string
  file_size: number
  signed_url?: string | null
}
