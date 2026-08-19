import { redirect } from "next/navigation"
import { getRequestScope } from "@/lib/admin/api-scope"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getCbtSettings, canAccessCbt } from "@/lib/cbt-config"

/**
 * Server-level guard for the standalone /cbt test-taking page.
 * Access is restricted based on CBT Settings configuration.
 */
export default async function CbtLayout({ children }: { children: React.ReactNode }) {
  const scope = await getRequestScope()
  const supabase = await createClient()
  const db = getServiceRoleClientOrFallback(supabase)
  const cbtSettings = await getCbtSettings(db)

  const allowed = canAccessCbt(scope, cbtSettings)
  if (!allowed) {
    redirect("/pms")
  }

  return <>{children}</>
}
