/**
 * Dept Console layout.
 *
 * Intentionally mirrors AdminLayout 1:1 — uses the same AdminSidebar,
 * AdminContextRibbon, AdminScopeProvider, and SidebarContent components.
 * Any future UI changes to those components automatically apply here too.
 *
 * The only difference vs AdminLayout is that the scope is synthesised from
 * DeptScope (always scopeMode "lead", always scoped to a single dept) instead
 * of being resolved from the database via resolveAdminScope.
 */
import { AdminSidebar } from "@/components/admin-sidebar"
import { AdminContextRibbon } from "@/components/admin-context-ribbon"
import { AdminScopeProvider } from "@/components/admin-scope-context"
import { SidebarContent } from "@/components/sidebar-content"
import type { ClientAdminScope } from "@/components/admin-scope-context"
import type { UserRole } from "@/types/database"

interface DeptLayoutProps {
  /** Serialisable admin-compatible scope (synthesised from DeptScope). */
  scope: ClientAdminScope
  user?: {
    email?: string
    user_metadata?: { first_name?: string; last_name?: string }
  }
  profile?: {
    first_name?: string
    last_name?: string
    department?: string
    role?: UserRole
    is_department_lead?: boolean
    admin_domains?: string[] | null
    lead_departments?: string[]
  }
  /** The dept name — shown in the context ribbon. */
  deptName: string
  children: React.ReactNode
}

export function DeptLayout({ scope, user, profile, deptName, children }: DeptLayoutProps) {
  return (
    <div className="admin-shell flex min-h-screen" data-scope="lead">
      <AdminSidebar user={user} profile={profile} adminScopeMode="lead" deptId={scope.managedDepartmentIds[0]} />
      <SidebarContent>
        <div className="min-h-screen bg-[var(--admin-content-bg)]">
          <AdminContextRibbon
            role={(profile?.role ?? "employee") as UserRole}
            department={deptName}
            scopeMode="lead"
            isAdminLike={scope.isAdminLike}
            managedDepartments={scope.managedDepartments}
          />
          <AdminScopeProvider scope={scope}>{children}</AdminScopeProvider>
        </div>
      </SidebarContent>
    </div>
  )
}
