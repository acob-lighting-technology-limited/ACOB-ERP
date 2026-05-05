"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Shield, GitBranch, Route, TestTube, RefreshCw, Pencil, ArrowUp, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import type { UserRole } from "@/types/database"
import type {
  AccessPath,
  ApprovalWorkflow,
  ApprovalWorkflowStage,
  GovernanceDepartment,
  ModuleCode,
} from "@/types/governance"
import { AddWorkflowDialog } from "./add-workflow-dialog"
import { AddStageDialog } from "./add-stage-dialog"
import { AddPathDialog } from "./add-path-dialog"
import { StageDialog, type StageFormPayload } from "./stage-dialog"

type RoleRule = {
  id: string
  access_path_id: string
  role_code: UserRole
  effect: "allow" | "deny"
  is_active: boolean
}

type AccessPathResponse = { paths: AccessPath[]; rules: RoleRule[] }

const tabs: DataTableTab[] = [
  { key: "workflows", label: "Workflows", icon: GitBranch },
  { key: "stages", label: "Stages", icon: Shield },
  { key: "paths", label: "Path Matrix", icon: Route },
  { key: "simulate", label: "Simulator", icon: TestTube },
]

const moduleOptions = [
  { value: "leave", label: "Leave" },
  { value: "help_desk", label: "Help Desk" },
  { value: "correspondence", label: "Correspondence" },
  { value: "pms_goal_setting", label: "PMS Goal Setting" },
  { value: "pms_kpi_scoring", label: "PMS KPI Scoring" },
  { value: "pms_review", label: "PMS Review" },
  { value: "task", label: "Task" },
  { value: "resource_booking", label: "Resource Booking" },
]

function statusLabel(value: boolean): "Set Active" | "Set Inactive" {
  return value ? "Set Inactive" : "Set Active"
}

