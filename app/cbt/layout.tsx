import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getCbtSettings, canAccessCbt, resolveCbtAccessScope } from "@/lib/cbt-config"

/**
 * Server-level guard for the standalone /cbt test-taking page.
 *
 * Access is driven entirely by CBT Settings (/admin/settings/cbt): super_admin
 * and developer always pass, everyone else must be granted by role or by name.
 * The scope is resolved from the profile row rather than the admin scope so a
 * plain employee who has been granted access actually gets it.
 */
export default async function CbtLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login?next=/cbt")
  }

  const db = getServiceRoleClientOrFallback(supabase)
  const [scope, cbtSettings] = await Promise.all([resolveCbtAccessScope(db, user.id), getCbtSettings(db)])

  if (!canAccessCbt(scope, cbtSettings)) {
    redirect("/pms")
  }

  return <>{children}</>
}
