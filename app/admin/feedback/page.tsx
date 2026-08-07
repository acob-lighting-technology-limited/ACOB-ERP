import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { AdminFeedbackContent } from "./admin-feedback-content"
import { expandDepartmentScopeForQuery, getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"
import type { FeedbackRecord } from "@/components/feedback/types"

const log = logger("feedback")

export default async function AdminFeedbackPage() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    redirect("/auth/login")
  }

  const scope = await resolveAdminScope(supabase, data.user.id)
  if (!scope) {
    redirect("/profile")
  }
  if (!["developer", "super_admin", "admin"].includes(String(scope.role || ""))) {
    redirect("/admin")
  }
  const departmentScope = getDepartmentScope(scope, "general")
  const queryDepartmentScope = departmentScope ? expandDepartmentScopeForQuery(departmentScope) : null

  // A lead must never read the anonymous feedback written about them, even when
  // that lead also holds an admin role.
  let feedbackQuery = dataClient
    .from("feedback")
    .select("*")
    .or(`target_lead_id.is.null,target_lead_id.neq.${data.user.id}`)
    .order("created_at", { ascending: false })
  if (departmentScope) {
    const { data: scopedUsers } =
      queryDepartmentScope && queryDepartmentScope.length > 0
        ? await dataClient.from("profiles").select("id").in("department", queryDepartmentScope)
        : { data: [] as { id: string }[] }
    const scopedUserIds = (scopedUsers || []).map((row) => row.id)
    feedbackQuery =
      scopedUserIds.length > 0 ? feedbackQuery.in("user_id", scopedUserIds) : feedbackQuery.eq("id", "__none__")
  }

  const { data: feedbackData, error: feedbackError } = await feedbackQuery

  if (feedbackError) {
    log.error("Error fetching feedback:", feedbackError)
  }

  // Fetch profiles for all user_ids in feedback
  let feedbackWithProfiles: FeedbackRecord[] = []
  if (feedbackData && feedbackData.length > 0) {
    const userIds = Array.from(new Set(feedbackData.map((f) => f.user_id).filter(Boolean)))
    let profilesData:
      | {
          id: string
          first_name: string | null
          last_name: string | null
          company_email: string | null
          department: string | null
        }[]
      | null = null

    if (userIds.length > 0) {
      let profilesQuery = dataClient
        .from("profiles")
        .select("id, first_name, last_name, company_email, department")
        .in("id", userIds)

      if (departmentScope) {
        profilesQuery =
          queryDepartmentScope && queryDepartmentScope.length > 0
            ? profilesQuery.in("department", queryDepartmentScope)
            : profilesQuery.eq("id", "__none__")
      }

      const { data, error: profilesError } = await profilesQuery

      if (profilesError) {
        log.error("Error fetching profiles:", profilesError)
      }
      profilesData = data || []
    }

    // Lead-directed feedback names the lead it is about (never the submitter).
    const targetLeadIds = Array.from(new Set(feedbackData.map((f) => f.target_lead_id).filter(Boolean)))
    const { data: targetLeads } =
      targetLeadIds.length > 0
        ? await dataClient
            .from("profiles")
            .select("id, first_name, last_name, company_email, department")
            .in("id", targetLeadIds)
        : {
            data: [] as {
              id: string
              first_name: string | null
              last_name: string | null
              company_email: string | null
              department: string | null
            }[],
          }

    feedbackWithProfiles = feedbackData.map((fb) => ({
      ...fb,
      user_id: fb.is_anonymous ? null : fb.user_id,
      profiles: fb.is_anonymous ? null : profilesData?.find((p) => p.id === fb.user_id) || null,
      target_lead: fb.target_lead_id ? targetLeads?.find((p) => p.id === fb.target_lead_id) || null : null,
    })) as FeedbackRecord[]
  }

  // Calculate stats
  const stats = {
    total: feedbackWithProfiles.length,
    open: feedbackWithProfiles.filter((f) => f.status === "open").length,
    inProgress: feedbackWithProfiles.filter((f) => f.status === "in_progress").length,
    resolved: feedbackWithProfiles.filter((f) => f.status === "resolved").length,
    closed: feedbackWithProfiles.filter((f) => f.status === "closed").length,
  }

  return <AdminFeedbackContent initialFeedback={feedbackWithProfiles} initialStats={stats} />
}
