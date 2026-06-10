import type { Metadata } from "next"
import { DeptLayout } from "@/components/dept-layout"
import { AcoBot } from "@/components/acobot/acobot"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { createClient } from "@/lib/supabase/server"
import { ErrorBoundary } from "@/components/error-boundary"
import type { ClientAdminScope } from "@/components/admin-scope-context"
import type { UserRole } from "@/types/database"

export const metadata: Metadata = {
  title: "Dept Console | ACOB Lighting Technology Limited",
  description: "Department lead console — manage your team, approvals, and operations.",
}

interface DeptLayoutPageProps {
  children: React.ReactNode
  params: Promise<{ dept_id: string }>
}

export default async function DeptLayoutPage({ children, params }: DeptLayoutPageProps) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const { data: profile } = authData?.user
    ? await supabase
        .from("profiles")
        .select("first_name, last_name, department, role, is_department_lead, admin_routes, lead_departments")
        .eq("id", authData.user.id)
        .single()
    : { data: null }

  const userData = authData?.user
    ? { email: authData.user.email, user_metadata: authData.user.user_metadata }
    : undefined

  /**
   * Synthesise a ClientAdminScope from DeptScope.
   * scopeMode is always "lead" — the dept surface is always dept-scoped.
   */
  const clientScope: ClientAdminScope = {
    userId: scope.userId,
    role: scope.role,
    scopeMode: "lead",
    managedDepartments: [scope.deptName],
    managedDepartmentIds: [scope.deptId],
    isDepartmentLead: true,
    isAdminLike: scope.isAdminLike,
  }

  // Profile shape for AdminSidebar — augment with lead info so the sidebar
  // filters nav items correctly for this user's role.
  const sidebarProfile = profile
    ? {
        first_name: profile.first_name ?? undefined,
        last_name: profile.last_name ?? undefined,
        department: scope.deptName, // always show the dept this console is for
        role: (profile.role ?? "employee") as UserRole,
        is_department_lead: true,
        admin_routes: (profile.admin_routes as string[] | null) ?? null,
        lead_departments: [scope.deptName],
      }
    : undefined

  return (
    <>
      <DeptLayout scope={clientScope} user={userData} profile={sidebarProfile} deptName={scope.deptName}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </DeptLayout>
      <AcoBot userName={profile?.first_name ?? null} />
    </>
  )
}
