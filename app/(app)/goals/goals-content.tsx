"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Plus, Target } from "lucide-react"
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
  pageTitle = "Department Goals",
  pageDescription = "View the department goals already set by your lead.",
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

  const approvalClass = (status: Goal["approval_status"]) => {
    if (status === "approved") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    if (status === "rejected") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
  }

  const columns = useMemo<DataTableColumn<GoalRow>[]>(
    () => [
      {
        key: "title",
        label: "Goal",
        sortable: true,
        accessor: (row) => row.title,
        resizable: true,
        initialWidth: 280,
        render: (row) => <span className="font-medium">{row.title}</span>,
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
        render: (row) => <span className="capitalize">{row.priority}</span>,
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) => <span className="capitalize">{String(row.status || "").replace("_", " ")}</span>,
      },
      {
        key: "approval",
        label: "Approval",
        sortable: true,
        accessor: (row) => row.approval_status,
        render: (row) => <Badge className={approvalClass(row.approval_status)}>{row.approval_status}</Badge>,
      },
      {
        key: "due_date",
        label: "Due Date",
        sortable: true,
        accessor: (row) => row.due_date || "",
        render: (row) => (row.due_date ? formatWATDate(row.due_date) : "-"),
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
        key: "approval_status",
        label: "Approval",
        mode: "custom",
        options: [
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
        ],
        filterFn: (row, selected) => selected.includes(row.approval_status),
      },
      ...cycleFilters,
    ],
    [cycleFilters]
  )

  async function handleCreateGoal() {
    if (!form.department || !form.title) {
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
          `${row.title} ${row.description} ${row.department} ${row.priority} ${row.status} ${row.cycleLabel}`
            .toLowerCase()
            .includes(query)
        }
        expandable={{
          render: (row) => (
            <div className="space-y-3">
              <div>
                <p className="text-muted-foreground text-xs uppercase">Description</p>
                <p className="text-sm">{row.description || "No description provided."}</p>
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
                  <Button size="sm" variant="outline">
                    Create Task
                  </Button>
                </Link>
              ) : null}
            </div>
          ),
        }}
        emptyTitle="No department goals found"
        emptyDescription="No goals match the current filters."
        emptyIcon={Target}
        skeletonRows={5}
        viewToggle
        cardRenderer={(row) => (
          <div className="space-y-3 rounded-xl border p-3.5 sm:p-4">
            <div className="flex items-start justify-between gap-2 border-b pb-2">
              <div>
                <span className="text-foreground block text-sm font-semibold">{row.title}</span>
                {row.department && <span className="text-muted-foreground block text-xs">{row.department}</span>}
              </div>
              <Badge className={approvalClass(row.approval_status)}>{row.approval_status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground block text-[10px] font-medium uppercase">Priority</span>
                <span className="text-foreground font-medium capitalize">{row.priority}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[10px] font-medium uppercase">Due Date</span>
                <span className="text-foreground font-medium">{row.due_date ? formatWATDate(row.due_date) : "-"}</span>
              </div>
            </div>
          </div>
        )}
        urlSync
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Department Goal</DialogTitle>
            <DialogDescription>
              Goals are departmental. After saving the goal, create tasks under it and assign them from task manager.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
                  {availableDepartments.map((department) => (
                    <SelectItem key={department} value={department}>
                      {department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(value) => setForm((current) => ({ ...current, priority: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
                />
              </div>
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
