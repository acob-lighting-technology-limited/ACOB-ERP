import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { GovernanceConsole } from "./_components/governance-console"

export default async function GovernancePage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) {
    redirect("/profile")
  }

  if (scope.role !== "developer" && scope.role !== "super_admin") {
    redirect("/admin/settings")
  }

  return <GovernanceConsole role={scope.role} />
}
