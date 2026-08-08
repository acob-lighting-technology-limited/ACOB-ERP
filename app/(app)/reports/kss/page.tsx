import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { KssRosterTable } from "@/components/reports/kss-roster-table"

export default async function DashboardKssPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) redirect("/auth/login")

  // staff_directory, not profiles: RLS limits a plain employee to their own
  // profile row, which left every presenter and submitter rendering "Unknown".
  const { data: employees } = await supabase
    .from("staff_directory")
    .select("id, full_name, department, employment_status")
    .order("full_name")
  const employeeRows = (employees || []) as Array<{
    id: string
    full_name: string
    department: string | null
    employment_status: string | null
  }>

  return (
    <KssRosterTable
      employees={employeeRows.map((e) => ({
        id: e.id,
        full_name: e.full_name,
        department: e.department,
        employment_status: e.employment_status,
      }))}
      backHref="/reports/general-meeting"
      backLabel="Back to General Meeting"
      title="Knowledge Sharing Session"
      currentUserId={user.id}
      readOnly
    />
  )
}
