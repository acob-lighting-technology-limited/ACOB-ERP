import { NextResponse } from "next/server"
import { createGovernanceClient, requireGovernanceActor } from "@/lib/governance/auth"
import { getWorkflowStages } from "@/lib/governance/resolver"
import { isGovernanceSetupMissing } from "@/lib/governance/errors"
import type { ApproverTargetConfig, BypassRoleRule, RelieverScopePreset } from "@/types/governance"

function normalizeStageCode(input: string): string {
  const code = input.trim().toLowerCase()
  if (code === "pending_md") return "lead_executive_management"
  if (code === "hcs") return "lead_corporate_services"
  return code
}

function mapResolutionMode(targetType: ApproverTargetConfig["target_type"]) {
  if (targetType === "department_lead") return "department_lead"
  if (targetType === "role") return "fixed_user"
  return "rule_based"
}

function parseRelieverScope(value: unknown): RelieverScopePreset {
  const allowed: RelieverScopePreset[] = [
    "same_department",
    "cross_department",
    "all_departments",
    "leads_only",
    "everyone",
  ]
  if (typeof value === "string" && allowed.includes(value as RelieverScopePreset)) {
    return value as RelieverScopePreset
  }
  return "same_department"
}

export async function GET(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "read")
    if (actor instanceof NextResponse) return actor

    const { searchParams } = new URL(request.url)
    const stageId = searchParams.get("id")
    if (stageId) {
      const { data, error } = await ((admin as any).from("approval_workflow_stages") as any)
        .select("*")
        .eq("id", stageId)
        .single()
      if (error) throw error
      return NextResponse.json({ data })
    }

    const workflowId = searchParams.get("workflow_id")
    if (!workflowId) {
      return NextResponse.json({ error: "workflow_id or id is required" }, { status: 400 })
    }

    const data = await getWorkflowStages(admin as any, workflowId)
    return NextResponse.json({ data })
  } catch (error) {
    if (isGovernanceSetupMissing(error)) {
      return NextResponse.json(
        {
          data: [],
          warning:
            "Governance schema is not available in this database yet. Apply migration: 20260429110000_unified_approval_governance.sql",
        },
        { status: 200 }
      )
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "mutate")
    if (actor instanceof NextResponse) return actor

    const payload = await request.json()

    const approverTarget = (payload.approver_target || { target_type: "department_lead" }) as ApproverTargetConfig
    const relieverScope = parseRelieverScope(payload.reliever_scope)
    const bypassRoles = (payload.bypass_roles || []) as BypassRoleRule[]
    const stageCode = normalizeStageCode(payload.stage_code)

    const insertPayload: Record<string, unknown> = {
      workflow_id: payload.workflow_id,
      stage_order: payload.stage_order,
      stage_code: stageCode,
      stage_name: payload.stage_name,
      approver_role_code: approverTarget.role_code ?? payload.approver_role_code ?? null,
      approver_resolution_mode: mapResolutionMode(approverTarget.target_type),
      resolution_config: payload.resolution_config ?? {},
      approver_target: approverTarget,
      bypass_roles: bypassRoles,
      reliever_scope: relieverScope,
      is_active: payload.is_active ?? true,
    }

    let { data, error } = await ((admin as any).from("approval_workflow_stages") as any)
      .insert(insertPayload)
      .select("*")
      .single()

    // Backward compatibility if v2 columns are not yet applied on DB.
    if (
      error &&
      String(error.message || "")
        .toLowerCase()
        .includes("column")
    ) {
      const legacyPayload = { ...insertPayload }
      delete legacyPayload.approver_target
      delete legacyPayload.bypass_roles
      delete legacyPayload.reliever_scope
      ;({ data, error } = await ((admin as any).from("approval_workflow_stages") as any)
        .insert(legacyPayload)
        .select("*")
        .single())
    }

    if (error) throw error
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "mutate")
    if (actor instanceof NextResponse) return actor

    const payload = await request.json()

    if (payload.action === "reorder") {
      const workflowId = payload.workflow_id
      const stageIds = Array.isArray(payload.stage_ids) ? payload.stage_ids : []
      if (!workflowId || stageIds.length === 0) {
        return NextResponse.json({ error: "workflow_id and stage_ids are required for reorder" }, { status: 400 })
      }

      // Two-phase reorder to avoid unique(workflow_id, stage_order) conflicts.
      for (let i = 0; i < stageIds.length; i += 1) {
        const stageId = stageIds[i]
        const { error: updateError } = await ((admin as any).from("approval_workflow_stages") as any)
          .update({ stage_order: 1000 + i + 1 })
          .eq("id", stageId)
          .eq("workflow_id", workflowId)
        if (updateError) throw updateError
      }
      for (let i = 0; i < stageIds.length; i += 1) {
        const stageId = stageIds[i]
        const { error: updateError } = await ((admin as any).from("approval_workflow_stages") as any)
          .update({ stage_order: i + 1 })
          .eq("id", stageId)
          .eq("workflow_id", workflowId)
        if (updateError) throw updateError
      }

      const data = await getWorkflowStages(admin as any, workflowId)
      return NextResponse.json({ data })
    }

    if (!payload.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const approverTarget = (payload.approver_target || { target_type: "department_lead" }) as ApproverTargetConfig
    const relieverScope = parseRelieverScope(payload.reliever_scope)
    const bypassRoles = (payload.bypass_roles || []) as BypassRoleRule[]

    const updatePayload: Record<string, unknown> = {
      stage_name: payload.stage_name,
      stage_order: payload.stage_order,
      approver_target: approverTarget,
      approver_role_code: approverTarget.role_code ?? payload.approver_role_code ?? null,
      approver_resolution_mode: mapResolutionMode(approverTarget.target_type),
      resolution_config: payload.resolution_config ?? {},
      bypass_roles: bypassRoles,
      reliever_scope: relieverScope,
      is_active: payload.is_active,
    }

    let { data, error } = await ((admin as any).from("approval_workflow_stages") as any)
      .update(updatePayload)
      .eq("id", payload.id)
      .select("*")
      .single()

    // Backward compatibility if v2 columns are not yet applied on DB.
    if (
      error &&
      String(error.message || "")
        .toLowerCase()
        .includes("column")
    ) {
      const legacyPayload = { ...updatePayload }
      delete legacyPayload.approver_target
      delete legacyPayload.bypass_roles
      delete legacyPayload.reliever_scope
      ;({ data, error } = await ((admin as any).from("approval_workflow_stages") as any)
        .update(legacyPayload)
        .eq("id", payload.id)
        .select("*")
        .single())
    }

    if (error) throw error
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "mutate")
    if (actor instanceof NextResponse) return actor

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const { error } = await (admin as any).from("approval_workflow_stages").delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
