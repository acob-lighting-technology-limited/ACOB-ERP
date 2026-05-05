import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { expandDepartmentScopeForQuery, getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Users, Package, ClipboardList, FileText, MessageSquare, Shield } from "lucide-react"
import { formatName } from "@/lib/utils"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { StatCard } from "@/components/ui/stat-card"
import { ActionQueue } from "@/components/admin/action-queue"
import { PrimaryModuleGrid, SecondaryModuleGrid } from "@/components/admin/module-grid"
import { RecentActivityFeed } from "@/components/admin/recent-activity-feed"
import type { NotificationItem } from "@/components/admin/dashboard-types"
import {
  normalizeToken,
  buildRecentActivity,
  primaryModules,
  secondaryModules,
} from "@/components/admin/dashboard-helpers"
import { logger } from "@/lib/logger"
import { buildAccessContextV2, canAccessRouteV2, resolveAdminRouteKeyV2 } from "@/lib/admin/policy-v2"

const log = logger("")

const notificationPriority: Record<NotificationItem["type"], number> = {
  error: 0,
  warning: 1,
  info: 2,
}

type ProfileIdRow = {
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
  const canSeeAuditActivity =
    ["developer", "super_admin"].includes(String(profile?.role || "").toLowerCase()) && scope?.scopeMode !== "lead"

  // Fetch stats
  const profilesQ = dataClient.from("profiles").select("*", { count: "exact", head: true })
  const assetsQ = dataClient.from("assets").select("*", { count: "exact", head: true }).is("deleted_at", null)
  const tasksQ = dataClient.from("tasks").select("*", { count: "exact", head: true })
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

  let filteredRawActivity: ActivityLogRow[] = []
  if (canSeeAuditActivity) {
    let auditQuery = dataClient
      .from("audit_logs")
      .select(
        "id, user_id, created_at, action, operation, entity_type, table_name, entity_id, department, metadata, changed_fields, new_values, old_values"
      )
      .order("created_at", { ascending: false })
      .limit(20)
    if (departmentScope) {
      auditQuery =
        queryDepartmentScope && queryDepartmentScope.length > 0
          ? auditQuery.in("department", queryDepartmentScope)
          : auditQuery.eq("id", "__none__")
    }
    const { data: rawActivity, error: auditError } = await auditQuery.returns<ActivityLogRow[]>()
    if (auditError) log.error("Recent activity query failed", auditError)
    filteredRawActivity = (rawActivity || [])
      .filter(
        (item) =>
          !["sync", "migrate", "update_schema", "migration"].includes(normalizeToken(item.action || item.operation))
      )
      .slice(0, 6)
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

  // Notifications
  const notifications: NotificationItem[] = []

  let pendingUsersQ = supabase.from("pending_users").select("*", { count: "exact", head: true }).eq("status", "pending")
  if (departmentScope) {
    pendingUsersQ =
      queryDepartmentScope && queryDepartmentScope.length > 0
        ? pendingUsersQ.in("department", queryDepartmentScope)
        : pendingUsersQ.eq("id", "__none__")
  }
  const { count: pendingUsersCount } = await pendingUsersQ
  if (pendingUsersCount && pendingUsersCount > 0) {
    notifications.push({
      id: "pending-users",
      type: "warning",
      title: "Pending User Approvals",
      message: `You have ${pendingUsersCount} user${pendingUsersCount > 1 ? "s" : ""} waiting for approval.`,
      timestamp: "Just now",
      link: "/admin/hr/employees",
      linkText: "Review Employees",
    })
  }

  let openFeedbackQ = supabase.from("feedback").select("*", { count: "exact", head: true }).eq("status", "open")
  if (departmentScope) {
    openFeedbackQ =
      scopedUserIds.length > 0 ? openFeedbackQ.in("user_id", scopedUserIds) : openFeedbackQ.eq("id", "__none__")
  }
  const { count: openFeedbackCount } = await openFeedbackQ
  if (openFeedbackCount && openFeedbackCount > 0) {
    notifications.push({
      id: "open-feedback",
      type: "info",
      title: "Open Feedback",
      message: `There ${openFeedbackCount === 1 ? "is" : "are"} ${openFeedbackCount} open feedback item${openFeedbackCount > 1 ? "s" : ""} that need attention.`,
      timestamp: "Recent",
      link: "/admin/feedback",
      linkText: "View Feedback",
    })
  }

  let urgentTasksQ = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("priority", "urgent")
    .in("status", ["pending", "in_progress"])
  if (departmentScope) {
    urgentTasksQ =
      queryDepartmentScope && queryDepartmentScope.length > 0
        ? urgentTasksQ.in("department", queryDepartmentScope)
        : urgentTasksQ.eq("id", "__none__")
  }
  const { count: urgentTasksCount } = await urgentTasksQ
  if (urgentTasksCount && urgentTasksCount > 0) {
    notifications.push({
      id: "urgent-tasks",
      type: "error",
      title: "Urgent Tasks",
      message: `You have ${urgentTasksCount} urgent task${urgentTasksCount > 1 ? "s" : ""} that need immediate attention.`,
      timestamp: "Urgent",
      link: "/admin/tasks",
      linkText: "View Tasks",
    })
  }

  const today = new Date().toISOString().split("T")[0]
  let overdueQ = supabase
    .from("tasks")
    .select("id", { count: "exact", head: false })
    .lt("due_date", today)
    .in("status", ["pending", "in_progress"])
  if (departmentScope) {
    overdueQ =
      queryDepartmentScope && queryDepartmentScope.length > 0
        ? overdueQ.in("department", queryDepartmentScope)
        : overdueQ.eq("id", "__none__")
  }
  const { data: overdueTasks } = await overdueQ
  if (overdueTasks && overdueTasks.length > 0) {
    notifications.push({
      id: "overdue-tasks",
      type: "error",
      title: "Overdue Tasks",
      message: `There ${overdueTasks.length === 1 ? "is" : "are"} ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""} that need to be completed.`,
      timestamp: "Overdue",
      link: "/admin/tasks",
      linkText: "View Tasks",
    })
  }

  if (user?.id && canAccessAction(["developer", "super_admin", "admin"], "/admin/hr/leave/approve")) {
    const [approverQueueResult, relieverQueueResult] = await Promise.all([
      dataClient
        .from("leave_requests")
        .select("id")
        .eq("current_approver_user_id", user.id)
        .in("status", ["pending", "pending_evidence"]),
      dataClient
        .from("leave_requests")
        .select("id")
        .eq("reliever_id", user.id)
        .in("current_stage_code", ["pending_reliever", "reliever_pending"])
        .in("status", ["pending", "pending_evidence"]),
    ])

    const pendingLeaveIds = new Set<string>([
      ...((approverQueueResult.data || []) as { id: string }[]).map((row) => row.id),
      ...((relieverQueueResult.data || []) as { id: string }[]).map((row) => row.id),
    ])

    if (pendingLeaveIds.size > 0) {
      notifications.push({
        id: "pending-leave-approvals",
        type: "warning",
        title: "Pending Leave Approvals",
        message: `${pendingLeaveIds.size} leave request${pendingLeaveIds.size > 1 ? "s" : ""} awaiting your review.`,
        timestamp: "Recent",
        link: "/admin/hr/leave/approve",
        linkText: "Review Leave",
      })
    }
  }

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  if (canSeeAuditActivity) {
    let todayAuditQ = supabase
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString())
    if (departmentScope) {
      todayAuditQ =
        queryDepartmentScope && queryDepartmentScope.length > 0
          ? todayAuditQ.in("department", queryDepartmentScope)
          : todayAuditQ.eq("id", "__none__")
    }
    const { count: todayAuditCount } = await todayAuditQ
    if (todayAuditCount && todayAuditCount > 50) {
      notifications.push({
        id: "high-activity",
        type: "info",
        title: "High System Activity",
        message: `There have been ${todayAuditCount} system activities today. Review audit logs for details.`,
        timestamp: "Today",
        link: "/admin/audit-logs",
        linkText: "View Audit Logs",
      })
    }
  }

  const filteredPrimaryModules = primaryModules.filter((a) => canAccessAction(a.roles, a.href))
  const filteredSecondaryModules = secondaryModules.filter((a) => canAccessAction(a.roles, a.href))
  const canManageEmployees = canAccessAction(["developer", "super_admin", "admin"], "/admin/hr/employees")
  const canReviewTasks = canAccessAction(["developer", "super_admin", "admin"], "/admin/tasks")
  const canOpenReports = canAccessAction(["developer", "super_admin", "admin"], "/admin/reports")
  const sortedNotifications = [...notifications].sort(
    (a, b) => notificationPriority[a.type] - notificationPriority[b.type]
  )

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

      <Section title="Action Queue" description="Priority items that require administrative attention.">
        <ActionQueue notifications={sortedNotifications} />
      </Section>

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

      <Section title="Primary Modules" description="Core admin workstreams used for daily operational control.">
        <PrimaryModuleGrid modules={filteredPrimaryModules} />
      </Section>

      <Section title="Secondary Modules" description="Additional administrative modules and supporting functions.">
        <SecondaryModuleGrid modules={filteredSecondaryModules} />
      </Section>

      {canSeeAuditActivity && (
        <Section title="Recent Activity" description="Latest cross-module changes recorded in the system.">
          <RecentActivityFeed activity={recentActivity} />
        </Section>
      )}
    </PageWrapper>
  )
}
