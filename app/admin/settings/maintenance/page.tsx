import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Wrench } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MaintenanceToggle } from "@/components/admin/maintenance-toggle"
import { canManageMaintenanceMode, parseMaintenanceMode } from "@/lib/maintenance"
import { formatWATDateTime } from "@/lib/utils/date"

export default async function SettingsMaintenancePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (!canManageMaintenanceMode(profile?.role)) redirect("/admin/settings")

  const { data: settings } = await supabase
    .from("system_settings")
    .select("value, updated_at, updated_by")
    .eq("key", "maintenance_mode")
    .single()

  const updatedBy = settings?.updated_by
    ? await supabase
        .from("profiles")
        .select("first_name, last_name, company_email")
        .eq("id", settings.updated_by)
        .single()
    : null

  const { enabled } = parseMaintenanceMode(settings?.value)

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Maintenance Control"
        description="Super admins and developers can toggle maintenance mode."
        icon={Wrench}
        backLink={{ href: "/admin/settings", label: "Back to Settings" }}
      />

      <Card>
        <CardHeader>
          <CardTitle>System Maintenance Mode</CardTitle>
          <CardDescription>When enabled, only super admins and developers can access non-auth pages.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <MaintenanceToggle />
          <div className="space-y-2 rounded-md border p-4 text-sm">
            <p>
              <span className="font-medium">Current status:</span> {enabled ? "Enabled" : "Disabled"}
            </p>
            <p>
              <span className="font-medium">Last updated:</span>{" "}
              {settings?.updated_at ? formatWATDateTime(settings.updated_at) : "Unknown"}
            </p>
            <p>
              <span className="font-medium">Updated by:</span>{" "}
              {updatedBy?.data
                ? `${updatedBy.data.first_name || ""} ${updatedBy.data.last_name || ""}`.trim() ||
                  updatedBy.data.company_email
                : "Unknown"}
            </p>
          </div>
        </CardContent>
      </Card>
    </PageWrapper>
  )
}
