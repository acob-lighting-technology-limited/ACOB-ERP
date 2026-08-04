import { NextResponse } from "next/server"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { normalizeDepartmentName } from "@/shared/departments"

export const dynamic = "force-dynamic"

type PaymentRow = {
  id: string
  title: string
  amount: number | null
  category: string | null
  created_at: string
  status: string | null
  currency: string | null
  department?: { name?: string | null } | null
}

// Shared between /admin/finance/reports (org-wide) and /dept/[id]/finance/reports
// (single-department, via getScopedDepartments — no client-side lock needed).
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  const db = getServiceRoleClientOrFallback(supabase)

  const depts = getScopedDepartments(scope)
  if (depts !== null && depts.length === 0) return NextResponse.json({ data: [] })

  const { data, error } = await db
    .from("department_payments")
    .select("id, title, amount, category, created_at, status, currency, department:departments(name)")
    .order("created_at", { ascending: false })

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const normalizedDepts = depts?.map((d) => normalizeDepartmentName(d))

  const rows = ((data ?? []) as PaymentRow[])
    .map((payment) => ({
      id: payment.id,
      title: payment.title,
      amount: payment.amount || 0,
      category: payment.category || "Other",
      created_at: payment.created_at,
      department_name: payment.department?.name || "Unknown",
      status: payment.status || "unknown",
      currency: payment.currency || "NGN",
    }))
    // depts === null means unrestricted (global admin) — no filter applied.
    .filter((payment) => !normalizedDepts || normalizedDepts.includes(normalizeDepartmentName(payment.department_name)))

  return NextResponse.json({ data: rows })
}
