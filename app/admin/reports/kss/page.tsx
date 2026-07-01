import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { KssRosterTable } from "@/components/reports/kss-roster-table"

export default async function AdminKssPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) redirect("/auth/login")

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_department_lead")
    .eq("id", user.id)
    .single()

  const role = String(profile?.role || "").toLowerCase()
  const isAllowed = ["developer", "super_admin", "admin"].includes(role) || profile?.is_department_lead === true
  if (!isAllowed) redirect("/admin/reports/general-meeting")

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name, department, employment_status")
    .order("full_name")

  return (
    <KssRosterTable
      employees={(employees || []).map(
        (e: { id: string; full_name: string; department: string | null; employment_status?: string | null }) => ({
          id: e.id,
          full_name: e.full_name,
          department: e.department,
          employment_status: e.employment_status || null,
        })
      )}
      backHref="/admin/reports/general-meeting"
      backLabel="Back to General Meeting"
      title="Knowledge Sharing Session"
      currentUserId={user.id}
      currentUserRole={role}
      enableScoring
    />
  )
}
