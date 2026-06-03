export type FleetResource = {
  id: string
  name: string
  resource_type: string
  description?: string | null
  is_active: boolean
}

export type FleetBooking = {
  id: string
  resource_id: string
  start_at: string
  end_at: string
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  admin_note?: string | null
  requester?: { id: string; full_name?: string | null; company_email?: string | null } | null
  reviewer?: { id: string; full_name?: string | null } | null
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
