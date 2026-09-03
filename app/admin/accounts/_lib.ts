import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"

export interface AdminAccountsSummary {
  requisitions: {
    total: number
    pending: number
  }
  payments: {
    total: number
    due: number
  }
  bills: {
    total: number
    unpaid: number
  }
  invoices: {
    total: number
    outstanding: number
  }
  assets: {
    total: number
  }
}

export async function getAdminAccountsData(lockedDepartmentId?: string): Promise<AdminAccountsSummary> {
  const supabase = await createClient()
  const db = getServiceRoleClientOrFallback(supabase)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const scope = await getRequestScope()
  if (!scope && !lockedDepartmentId) {
    redirect("/profile")
  }

  let scopedDepts: string[] | null = null
  const departmentIdFilter: string | null = lockedDepartmentId || null

  if (lockedDepartmentId) {
    // Resolve department name for department_payments / requisitions if needed
    const { data: dept } = await db.from("departments").select("id, name").eq("id", lockedDepartmentId).maybeSingle()
    if (dept?.name) {
      scopedDepts = [dept.name]
    }
  } else if (scope) {
    scopedDepts = getScopedDepartments(scope)
  }

  // 1. Requisitions Query
  let reqQuery = db.from("requisitions").select("id, status, department")
  if (scopedDepts !== null) {
    if (scopedDepts.length === 0) {
      reqQuery = reqQuery.in("department", ["__none__"])
    } else {
      reqQuery = reqQuery.in("department", scopedDepts)
    }
  }

  // 2. Department Payments Query
  let payQuery = db.from("department_payments").select("id, status, department_id")
  if (departmentIdFilter) {
    payQuery = payQuery.eq("department_id", departmentIdFilter)
  } else if (scopedDepts !== null) {
    if (scopedDepts.length === 0) {
      payQuery = payQuery.eq("department_id", "__none__")
    } else {
      // Find department IDs matching scoped names
      const { data: depts } = await db.from("departments").select("id").in("name", scopedDepts)
      const deptIds = (depts || []).map((d) => d.id)
      if (deptIds.length > 0) {
        payQuery = payQuery.in("department_id", deptIds)
      } else {
        payQuery = payQuery.eq("department_id", "__none__")
      }
    }
  }

  // 3. Bills Query
  const billsQuery = db.from("bills").select("id, status")

  // 4. Invoices Query
  const invoicesQuery = db.from("invoices").select("id, status")

  // 5. Assets Query
  let assetsQuery = db.from("assets").select("id, department")
  if (scopedDepts !== null) {
    if (scopedDepts.length === 0) {
      assetsQuery = assetsQuery.in("department", ["__none__"])
    } else {
      assetsQuery = assetsQuery.in("department", scopedDepts)
    }
  }

  type ReqRow = { id: string; status: string | null; department?: string | null }
  type PayRow = { id: string; status: string | null; department_id?: string | null }
  type BillRow = { id: string; status: string | null }
  type InvoiceRow = { id: string; status: string | null }
  type AssetRow = { id: string; department?: string | null }

  const [{ data: reqData }, { data: payData }, { data: billsData }, { data: invoicesData }, { data: assetsData }] =
    await Promise.all([
      reqQuery.returns<ReqRow[]>(),
      payQuery.returns<PayRow[]>(),
      billsQuery.returns<BillRow[]>(),
      invoicesQuery.returns<InvoiceRow[]>(),
      assetsQuery.returns<AssetRow[]>(),
    ])

  const requisitions = reqData || []
  const pendingRequisitions = requisitions.filter((r) =>
    ["pending", "submitted", "in_review", "under_review"].includes(String(r.status || "").toLowerCase())
  ).length

  const payments = payData || []
  const duePayments = payments.filter((p) =>
    ["due", "pending", "overdue"].includes(String(p.status || "").toLowerCase())
  ).length

  const bills = billsData || []
  const unpaidBills = bills.filter((b) =>
    ["pending", "due", "overdue", "unpaid", "partially_paid"].includes(String(b.status || "").toLowerCase())
  ).length

  const invoices = invoicesData || []
  const outstandingInvoices = invoices.filter((inv) =>
    ["sent", "overdue", "unpaid", "partially_paid", "pending"].includes(String(inv.status || "").toLowerCase())
  ).length

  const assets = assetsData || []

  return {
    requisitions: {
      total: requisitions.length,
      pending: pendingRequisitions,
    },
    payments: {
      total: payments.length,
      due: duePayments,
    },
    bills: {
      total: bills.length,
      unpaid: unpaidBills,
    },
    invoices: {
      total: invoices.length,
      outstanding: outstandingInvoices,
    },
    assets: {
      total: assets.length,
    },
  }
}
