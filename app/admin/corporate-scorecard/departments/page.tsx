import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { DepartmentCascadeContent } from "../_components/department-cascade-content"

export const metadata: Metadata = {
  title: "Department Cascade | Corporate Scorecard",
  description: "One department's KPIs, targets and recorded progress against the 2026 plan.",
}

type DbClient = Awaited<ReturnType<typeof createClient>>

export default async function DepartmentCascadePage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>
}) {
  const { department } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect("/auth/login")

  const scope = await resolveAdminScope(supabase as DbClient, user.id)
  if (!scope) redirect("/profile")

  const { data: departmentRows } = await supabase.from("departments").select("name").eq("is_active", true).order("name")

  return (
    <DepartmentCascadeContent
      departments={(departmentRows || []).map((d) => d.name)}
      initialDepartment={department || null}
    />
  )
}
