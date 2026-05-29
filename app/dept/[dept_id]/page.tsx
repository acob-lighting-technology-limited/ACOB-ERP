/**
 * Dept Console dashboard.
 *
 * Uses the exact same visual components as the admin dashboard
 * (PageWrapper, PageHeader, StatCard, AdminActivityTabs, RecentActivityFeed)
 * so any UI changes there automatically apply here too.
 *
 * Data is scoped to this department only.
 */
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { Users, Package, ClipboardList, FileText, MessageSquare, Building2 } from "lucide-react"
import Link from "next/link"
import { formatName } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
import { RecentActivityFeed } from "@/components/admin/recent-activity-feed"
import {
  AdminActivityTabs,
  type AdminAssetActivityRow,
  type AdminAttendanceActivityRow,
  type AdminCorrespondenceActivityRow,
  type AdminDocumentationActivityRow,
  type AdminFeedbackActivityRow,
  type AdminHelpDeskActivityRow,
  type AdminLeaveActivityRow,
  type AdminPaymentActivityRow,
  type AdminTaskActivityRow,
} from "@/components/admin/activity-tabs"
import { normalizeToken, buildRecentActivity } from "@/components/admin/dashboard-helpers"
import { logger } from "@/lib/logger"

const log = logger("dept-dashboard")

type ProfileIdRow = { id: string }
type ActivityActorRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  company_email?: string | null
}
type ActivityLogRow = {
  id: string
  user_id: string | null
  created_at: string
  action?: string | null
  operation?: string | null
  entity_type?: string | null
  table_name?: string | null
  entity_id?: string | null
  department?: string | null
  metadata?: Record<string, unknown> | null
  changed_fields?: unknown
  new_values?: Record<string, unknown> | null
  old_values?: Record<string, unknown> | null
}

interface DeptOverviewPageProps {
  params: Promise<{ dept_id: string }>
}

