import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { CommunicationsComposer } from "@/app/admin/communications/_components/communications-composer"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptBroadcastPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const { data: profile } = await dataClient
    .from("profiles")
    .select("role, full_name, department, company_email, additional_email")
    .eq("id", user.id)
    .single()

  if (!profile) {
    redirect(`/dept/${dept_id}/communications`)
  }

  // Fetch all org employees so the lead can broadcast org-wide
  const { data: employees } = await dataClient
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
      mode="communications"
      currentUser={{
        id: user.id,
        full_name: profile?.full_name || null,
        department: profile?.department || scope.deptName,
        email: profile?.company_email || profile?.additional_email || user.email || null,
      }}
    />
  )
}
