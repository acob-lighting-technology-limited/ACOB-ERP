import type { UserRole } from "@/types/database"

export type ModuleCode =
  | "leave"
  | "help_desk"
  | "correspondence"
  | "pms_kpi"
  | "pms_goal_setting"
  | "pms_kpi_scoring"
  | "pms_review"
  | "task"
  | "resource_booking"

export type ApproverResolutionMode = "fixed_user" | "department_lead" | "rule_based"
export type AccessRuleEffect = "allow" | "deny"
export type AccessPathKind = "app" | "api"

export type ApproverTargetType = "role" | "department_lead" | "department_members" | "everyone"

export type RelieverScopePreset = "same_department" | "cross_department" | "all_departments" | "leads_only" | "everyone"

export interface ApproverTargetConfig {
  target_type: ApproverTargetType
  role_code?: UserRole
  department_id?: string
}

export interface BypassRoleRule {
  role_code: UserRole
}

export interface ApprovalWorkflow {
  id: string
  module_code: ModuleCode
  requester_kind: string
  name: string
  description: string | null
  is_active: boolean
  version: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface ApprovalWorkflowStage {
  id: string
  workflow_id: string
  stage_order: number
  stage_code: string
  stage_name: string
  approver_role_code: string | null
  approver_resolution_mode: ApproverResolutionMode
  resolution_config: Record<string, unknown>
  approver_target: ApproverTargetConfig
  bypass_roles: BypassRoleRule[]
  reliever_scope: RelieverScopePreset
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ApprovalChainPreviewStep {
  stage_order: number
  stage_code: string
  approver_role_code: string | null
  approver_user_id: string | null
  resolution_mode: ApproverResolutionMode
}

export interface ApprovalChainPreviewResponse {
  module_code: ModuleCode
  requester_kind: string
  department: string | null
  steps: ApprovalChainPreviewStep[]
}

export interface AccessPath {
  id: string
  path_pattern: string
  path_kind: AccessPathKind
  methods: string[]
  description: string | null
  priority: number
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface AccessPathRoleRule {
  id: string
  access_path_id: string
  role_code: UserRole
  effect: AccessRuleEffect
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AccessDecisionTrace {
  role: UserRole
  path: string
  method: string
  allowed: boolean
}

export interface GovernanceDepartment {
  id: string
  name: string
}
