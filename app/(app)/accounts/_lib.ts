import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export interface UserAccountsSummary {
  profile: {
    id: string
    firstName: string
    lastName: string
    department: string | null
  } | null
  requisitions: {
    totalCount: number
    pendingCount: number
  }
  payments: {
    totalCount: number
    dueCount: number
  }
  payroll: {
    latestNetSalary: number | null
    latestPeriodName: string | null
    latestStatus: string | null
  }
  assets: {
    assignedCount: number
  }
}

export async function getCurrentUserAccountsData(): Promise<UserAccountsSummary> {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, department, department_id")
    .eq("id", user.id)
    .maybeSingle()

  // Resolve user's department ID if missing
  let userDepartmentId = profile?.department_id || null
  if (!userDepartmentId && profile?.department) {
    const raw = String(profile.department).trim()
    const candidates = raw.toLowerCase() === "finance" ? ["Accounts", raw] : [raw]
    const { data: dept } = await dataClient
      .from("departments")
      .select("id")
      .in("name", candidates)
      .limit(1)
      .maybeSingle()
    if (dept) {
      userDepartmentId = dept.id
    }
  }

  const [{ data: userRequisitions }, { data: deptPayments }, { data: payrollEntries }, { data: assignedAssets }] =
    await Promise.all([
      dataClient.from("requisitions").select("id, status").eq("user_id", user.id),
      userDepartmentId
        ? dataClient.from("department_payments").select("id, status").eq("department_id", userDepartmentId)
        : Promise.resolve({ data: [] }),
      dataClient
        .from("payroll_entries")
        .select(
          `
        id,
        net_salary,
        status,
        payroll_periods:payroll_period_id (
          name,
          pay_date
        )
      `
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1),
      dataClient.from("asset_assignments").select("id").eq("assigned_to", user.id).eq("is_current", true),
    ])

  const requisitionsList = userRequisitions || []
  const pendingRequisitions = requisitionsList.filter((r) =>
    ["pending", "submitted", "in_review", "under_review"].includes(String(r.status || "").toLowerCase())
  ).length

  const paymentsList = deptPayments || []
  const duePayments = paymentsList.filter((p) =>
    ["due", "pending", "overdue"].includes(String(p.status || "").toLowerCase())
  ).length

  type PayrollPeriodRow = { name?: string | null; pay_date?: string | null }
  const latestEntry = payrollEntries?.[0] as
    | {
        net_salary?: number | null
        status?: string | null
        payroll_periods?: PayrollPeriodRow | PayrollPeriodRow[] | null
      }
    | undefined

  const periodObj = Array.isArray(latestEntry?.payroll_periods)
    ? latestEntry.payroll_periods[0]
    : latestEntry?.payroll_periods

  return {
    profile: profile
      ? {
          id: profile.id,
          firstName: profile.first_name || "",
          lastName: profile.last_name || "",
          department: profile.department,
        }
      : null,
    requisitions: {
      totalCount: requisitionsList.length,
      pendingCount: pendingRequisitions,
    },
    payments: {
      totalCount: paymentsList.length,
      dueCount: duePayments,
    },
    payroll: {
      latestNetSalary: typeof latestEntry?.net_salary === "number" ? latestEntry.net_salary : null,
      latestPeriodName: periodObj?.name || null,
      latestStatus: latestEntry?.status || null,
    },
    assets: {
      assignedCount: assignedAssets?.length || 0,
    },
  }
}
