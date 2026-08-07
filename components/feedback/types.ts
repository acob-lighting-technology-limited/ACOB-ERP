export type FeedbackStatus = "open" | "in_progress" | "resolved" | "closed"

export type FeedbackType = "concern" | "complaint" | "suggestion" | "required_item"

export interface FeedbackProfileSummary {
  first_name?: string | null
  last_name?: string | null
  company_email?: string | null
  department?: string | null
}

export interface FeedbackRecord {
  id: string
  user_id: string | null
  feedback_type: FeedbackType | string
  title: string
  description: string | null
  status: FeedbackStatus | string
  is_anonymous?: boolean | null
  created_at: string
  updated_at: string
  profiles?: FeedbackProfileSummary | null
  /** Set when this feedback is about a department lead (always fully anonymous). */
  target_lead_id?: string | null
  target_department?: string | null
  target_lead?: FeedbackProfileSummary | null
}

export type EditableFeedbackRecord = Pick<
  FeedbackRecord,
  "id" | "feedback_type" | "title" | "description" | "status" | "created_at"
>
