import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { LunchRegisterPage } from "@/app/admin/hr/lunch/view"

export const dynamic = "force-dynamic"

export default async function Page() {
  const supabase = await createClient()
  const scope = await getRequestScope()
  if (!scope?.isAdminLike) {
    return <div className="text-muted-foreground p-8 text-center">Access Denied</div>
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)

  // Get today's local date (e.g. 2026-07-16)
  const today = new Date().toLocaleDateString("en-CA") // YYYY-MM-DD format

  const [employeesRes, logsRes, settingsRes] = await Promise.all([
    dataClient
      .from("profiles")
      .select("id, full_name, employee_number, department")
      .eq("employment_status", "active")
      .order("full_name"),
    dataClient.from("attendance_lunch_log").select("user_id").eq("date", today),
    dataClient.from("system_settings").select("value").eq("key", "lunch_settings").maybeSingle(),
  ])

  const employees = employeesRes.data || []
  const initialAteUserIds = logsRes.data?.map((l) => l.user_id) || []
  const initialSettings = settingsRes.data?.value || { cost: 2200, subsidy_percent: 50 }

  return (
    <LunchRegisterPage
      initialEmployees={employees}
      initialAteUserIds={initialAteUserIds}
      initialSettings={initialSettings}
      todayDate={today}
    />
  )
}
