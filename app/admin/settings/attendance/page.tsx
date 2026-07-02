import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Clock } from "lucide-react"
import { AttendancePolicy, DEFAULT_ATTENDANCE_POLICY } from "@/lib/org-config"
import { AttendanceForm } from "./_components/attendance-form"

export default async function AttendanceSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope || !scope.isAdminLike) {
    redirect("/admin/settings")
  }

  const { data: settingRow } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "attendance_policy")
    .maybeSingle()

  const initialPolicy = (settingRow?.value as AttendancePolicy) || DEFAULT_ATTENDANCE_POLICY

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Attendance Policy Settings"
        description="Configure workday start/end times, late grace period, and incomplete punch credit penalties."
        icon={Clock}
        backLink={{ href: "/admin/settings", label: "Back to Settings" }}
      />
      <div className="max-w-2xl mx-auto py-8">
        <AttendanceForm initialPolicy={initialPolicy} />
      </div>
    </PageWrapper>
  )
}
