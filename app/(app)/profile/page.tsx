import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { ProfileContent } from "./profile-content"
import { buildRecentActivity, normalizeToken } from "@/components/admin/dashboard-helpers"
import type { PersonalRecentActivityItem } from "@/components/profile/personal-recent-activity-feed"

export interface UserProfile {
  id: string
  first_name: string
  last_name: string
  other_names: string | null
  company_email: string
  department: string
  designation: string | null
  role: string
  phone_number: string | null
  additional_phone: string | null
  residential_address: string | null
  office_location: string | null
  is_admin: boolean
  is_department_lead: boolean
  lead_departments: string[]
  employment_date: string | null
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  department: string | null
  due_date: string | null
  created_at: string
  assignment_type?: "individual" | "multiple" | "department"
}

export interface Asset {
  id: string
  asset_name?: string
  asset_type: string
  asset_model: string | null
  serial_number: string | null
  unique_code: string | null
  status: string
  assigned_at: string
  assignment_type?: "individual" | "department" | "office"
  department?: string
  office_location?: string
}

export interface Documentation {
  id: string
  title: string
  category: string | null
  created_at: string
}

export interface Feedback {
  id: string
  feedback_type: string
  title: string
  description: string | null
  status: string
  created_at: string
}

export interface CorrespondenceItem {
  id: string
  reference_number: string
  subject: string
  status: string
  created_at: string
}

export interface HelpDeskItem {
  id: string
  ticket_number: string
  title: string
  status: string
  priority: string
  created_at: string
}

export interface PaymentItem {
  id: string
  title: string
  payment_type: string
  status: string
  amount: number | null
  currency: string
  payment_date: string | null
  created_at: string
}

export interface LeaveItem {
  id: string
  leave_type: string
  status: string
  start_date: string
  end_date: string
  days_requested: number
  created_at: string
}

type LeaveItemLegacyRow = {
  id: string
  leave_type: string
  status: string
  start_date: string
  end_date: string
  days_requested: number
  created_at: string
}

type LeaveItemModernRow = {
  id: string
  leave_type_id: string | null
  status: string
  start_date: string
  end_date: string
  days_count: number | null
  created_at: string
}

export interface AttendanceItem {
  id: string
  date: string
  status: string
  clock_in: string | null
  clock_out: string | null
  created_at: string
}

type ProfileRow = UserProfile & {
  department_id?: string | null
}

type DepartmentNameRow = {
  name: string
}

type TaskAssignmentRow = {
  task_id: string
}

type AssetRow = Asset & {
  created_at?: string
  deleted_at?: string | null
}

type AssetAssignmentRow = {
  assigned_at: string
  asset: AssetRow | null
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
  metadata?: Record<string, unknown> | null
  changed_fields?: unknown
  new_values?: Record<string, unknown> | null
  old_values?: Record<string, unknown> | null
}

const isDefined = <T,>(value: T | null | undefined): value is T => value != null

