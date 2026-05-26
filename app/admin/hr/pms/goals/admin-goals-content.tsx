"use client"

import { useMemo, useState } from "react"
import { Plus, Target, CheckCircle, Clock } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { StatCard } from "@/components/ui/stat-card"
import {
  DataTablePage,
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table"

import type { Goal } from "@/app/(app)/goals/page"

type ReviewCycle = {
  id: string
  name: string
  review_type: string | null
}

type GoalWithCycle = Goal & {
  cycle?: ReviewCycle | null
}

const INITIAL_FORM = {
  department: "",
  review_cycle_id: "",
  title: "",
  description: "",
  due_date: "",
}

const TABS: DataTableTab[] = [
  { key: "department", label: "Department" },
  { key: "cycle", label: "Cycle" },
]

export function AdminGoalsContent({
  initialGoals,
  managedDepartments,
  cycles,
  canCreateGoal,
}: {
  initialGoals: GoalWithCycle[]
  managedDepartments: string[]
  cycles: ReviewCycle[]
  canCreateGoal: boolean
}) {
  const router = useRouter()
  const [goals, setGoals] = useState(initialGoals)
  const [tab, setTab] = useState("department")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    ...INITIAL_FORM,
    department: managedDepartments[0] || "",
    review_cycle_id: cycles[0]?.id || "",
  })

  // ─── Columns for Department Goals ──────────────────────────────────────────
  const goalColumns: DataTableColumn<GoalWithCycle>[] = useMemo(
    () => [
      {
        key: "title",
        label: "Goal",
        sortable: true,
        resizable: true,
        initialWidth: 250,
        accessor: (r) => r.title,
        render: (r) => (
          <div className="space-y-1">
            <p className="font-medium">{r.title}</p>
            {r.description ? (
              <p className="text-muted-foreground truncate text-xs" title={r.description}>
                {r.description}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => r.department || "-",
        hideOnMobile: true,
      },
      {
        key: "cycle",
        label: "Cycle",
        sortable: true,
        accessor: (r) => r.cycle?.name || "-",
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => String(r.status || "").replaceAll("_", " "),
        render: (r) => <span className="capitalize">{String(r.status || "").replaceAll("_", " ")}</span>,
      },
      {
        key: "approval",
        label: "Approval",
        accessor: (r) => r.approval_status || "pending",
        render: (r) => <span className="capitalize">{r.approval_status || "pending"}</span>,
        hideOnMobile: true,
      },
      {
        key: "due",
        label: "Due Date",
        sortable: true,
        accessor: (r) => r.due_date || "",
        render: (r) => <span>{r.due_date ? formatWATDate(r.due_date) : "-"}</span>,
        hideOnMobile: true,
      },
    ],
    []
  )

  const goalFilters: DataTableFilter<GoalWithCycle>[] = useMemo(() => {
    return [
      {
        key: "department",
        label: "Department",
        options: managedDepartments.map((d) => ({ value: d, label: d })),
      },
      {
        key: "cycle",
        label: "Cycle",
        options: cycles.map((c) => ({ value: c.id, label: c.name })),
        mode: "custom",
        filterFn: (row, selected) => selected.includes(row.review_cycle_id || ""),
      },
    ]
  }, [managedDepartments, cycles])

  // ─── Columns for Cycle View ──────────────────────────────────────────────
  const cycleRows = useMemo(() => {
    return cycles.map((cycle) => {
      const cycleGoals = goals.filter((goal) => goal.review_cycle_id === cycle.id)
      return {
        id: cycle.id,
        cycle: cycle.name,
        review_type: cycle.review_type || "-",
        departments: new Set(cycleGoals.map((goal) => goal.department).filter(Boolean)).size,
        goals: cycleGoals.length,
        approved: cycleGoals.filter((goal) => goal.approval_status === "approved").length,
      }
    })
  }, [cycles, goals])

  const cycleColumns: DataTableColumn<(typeof cycleRows)[number]>[] = useMemo(
    () => [
      {
        key: "cycle",
        label: "Cycle",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) => r.cycle,
        render: (r) => <span className="font-medium">{r.cycle}</span>,
      },
      {
        key: "review_type",
        label: "Review Type",
        sortable: true,
        accessor: (r) => r.review_type,
        hideOnMobile: true,
      },
      {
        key: "departments",
        label: "Departments",
        align: "center",
        accessor: (r) => String(r.departments),
        hideOnMobile: true,
      },
      {
        key: "goals_count",
        label: "Goals",
        align: "center",
        accessor: (r) => String(r.goals),
        hideOnMobile: true,
      },
      {
        key: "approved",
        label: "Approved",
        align: "center",
        accessor: (r) => String(r.approved),
        hideOnMobile: true,
      },
    ],
    []
  )

  const cycleFilters: DataTableFilter<(typeof cycleRows)[number]>[] = useMemo(() => {
    const types = Array.from(new Set(cycleRows.map((r) => r.review_type))).sort()
    return [
      {
        key: "review_type",
        label: "Review Type",
        options: types.map((t) => ({ value: t, label: t })),
      },
    ]
  }, [cycleRows])

  // ─── Actions ─────────────────────────────────────────────────────────────
  async function handleCreateGoal() {
    if (!form.department || !form.review_cycle_id || !form.title.trim()) {
      toast.error("Department, cycle, and goal title are required")
      return
    }

    setSaving(true)
    try {
      const response = await fetch("/api/hr/performance/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = (await response.json().catch(() => null)) as { data?: GoalWithCycle; error?: string } | null
      if (!response.ok || !payload?.data) throw new Error(payload?.error || "Failed to create goal")
      setGoals((current) => [payload.data as GoalWithCycle, ...current])
      setForm({ ...INITIAL_FORM, department: form.department, review_cycle_id: form.review_cycle_id })
      setIsDialogOpen(false)
      toast.success("Department goal created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create goal")
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  const pendingGoals = goals.filter((g) => g.approval_status === "pending").length
  const approvedGoals = goals.filter((g) => g.approval_status === "approved").length

  return (
    <DataTablePage
      title="PMS Goals"
      description="Department leads create department goals here, then create tasks under the specific goal."
      icon={Target}
      backLink={{ href: "/admin/hr/pms", label: "Back to PMS" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      actions={
        canCreateGoal ? (
          <Button size="sm" onClick={() => setIsDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Goal
          </Button>
        ) : undefined
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard title="Total Goals" value={goals.length} icon={Target} />
          <StatCard
            title="Pending Approval"
            value={pendingGoals}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Approved"
            value={approvedGoals}
            icon={CheckCircle}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
        </div>
      }
    >
      {tab === "department" ? (
        <DataTable<GoalWithCycle>
          data={goals}
          columns={goalColumns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search goal, department, cycle..."
          searchFn={(row, q) =>
            [row.title, row.description, row.department, row.cycle?.name, row.status]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          }
          filters={goalFilters}
          pagination={{ pageSize: 50 }}
          rowActions={[
            {
              label: "Create Task",
              onClick: (row) => router.push(`/admin/hr/pms/goals/task?goal_id=${encodeURIComponent(row.id)}`),
            },
          ]}
        />
      ) : (
        <DataTable<(typeof cycleRows)[number]>
          data={cycleRows}
          columns={cycleColumns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search cycle, type..."
          searchFn={(row, q) => [row.cycle, row.review_type].some((value) => String(value).toLowerCase().includes(q))}
          filters={cycleFilters}
          pagination={{ pageSize: 50 }}
        />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Department Goal</DialogTitle>
            <DialogDescription>
              Goals are departmental now. Save the goal here, then create tasks inside it for one person or the
              department queue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={form.department}
                  onValueChange={(value) => setForm((current) => ({ ...current, department: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {managedDepartments.map((department) => (
                      <SelectItem key={department} value={department}>
                        {department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cycle</Label>
                <Select
                  value={form.review_cycle_id}
                  onValueChange={(value) => setForm((current) => ({ ...current, review_cycle_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cycle" />
                  </SelectTrigger>
                  <SelectContent>
                    {cycles.map((cycle) => (
                      <SelectItem key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Goal Title</Label>
              <Input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                rows={4}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={form.due_date}
                onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateGoal()} disabled={saving}>
                {saving ? "Saving..." : "Save Goal"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
