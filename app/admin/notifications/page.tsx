import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { AdminNotificationContent, type DynamicNotification } from "./admin-notification-content"
import { getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"

type ProfileIdRow = { id: string }
type DepartmentIdRow = { id: string }

async function formatRelativeTime(dateString: string): Promise<string> {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return "Just now"
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours} hour${hours > 1 ? "s" : ""} ago`
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days} day${days > 1 ? "s" : ""} ago`
  }

  return formatWATDate(date, { month: "short", day: "numeric", year: "numeric" })
}

async function getAdminNotificationsData() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) {
    return { redirect: "/profile" as const }
  }
  const departmentScope = getDepartmentScope(scope, "general")
  const profileIdsInScope = departmentScope
    ? (departmentScope.length > 0
        ? await dataClient.from("profiles").select("id").in("department", departmentScope)
        : { data: [] as ProfileIdRow[] }
      ).data || []
    : null
  const scopedUserIds = (profileIdsInScope as ProfileIdRow[] | null)?.map((p) => p.id) || []
  const departmentIdsInScope = departmentScope
    ? (departmentScope.length > 0
        ? await dataClient.from("departments").select("id").in("name", departmentScope)
        : { data: [] as DepartmentIdRow[] }
      ).data || []
    : null
  const scopedDepartmentIds = (departmentIdsInScope as DepartmentIdRow[] | null)?.map((d) => d.id) || []

  const notificationList: DynamicNotification[] = []
  const now = new Date()
  const today = toLocalISODate(now)
  const timestamp = await formatRelativeTime(now.toISOString())

  // Pending user approvals
  try {
    let pendingUsersQuery = dataClient
      .from("pending_users")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
    if (departmentScope) {
      pendingUsersQuery =
        departmentScope.length > 0
          ? pendingUsersQuery.in("department", departmentScope)
          : pendingUsersQuery.eq("id", "__none__")
    }
    const { count: pendingUsersCount } = await pendingUsersQuery

    if (pendingUsersCount && pendingUsersCount > 0) {
      notificationList.push({
        id: "pending-users",
        type: "warning",
        category: "users",
        title: "Pending User Approvals",
        message: `${pendingUsersCount} user${pendingUsersCount > 1 ? "s" : ""} waiting for approval`,
        timestamp,
        link: "/admin/hr/employees",
        linkText: "Review Employees",
        read: false,
        priority: "high",
      })
    }
  } catch {}

  // Open feedback
  try {
    let openFeedbackQuery = dataClient.from("feedback").select("*", { count: "exact", head: true }).eq("status", "open")
    if (departmentScope) {
      openFeedbackQuery =
        scopedUserIds.length > 0
          ? openFeedbackQuery.in("user_id", scopedUserIds)
          : openFeedbackQuery.eq("id", "__none__")
    }
    const { count: openFeedbackCount } = await openFeedbackQuery

    if (openFeedbackCount && openFeedbackCount > 0) {
      notificationList.push({
        id: "open-feedback",
        type: "info",
        category: "feedback",
        title: "Open Feedback",
        message: `${openFeedbackCount} open feedback item${openFeedbackCount > 1 ? "s" : ""} need attention`,
        timestamp,
        link: "/admin/feedback",
        linkText: "View Feedback",
        read: false,
        priority: "normal",
      })
    }
  } catch {}

  // Urgent tasks
  try {
    let urgentTasksQuery = dataClient
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("priority", "urgent")
      .in("status", ["pending", "in_progress"])
    if (departmentScope) {
      urgentTasksQuery =
        departmentScope.length > 0
          ? urgentTasksQuery.in("department", departmentScope)
          : urgentTasksQuery.eq("id", "__none__")
    }
    const { count: urgentTasksCount } = await urgentTasksQuery

    if (urgentTasksCount && urgentTasksCount > 0) {
      notificationList.push({
        id: "urgent-tasks",
        type: "error",
        category: "tasks",
        title: "Urgent Tasks",
        message: `${urgentTasksCount} urgent task${urgentTasksCount > 1 ? "s" : ""} need immediate attention`,
        timestamp,
        link: "/admin/tasks",
        linkText: "View Tasks",
        read: false,
        priority: "urgent",
      })
    }
  } catch {}

  // Overdue tasks
  try {
    let overdueTasksQuery = dataClient
      .from("tasks")
      .select("id")
      .lt("due_date", today)
      .in("status", ["pending", "in_progress"])
    if (departmentScope) {
      overdueTasksQuery =
        departmentScope.length > 0
          ? overdueTasksQuery.in("department", departmentScope)
          : overdueTasksQuery.eq("id", "__none__")
    }
    const { data: overdueTasks } = await overdueTasksQuery

    if (overdueTasks && overdueTasks.length > 0) {
      notificationList.push({
        id: "overdue-tasks",
        type: "error",
        category: "tasks",
        title: "Overdue Tasks",
        message: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""} need to be completed`,
        timestamp,
        link: "/admin/tasks",
        linkText: "View Tasks",
        read: false,
        priority: "urgent",
      })
    }
  } catch {}

  // Overdue payments
  try {
    let overduePaymentsQuery = dataClient
      .from("department_payments")
      .select("id")
      .lt("next_payment_due", now.toISOString())
      .eq("status", "due")
    if (departmentScope) {
      overduePaymentsQuery =
        scopedDepartmentIds.length > 0
          ? overduePaymentsQuery.in("department_id", scopedDepartmentIds)
          : overduePaymentsQuery.eq("id", "__none__")
    }
    const { data: overduePayments } = await overduePaymentsQuery

    if (overduePayments && overduePayments.length > 0) {
      notificationList.push({
        id: "overdue-payments",
        type: "error",
        category: "payments",
        title: "Overdue Payments",
        message: `${overduePayments.length} payment${overduePayments.length > 1 ? "s" : ""} past due date`,
        timestamp,
        link: "/admin/accounts/payments",
        linkText: "View Payments",
        read: false,
        priority: "urgent",
      })
    }
  } catch {}

  // Payments due soon (within 7 days)
  try {
    const sevenDaysFromNow = new Date()
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)
    let dueSoonPaymentsQuery = dataClient
      .from("department_payments")
      .select("id")
      .gte("next_payment_due", now.toISOString())
      .lte("next_payment_due", sevenDaysFromNow.toISOString())
      .eq("status", "due")
    if (departmentScope) {
      dueSoonPaymentsQuery =
        scopedDepartmentIds.length > 0
          ? dueSoonPaymentsQuery.in("department_id", scopedDepartmentIds)
          : dueSoonPaymentsQuery.eq("id", "__none__")
    }
    const { data: dueSoonPayments } = await dueSoonPaymentsQuery

    if (dueSoonPayments && dueSoonPayments.length > 0) {
      notificationList.push({
        id: "due-soon-payments",
        type: "warning",
        category: "payments",
        title: "Payments Due Soon",
        message: `${dueSoonPayments.length} payment${dueSoonPayments.length > 1 ? "s" : ""} due within 7 days`,
        timestamp,
        link: "/admin/accounts/payments",
        linkText: "View Payments",
        read: false,
        priority: "high",
      })
    }
  } catch {}

  // Pending leave requests
  try {
    let pendingLeaveQuery = dataClient
      .from("leave_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
    if (departmentScope) {
      pendingLeaveQuery =
        scopedUserIds.length > 0
          ? pendingLeaveQuery.in("user_id", scopedUserIds)
          : pendingLeaveQuery.eq("id", "__none__")
    }
    const { count: pendingLeaveCount } = await pendingLeaveQuery

    if (pendingLeaveCount && pendingLeaveCount > 0) {
      notificationList.push({
        id: "pending-leave",
        type: "warning",
        category: "leave",
        title: "Pending Leave Requests",
        message: `${pendingLeaveCount} leave request${pendingLeaveCount > 1 ? "s" : ""} awaiting approval`,
        timestamp,
        link: "/admin/hr/leave/approve",
        linkText: "Review Requests",
        read: false,
        priority: "high",
      })
    }
  } catch {}

  // Unresolved asset issues
  try {
    let assetIssuesQuery = dataClient
      .from("asset_issues")
      .select("*", { count: "exact", head: true })
      .in("status", ["open", "in_progress"])
    if (departmentScope) {
      assetIssuesQuery =
        scopedUserIds.length > 0
          ? assetIssuesQuery.in("created_by", scopedUserIds)
          : assetIssuesQuery.eq("id", "__none__")
    }
    const { count: assetIssuesCount } = await assetIssuesQuery

    if (assetIssuesCount && assetIssuesCount > 0) {
      notificationList.push({
        id: "asset-issues",
        type: "warning",
        category: "assets",
        title: "Unresolved Asset Issues",
        message: `${assetIssuesCount} asset issue${assetIssuesCount > 1 ? "s" : ""} need attention`,
        timestamp,
        link: "/admin/assets/issues",
        linkText: "View Issues",
        read: false,
        priority: "normal",
      })
    }
  } catch {}

  // Assets in maintenance
  try {
    let maintenanceQuery = dataClient
      .from("assets")
      .select("*", { count: "exact", head: true })
      .eq("status", "maintenance")
      .is("deleted_at", null)
    if (departmentScope) {
      maintenanceQuery =
        departmentScope.length > 0
          ? maintenanceQuery.in("department", departmentScope)
          : maintenanceQuery.eq("id", "__none__")
    }
    const { count: maintenanceCount } = await maintenanceQuery

    if (maintenanceCount && maintenanceCount > 0) {
      notificationList.push({
        id: "assets-maintenance",
        type: "info",
        category: "assets",
        title: "Assets in Maintenance",
        message: `${maintenanceCount} asset${maintenanceCount > 1 ? "s" : ""} currently in maintenance`,
        timestamp,
        link: "/admin/assets",
        linkText: "View Assets",
        read: false,
        priority: "low",
      })
    }
  } catch {}

  // Sort by priority
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
  notificationList.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return { notifications: notificationList }
}

export default async function AdminNotificationPage() {
  const data = await getAdminNotificationsData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const notificationsData = data as { notifications: DynamicNotification[] }

  return <AdminNotificationContent initialNotifications={notificationsData.notifications} />
}
