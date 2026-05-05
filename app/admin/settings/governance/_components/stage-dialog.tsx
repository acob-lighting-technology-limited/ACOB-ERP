"use client"

import { useEffect, useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import type {
  ApprovalWorkflowStage,
  ApproverTargetConfig,
  GovernanceDepartment,
  RelieverScopePreset,
} from "@/types/governance"
import type { UserRole } from "@/types/database"

const roleOptions: UserRole[] = ["super_admin", "developer", "admin", "employee", "visitor"]

export type StageFormPayload = {
  stage_name: string
  stage_code: string
  stage_order: number
  approver_target: ApproverTargetConfig
  bypass_roles: Array<{ role_code: UserRole }>
  reliever_scope: RelieverScopePreset
  is_active: boolean
}

export function StageDialog({
  trigger,
  title,
  departments,
  nextOrder,
  initial,
  onSubmit,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  trigger?: ReactNode
  title: string
  departments: GovernanceDepartment[]
  nextOrder: number
  initial?: ApprovalWorkflowStage
  onSubmit: (payload: StageFormPayload) => Promise<void>
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen
  const [stageName, setStageName] = useState("")
  const [stageCode, setStageCode] = useState("pending_custom")
  const [stageOrder, setStageOrder] = useState(String(nextOrder))
  const [targetType, setTargetType] = useState<ApproverTargetConfig["target_type"]>("department_lead")
  const [targetRole, setTargetRole] = useState<UserRole>("admin")
  const [targetDepartmentId, setTargetDepartmentId] = useState<string>("")
  const [relieverScope, setRelieverScope] = useState<RelieverScopePreset>("same_department")
  const [bypassRoles, setBypassRoles] = useState<UserRole[]>(["super_admin", "developer"])
  const [isActive, setIsActive] = useState(true)
  const [formError, setFormError] = useState<string>("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (initial) {
      setStageName(initial.stage_name)
      setStageCode(initial.stage_code)
      setStageOrder(String(initial.stage_order))
      setTargetType(initial.approver_target?.target_type || "department_lead")
      setTargetRole((initial.approver_target?.role_code as UserRole | undefined) || "admin")
      setTargetDepartmentId(initial.approver_target?.department_id || "")
      setRelieverScope(initial.reliever_scope || "same_department")
      setBypassRoles(
        (initial.bypass_roles || [])
          .map((b) => b.role_code)
          .filter((role): role is UserRole => roleOptions.includes(role as UserRole))
      )
      setIsActive(initial.is_active)
      return
    }

    setStageName("")
    setStageCode("pending_custom")
    setStageOrder(String(nextOrder))
    setTargetType("department_lead")
    setTargetRole("admin")
    setTargetDepartmentId("")
    setRelieverScope("same_department")
    setBypassRoles(["super_admin", "developer"])
    setIsActive(true)
  }, [initial, nextOrder])

  function normalizeStageCode(value: string): string {
    const code = value.trim().toLowerCase()
    if (code === "pending_md") return "lead_executive_management"
    if (code === "hcs") return "lead_corporate_services"
    return code
  }

  const isRelieverStage = stageCode.toLowerCase().includes("reliever") || stageName.toLowerCase().includes("reliever")

  function toggleBypassRole(role: UserRole, checked: boolean) {
    setBypassRoles((prev) => {
      if (checked) return prev.includes(role) ? prev : [...prev, role]
      return prev.filter((r) => r !== role)
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError("")
    if (targetType === "department_lead" && !targetDepartmentId) {
      setFormError("Department is required when Approver Target is Department Lead.")
      return
    }

    setSaving(true)
    try {
      const mappedBypassRoles = bypassRoles.map((role_code) => ({ role_code }))

      const approverTarget: ApproverTargetConfig =
        targetType === "role"
          ? { target_type: targetType, role_code: targetRole }
          : targetType === "everyone"
            ? { target_type: targetType }
            : targetType === "department_members"
              ? { target_type: targetType }
              : { target_type: targetType, department_id: targetDepartmentId || undefined }

      await onSubmit({
        stage_name: stageName.trim(),
        stage_code: normalizeStageCode(stageCode),
        stage_order: Number(stageOrder || nextOrder),
        approver_target: approverTarget,
        bypass_roles: mappedBypassRoles,
        reliever_scope: relieverScope,
        is_active: isActive,
      })
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {formError ? <p className="text-sm text-red-500">{formError}</p> : null}
            <div className="space-y-2">
              <Label>Stage Name</Label>
              <Input value={stageName} onChange={(e) => setStageName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Stage Code (System Key)</Label>
              <Input
                value={stageCode}
                onChange={(e) => setStageCode(e.target.value)}
                required
                disabled={Boolean(initial)}
              />
            </div>
            <div className="space-y-2">
              <Label>Stage Order</Label>
              <Input
                type="number"
                min={1}
                value={stageOrder}
                onChange={(e) => setStageOrder(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Approver Target</Label>
              <Select value={targetType} onValueChange={(v) => setTargetType(v as ApproverTargetConfig["target_type"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="role">Role</SelectItem>
                  <SelectItem value="department_lead">Department Lead</SelectItem>
                  <SelectItem value="department_members">Department Members</SelectItem>
                  <SelectItem value="everyone">Everyone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {targetType === "role" && (
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={targetRole} onValueChange={(v) => setTargetRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {targetType === "department_lead" && (
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={targetDepartmentId} onValueChange={setTargetDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Bypass Roles</Label>
              <div className="grid grid-cols-1 gap-2 rounded-md border p-3">
                {roleOptions.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={bypassRoles.includes(role)}
                      onCheckedChange={(checked) => toggleBypassRole(role, Boolean(checked))}
                    />
                    <span>{role}</span>
                  </label>
                ))}
              </div>
            </div>
            {isRelieverStage ? (
              <div className="space-y-2">
                <Label>Reliever Scope</Label>
                <Select value={relieverScope} onValueChange={(v) => setRelieverScope(v as RelieverScopePreset)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same_department">Same Department</SelectItem>
                    <SelectItem value="cross_department">Cross Department</SelectItem>
                    <SelectItem value="all_departments">All Departments</SelectItem>
                    <SelectItem value="leads_only">Leads Only</SelectItem>
                    <SelectItem value="everyone">Everyone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={isActive ? "active" : "inactive"} onValueChange={(v) => setIsActive(v === "active")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
