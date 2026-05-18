import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PortalReferenceGeneratorContent } from "../tools/reference-generator/portal-reference-generator-content"
import type { CorrespondenceRecord } from "@/types/correspondence"

interface DepartmentCodeOption {
  department_name: string
  department_code: string
}

interface ProfileRow {
  full_name: string | null
  first_name: string | null
  last_name: string | null
  department: string | null
  role: string | null
  lead_departments: string[] | null
  is_department_lead: boolean | null
}

async function getData() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { redirectTo: "/auth/login" as const }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, first_name, last_name, department, role, lead_departments, is_department_lead")
    .eq("id", user.id)
    .single<ProfileRow>()

  const currentViewerName =
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    user.email ||
    ""

  // User portal: only personal records (originator or responsible officer).
  // Admins and leads use /admin/correspondence to see scoped admin data.
  const { data: records } = await supabase
    .from("correspondence_records")
    .select("*")
    .or(`originator_id.eq.${user.id},responsible_officer_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<CorrespondenceRecord[]>()

  const role = profile?.role || ""
  const isDeptLead = Boolean(profile?.is_department_lead)
  const scopedRecords = records || []

  const { data: rawDepartments } = await supabase
    .from("departments")
    .select("name, department_code")
    .eq("is_active", true)
    .not("department_code", "is", null)
    .order("name", { ascending: true })

  const departmentCodes: DepartmentCodeOption[] = (rawDepartments || [])
    .filter((d): d is { name: string; department_code: string } => Boolean(d.department_code))
    .map((d) => ({ department_name: d.name, department_code: d.department_code }))

  return {
    currentViewerRole: role,
    isDepartmentLead: isDeptLead,
    currentViewerName,
    currentViewerId: user.id,
    currentViewerDepartment: profile?.department || "",
    records: scopedRecords || [],
    departmentCodes: departmentCodes || [],
  }
}

export default async function CorrespondencePage() {
  const data = await getData()

  if ("redirectTo" in data) {
    redirect(data.redirectTo || "/auth/login")
  }

  return (
    <PortalReferenceGeneratorContent
      currentViewerRole={data.currentViewerRole}
      isDepartmentLead={data.isDepartmentLead}
      currentViewerName={data.currentViewerName}
      currentViewerId={data.currentViewerId}
      currentViewerDepartment={data.currentViewerDepartment}
      initialRecords={data.records}
      departmentCodes={data.departmentCodes}
    />
  )
}
