import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Brain } from "lucide-react"
import { getCbtSettings } from "@/lib/cbt-config"
import { CbtSettingsForm } from "./_components/cbt-settings-form"

export default async function CbtSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope || (scope.role !== "super_admin" && scope.role !== "developer")) {
    redirect("/admin/settings")
  }

  const db = getServiceRoleClientOrFallback(supabase)
  const initialSettings = await getCbtSettings(db)

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="CBT Assessment Settings"
        description="Manage default CBT session question counts, duration per question, and total exam timer calculation."
        icon={Brain}
        backLink={{ href: "/admin/settings", label: "Back to Settings" }}
      />
      <CbtSettingsForm initialSettings={initialSettings} />
    </PageWrapper>
  )
}
