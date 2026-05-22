import type { SupabaseClient } from "@supabase/supabase-js"

type ExitProfileRow = {
  role?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
}

export interface ExitBlockers {
  assets: number
  tasks: number
  task_assignments: number
  managed_projects: number
  project_memberships: number
  lead_roles: number
  total: number
}

const ACTIVE_PROJECT_STATUSES = ["planning", "active", "on_hold"]

export async function getExitBlockers(supabase: SupabaseClient, employeeId: string): Promise<ExitBlockers> {
  const [assetsRes, tasksRes, taskAssignmentsRes, managedProjectsRes, projectMembershipsRes, profileRes] =
    await Promise.all([
      supabase
        .from("asset_assignments")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", employeeId)
        .eq("is_current", true),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", employeeId)
        .neq("status", "completed"),
      supabase
        .from("task_assignments")
        .select("id, task:tasks!inner(status)", { count: "exact", head: true })
        .eq("user_id", employeeId)
        .neq("task.status", "completed"),
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("project_manager_id", employeeId)
        .in("status", ACTIVE_PROJECT_STATUSES),
      supabase
        .from("project_members")
        .select("id, project:projects!inner(status)", { count: "exact", head: true })
        .eq("user_id", employeeId)
        .eq("is_active", true)
        .in("project.status", ACTIVE_PROJECT_STATUSES),
      supabase.from("profiles").select("role, is_department_lead, lead_departments").eq("id", employeeId).single(),
    ])

  const profile = profileRes.data as ExitProfileRow | null
  const leadDepartments = Array.isArray(profile?.lead_departments) ? profile.lead_departments : []
  const hasLeadRole = profile?.is_department_lead === true || leadDepartments.length > 0

  const blockers: ExitBlockers = {
    assets: assetsRes.count || 0,
    tasks: tasksRes.count || 0,
    task_assignments: taskAssignmentsRes.count || 0,
    managed_projects: managedProjectsRes.count || 0,
    project_memberships: projectMembershipsRes.count || 0,
    lead_roles: hasLeadRole ? 1 : 0,
    total: 0,
  }

  blockers.total =
    blockers.assets +
    blockers.tasks +
    blockers.task_assignments +
    blockers.managed_projects +
    blockers.project_memberships +
    blockers.lead_roles

  return blockers
}
