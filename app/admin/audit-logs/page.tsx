import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AdminAuditLogsContent, type AuditLog, type UserProfile } from "./admin-audit-logs-content"
import type { EmployeeMember as employeeMember } from "./types"
import { expandDepartmentScopeForQuery, getDepartmentScope, resolveAdminScope } from "@/lib/admin/rbac"
import { normalizeAuditAction } from "@/lib/audit/core"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

import { logger } from "@/lib/logger"

const log = logger("audit-logs")

type AuditLogsRpcClient = {
  rpc: (
    fn: "get_audit_logs_enriched",
    args: {
      p_limit: number
      p_offset: number
      p_hidden_actions: string[]
      p_department_filter: string[] | null
    }
  ) => Promise<{ data: unknown[] | null; error: unknown }>
}

type AuditLogsData =
  | { kind: "redirect"; redirect: string }
  | {
      kind: "data"
      logs: AuditLog[]
      totalCount: number
      employee: employeeMember[]
      departments: string[]
      userProfile: UserProfile
    }

async function getAuditLogsData(): Promise<AuditLogsData> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { kind: "redirect", redirect: "/auth/login" }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = await resolveAdminScope(supabase as any, user.id)
  if (!scope) {
    return { kind: "redirect", redirect: "/profile" }
  }
  if (!["developer", "super_admin"].includes(String(scope.role || "").toLowerCase())) {
    return { kind: "redirect", redirect: "/admin" }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataClient = getServiceRoleClientOrFallback(supabase as any)
  const auditLogsRpcClient = dataClient as unknown as AuditLogsRpcClient
  const departmentScope = getDepartmentScope(scope, "general")
  const queryDepartmentScope = departmentScope ? expandDepartmentScopeForQuery(departmentScope) : null

  const userProfile: UserProfile = {
    role: scope.role,
    lead_departments: scope.leadDepartments,
    managed_departments: scope.managedDepartments,
  }

  // Single enriched RPC call (replaces 13 sequential queries)
  const { data: rpcRows, error: rpcError } = await auditLogsRpcClient.rpc("get_audit_logs_enriched", {
    p_limit: 500,
    p_offset: 0,
    p_hidden_actions: ["sync", "migrate", "update_schema", "migration"],
    p_department_filter: queryDepartmentScope ?? null,
  })

  if (rpcError) {
    log.error("get_audit_logs_enriched RPC error:", rpcError)
    return { kind: "data", logs: [], totalCount: 0, employee: [], departments: [], userProfile }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (rpcRows ?? []) as any[]
  const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0

  // Map RPC rows → AuditLog shape expected by the client component.
  // Supports both the newer JSONB-column format (user_data, target_user_data…)
  // and the older flat-column format (actor_first_name, actor_last_name…).
  const logs: AuditLog[] = rows.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any) => {
      const rawAction = row.action || "update"
      const normalizedAction = normalizeAuditAction(rawAction).action
      const metadata = {
        ...(row.metadata || {}),
        ...(row.metadata?.event ? {} : rawAction !== normalizedAction ? { event: rawAction } : {}),
      }

      // -- actor (performed-by) user -----------------------------------------
      // Prefer JSONB user_data (new RPC); fall back to flat actor_* columns (old RPC).
      const user =
        row.user_data ??
        (row.actor_first_name || row.actor_last_name
          ? {
              first_name: row.actor_first_name ?? "",
              last_name: row.actor_last_name ?? "",
              company_email: row.actor_email ?? "",
              employee_number: row.actor_employee_no ?? undefined,
            }
          : null)

      // -- target user --------------------------------------------------------
      const target_user =
        row.target_user_data ??
        (row.target_first_name || row.target_last_name
          ? {
              first_name: row.target_first_name ?? "",
              last_name: row.target_last_name ?? "",
              company_email: row.target_email ?? "",
              employee_number: row.target_employee_no ?? undefined,
            }
          : null)

      // -- task ---------------------------------------------------------------
      const task_info = row.task_info ?? (row.task_title ? { title: row.task_title } : null)

      // -- asset --------------------------------------------------------------
      const asset_info =
        row.asset_info ??
        (row.asset_name
          ? {
              asset_name: row.asset_name,
              unique_code: row.asset_unique_code ?? undefined,
              serial_number: row.asset_serial ?? undefined,
              assigned_to: row.asset_assigned_to ?? undefined,
              assigned_to_user:
                row.asset_assignee_first_name || row.asset_assignee_last_name
                  ? {
                      first_name: row.asset_assignee_first_name ?? "",
                      last_name: row.asset_assignee_last_name ?? "",
                    }
                  : undefined,
            }
          : null)

      // -- payment ------------------------------------------------------------
      const payment_info =
        row.payment_info ??
        (row.payment_title
          ? { title: row.payment_title, amount: 0, currency: "", department_name: row.payment_dept_name ?? undefined }
          : null)

      // -- document -----------------------------------------------------------
      const document_info =
        row.document_info ??
        (row.doc_file_name
          ? { file_name: row.doc_file_name, document_type: "", department_name: row.doc_dept_name ?? undefined }
          : null)

      // -- department ---------------------------------------------------------
      const department_info = row.department_info ?? (row.dept_name ? { name: row.dept_name } : null)

      // -- category -----------------------------------------------------------
      const category_info = row.category_info ?? (row.category_name ? { name: row.category_name } : null)

      // -- leave request ------------------------------------------------------
      const leave_request_info =
        row.leave_request_info ??
        (row.leave_type_name
          ? {
              user_id: row.user_id ?? "",
              leave_type_name: row.leave_type_name,
              requester_user:
                row.leave_requester_first_name || row.leave_requester_last_name
                  ? {
                      first_name: row.leave_requester_first_name ?? "",
                      last_name: row.leave_requester_last_name ?? "",
                    }
                  : undefined,
            }
          : null)

      // -- device -------------------------------------------------------------
      const device_info = row.device_info ?? (row.device_name ? { device_name: row.device_name } : null)

      return {
        id: row.id,
        user_id: row.user_id,
        action: normalizedAction,
        entity_type: (row.entity_type || "unknown").toLowerCase(),
        entity_id: row.entity_id ?? null,
        old_values: row.old_values ?? {},
        new_values: row.new_values ?? {},
        metadata,
        created_at: row.created_at,
        department: row.department ?? null,
        changed_fields: row.changed_fields ?? [],
        user,
        target_user,
        task_info,
        asset_info,
        payment_info,
        document_info,
        department_info,
        category_info,
        leave_request_info,
        device_info,
      }
    }
  )

  // Employees for filter dropdown
  let employeeQuery = dataClient
    .from("profiles")
    .select("id, first_name, last_name, department")
    .order("last_name", { ascending: true })
  if (departmentScope) {
    employeeQuery =
      queryDepartmentScope && queryDepartmentScope.length > 0
        ? employeeQuery.in("department", queryDepartmentScope)
        : employeeQuery.eq("id", "__none__")
  }
  const { data: employeeData } = await employeeQuery
  const employee = (employeeData ?? []) as employeeMember[]

  // Departments
  let departments: string[]
  if (departmentScope) {
    departments = [...departmentScope].sort()
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employeeDepartments = employee.map((s) => s.department).filter(Boolean)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logDepartments = rows.map((r: any) => r.department).filter(Boolean)
    departments = Array.from(new Set([...employeeDepartments, ...logDepartments])).sort() as string[]
  }

  return { kind: "data", logs, totalCount, employee, departments, userProfile }
}

export default async function AuditLogsPage() {
  const data = await getAuditLogsData()

  if (data.kind === "redirect") {
    redirect(data.redirect)
  }

  const { logs, totalCount, employee, departments, userProfile } = data

  return (
    <AdminAuditLogsContent
      initialLogs={logs}
      initialTotalCount={totalCount}
      initialemployee={employee}
      initialDepartments={departments}
      userProfile={userProfile}
    />
  )
}
