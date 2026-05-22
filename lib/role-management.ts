export const ADMIN_LIKE_ROLES = ["developer", "super_admin", "admin"] as const
export const ASSIGNABLE_ROLES = ["visitor", "employee", "admin", "super_admin", "developer"] as const

export function canAssignRole(assignerRole: string, targetRole: string): boolean {
  if (assignerRole === "super_admin") return ASSIGNABLE_ROLES.includes(targetRole as (typeof ASSIGNABLE_ROLES)[number])
  if (assignerRole === "developer")
    return ["visitor", "employee", "admin", "super_admin", "developer"].includes(targetRole)
  if (assignerRole === "admin") return ["visitor", "employee"].includes(targetRole)
  return false
}

export function canManageDeveloperAccounts(actorRole: string): boolean {
  return actorRole === "super_admin" || actorRole === "developer"
}

export function canManageSuperAdminAccounts(actorRole: string): boolean {
  return actorRole === "super_admin" || actorRole === "developer"
}

export function getAssignableRolesForActor(actorRole: string): string[] {
  if (actorRole === "super_admin") return [...ASSIGNABLE_ROLES]
  if (actorRole === "developer") return ["visitor", "employee", "admin", "super_admin", "developer"]
  if (actorRole === "admin") return ["visitor", "employee"]
  return []
}
