import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { PaymentsTable } from "@/components/payments/payments-table"

interface Payment {
  id: string
  department_id: string
  title: string
  amount: number
  currency: string
  status: "due" | "paid" | "overdue" | "cancelled"
  payment_type: "one-time" | "recurring"
  recurrence_period?: "monthly" | "quarterly" | "yearly"
  next_payment_due?: string
  payment_date?: string
  category: string
  description?: string
  issuer_name?: string
  issuer_phone_number?: string
  issuer_address?: string
  payment_reference?: string
  amount_paid?: number
  created_at: string
  department?: { name: string }
  documents?: { id: string; document_type: string; file_path: string; file_name?: string; applicable_date?: string }[]
}

interface Department {
  id: string
  name: string
}

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAccountsPaymentsPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)

  const { data: deptRow } = await dataClient.from("departments").select("id, name").eq("name", deptName).single()

  const departmentIds = deptRow ? [deptRow.id] : []

  const { data: payments } =
    departmentIds.length > 0
      ? await dataClient
          .from("department_payments")
          .select(
            "*, department:departments(name), documents:payment_documents(id, document_type, file_path, file_name, applicable_date)"
          )
          .in("department_id", departmentIds)
          .order("created_at", { ascending: false })
      : { data: [] as Payment[] }

  const departments: Department[] = deptRow ? [{ id: deptRow.id, name: deptRow.name }] : []

  const { data: authData } = await supabase.auth.getUser()

  return (
    <PaymentsTable
      initialPayments={(payments || []) as Payment[]}
      initialDepartments={departments}
      currentUser={{
        id: authData.user?.id ?? scope.userId,
        department_id: deptRow?.id ?? null,
        isAdmin: scope.isAdminLike,
      }}
      basePath={`/dept/${dept_id}/accounts/payments`}
    />
  )
}
