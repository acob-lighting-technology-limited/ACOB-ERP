import type { SupabaseClient } from "@supabase/supabase-js"
import type { UserRole } from "@/types/database"
import type {
  AccessDecisionTrace,
  AccessPath,
  ApprovalChainPreviewResponse,
  ApprovalWorkflow,
  ApprovalWorkflowStage,
  ModuleCode,
} from "@/types/governance"

const LEGACY_MODULE_COMPAT: Record<string, ModuleCode> = {
  pms_kpi: "pms_kpi_scoring",
}

export async function getWorkflows(
  supabase: SupabaseClient,
  moduleCode?: ModuleCode,
  requesterKind?: string
): Promise<ApprovalWorkflow[]> {
  let query = (supabase.from("approval_workflows") as any).select("*").order("module_code").order("requester_kind")
  if (moduleCode) {
    const code = LEGACY_MODULE_COMPAT[moduleCode] || moduleCode
    query = query.eq("module_code", code)
  }
  if (requesterKind) query = query.eq("requester_kind", requesterKind)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as unknown as ApprovalWorkflow[]
}

export async function getWorkflowStages(
  supabase: SupabaseClient,
  workflowId: string
): Promise<ApprovalWorkflowStage[]> {
  const { data, error } = await (supabase.from("approval_workflow_stages") as any)
    .select("*")
    .eq("workflow_id", workflowId)
    .order("stage_order")

  if (error) throw error

  return ((data || []) as Array<Record<string, unknown>>).map((row) => {
    const resolutionConfig = (row.resolution_config || {}) as Record<string, unknown>
    const defaultTarget =
      resolutionConfig.approver_target && typeof resolutionConfig.approver_target === "object"
        ? (resolutionConfig.approver_target as Record<string, unknown>)
        : { target_type: "department_lead" }

    return {
      ...(row as unknown as ApprovalWorkflowStage),
      approver_target: (row.approver_target as ApprovalWorkflowStage["approver_target"]) || {
        target_type: String(
          defaultTarget.target_type || "department_lead"
        ) as ApprovalWorkflowStage["approver_target"]["target_type"],
        role_code: typeof defaultTarget.role_code === "string" ? (defaultTarget.role_code as UserRole) : undefined,
        department_id: typeof defaultTarget.department_id === "string" ? defaultTarget.department_id : undefined,
      },
      bypass_roles: (row.bypass_roles as ApprovalWorkflowStage["bypass_roles"]) || [],
      reliever_scope: (row.reliever_scope as ApprovalWorkflowStage["reliever_scope"]) || "same_department",
    }
  })
}

export async function simulateApprovalChain(
  supabase: SupabaseClient,
  moduleCode: ModuleCode,
  requesterKind: string,
  department: string | null
): Promise<ApprovalChainPreviewResponse> {
  const normalizedModuleCode = LEGACY_MODULE_COMPAT[moduleCode] || moduleCode

  const { data: stages, error: stagesError } = await (supabase.rpc as any)("get_workflow_stages", {
    p_module_code: normalizedModuleCode,
    p_requester_kind: requesterKind,
  })

  if (stagesError) throw stagesError

  const steps: ApprovalChainPreviewResponse["steps"] = []
  for (const stage of (stages as Array<{ stage_order: number }> | null) || []) {
    const { data: resolved, error: resolveError } = await (supabase.rpc as any)("resolve_next_approver", {
      p_module_code: normalizedModuleCode,
      p_requester_kind: requesterKind,
      p_current_stage_order: stage.stage_order - 1,
      p_department: department,
    })

    if (resolveError) throw resolveError
    const row = (
      resolved as Array<{
        next_stage_order: number
        next_stage_code: string
        approver_role_code: string | null
        approver_user_id: string | null
        resolution_mode: "fixed_user" | "department_lead" | "rule_based"
      }> | null
    )?.[0]
    if (!row) continue

    steps.push({
      stage_order: row.next_stage_order,
      stage_code: row.next_stage_code,
      approver_role_code: row.approver_role_code,
      approver_user_id: row.approver_user_id,
      resolution_mode: row.resolution_mode,
    })
  }

  return {
    module_code: normalizedModuleCode,
    requester_kind: requesterKind,
    department,
    steps,
  }
}

export async function getAccessPaths(supabase: SupabaseClient): Promise<AccessPath[]> {
  const { data, error } = await (supabase.from("access_paths") as any)
    .select("*")
    .order("priority", { ascending: true })
  if (error) throw error
  return (data || []) as unknown as AccessPath[]
}

export async function simulatePathAccess(
  supabase: SupabaseClient,
  role: UserRole,
  path: string,
  method: string
): Promise<AccessDecisionTrace> {
  const { data, error } = await (supabase.rpc as any)("is_path_allowed", {
    p_user_role: role,
    p_path: path,
    p_method: method,
  })

  if (error) throw error

  return {
    role,
    path,
    method,
    allowed: Boolean(data),
  }
}
