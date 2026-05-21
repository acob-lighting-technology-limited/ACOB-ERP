import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CommunicationsComposer } from "@/app/admin/communications/_components/communications-composer"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"

export default async function CommunicationsMeetingsRemindersPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, department")
    .eq("id", user.id)
    .single()

  if (!profile || !["developer", "super_admin", "admin"].includes(profile.role)) {
    redirect("/profile")
  }

  const { data: employees } = await supabase
    .from("profiles")
    .select(
      "id, full_name, company_email, additional_email, department, designation, employment_status, is_department_lead, gender"
    )
    .or("company_email.not.is.null,additional_email.not.is.null")
    .order("full_name")

  const assignableEmployees = (employees || []).filter((employee) =>
    isAssignableEmploymentStatus(employee.employment_status, { allowLegacyNullStatus: false })
  )

  return (
    <CommunicationsComposer
      employees={assignableEmployees}
      mode="meetings"
      currentUser={{
        id: user.id,
        full_name: profile?.full_name || null,
        department: profile?.department || null,
      }}
    />
  )
}