export function GovernanceConsole({ role }: { role: UserRole }) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState("workflows")
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("")
  const [simulationOutput, setSimulationOutput] = useState<string>("")
  const [editingStage, setEditingStage] = useState<ApprovalWorkflowStage | null>(null)
  const [editStageOpen, setEditStageOpen] = useState(false)
  const [editingStageLoading, setEditingStageLoading] = useState(false)

  const workflowsQuery = useQuery({
    queryKey: ["governance", "workflows"],
    queryFn: async () => {
      const res = await fetch("/api/admin/governance/workflows", {
        headers: { "x-user-role": role },
      })
      if (!res.ok) throw new Error("Failed to load workflows")
      const body = (await res.json()) as { data: ApprovalWorkflow[] }
      return body.data
    },
  })

  const workflows = useMemo(() => workflowsQuery.data || [], [workflowsQuery.data])

  const stagesQuery = useQuery({
    queryKey: ["governance", "stages", selectedWorkflowId],
    enabled: selectedWorkflowId.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/admin/governance/stages?workflow_id=${selectedWorkflowId}`, {
        headers: { "x-user-role": role },
      })
      if (!res.ok) throw new Error("Failed to load stages")
      const body = (await res.json()) as { data: ApprovalWorkflowStage[] }
      return body.data
    },
  })

  const stages = useMemo(() => stagesQuery.data || [], [stagesQuery.data])

  const lookupsQuery = useQuery({
    queryKey: ["governance", "lookups"],
    queryFn: async () => {
      const res = await fetch("/api/admin/governance/lookups", {
        headers: { "x-user-role": role },
      })
      if (!res.ok) throw new Error("Failed to load lookups")
      const body = (await res.json()) as { data: { departments: GovernanceDepartment[] } }
      return body.data
    },
  })

  const departments = lookupsQuery.data?.departments || []

  const pathsQuery = useQuery({
    queryKey: ["governance", "paths"],
    queryFn: async () => {
      const res = await fetch("/api/admin/governance/access-paths", {
        headers: { "x-user-role": role },
      })
      if (!res.ok) throw new Error("Failed to load access paths")
      const body = (await res.json()) as { data: AccessPathResponse }
      return body.data
    },
  })

  const accessPaths = useMemo(() => pathsQuery.data?.paths || [], [pathsQuery.data?.paths])
  const roleRules = pathsQuery.data?.rules || []

  const stats = useMemo(() => {
    const activeWorkflows = workflows.filter((w) => w.is_active).length
    const activeStages = stages.filter((s) => s.is_active).length
    const activePaths = accessPaths.filter((p) => p.is_active).length
    return { activeWorkflows, activeStages, activePaths }
  }, [workflows, stages, accessPaths])

  const workflowColumns: DataTableColumn<ApprovalWorkflow>[] = [
    {
      key: "name",
      label: "Name",
      sortable: true,
      accessor: (r) => r.name,
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "module_code",
      label: "Module",
      sortable: true,
      accessor: (r) => r.module_code,
      render: (r) => <Badge variant="secondary">{r.module_code}</Badge>,
    },
    { key: "requester_kind", label: "Requester", sortable: true, accessor: (r) => r.requester_kind },
    { key: "version", label: "Version", sortable: true, accessor: (r) => r.version, align: "center" },
    {
      key: "is_active",
      label: "Status",
      sortable: true,
      accessor: (r) => (r.is_active ? "active" : "inactive"),
      render: (r) => <Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "actions",
      label: "Action",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 rounded-md border px-2 py-1">
            <span
              className={row.is_active ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-red-600"}
            >
              {row.is_active ? "Active" : "Inactive"}
            </span>
            <Switch checked={row.is_active} onCheckedChange={(checked) => void setWorkflowActive(row, checked)} />
          </div>
        </div>
      ),
    },
  ]

  const workflowFilters: DataTableFilter<ApprovalWorkflow>[] = [
    { key: "module_code", label: "Module", options: moduleOptions },
    {
      key: "is_active",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  ]

  const stageColumns: DataTableColumn<ApprovalWorkflowStage>[] = [
    { key: "stage_order", label: "Order", sortable: true, accessor: (r) => r.stage_order, align: "center" },
    {
      key: "stage_code",
      label: "System Code",
      sortable: true,
      accessor: (r) => r.stage_code,
      render: (r) => <span className="font-mono text-xs">{r.stage_code}</span>,
    },
    { key: "stage_name", label: "Stage Name", sortable: true, accessor: (r) => r.stage_name },
    {
      key: "approver_target",
      label: "Approver Target",
      accessor: (r) => r.approver_target?.target_type || "department_lead",
      render: (r) => <span>{r.approver_target?.target_type || "department_lead"}</span>,
    },
    { key: "reliever_scope", label: "Reliever Scope", accessor: (r) => r.reliever_scope || "same_department" },
    {
      key: "actions",
      label: "Action",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void reorderStage(row.id, "up")}>
            <ArrowUp className="mr-1 h-4 w-4" /> Move Up
          </Button>
          <Button size="sm" variant="outline" onClick={() => void reorderStage(row.id, "down")}>
            <ArrowDown className="mr-1 h-4 w-4" /> Move Down
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void openEditStage(row.id)
            }}
          >
            <Pencil className="mr-1 h-4 w-4" /> Edit
          </Button>
          <div className="flex items-center gap-2 rounded-md border px-2 py-1">
            <span
              className={row.is_active ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-red-600"}
            >
              {row.is_active ? "Active" : "Inactive"}
            </span>
            <Switch checked={row.is_active} onCheckedChange={(checked) => void setStageActive(row, checked)} />
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              void (async () => {
                const res = await fetch(`/api/admin/governance/stages?id=${row.id}`, {
                  method: "DELETE",
                  headers: { "x-user-role": role },
                })
                if (!res.ok) {
                  toast.error("Failed to delete stage")
                  return
                }
                toast.success("Stage deleted")
                await queryClient.invalidateQueries({ queryKey: ["governance", "stages", selectedWorkflowId] })
              })()
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ]

  const stageFilters: DataTableFilter<ApprovalWorkflowStage>[] = [
    {
      key: "approver_target",
      label: "Approver Target",
      options: [
        { value: "role", label: "Role" },
        { value: "department_lead", label: "Department Lead" },
        { value: "department_members", label: "Department Members" },
        { value: "everyone", label: "Everyone" },
      ],
      mode: "custom",
      filterFn: (row, selected) => {
        const values = Array.isArray(selected) ? selected : [selected]
        if (values.length === 0) return true
        return values.includes(row.approver_target?.target_type || "department_lead")
      },
    },
    {
      key: "is_active",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
      mode: "custom",
      filterFn: (row, selected) => {
        const values = Array.isArray(selected) ? selected : [selected]
        if (values.length === 0) return true
        return values.some((v) => (v === "active" ? row.is_active : !row.is_active))
      },
    },
  ]

  const pathColumns: DataTableColumn<AccessPath>[] = [
    {
      key: "path_pattern",
      label: "Path Pattern",
      sortable: true,
      accessor: (r) => r.path_pattern,
      render: (r) => <span className="font-mono text-xs">{r.path_pattern}</span>,
    },
    {
      key: "path_kind",
      label: "Kind",
      sortable: true,
      accessor: (r) => r.path_kind,
      render: (r) => <Badge variant="secondary">{r.path_kind.toUpperCase()}</Badge>,
    },
    {
      key: "methods",
      label: "Methods",
      accessor: (r) => r.methods.join(","),
      render: (r) => <span>{r.methods.join(", ")}</span>,
    },
    { key: "priority", label: "Priority", sortable: true, accessor: (r) => r.priority, align: "center" },
    {
      key: "is_active",
      label: "Status",
      sortable: true,
      accessor: (r) => (r.is_active ? "active" : "inactive"),
      render: (r) => <Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "actions",
      label: "Action",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 rounded-md border px-2 py-1">
            <span
              className={row.is_active ? "text-xs font-medium text-emerald-600" : "text-xs font-medium text-red-600"}
            >
              {row.is_active ? "Active" : "Inactive"}
            </span>
            <Switch checked={row.is_active} onCheckedChange={(checked) => void setPathActive(row, checked)} />
          </div>
        </div>
      ),
    },
  ]

  const pathFilters: DataTableFilter<AccessPath>[] = [
    {
      key: "path_kind",
      label: "Kind",
      options: [
        { value: "app", label: "App" },
        { value: "api", label: "API" },
      ],
    },
    {
      key: "is_active",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  ]

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["governance", "workflows"] }),
      queryClient.invalidateQueries({ queryKey: ["governance", "stages"] }),
      queryClient.invalidateQueries({ queryKey: ["governance", "paths"] }),
      queryClient.invalidateQueries({ queryKey: ["governance", "lookups"] }),
    ])
    toast.success("Governance data refreshed")
  }

  async function createWorkflow(payload: { name: string; module_code: ModuleCode; requester_kind: string }) {
    const res = await fetch("/api/admin/governance/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({ ...payload, is_active: true, version: 1 }),
    })

    if (!res.ok) {
      toast.error("Failed to create workflow")
      return
    }
    toast.success("Workflow created")
    await queryClient.invalidateQueries({ queryKey: ["governance", "workflows"] })
  }

  async function createStage(payload: StageFormPayload) {
    if (!selectedWorkflowId) return
    const res = await fetch("/api/admin/governance/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({ workflow_id: selectedWorkflowId, ...payload }),
    })

    if (!res.ok) {
      toast.error("Failed to create stage")
      return
    }

    toast.success("Stage created")
    await queryClient.invalidateQueries({ queryKey: ["governance", "stages", selectedWorkflowId] })
  }

  async function updateStage(row: ApprovalWorkflowStage, payload: StageFormPayload) {
    const res = await fetch("/api/admin/governance/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({ id: row.id, ...payload }),
    })

    if (!res.ok) {
      toast.error("Failed to update stage")
      return
    }
    toast.success("Stage updated")
    await queryClient.invalidateQueries({ queryKey: ["governance", "stages", selectedWorkflowId] })
  }

  async function openEditStage(stageId: string) {
    setEditingStageLoading(true)
    try {
      const res = await fetch(`/api/admin/governance/stages?id=${stageId}`, {
        headers: { "x-user-role": role },
      })
      if (!res.ok) {
        toast.error("Failed to load stage details")
        return
      }
      const body = (await res.json()) as { data: ApprovalWorkflowStage }
      setEditingStage(body.data)
      setEditStageOpen(true)
    } finally {
      setEditingStageLoading(false)
    }
  }

  async function reorderStage(stageId: string, direction: "up" | "down") {
    if (!selectedWorkflowId || stages.length === 0) return
    const idx = stages.findIndex((s) => s.id === stageId)
    if (idx < 0) return
    const targetIdx = direction === "up" ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= stages.length) return

    const reordered = [...stages]
    const [item] = reordered.splice(idx, 1)
    reordered.splice(targetIdx, 0, item)

    const res = await fetch("/api/admin/governance/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({
        action: "reorder",
        workflow_id: selectedWorkflowId,
        stage_ids: reordered.map((s) => s.id),
      }),
    })
    if (!res.ok) {
      toast.error("Failed to reorder stages")
      return
    }
    toast.success("Stage order updated")
    await queryClient.invalidateQueries({ queryKey: ["governance", "stages", selectedWorkflowId] })
  }

  async function setWorkflowActive(row: ApprovalWorkflow, isActive: boolean) {
    const res = await fetch("/api/admin/governance/workflows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({ ...row, is_active: isActive }),
    })
    if (!res.ok) {
      toast.error("Failed to update workflow")
      return
    }
    toast.success("Workflow updated")
    await queryClient.invalidateQueries({ queryKey: ["governance", "workflows"] })
  }

  async function setStageActive(row: ApprovalWorkflowStage, isActive: boolean) {
    const res = await fetch("/api/admin/governance/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({
        id: row.id,
        stage_name: row.stage_name,
        stage_order: row.stage_order,
        approver_target: row.approver_target,
        bypass_roles: row.bypass_roles,
        reliever_scope: row.reliever_scope,
        is_active: isActive,
      }),
    })
    if (!res.ok) {
      toast.error("Failed to update stage")
      return
    }
    toast.success("Stage updated")
    await queryClient.invalidateQueries({ queryKey: ["governance", "stages", selectedWorkflowId] })
  }

  async function setPathActive(row: AccessPath, isActive: boolean) {
    const scopedRules = roleRules
      .filter((rule) => rule.access_path_id === row.id)
      .map((r) => ({ role_code: r.role_code, effect: r.effect, is_active: r.is_active }))

    const res = await fetch("/api/admin/governance/access-paths", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({ ...row, is_active: isActive, rules: scopedRules }),
    })

    if (!res.ok) {
      toast.error("Failed to update path")
      return
    }
    toast.success("Path updated")
    await queryClient.invalidateQueries({ queryKey: ["governance", "paths"] })
  }

  async function createAccessPath(payload: { path_pattern: string; path_kind: "app" | "api"; methods: string[] }) {
    const res = await fetch("/api/admin/governance/access-paths", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({
        path_pattern: payload.path_pattern,
        path_kind: payload.path_kind,
        methods: payload.methods,
        description: "Created from governance console",
        priority: 100,
        is_active: true,
        rules: [
          { role_code: "developer", effect: "allow", is_active: true },
          { role_code: "super_admin", effect: "allow", is_active: true },
          { role_code: "admin", effect: "deny", is_active: true },
          { role_code: "employee", effect: "deny", is_active: true },
          { role_code: "visitor", effect: "deny", is_active: true },
        ],
      }),
    })

    if (!res.ok) {
      toast.error("Failed to create access path")
      return
    }

    toast.success("Access path created")
    await queryClient.invalidateQueries({ queryKey: ["governance", "paths"] })
  }

  async function runPathSimulation() {
    const simRole = (window.prompt("Role to test", "admin") || "admin") as UserRole
    const simPath =
      window.prompt("Path to test", "/api/admin/governance/workflows") || "/api/admin/governance/workflows"
    const simMethod = window.prompt("Method", "GET") || "GET"

    const res = await fetch("/api/admin/governance/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({ mode: "path", role: simRole, path: simPath, method: simMethod }),
    })

    const body = await res.json()
    if (!res.ok) {
      toast.error("Simulation failed")
      return
    }

    setSimulationOutput(JSON.stringify(body.data, null, 2))
  }

  async function runApprovalSimulation() {
    const moduleCode = (window.prompt("Module code", "leave") || "leave") as ModuleCode
    const requesterKind = window.prompt("Requester kind", "employee") || "employee"
    const department = window.prompt("Department (optional)", "Admin & HR")

    const res = await fetch("/api/admin/governance/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-role": role },
      body: JSON.stringify({ mode: "approval", module_code: moduleCode, requester_kind: requesterKind, department }),
    })

    const body = await res.json()
    if (!res.ok) {
      toast.error("Simulation failed")
      return
    }

    setSimulationOutput(JSON.stringify(body.data, null, 2))
  }

  const workflowActions = (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
        <RefreshCw className="mr-1 h-4 w-4" /> Refresh
      </Button>
      <AddWorkflowDialog onCreate={createWorkflow} />
    </div>
  )

  return (
    <DataTablePage
      title="Governance Control Plane"
      description="Manage approval workflows and route access matrix for super admin/developer governance."
      icon={Shield}
      backLink={{ href: "/admin/settings", label: "Back to Settings" }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            title="Active Workflows"
            value={stats.activeWorkflows}
            icon={GitBranch}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Active Stages"
            value={stats.activeStages}
            icon={Shield}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Active Paths"
            value={stats.activePaths}
            icon={Route}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
      actions={
        activeTab === "workflows" ? (
          workflowActions
        ) : activeTab === "stages" ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <AddStageDialog
              disabled={!selectedWorkflowId}
              departments={departments}
              nextOrder={stages.length + 1}
              onCreate={createStage}
            />
          </div>
        ) : activeTab === "paths" ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <AddPathDialog onCreate={createAccessPath} />
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void runApprovalSimulation()}>
              <TestTube className="mr-1 h-4 w-4" /> Simulate Approval
            </Button>
            <Button size="sm" onClick={() => void runPathSimulation()}>
              <TestTube className="mr-1 h-4 w-4" /> Simulate Path
            </Button>
          </div>
        )
      }
    >
      {activeTab === "workflows" && (
        <DataTable<ApprovalWorkflow>
          data={workflows}
          columns={workflowColumns}
          getRowId={(row) => row.id}
          filters={workflowFilters}
          searchPlaceholder="Search workflows..."
          searchFn={(row, q) =>
            row.name.toLowerCase().includes(q) ||
            row.requester_kind.toLowerCase().includes(q) ||
            row.module_code.toLowerCase().includes(q)
          }
          isLoading={workflowsQuery.isLoading}
          rowActions={[
            {
              label: "View Stages",
              onClick: (row) => {
                setSelectedWorkflowId(row.id)
                setActiveTab("stages")
              },
            },
            {
              label: "Edit",
              onClick: (row) => {
                setSimulationOutput(JSON.stringify(row, null, 2))
                setActiveTab("simulate")
              },
            },
            {
              label: "Delete",
              variant: "destructive",
              onClick: async (row) => {
                const res = await fetch(`/api/admin/governance/workflows?id=${row.id}`, {
                  method: "DELETE",
                  headers: { "x-user-role": role },
                })
                if (!res.ok) {
                  toast.error("Failed to delete workflow")
                  return
                }
                toast.success("Workflow deleted")
                await queryClient.invalidateQueries({ queryKey: ["governance", "workflows"] })
              },
            },
          ]}
          viewToggle
          cardRenderer={(row) => (
            <div className="space-y-2 rounded-xl border p-4">
              <p className="font-medium">{row.name}</p>
              <p className="text-muted-foreground text-sm">
                {row.module_code} / {row.requester_kind}
              </p>
              <Badge variant={row.is_active ? "default" : "outline"}>{row.is_active ? "Active" : "Inactive"}</Badge>
            </div>
          )}
          urlSync
        />
      )}

      {activeTab === "stages" && (
        <DataTable<ApprovalWorkflowStage>
          data={stages}
          columns={stageColumns}
          getRowId={(row) => row.id}
          filters={stageFilters}
          searchPlaceholder="Search stages..."
          searchFn={(row, q) =>
            row.stage_code.toLowerCase().includes(q) ||
            row.stage_name.toLowerCase().includes(q) ||
            (row.approver_target?.target_type || "").toLowerCase().includes(q)
          }
          isLoading={stagesQuery.isLoading || editingStageLoading}
          rowActions={[]}
          expandable={{
            render: (row) => (
              <div className="space-y-2 p-3 text-sm">
                <p>
                  <span className="font-medium">Bypass roles:</span>{" "}
                  {(row.bypass_roles || []).map((r) => r.role_code).join(", ") || "none"}
                </p>
                <p>
                  <span className="font-medium">Reliever scope:</span> {row.reliever_scope || "same_department"}
                </p>
              </div>
            ),
          }}
          urlSync
        />
      )}

      {activeTab === "paths" && (
        <DataTable<AccessPath>
          data={accessPaths}
          columns={pathColumns}
          getRowId={(row) => row.id}
          filters={pathFilters}
          searchPlaceholder="Search path patterns..."
          searchFn={(row, q) => row.path_pattern.toLowerCase().includes(q) || row.path_kind.toLowerCase().includes(q)}
          isLoading={pathsQuery.isLoading}
          rowActions={[
            {
              label: "Rules",
              onClick: (row) => {
                const scoped = roleRules.filter((rule) => rule.access_path_id === row.id)
                setSimulationOutput(JSON.stringify(scoped, null, 2))
                setActiveTab("simulate")
              },
            },
            {
              label: "Edit",
              onClick: (row) => {
                setSimulationOutput(JSON.stringify(row, null, 2))
                setActiveTab("simulate")
              },
            },
            {
              label: "Delete",
              variant: "destructive",
              onClick: async (row) => {
                const res = await fetch(`/api/admin/governance/access-paths?id=${row.id}`, {
                  method: "DELETE",
                  headers: { "x-user-role": role },
                })
                if (!res.ok) {
                  toast.error("Failed to delete path")
                  return
                }
                toast.success("Path deleted")
                await queryClient.invalidateQueries({ queryKey: ["governance", "paths"] })
              },
            },
          ]}
          urlSync
        />
      )}

      {activeTab === "simulate" && (
        <div className="rounded-xl border p-4">
          <p className="mb-2 text-sm font-medium">Simulation Output</p>
          <pre className="bg-muted/50 overflow-auto rounded-md p-3 text-xs">
            {simulationOutput || "Run a simulation to see decision traces."}
          </pre>
        </div>
      )}

      {editingStage && (
        <StageDialog
          key={editingStage.id}
          open={editStageOpen}
          onOpenChange={(open) => {
            setEditStageOpen(open)
            if (!open) setEditingStage(null)
          }}
          title="Edit Stage"
          initial={editingStage}
          departments={departments}
          nextOrder={editingStage.stage_order}
          onSubmit={async (payload) => {
            await updateStage(editingStage, payload)
            setEditStageOpen(false)
          }}
        />
      )}
    </DataTablePage>
  )
}
