import { Sidebar } from "@/components/sidebar"
import { SidebarContent } from "@/components/sidebar-content"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

interface AppLayoutProps {
  children: React.ReactNode
}

export async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient()
  const typedSupabase = supabase as SupabaseClient<Database>
  const { data, error } = await supabase.auth.getUser()

  if (error || !data?.user) {
    redirect("/auth/login")
  }

  // Fetch user profile
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single()
  const adminScope = await resolveAdminScope(typedSupabase, data.user.id)
  const canAccessAdmin = Boolean(adminScope)

  // Compute deptConsoleHref for any user who is a dept lead — pure leads AND admin+lead.
  // Both surfaces are useful independently: admin = global ops, dept = scoped view.
  let deptConsoleHref: string | undefined
  if (profile?.is_department_lead) {
    const leadDepts: string[] = Array.isArray(profile.lead_departments) ? profile.lead_departments : []
    const primaryDeptName = leadDepts[0] ?? profile.department
    if (primaryDeptName) {
      const normalized = normalizeDepartmentName(primaryDeptName)
      const { data: deptRow } = await supabase.from("departments").select("id").eq("name", normalized).single()
      if (deptRow?.id) {
        deptConsoleHref = `/dept/${deptRow.id}`
      }
    }
  }

  const userData = {
    email: data.user.email,
    user_metadata: data.user.user_metadata,
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={userData}
        profile={profile || undefined}
        canAccessAdmin={canAccessAdmin}
        deptConsoleHref={deptConsoleHref}
      />
      <SidebarContent>{children}</SidebarContent>
    </div>
  )
}
