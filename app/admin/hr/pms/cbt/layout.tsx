import { redirect } from "next/navigation"
import { getRequestScope } from "@/lib/admin/api-scope"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getCbtSettings, canAccessCbt } from "@/lib/cbt-config"

/**
 * Server-level guard for the CBT section.
 * Access is granted to super_admin, developer, or users/roles configured in CBT Settings.
 */
export default async function CbtLayout({ children }: { children: React.ReactNode }) {
  const scope = await getRequestScope()
  const supabase = await createClient()
  const db = getServiceRoleClientOrFallback(supabase)
  const cbtSettings = await getCbtSettings(db)

  const allowed = canAccessCbt(scope, cbtSettings)
  if (!allowed) {
    redirect("/admin/hr/pms")
  }

  return <>{children}</>
}
