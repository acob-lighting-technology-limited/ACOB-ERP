export interface TaskAssignmentAuthorityProfile {
  id: string
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
  lead_departments?: string[] | null
  isAdminLike?: boolean | null
}

export interface TaskAssignmentTargetProfile {
  id: string
  department?: string | null
}

import { normalizeDepartmentName, normalizeDepartmentList, isSameDepartment } from "@/shared/departments"

export function hasGlobalTaskAssignmentAuthority(profile: TaskAssignmentAuthorityProfile | null | undefined): boolean {
  if (!profile) return false
  if (profile.isAdminLike) return true
  const role = String(profile.role || "").toLowerCase()
  return ["admin", "super_admin", "developer", "hr_manager"].includes(role)
}

export function canAssignTasks(profile: TaskAssignmentAuthorityProfile | null | undefined): boolean {
  if (!profile) return false
  if (hasGlobalTaskAssignmentAuthority(profile)) return true
  return Boolean(profile.is_department_lead)
}

export function getAssignableDepartments(profile: TaskAssignmentAuthorityProfile): string[] {
  if (hasGlobalTaskAssignmentAuthority(profile)) {
    return [] // Empty means all departments in global context, or caller provides full list
  }

  const departments = normalizeDepartmentList([
    profile.department,
    ...(Array.isArray(profile.lead_departments) ? profile.lead_departments : []),
  ])

  return profile.is_department_lead ? departments : []
}

export function profileLeadsDepartment(
  profile: TaskAssignmentAuthorityProfile | null | undefined,
  departmentName: string
) {
  if (!profile) return false
  if (hasGlobalTaskAssignmentAuthority(profile)) return true
  if (!profile.is_department_lead) return false
  return getAssignableDepartments(profile).some((dept) => isSameDepartment(dept, departmentName))
}

export function canAssignToDepartment(
  assigner: TaskAssignmentAuthorityProfile | null | undefined,
  department: string | null | undefined
) {
  if (!assigner || !department) return false
  if (!canAssignTasks(assigner)) return false
  if (hasGlobalTaskAssignmentAuthority(assigner)) return true
  return getAssignableDepartments(assigner).some((managedDept) => isSameDepartment(managedDept, department))
}

export function canAssignToProfile(
  assigner: TaskAssignmentAuthorityProfile | null | undefined,
  assignee: TaskAssignmentTargetProfile | null | undefined
) {
  if (!assigner || !assignee) return false
  if (!canAssignTasks(assigner)) return false
  if (assigner.id === assignee.id) return true
  if (hasGlobalTaskAssignmentAuthority(assigner)) return true
  return canAssignToDepartment(assigner, assignee.department)
}

export function filterAssignableTaskUsers<T extends TaskAssignmentTargetProfile>(
  assigner: TaskAssignmentAuthorityProfile | null | undefined,
  users: T[]
) {
  if (!assigner) return []
  if (hasGlobalTaskAssignmentAuthority(assigner)) return users
  return users.filter((user) => canAssignToProfile(assigner, user))
}

export function filterAssignableTaskDepartments(
  assigner: TaskAssignmentAuthorityProfile | null | undefined,
  departments: string[]
) {
  if (!assigner) return []
  if (hasGlobalTaskAssignmentAuthority(assigner)) return departments
  return departments.filter((department) => canAssignToDepartment(assigner, department))
}
