import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { AdminFeedbackContent } from "@/app/admin/feedback/admin-feedback-content"
import type { FeedbackRecord } from "@/components/feedback/types"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptFeedbackPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)
  const expandedDepts = expandDepartmentScopeForQuery([deptName])

  const { data: deptUsers } =
    expandedDepts.length > 0
      ? await dataClient.from("profiles").select("id").in("department", expandedDepts)
      : { data: [] as { id: string }[] }

  const userIds = (deptUsers || []).map((u) => u.id)

  // Explicitly exclude lead-directed feedback: it is HR-only and must never
  // surface in a department lead's view (their own team writes it about them).
  const { data: feedbackData } =
    userIds.length > 0
      ? await dataClient
          .from("feedback")
          .select("*")
          .in("user_id", userIds)
          .is("target_lead_id", null)
          .order("created_at", { ascending: false })
      : { data: [] }

  let feedbackWithProfiles: FeedbackRecord[] = []
  if (feedbackData && feedbackData.length > 0) {
    const uniqueUserIds = Array.from(new Set(feedbackData.map((f) => f.user_id).filter(Boolean)))
    const { data: profilesData } =
      uniqueUserIds.length > 0
        ? await dataClient
            .from("profiles")
            .select("id, first_name, last_name, company_email, department")
            .in("id", uniqueUserIds)
        : { data: [] }
    const profilesMap = new Map((profilesData || []).map((p) => [p.id, p]))
    feedbackWithProfiles = feedbackData.map((fb) => ({
      ...fb,
      user_id: fb.is_anonymous ? null : fb.user_id,
      profiles: fb.is_anonymous ? null : profilesMap.get(fb.user_id) || null,
    })) as FeedbackRecord[]
  }

  const stats = {
    total: feedbackWithProfiles.length,
    open: feedbackWithProfiles.filter((f) => f.status === "open").length,
    inProgress: feedbackWithProfiles.filter((f) => f.status === "in_progress").length,
    resolved: feedbackWithProfiles.filter((f) => f.status === "resolved").length,
    closed: feedbackWithProfiles.filter((f) => f.status === "closed").length,
  }

  return <AdminFeedbackContent initialFeedback={feedbackWithProfiles} initialStats={stats} />
}
