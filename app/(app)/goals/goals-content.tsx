"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Plus, Target, Trash2, ListPlus } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import type { Goal } from "./page"
import { apiFetch } from "@/lib/api-client"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"

type GoalsContentProps = {
  initialGoals: Goal[]
  cycles?: {
    id: string
    name: string
    review_type?: string | null
    start_date?: string | null
    end_date?: string | null
  }[]
  canCreateGoal?: boolean
  managedDepartments?: string[]
  pageTitle?: string
  pageDescription?: string
  backHref?: string
  backLabel?: string
  showCreateTaskAction?: boolean
  summaryCards?: Array<{ label: string; value: string | number }>
}

const INITIAL_FORM = {
  department: "",
  title: "",
  description: "",
  priority: "medium",
  due_date: "",
}

type GoalRow = Goal & {
  cycleLabel: string
}

export function GoalsContent({
  initialGoals,
  cycles = [],
  canCreateGoal = false,
  managedDepartments = [],
  pageTitle = "Department Strategic Goals",
  pageDescription = "View and manage departmental strategic goals and linked tasks.",
  backHref = "/pms",
  backLabel = "Back to PMS",
  showCreateTaskAction = false,
  summaryCards = [],
}: GoalsContentProps) {
  const [goals, setGoals] = useState<Goal[]>(initialGoals)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(INITIAL_FORM)

  const rows = useMemo<GoalRow[]>(
    () =>
      goals.map((goal) => ({
        ...goal,
        cycleLabel: goal.cycle?.name || "-",
      })),
    [goals]
  )

  const availableDepartments = useMemo(
    () =>
      (managedDepartments.length > 0
        ? managedDepartments
        : Array.from(new Set(goals.map((goal) => goal.department).filter(Boolean) as string[]))
      ).sort((left, right) => left.localeCompare(right)),
    [goals, managedDepartments]
  )

  const columns = useMemo<DataTableColumn<GoalRow>[]>(
    () => [
      {
        key: "title",
        label: "Goal",
        sortable: true,
        accessor: (row) => row.title,
        resizable: true,
        initialWidth: 280,
        render: (row) => (
          <div>
            <p className="text-foreground font-medium">{row.title}</p>
            {row.description ? (
              <p className="text-muted-foreground truncate text-xs" title={row.description}>
                {row.description}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department || "-",
        hideOnMobile: true,
      },
      {
        key: "cycle",
        label: "Cycle",
        sortable: true,
        accessor: (row) => row.cycleLabel,
        hideOnMobile: true,
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        accessor: (row) => row.priority,
        render: (row) => (
          <Badge variant="outline" className="text-[11px] capitalize">
            {row.priority}
          </Badge>
        ),
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) => (
          <Badge variant="secondary" className="text-[11px] capitalize">
            {String(row.status || "in_progress").replace("_", " ")}
          </Badge>
        ),
      },
      {
        key: "due_date",
        label: "Due Date",
        sortable: true,
        accessor: (row) => row.due_date || "",
        render: (row) => (
          <span className="text-muted-foreground text-xs">{row.due_date ? formatWATDate(row.due_date) : "-"}</span>
        ),
        hideOnMobile: true,
      },
    ],
    []
  )

  const { filters: cycleFilters } = useCycleFilters<GoalRow>({
    cycles,
    getRowCycleId: (row) => row.review_cycle_id,
  })

  const filters = useMemo<DataTableFilter<GoalRow>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        options: availableDepartments.map((d) => ({ value: d, label: d })),
      },
      ...cycleFilters,
    ],
    [availableDepartments, cycleFilters]
  )

  async function handleCreateGoal() {
    if (!form.department || !form.title.trim()) {
      toast.error("Department and goal title are required")
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch("/api/hr/performance/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = (await response.json().catch(() => null)) as { data?: Goal; error?: string } | null
      if (!response.ok || !payload?.data) throw new Error(payload?.error || "Failed to create goal")

      setGoals((current) => [payload.data as Goal, ...current])
      setForm(INITIAL_FORM)
      setIsDialogOpen(false)
      toast.success("Department goal created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create goal")
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveGoal(goal: GoalRow) {
    try {
      const response = await apiFetch(`/api/hr/performance/goals?id=${encodeURIComponent(goal.id)}`, {
        method: "DELETE",
      })
      if (!response.ok) throw new Error("Failed to archive goal")
      setGoals((current) => current.filter((g) => g.id !== goal.id))
      toast.success("Goal archived")
    } catch (error) {
      toast.error("Failed to archive goal")
    }
  }

  return (
    <DataTablePage
      title={pageTitle}
      description={pageDescription}
      icon={Target}
      backLink={{ href: backHref, label: backLabel }}
      actions={
        canCreateGoal ? (
          <Button size="sm" className="h-8 gap-2" onClick={() => setIsDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Goal
          </Button>
        ) : undefined
      }
      stats={
        summaryCards.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
            {summaryCards.map((card, index) => (
              <StatCard
                key={card.label}
                title={card.label}
                value={card.value}
                icon={Target}
                iconBgColor={index === 0 ? "bg-blue-500/10" : index === 1 ? "bg-emerald-500/10" : "bg-amber-500/10"}
                iconColor={index === 0 ? "text-blue-500" : index === 1 ? "text-emerald-500" : "text-amber-500"}
              />
            ))}
          </div>
        ) : undefined
      }
    >
      <DataTable<GoalRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search goal, department, status, or cycle..."
        searchFn={(row, query) =>
          `${row.title} ${row.description || ""} ${row.department || ""} ${row.priority} ${row.status} ${row.cycleLabel}`
            .toLowerCase()
            .includes(query.toLowerCase())
        }
        rowActions={
          canCreateGoal
            ? [
                {
                  label: "Create Task under Goal",
                  icon: ListPlus,
                  onClick: (row) => {
                    window.location.href = `/admin/tasks?goal_id=${encodeURIComponent(row.id)}`
                  },
                },
                {
                  label: "Archive Goal",
                  icon: Trash2,
                  variant: "destructive",
                  onClick: (row) => handleArchiveGoal(row),
                },
              ]
            : undefined
        }
        expandable={{
          render: (row) => (
            <div className="space-y-3 p-3 text-xs">
              <div>
                <p className="text-muted-foreground text-[10px] font-semibold uppercase">Description</p>
                <p className="pt-0.5 text-sm">{row.description || "No description provided."}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                    Linked Tasks
                  </p>
                  {row.linked_tasks && row.linked_tasks.length > 0 ? (
                    <div className="space-y-2">
                      {row.linked_tasks.map((task) => (
                        <div key={task.id} className="rounded border p-2 text-xs">
                          <p className="font-medium">
                            {task.work_item_number ? `${task.work_item_number} - ` : ""}
                            {task.title}
                          </p>
                          <p className="text-muted-foreground capitalize">
                            {String(task.status || "").replace(/_/g, " ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">No linked tasks yet.</p>
                  )}
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                    Linked Help Desk
                  </p>
                  {row.linked_help_desk && row.linked_help_desk.length > 0 ? (
                    <div className="space-y-2">
                      {row.linked_help_desk.map((ticket) => (
                        <div key={ticket.id} className="rounded border p-2 text-xs">
                          <p className="font-medium">
                            {ticket.ticket_number ? `${ticket.ticket_number} - ` : ""}
                            {ticket.title}
                          </p>
                          <p className="text-muted-foreground capitalize">
                            {String(ticket.status || "").replace(/_/g, " ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">No linked help desk tickets yet.</p>
                  )}
                </div>
              </div>
              {showCreateTaskAction ? (
                <Link href={`/admin/tasks?goal_id=${encodeURIComponent(row.id)}`}>
                  <Button size="sm" variant="outline" className="text-xs">
                    Create Task under this Goal
                  </Button>
                </Link>
              ) : null}
            </div>
          ),
        }}
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Strategic Goal</DialogTitle>
            <DialogDescription>
              Create a strategic goal for your department. Tasks can be created directly under this goal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 pt-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Department *</Label>
              <Select
                value={form.department}
                onValueChange={(value) => setForm((current) => ({ ...current, department: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {availableDepartments.map((department) => (
                    <SelectItem key={department} value={department}>
                      {department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Goal Title *</Label>
              <Input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="e.g. Reduce client response time to under 1 hour"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Description</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Key scope and success indicators..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(value) => setForm((current) => ({ ...current, priority: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Due Date</Label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleCreateGoal()}
                disabled={saving || !form.title.trim() || !form.department}
              >
                {saving ? "Saving..." : "Save Goal"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
