import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { Sidebar } from "@/components/sidebar"
import { SidebarContent } from "@/components/sidebar-content"
import { NotFoundContent } from "@/components/not-found-content"

export default async function NotFound() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <NotFoundContent />
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()
  const canAccessAdmin = Boolean(await resolveAdminScope(supabase, user.id))

  const userData = {
    email: user.email,
    user_metadata: user.user_metadata,
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={userData} profile={profile || undefined} canAccessAdmin={canAccessAdmin} />
      <SidebarContent>
        <NotFoundContent />
      </SidebarContent>
    </div>
  )
}