export default async function DeptOverviewPage({ params }: DeptOverviewPageProps) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: authData } = await supabase.auth.getUser()

  const deptName = normalizeDepartmentName(scope.deptName)
  const queryDepartmentScope = expandDepartmentScopeForQuery([deptName])

  // Profile IDs within this dept — used to scope user-linked tables
  const { data: profileIdRows } =
    queryDepartmentScope.length > 0
      ? await dataClient.from("profiles").select("id").in("department", queryDepartmentScope).returns<ProfileIdRow[]>()
      : { data: [] as ProfileIdRow[] }
  const scopedUserIds = (profileIdRows || []).map((r) => r.id)

  const { data: profile } = authData.user
    ? await dataClient.from("profiles").select("first_name").eq("id", authData.user.id).single()
    : { data: null }

  // ── Stats ────────────────────────────────────────────────────────────────
  const [employeeStats, assetStats, taskStats, docStats, feedbackStats] = await Promise.all([
    queryDepartmentScope.length > 0
      ? dataClient.from("profiles").select("*", { count: "exact", head: true }).in("department", queryDepartmentScope)
      : dataClient.from("profiles").select("*", { count: "exact", head: true }).eq("id", "__none__"),
    queryDepartmentScope.length > 0
      ? dataClient
          .from("assets")
          .select("*", { count: "exact", head: true })
          .is("deleted_at", null)
          .in("department", queryDepartmentScope)
      : dataClient.from("assets").select("*", { count: "exact", head: true }).eq("id", "__none__"),
    queryDepartmentScope.length > 0
      ? dataClient
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .neq("category", "weekly_action")
          .in("department", queryDepartmentScope)
      : dataClient.from("tasks").select("*", { count: "exact", head: true }).eq("id", "__none__"),
    scopedUserIds.length > 0
      ? dataClient.from("user_documentation").select("*", { count: "exact", head: true }).in("user_id", scopedUserIds)
      : dataClient.from("user_documentation").select("*", { count: "exact", head: true }).eq("id", "__none__"),
    scopedUserIds.length > 0
      ? dataClient.from("feedback").select("*", { count: "exact", head: true }).in("user_id", scopedUserIds)
      : dataClient.from("feedback").select("*", { count: "exact", head: true }).eq("id", "__none__"),
  ])

  if (employeeStats.error) log.error("profiles count failed", employeeStats.error)
  if (assetStats.error) log.error("assets count failed", assetStats.error)
  if (taskStats.error) log.error("tasks count failed", taskStats.error)

  // ── Activity tabs data (mirrors admin dashboard queries, dept-scoped) ────
  const [
    assetsActivity,
    tasksActivity,
    docsActivity,
    feedbackActivity,
    helpDeskActivity,
    leaveActivity,
    attendanceActivity,
  ] = await Promise.all([
    queryDepartmentScope.length > 0
      ? dataClient
          .from("assets")
          .select(
            "id, asset_type, asset_model, unique_code, status, assignment_type, department, office_location, created_at"
          )
          .is("deleted_at", null)
          .in("department", queryDepartmentScope)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<AdminAssetActivityRow[]>()
      : Promise.resolve({ data: [] as AdminAssetActivityRow[], error: null }),

    queryDepartmentScope.length > 0
      ? dataClient
          .from("tasks")
          .select("id, title, status, priority, department, due_date, created_at")
          .neq("category", "weekly_action")
          .in("department", queryDepartmentScope)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<AdminTaskActivityRow[]>()
      : Promise.resolve({ data: [] as AdminTaskActivityRow[], error: null }),

    scopedUserIds.length > 0
      ? dataClient
          .from("user_documentation")
          .select("id, title, category, user_id, created_at")
          .in("user_id", scopedUserIds)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<AdminDocumentationActivityRow[]>()
      : Promise.resolve({ data: [] as AdminDocumentationActivityRow[], error: null }),

    scopedUserIds.length > 0
      ? dataClient
          .from("feedback")
          .select("id, feedback_type, title, status, user_id, created_at")
          .in("user_id", scopedUserIds)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<AdminFeedbackActivityRow[]>()
      : Promise.resolve({ data: [] as AdminFeedbackActivityRow[], error: null }),

    // Help desk: tickets where this dept is the service or requester dept
    (async () => {
      if (!queryDepartmentScope.length) return { data: [] as AdminHelpDeskActivityRow[], error: null }
      const select = "id, ticket_number, title, status, priority, service_department, requester_id, created_at"
      const [svc, req] = await Promise.all([
        dataClient
          .from("help_desk_tickets")
          .select(select)
          .in("service_department", queryDepartmentScope)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<AdminHelpDeskActivityRow[]>(),
        scopedUserIds.length > 0
          ? dataClient
              .from("help_desk_tickets")
              .select(select)
              .in("requester_id", scopedUserIds)
              .order("created_at", { ascending: false })
              .limit(50)
              .returns<AdminHelpDeskActivityRow[]>()
          : Promise.resolve({ data: [] as AdminHelpDeskActivityRow[], error: null }),
      ])
      const merged = Array.from(new Map([...(svc.data || []), ...(req.data || [])].map((r) => [r.id, r])).values())
        .sort((a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime())
        .slice(0, 50)
      return { data: merged, error: svc.error || req.error }
    })(),

    scopedUserIds.length > 0
      ? dataClient
          .from("leave_requests")
          .select("id, user_id, request_kind, status, start_date, end_date, days_count, created_at")
          .in("user_id", scopedUserIds)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<AdminLeaveActivityRow[]>()
      : Promise.resolve({ data: [] as AdminLeaveActivityRow[], error: null }),

    scopedUserIds.length > 0
      ? dataClient
          .from("attendance_records")
          .select("id, user_id, date, status, clock_in, clock_out, created_at")
          .in("user_id", scopedUserIds)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<AdminAttendanceActivityRow[]>()
      : Promise.resolve({ data: [] as AdminAttendanceActivityRow[], error: null }),
  ])

  // ── Correspondence ───────────────────────────────────────────────────────
  const correspondenceActivity = await (async () => {
    if (!queryDepartmentScope.length) return { data: [] as AdminCorrespondenceActivityRow[], error: null }
    const select = "id, reference_number, subject, status, department_name, assigned_department_name, created_at"
    const [dept, assigned] = await Promise.all([
      dataClient
        .from("correspondence_records")
        .select(select)
        .in("department_name", queryDepartmentScope)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<AdminCorrespondenceActivityRow[]>(),
      dataClient
        .from("correspondence_records")
        .select(select)
        .in("assigned_department_name", queryDepartmentScope)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<AdminCorrespondenceActivityRow[]>(),
    ])
    const merged = Array.from(new Map([...(dept.data || []), ...(assigned.data || [])].map((r) => [r.id, r])).values())
      .sort((a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime())
      .slice(0, 50)
    return { data: merged, error: dept.error || assigned.error }
  })()

  // ── Audit activity ───────────────────────────────────────────────────────
  let filteredRawActivity: ActivityLogRow[] = []
  const activitySelect =
    "id, user_id, created_at, action, operation, entity_type, table_name, entity_id, department, metadata, changed_fields, new_values, old_values"
  if (queryDepartmentScope.length > 0) {
    const [deptActivity, userActivity] = await Promise.all([
      dataClient
        .from("audit_logs")
        .select(activitySelect)
        .in("department", queryDepartmentScope)
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<ActivityLogRow[]>(),
      scopedUserIds.length > 0
        ? dataClient
            .from("audit_logs")
            .select(activitySelect)
            .in("user_id", scopedUserIds)
            .order("created_at", { ascending: false })
            .limit(20)
            .returns<ActivityLogRow[]>()
        : Promise.resolve({ data: [] as ActivityLogRow[], error: null }),
    ])
    const byId = new Map<string, ActivityLogRow>()
    for (const item of [...(deptActivity.data || []), ...(userActivity.data || [])]) byId.set(item.id, item)
    filteredRawActivity = Array.from(byId.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .filter(
        (item) =>
          !["sync", "migrate", "update_schema", "migration"].includes(
            normalizeToken(item.action || item.operation || "")
          )
      )
      .slice(0, 8)
  }

  const actorIds = Array.from(new Set(filteredRawActivity.map((item) => item.user_id).filter(Boolean))) as string[]
  let actorMap = new Map<string, { first_name?: string; last_name?: string; company_email?: string }>()
  if (actorIds.length > 0) {
    const { data: actorProfiles } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, company_email")
      .in("id", actorIds)
      .returns<ActivityActorRow[]>()
    actorMap = new Map(
      (actorProfiles || []).map((a) => [
        a.id,
        {
          first_name: a.first_name || undefined,
          last_name: a.last_name || undefined,
          company_email: a.company_email || undefined,
        },
      ])
    )
  }

  const recentActivity = buildRecentActivity(filteredRawActivity, actorMap)

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title={`${scope.deptName} Dashboard`}
        description={`Department overview for ${formatName(profile?.first_name) || "Lead"} — leave queue, tasks, help desk, and recent activity.`}
        icon={Building2}
        actions={
          <>
            <Button asChild size="sm">
              <Link href={`/dept/${dept_id}/hr/employees`}>Manage Employees</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/dept/${dept_id}/tasks`}>Review Tasks</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/dept/${dept_id}/hr/leave`}>Review Leave</Link>
            </Button>
          </>
        }
      />

      <Section title="Core KPIs" description="Current operational totals for this department.">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4 lg:grid-cols-5">
          <StatCard
            title="Team Members"
            value={employeeStats.count || 0}
            description="Active profiles in dept"
            icon={Users}
            iconBgColor="bg-blue-100 dark:bg-blue-900/30"
            iconColor="text-blue-600 dark:text-blue-400"
          />
          <StatCard
            title="Assets"
            value={assetStats.count || 0}
            description="Tracked dept inventory"
            icon={Package}
            iconBgColor="bg-purple-100 dark:bg-purple-900/30"
            iconColor="text-purple-600 dark:text-purple-400"
          />
          <StatCard
            title="Active Tasks"
            value={taskStats.count || 0}
            description="Tasks in dept"
            icon={ClipboardList}
            iconBgColor="bg-green-100 dark:bg-green-900/30"
            iconColor="text-green-600 dark:text-green-400"
          />
          <StatCard
            title="Documents"
            value={docStats.count || 0}
            description="Team documentation"
            icon={FileText}
            iconBgColor="bg-orange-100 dark:bg-orange-900/30"
            iconColor="text-orange-600 dark:text-orange-400"
          />
          <StatCard
            title="Feedback"
            value={feedbackStats.count || 0}
            description="Submitted by team"
            icon={MessageSquare}
            iconBgColor="bg-cyan-100 dark:bg-cyan-900/30"
            iconColor="text-cyan-600 dark:text-cyan-400"
          />
        </div>
      </Section>

      <RecentActivityFeed activity={recentActivity} showViewAll={false} />

      <AdminActivityTabs
        assets={assetsActivity.data || []}
        tasks={tasksActivity.data || []}
        documentation={docsActivity.data || []}
        feedback={feedbackActivity.data || []}
        correspondence={correspondenceActivity.data || []}
        helpDesk={helpDeskActivity.data || []}
        payments={[] as AdminPaymentActivityRow[]}
        leave={leaveActivity.data || []}
        attendance={attendanceActivity.data || []}
      />
    </PageWrapper>
  )
}
