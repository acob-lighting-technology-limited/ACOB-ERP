"use client"

import { useMemo, useState } from "react"
import { Plus, Target, CheckCircle, Clock, Trash2, ListPlus } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"

import type { Goal } from "@/app/(app)/goals/page"
import { apiFetch } from "@/lib/api-client"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"

type ReviewCycle = {
  id: string
  name: string
  review_type: string | null
  start_date?: string | null
  end_date?: string | null
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
  backLinkHref,
  goalsBasePath,
}: {
  initialGoals: GoalWithCycle[]
  managedDepartments: string[]
  cycles: ReviewCycle[]
  canCreateGoal: boolean
  backLinkHref?: string
  goalsBasePath?: string
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
        initialWidth: 280,
        accessor: (r) => r.title,
        render: (r) => (
          <div className="space-y-0.5">
            <p className="text-foreground font-medium">{r.title}</p>
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
        label: "Review Cycle",
        sortable: true,
        accessor: (r) => r.cycle?.name || "-",
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => r.status || "in_progress",
        render: (r) => (
          <Badge variant="outline" className="text-xs capitalize">
            {String(r.status || "in_progress").replaceAll("_", " ")}
          </Badge>
        ),
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

  const { filters: goalCycleFilters } = useCycleFilters<GoalWithCycle>({
    cycles,
    getRowCycleId: (row) => row.review_cycle_id,
  })

  const goalFilters: DataTableFilter<GoalWithCycle>[] = useMemo(() => {
    return [
      {
        key: "department",
        label: "Department",
        options: managedDepartments.map((d) => ({ value: d, label: d })),
      },
      ...goalCycleFilters,
    ]
  }, [managedDepartments, goalCycleFilters])

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
    ],
    []
  )

  const { filters: cycleTabCycleFilters } = useCycleFilters<(typeof cycleRows)[number]>({
    cycles,
    getRowCycleId: (row) => row.id,
  })

  const cycleFilters: DataTableFilter<(typeof cycleRows)[number]>[] = cycleTabCycleFilters

  // ─── Actions ─────────────────────────────────────────────────────────────
  async function handleCreateGoal() {
    if (!form.department || !form.review_cycle_id || !form.title.trim()) {
      toast.error("Department, cycle, and goal title are required")
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch("/api/hr/performance/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = (await response.json().catch(() => null)) as { data?: GoalWithCycle; error?: string } | null
      if (!response.ok || !payload?.data) throw new Error(payload?.error || "Failed to create goal")
      setGoals((current) => [payload.data as GoalWithCycle, ...current])
      setForm({ ...INITIAL_FORM, department: form.department, review_cycle_id: form.review_cycle_id })
      setIsDialogOpen(false)
      toast.success("Department goal created successfully")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create goal")
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveGoal(goal: GoalWithCycle) {
    try {
      const response = await apiFetch(`/api/hr/performance/goals?id=${encodeURIComponent(goal.id)}`, {
        method: "DELETE",
      })
      if (!response.ok) throw new Error("Failed to archive goal")
      setGoals((current) => current.filter((g) => g.id !== goal.id))
      toast.success("Goal archived successfully")
    } catch (error) {
      toast.error("Failed to archive goal")
    }
  }

  return (
    <DataTablePage
      title="PMS Strategic Goals"
      description="Department leads and admins define strategic goals here and link actionable tasks."
      icon={Target}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms", label: "Back to PMS" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      actions={
        canCreateGoal ? (
          <Button size="sm" onClick={() => setIsDialogOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Strategic Goal</span>
            <span className="sm:hidden">Add</span>
          </Button>
        ) : undefined
      }
      stats={
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatCard variant="compact" title="Total Goals" value={goals.length} icon={Target} />
          <StatCard
            variant="compact"
            title="Active Review Cycles"
            value={cycles.length}
            icon={Clock}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Departments with Goals"
            value={new Set(goals.map((g) => g.department).filter(Boolean)).size}
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
              label: "Create Task under Goal",
              icon: ListPlus,
              onClick: (row) =>
                router.push(`${goalsBasePath ?? "/admin/hr/pms/goals"}/task?goal_id=${encodeURIComponent(row.id)}`),
            },
            {
              label: "Archive Goal",
              icon: Trash2,
              variant: "destructive",
              onClick: (row) => handleArchiveGoal(row),
            },
          ]}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: () => "bg-emerald-500",
            title: (r) => r.title,
            subtitle: (r) => `${r.department} · ${r.cycle?.name || "No cycle"}`,
            trailing: (r) => (
              <Badge variant="outline" className="text-[10px] capitalize">
                {r.status || "Active"}
              </Badge>
            ),
            onSelect: (r) =>
              router.push(`${goalsBasePath ?? "/admin/hr/pms/goals"}/task?goal_id=${encodeURIComponent(r.id)}`),
          }}
          cardRenderer={(r) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{r.title}</p>
                  <p className="text-muted-foreground text-xs">{r.department}</p>
                </div>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {r.status || "Active"}
                </Badge>
              </div>
              <p className="text-muted-foreground line-clamp-2 text-xs">{r.description || "No description."}</p>
              <div className="flex items-center justify-between border-t pt-2 text-[10px]">
                <span>Cycle: {r.cycle?.name || "None"}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() =>
                    router.push(`${goalsBasePath ?? "/admin/hr/pms/goals"}/task?goal_id=${encodeURIComponent(r.id)}`)
                  }
                >
                  <ListPlus className="mr-1 h-3 w-3" /> Add Task
                </Button>
              </div>
            </div>
          )}
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
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: () => "bg-blue-500",
            title: (r) => r.cycle,
            subtitle: (r) => `${r.review_type} · ${r.departments} depts`,
            trailing: (r) => <span className="text-xs font-semibold">{r.goals} goals</span>,
          }}
          cardRenderer={(r) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{r.cycle}</p>
                  <p className="text-muted-foreground text-xs">{r.review_type}</p>
                </div>
                <Badge variant="outline">{r.goals} goals</Badge>
              </div>
              <div className="text-muted-foreground border-t pt-2 text-[10px]">Departments: {r.departments}</div>
            </div>
          )}
        />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Department Goal</DialogTitle>
            <DialogDescription>
              Create a strategic goal for your department. Once created, team tasks can be aligned to this goal to drive
              performance scoring.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Department *</Label>
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
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Review Cycle *</Label>
                <Select
                  value={form.review_cycle_id}
                  onValueChange={(value) => setForm((current) => ({ ...current, review_cycle_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cycle" />
                  </SelectTrigger>
                  <SelectContent>
                    {cycles
                      .filter((cycle) => !cycle.review_type || cycle.review_type.toLowerCase() === "quarterly")
                      .map((cycle) => (
                        <SelectItem key={cycle.id} value={cycle.id}>
                          {cycle.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Goal Title *</Label>
              <Input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="e.g. Achieve 98% on-time project completion rate"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Describe key outcomes and measurement criteria..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Target Due Date</Label>
              <Input
                type="date"
                value={form.due_date}
                onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateGoal()} disabled={saving || !form.title.trim()}>
                {saving ? "Saving..." : "Save Goal"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
