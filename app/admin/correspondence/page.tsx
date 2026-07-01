import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { AdminReferenceGeneratorContent } from "../tools/reference-generator/admin-reference-generator-content"
import { getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import type { CorrespondenceRecord } from "@/types/correspondence"

async function getData() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { redirectTo: "/auth/login" as const }
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) {
    return { redirectTo: "/profile" as const }
  }

  const departmentScope = getDepartmentScope(scope, "general")

  const { data: records } = await dataClient
    .from("correspondence_records")
    .select("*")
    .order("created_at", { ascending: false })

  const scopedRecords =
    departmentScope && departmentScope.length > 0
      ? (records || []).filter(
          (record: CorrespondenceRecord) =>
            departmentScope.includes(record.department_name || "") ||
            departmentScope.includes(record.assigned_department_name || "")
        )
      : departmentScope
        ? []
        : records || []

  const recordsList = scopedRecords || []

  // Find unique department + year pairs for external records
  const deptYearPairs = new Map<string, { departmentCode: string; year: number }>()
  for (const r of recordsList) {
    if (r.letter_type === "external" && r.department_code && r.created_at) {
      const year = new Date(r.created_at).getFullYear()
      const key = `${r.department_code}:${year}`
      if (!deptYearPairs.has(key)) {
        deptYearPairs.set(key, { departmentCode: r.department_code, year })
      }
    }
  }

  // Fetch chronological sequences for each pair
  const sequenceMaps = new Map<string, Map<string, number>>()
  for (const [key, { departmentCode, year }] of deptYearPairs.entries()) {
    const startOfYear = `${year}-01-01T00:00:00.000Z`
    const endOfYear = `${year}-12-31T23:59:59.999Z`

    const { data: seqData } = await dataClient
      .from("correspondence_records")
      .select("id")
      .eq("department_code", departmentCode)
      .eq("letter_type", "external")
      .gte("created_at", startOfYear)
      .lte("created_at", endOfYear)
      .order("created_at", { ascending: true })

    const map = new Map<string, number>()
    if (seqData) {
      seqData.forEach((row, index) => {
        map.set(String(row.id), index + 1)
      })
    }
    sequenceMaps.set(key, map)
  }

  const enrichedRecords = recordsList.map((r) => {
    let simulated_sequence: number | null = null
    if (r.letter_type === "external" && r.department_code && r.created_at) {
      const year = new Date(r.created_at).getFullYear()
      const key = `${r.department_code}:${year}`
      const map = sequenceMaps.get(key)
      if (map) {
        simulated_sequence = map.get(String(r.id)) ?? null
      }
    }
    return {
      ...r,
      simulated_sequence,
    }
  })

  return { records: enrichedRecords }
}

export default async function AdminCorrespondencePage() {
  const data = await getData()

  if ("redirectTo" in data) {
    redirect(data.redirectTo || "/auth/login")
  }

  return <AdminReferenceGeneratorContent initialRecords={data.records} />
}
