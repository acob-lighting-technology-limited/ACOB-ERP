import type { HelpDeskPriority, HelpDeskStatus } from "@/lib/help-desk/server"
export type { HelpDeskPriority, HelpDeskStatus }

export interface HelpDeskTicket {
  id: string
  ticket_number: string
  title: string
  description: string | null
  request_type: "support" | "procurement"
  category: string | null
  service_department: string
  priority: HelpDeskPriority
  status: HelpDeskStatus
  requester_id: string
  created_by: string
  assigned_to: string | null
  assigned_by: string | null
  task_id?: string | null
  goal_id?: string | null
  goal_title?: string | null
  requester_department?: string | null
  handling_mode?: string | null
  support_mode?: string | null
  approval_required: boolean
  sla_target_at: string | null
  submitted_at: string
  assigned_at: string | null
  started_at: string | null
  paused_at: string | null
  resumed_at: string | null
  resolved_at: string | null
  closed_at: string | null
  csat_rating: number | null
  csat_feedback: string | null
  comment_count?: number
  created_at: string
  updated_at: string
}
