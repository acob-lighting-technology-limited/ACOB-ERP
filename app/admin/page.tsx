import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { expandDepartmentScopeForQuery, getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Users, Package, ClipboardList, FileText, MessageSquare, Shield } from "lucide-react"
import { formatName } from "@/lib/utils"
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
import { buildAccessContextV2, canAccessRouteV2, resolveAdminRouteKeyV2 } from "@/lib/admin/policy-v2"

const log = logger("")

type ProfileIdRow = {
  id: string
}

type DepartmentIdRow = {
  id: string
}

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

export default async function AdminDashboardPage() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await resolveAdminScope(supabase, user.id) : null
  const departmentScope = scope ? getDepartmentScope(scope, "general") : null
  const queryDepartmentScope = departmentScope ? expandDepartmentScopeForQuery(departmentScope) : null
  const profileIdsInScope = departmentScope
    ? (queryDepartmentScope && queryDepartmentScope.length > 0
        ? await dataClient
            .from("profiles")
            .select("id")
            .in("department", queryDepartmentScope)
            .returns<ProfileIdRow[]>()
        : { data: [] as ProfileIdRow[] }
      ).data || []
    : null
  const scopedUserIds = profileIdsInScope ? profileIdsInScope.map((profileRow) => profileRow.id) : []

  const { data: profile } = await dataClient.from("profiles").select("*").eq("id", user?.id).single()
  const canSeeAuditActivity = Boolean(scope?.isAdminLike || scope?.isDepartmentLead)

  // Fetch stats
  const profilesQ = dataClient.from("profiles").select("*", { count: "exact", head: true })
  const assetsQ = dataClient.from("assets").select("*", { count: "exact", head: true }).is("deleted_at", null)
  const tasksQ = dataClient.from("tasks").select("*", { count: "exact", head: true }).neq("category", "weekly_action")
  const docsQ = dataClient.from("user_documentation").select("*", { count: "exact", head: true })
  const feedbackQ = dataClient.from("feedback").select("*", { count: "exact", head: true })

  const [employeeStats, assetStats, taskStats, docStats, feedbackStats] = await Promise.all([
    departmentScope
      ? queryDepartmentScope && queryDepartmentScope.length > 0
        ? profilesQ.in("department", queryDepartmentScope)
        : profilesQ.eq("id", "__none__")
      : profilesQ,
    departmentScope
      ? queryDepartmentScope && queryDepartmentScope.length > 0
        ? assetsQ.in("department", queryDepartmentScope)
        : assetsQ.eq("id", "__none__")
      : assetsQ,
    departmentScope
      ? queryDepartmentScope && queryDepartmentScope.length > 0
        ? tasksQ.in("department", queryDepartmentScope)
        : tasksQ.eq("id", "__none__")
      : tasksQ,
    departmentScope
      ? scopedUserIds.length > 0
        ? docsQ.in("user_id", scopedUserIds)
        : docsQ.eq("id", "__none__")
      : docsQ,
    departmentScope
      ? scopedUserIds.length > 0
        ? feedbackQ.in("user_id", scopedUserIds)
        : feedbackQ.eq("id", "__none__")
      : feedbackQ,
  ])

  if (employeeStats.error) log.error("profiles count failed", employeeStats.error)
  if (assetStats.error) log.error("assets count failed", assetStats.error)
  if (taskStats.error) log.error("tasks count failed", taskStats.error)
  if (docStats.error) log.error("user_documentation count failed", docStats.error)
  if (feedbackStats.error) log.error("feedback count failed", feedbackStats.error)

  const scopedDepartmentIds =
    departmentScope && queryDepartmentScope && queryDepartmentScope.length > 0
      ? (
          (
            await dataClient
              .from("departments")
              .select("id")
              .in("name", queryDepartmentScope)
              .returns<DepartmentIdRow[]>()
          ).data || []
        ).map((department) => department.id)
      : []

  const loadAssetsActivity = () => {
    let query = dataClient
      .from("assets")
      .select(
        "id, asset_type, asset_model, unique_code, status, assignment_type, department, office_location, created_at"
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50)
    if (departmentScope) {
      query =
        queryDepartmentScope && queryDepartmentScope.length > 0
          ? query.in("department", queryDepartmentScope)
          : query.eq("id", "__none__")
    }
    return query.returns<AdminAssetActivityRow[]>()
  }

  const loadTasksActivity = () => {
    let query = dataClient
      .from("tasks")
      .select("id, title, status, priority, department, due_date, created_at")
      .neq("category", "weekly_action")
      .order("created_at", { ascending: false })
      .limit(50)
    if (departmentScope) {
      query =
        queryDepartmentScope && queryDepartmentScope.length > 0
          ? query.in("department", queryDepartmentScope)
          : query.eq("id", "__none__")
    }
    return query.returns<AdminTaskActivityRow[]>()
  }

  const loadDocsActivity = () => {
    let query = dataClient
      .from("user_documentation")
      .select("id, title, category, user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (departmentScope) {
      query = scopedUserIds.length > 0 ? query.in("user_id", scopedUserIds) : query.eq("id", "__none__")
    }
    return query.returns<AdminDocumentationActivityRow[]>()
  }

  const loadFeedbackActivity = () => {
    let query = dataClient
      .from("feedback")
      .select("id, feedback_type, title, status, user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (departmentScope) {
      query = scopedUserIds.length > 0 ? query.in("user_id", scopedUserIds) : query.eq("id", "__none__")
    }
    return query.returns<AdminFeedbackActivityRow[]>()
  }

  const mergeRowsById = <T extends { id: string; created_at: string | null }>(rows: T[][]): T[] =>
    Array.from(new Map(rows.flat().map((row) => [row.id, row])).values())
      .sort((a, b) => new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime())
      .slice(0, 50)

  const loadCorrespondenceActivity = async () => {
    const select = "id, reference_number, subject, status, department_name, assigned_department_name, created_at"
    if (departmentScope) {
      if (!queryDepartmentScope || queryDepartmentScope.length === 0) {
        return { data: [] as AdminCorrespondenceActivityRow[], error: null }
      }
      const [departmentRecords, assignedRecords] = await Promise.all([
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
      return {
        data: mergeRowsById([departmentRecords.data || [], assignedRecords.data || []]),
        error: departmentRecords.error || assignedRecords.error,
      }
    }
    return dataClient
      .from("correspondence_records")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<AdminCorrespondenceActivityRow[]>()
  }

  const loadHelpDeskActivity = async () => {
    const select = "id, ticket_number, title, status, priority, service_department, requester_id, created_at"
    if (departmentScope) {
      if (!queryDepartmentScope || queryDepartmentScope.length === 0) {
        return { data: [] as AdminHelpDeskActivityRow[], error: null }
      }
      const [serviceTickets, requesterTickets] = await Promise.all([
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
      return {
        data: mergeRowsById([serviceTickets.data || [], requesterTickets.data || []]),
        error: serviceTickets.error || requesterTickets.error,
      }
    }
    return dataClient
      .from("help_desk_tickets")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<AdminHelpDeskActivityRow[]>()
  }

  const loadPaymentsActivity = () => {
    let query = dataClient
      .from("department_payments")
      .select("id, title, payment_type, status, amount, currency, payment_date, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (departmentScope) {
      query =
        scopedDepartmentIds.length > 0 ? query.in("department_id", scopedDepartmentIds) : query.eq("id", "__none__")
    }
    return query.returns<AdminPaymentActivityRow[]>()
  }

  const loadLeaveActivity = () => {
    let query = dataClient
      .from("leave_requests")
      .select("id, user_id, request_kind, status, start_date, end_date, days_count, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (departmentScope) {
      query = scopedUserIds.length > 0 ? query.in("user_id", scopedUserIds) : query.eq("id", "__none__")
    }
    return query.returns<AdminLeaveActivityRow[]>()
  }

  const loadAttendanceActivity = () => {
    let query = dataClient
      .from("attendance_records")
      .select("id, user_id, date, status, clock_in, clock_out, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (departmentScope) {
      query = scopedUserIds.length > 0 ? query.in("user_id", scopedUserIds) : query.eq("id", "__none__")
    }
    return query.returns<AdminAttendanceActivityRow[]>()
  }

  const [
    assetsActivity,
    tasksActivity,
    docsActivity,
    feedbackActivity,
    correspondenceActivity,
    helpDeskActivity,
    paymentsActivity,
    leaveActivity,
    attendanceActivity,
  ] = await Promise.all([
    loadAssetsActivity(),
    loadTasksActivity(),
    loadDocsActivity(),
    loadFeedbackActivity(),
    loadCorrespondenceActivity(),
    loadHelpDeskActivity(),
    loadPaymentsActivity(),
    loadLeaveActivity(),
    loadAttendanceActivity(),
  ])

  if (assetsActivity.error) log.error("assets activity query failed", assetsActivity.error)
  if (tasksActivity.error) log.error("tasks activity query failed", tasksActivity.error)
  if (docsActivity.error) log.error("user_documentation activity query failed", docsActivity.error)
  if (feedbackActivity.error) log.error("feedback activity query failed", feedbackActivity.error)
  if (correspondenceActivity.error) log.error("correspondence activity query failed", correspondenceActivity.error)
  if (helpDeskActivity.error) log.error("help desk activity query failed", helpDeskActivity.error)
  if (paymentsActivity.error) log.error("payments activity query failed", paymentsActivity.error)
  if (leaveActivity.error) log.error("leave activity query failed", leaveActivity.error)
  if (attendanceActivity.error) log.error("attendance activity query failed", attendanceActivity.error)

  let filteredRawActivity: ActivityLogRow[] = []
  if (canSeeAuditActivity) {
    const activitySelect =
      "id, user_id, created_at, action, operation, entity_type, table_name, entity_id, department, metadata, changed_fields, new_values, old_values"
    let rawActivity: ActivityLogRow[] = []

    if (departmentScope) {
      if (queryDepartmentScope && queryDepartmentScope.length > 0) {
        const [departmentActivity, userActivity] = await Promise.all([
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

        if (departmentActivity.error) log.error("Recent activity department query failed", departmentActivity.error)
        if (userActivity.error) log.error("Recent activity user query failed", userActivity.error)

        const activityById = new Map<string, ActivityLogRow>()
        for (const item of [...(departmentActivity.data || []), ...(userActivity.data || [])]) {
          activityById.set(item.id, item)
        }
        rawActivity = Array.from(activityById.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      }
    } else {
      const { data, error: auditError } = await dataClient
        .from("audit_logs")
        .select(activitySelect)
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<ActivityLogRow[]>()
      if (auditError) log.error("Recent activity query failed", auditError)
      rawActivity = data || []
    }

    filteredRawActivity = rawActivity
      .filter(
        (item) =>
          !["sync", "migrate", "update_schema", "migration"].includes(normalizeToken(item.action || item.operation))
      )
      .slice(0, 8)
  }

  const actorIds = Array.from(new Set(filteredRawActivity.map((item) => item.user_id).filter(Boolean)))
  let actorMap = new Map<string, { first_name?: string; last_name?: string; company_email?: string }>()
  if (actorIds.length > 0) {
    const { data: actorProfiles } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, company_email")
      .in("id", actorIds)
      .returns<ActivityActorRow[]>()
    actorMap = new Map(
      (actorProfiles || []).map((actor) => [
        actor.id,
        {
          first_name: actor.first_name || undefined,
          last_name: actor.last_name || undefined,
          company_email: actor.company_email || undefined,
        },
      ])
    )
  }

  const recentActivity = buildRecentActivity(filteredRawActivity, actorMap)
  const accessContext = scope ? buildAccessContextV2(scope) : null
  const canAccessAction = (_requiredRoles: string[], href: string) =>
    Boolean(accessContext && canAccessRouteV2(accessContext, resolveAdminRouteKeyV2(href)))

  const canManageEmployees = canAccessAction(["developer", "super_admin", "admin"], "/admin/hr/employees")
  const canReviewTasks = canAccessAction(["developer", "super_admin", "admin"], "/admin/tasks")
  const canOpenReports = canAccessAction(["developer", "super_admin", "admin"], "/admin/reports")

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Admin Dashboard"
        description={`Operational control center for ${formatName(profile?.first_name) || "Admin"}: review queues, monitor workload, and execute priority actions.`}
        icon={Shield}
        actions={
          <>
            {canManageEmployees && (
              <Button asChild size="sm">
                <Link href="/admin/hr/employees">Manage Employees</Link>
              </Button>
            )}
            {canReviewTasks && (
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/tasks">Review Tasks</Link>
              </Button>
            )}
            {canOpenReports && (
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/reports">Open Reports</Link>
              </Button>
            )}
          </>
        }
      />

      <Section title="Core KPIs" description="Current operational totals across core business areas.">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4 lg:grid-cols-5">
          <StatCard
            title="Total Employees"
            value={employeeStats.count || 0}
            description="Registered user profiles"
            icon={Users}
            iconBgColor="bg-blue-100 dark:bg-blue-900/30"
            iconColor="text-blue-600 dark:text-blue-400"
          />
          <StatCard
            title="Assets"
            value={assetStats.count || 0}
            description="Tracked inventory records"
            icon={Package}
            iconBgColor="bg-purple-100 dark:bg-purple-900/30"
            iconColor="text-purple-600 dark:text-purple-400"
          />
          <StatCard
            title="Active Tasks"
            value={taskStats.count || 0}
            description="Total tasks in system"
            icon={ClipboardList}
            iconBgColor="bg-green-100 dark:bg-green-900/30"
            iconColor="text-green-600 dark:text-green-400"
          />
          <StatCard
            title="Documents"
            value={docStats.count || 0}
            description="User documentation files"
            icon={FileText}
            iconBgColor="bg-orange-100 dark:bg-orange-900/30"
            iconColor="text-orange-600 dark:text-orange-400"
          />
          <StatCard
            title="Feedback"
            value={feedbackStats.count || 0}
            description="Submitted feedback records"
            icon={MessageSquare}
            iconBgColor="bg-cyan-100 dark:bg-cyan-900/30"
            iconColor="text-cyan-600 dark:text-cyan-400"
          />
        </div>
      </Section>

      {canSeeAuditActivity && (
        <RecentActivityFeed activity={recentActivity} showViewAll={canAccessAction([], "/admin/audit-logs")} />
      )}

      <AdminActivityTabs
        assets={assetsActivity.data || []}
        tasks={tasksActivity.data || []}
        documentation={docsActivity.data || []}
        feedback={feedbackActivity.data || []}
        correspondence={correspondenceActivity.data || []}
        helpDesk={helpDeskActivity.data || []}
        payments={paymentsActivity.data || []}
        leave={leaveActivity.data || []}
        attendance={attendanceActivity.data || []}
      />
    </PageWrapper>
  )
}