async function getProfileData() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const loadErrors: string[] = []

  // Get current user
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const userId = user.id

  // Load profile
  const { data: profileData, error: profileError } = await dataClient
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single<ProfileRow>()

  if (profileError || !profileData) {
    return {
      profile: null,
      tasks: [],
      assets: [],
      documentation: [],
      feedback: [],
      correspondence: [],
      helpDesk: [],
      payments: [],
      leave: [],
      attendance: [],
      recentActivity: [],
    }
  }

  let resolvedDepartment = profileData.department || null
  if (profileData.department_id) {
    const { data: deptById } = await dataClient
      .from("departments")
      .select("name")
      .eq("id", profileData.department_id)
      .maybeSingle<DepartmentNameRow>()
    if (deptById?.name) resolvedDepartment = deptById.name
  }
  if (String(resolvedDepartment || "").toLowerCase() === "finance") {
    resolvedDepartment = "Accounts"
  }

  // Load tasks assigned to user (individual, multiple-user, and department tasks)
  const { data: individualTasks, error: individualTasksError } = await dataClient
    .from("tasks")
    .select("*")
    .eq("assigned_to", userId)
    .order("created_at", { ascending: false })
  if (individualTasksError) loadErrors.push("tasks")

  // Load multiple-user tasks
  const { data: taskAssignments, error: taskAssignmentsError } = await dataClient
    .from("task_assignments")
    .select("task_id")
    .eq("user_id", userId)
    .returns<TaskAssignmentRow[]>()
  if (taskAssignmentsError) loadErrors.push("tasks")

  let multipleUserTasks: Task[] = []
  if (taskAssignments && taskAssignments.length > 0) {
    const taskIds = taskAssignments.map((ta) => ta.task_id)
    const { data: tasksData, error: tasksDataError } = await dataClient
      .from("tasks")
      .select("*")
      .in("id", taskIds)
      .eq("assignment_type", "multiple")
      .order("created_at", { ascending: false })
    if (tasksData) multipleUserTasks = tasksData
    if (tasksDataError) loadErrors.push("tasks")
  }

  // Load department tasks
  const { data: departmentTasks, error: departmentTasksError } = await dataClient
    .from("tasks")
    .select("*")
    .eq("department", resolvedDepartment)
    .eq("assignment_type", "department")
    .order("created_at", { ascending: false })
  if (departmentTasksError) loadErrors.push("tasks")

  const allTasks = [...(individualTasks || []), ...multipleUserTasks, ...(departmentTasks || [])]

  // Load assets assigned to user (individual)
  const { data: individualAssignments, error: individualAssignmentsError } = await dataClient
    .from("asset_assignments")
    .select(
      `
      assigned_at,
      asset:assets(
        id,
        asset_type,
        asset_model,
        serial_number,
        status,
        unique_code,
        created_at,
        deleted_at
      )
    `
    )
    .eq("assigned_to", userId)
    .eq("is_current", true)
    .returns<AssetAssignmentRow[]>()
  if (individualAssignmentsError) loadErrors.push("assets")

  // Load department and office assets (separate queries to avoid filter parsing issues with commas in names)
  const [departmentAssetsRes, officeAssetsRes] = await Promise.all([
    resolvedDepartment
      ? dataClient
          .from("assets")
          .select("*")
          .eq("status", "assigned")
          .is("deleted_at", null)
          .eq("assignment_type", "department")
          .eq("department", resolvedDepartment)
      : Promise.resolve({ data: [] as AssetRow[], error: null }),
    profileData.office_location
      ? dataClient
          .from("assets")
          .select("*")
          .eq("status", "assigned")
          .is("deleted_at", null)
          .eq("assignment_type", "office")
          .eq("office_location", profileData.office_location)
      : Promise.resolve({ data: [] as AssetRow[], error: null }),
  ])
  if (departmentAssetsRes.error || officeAssetsRes.error) loadErrors.push("assets")
  const sharedAssets = [...(departmentAssetsRes.data || []), ...(officeAssetsRes.data || [])]

  let allAssets: Asset[] = []

  // Process individual assignments
  if (individualAssignments) {
    const indAssets = individualAssignments
      .map((a): Asset | null =>
        a.asset && !a.asset.deleted_at
          ? {
              ...a.asset,
              assigned_at: a.assigned_at,
              assignment_type: "individual",
            }
          : null
      )
      .filter(isDefined)
    allAssets = [...allAssets, ...indAssets]
  }

  // Process shared assets
  if (sharedAssets) {
    const shAssets = sharedAssets.map((a) => ({
      ...a,
      assigned_at: a.created_at, // Use created_at for shared assets
      assignment_type: a.assignment_type,
    }))
    allAssets = [...allAssets, ...shAssets]
  }

  // Load documentation created by user
  const { data: docsData, error: docsError } = await dataClient
    .from("user_documentation")
    .select("id, title, category, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (docsError) loadErrors.push("documentation")

  // Load feedback submitted by user
  const { data: feedbackData, error: feedbackError } = await dataClient
    .from("feedback")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
  if (feedbackError) loadErrors.push("feedback")

  const { data: correspondenceData, error: correspondenceError } = await dataClient
    .from("correspondence_records")
    .select("id, reference_number, subject, status, created_at")
    .or(`originator_id.eq.${userId},responsible_officer_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<CorrespondenceItem[]>()
  if (correspondenceError) loadErrors.push("correspondence")

  const { data: helpDeskData, error: helpDeskError } = await dataClient
    .from("help_desk_tickets")
    .select("id, ticket_number, title, status, priority, created_at")
    .or(`requester_id.eq.${userId},assigned_to.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<HelpDeskItem[]>()
  if (helpDeskError) loadErrors.push("help desk")

  let paymentsQuery = dataClient
    .from("department_payments")
    .select("id, title, payment_type, status, amount, currency, payment_date, created_at")
    .order("created_at", { ascending: false })
    .limit(20)
  if (profileData.department_id) {
    paymentsQuery = paymentsQuery.or(`created_by.eq.${userId},department_id.eq.${profileData.department_id}`)
  } else {
    paymentsQuery = paymentsQuery.eq("created_by", userId)
  }
  const { data: paymentsData, error: paymentsError } = await paymentsQuery.returns<PaymentItem[]>()
  if (paymentsError) loadErrors.push("payments")

  let leaveData: LeaveItem[] = []
  const { data: legacyLeaveData, error: legacyLeaveError } = await dataClient
    .from("leave_requests")
    .select("id, leave_type, status, start_date, end_date, days_requested, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<LeaveItemLegacyRow[]>()

  if (!legacyLeaveError && legacyLeaveData) {
    leaveData = legacyLeaveData
  } else {
    const { data: modernLeaveData, error: modernLeaveError } = await dataClient
      .from("leave_requests")
      .select("id, leave_type_id, status, start_date, end_date, days_count, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<LeaveItemModernRow[]>()

    if (modernLeaveError) {
      loadErrors.push("leave")
    } else if (modernLeaveData) {
      leaveData = modernLeaveData.map((row) => ({
        id: row.id,
        leave_type: row.leave_type_id || "Leave",
        status: row.status,
        start_date: row.start_date,
        end_date: row.end_date,
        days_requested: row.days_count || 0,
        created_at: row.created_at,
      }))
    }
  }

  const { data: attendanceData, error: attendanceError } = await dataClient
    .from("attendance_records")
    .select("id, date, status, clock_in, clock_out, created_at")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(20)
    .returns<AttendanceItem[]>()
  if (attendanceError) loadErrors.push("attendance")

  const loadError = loadErrors.length > 0 ? "Some profile sections failed to load. Please refresh." : null

  const { data: rawActivity } = await dataClient
    .from("audit_logs")
    .select(
      "id, user_id, created_at, action, operation, entity_type, table_name, entity_id, metadata, changed_fields, new_values, old_values"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12)
    .returns<ActivityLogRow[]>()

  const filteredRawActivity = (rawActivity || [])
    .filter(
      (item) =>
        !["sync", "migrate", "update_schema", "migration"].includes(normalizeToken(item.action || item.operation))
    )
    .slice(0, 8)

  const actorMap = new Map<string, { first_name?: string; last_name?: string; company_email?: string }>([
    [
      userId,
      {
        first_name: profileData.first_name || undefined,
        last_name: profileData.last_name || undefined,
        company_email: profileData.company_email || undefined,
      },
    ],
  ])

  const recentActivity = buildRecentActivity(filteredRawActivity, actorMap) as PersonalRecentActivityItem[]

  return {
    profile: profileData,
    tasks: allTasks,
    assets: allAssets,
    documentation: (docsData || []) as Documentation[],
    feedback: (feedbackData || []) as Feedback[],
    correspondence: correspondenceData || [],
    helpDesk: helpDeskData || [],
    payments: paymentsData || [],
    leave: leaveData,
    attendance: attendanceData || [],
    recentActivity,
    loadError,
  }
}

export default async function ProfilePage() {
  const data = await getProfileData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  // Type assertion since we've checked for redirect above
  const profileData = data as Exclude<Awaited<ReturnType<typeof getProfileData>>, { redirect: "/auth/login" }>

  return (
    <ProfileContent
      profile={profileData.profile}
      tasks={profileData.tasks}
      assets={profileData.assets}
      documentation={profileData.documentation}
      feedback={profileData.feedback}
      correspondence={profileData.correspondence}
      helpDesk={profileData.helpDesk}
      payments={profileData.payments}
      leave={profileData.leave}
      attendance={profileData.attendance}
      recentActivity={profileData.recentActivity}
      initialError={profileData.loadError}
    />
  )
}
