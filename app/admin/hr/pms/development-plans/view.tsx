"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookOpen, Eye, Pencil, Plus, Target, TrendingUp, Users } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

type PlanAction = {
  id?: string
  title: string
  description?: string | null
  due_date?: string | null
  status?: string | null
  completed_at?: string | null
}

type DevelopmentPlan = {
  id: string
  user_id: string
  review_cycle_id?: string | null
  title: string
  description: string | null
  focus_area: string
  priority: "low" | "medium" | "high"
  status: "active" | "completed" | "cancelled" | "on_hold"
  target_date: string | null
  progress_pct: number | null
  created_at: string
  user?: Profile | null
  actions?: PlanAction[] | null
  review?: { id: string } | null
}

type Cycle = {
  id: string
  name: string
  review_type?: string | null
  start_date?: string | null
  end_date?: string | null
}

const FOCUS_LABELS: Record<string, string> = {
  general: "General",
  communication: "Communication",
  leadership: "Leadership",
  technical: "Technical Skills",
  collaboration: "Collaboration",
  time_management: "Time Management",
  problem_solving: "Problem Solving",
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  completed: "secondary",
  cancelled: "destructive",
  on_hold: "outline",
}

const PRIORITY_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
}

function formatName(profile: Profile | null | undefined) {
  return `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || "Unknown"
}

function formatDate(date: string | null | undefined) {
  if (!date) return "-"
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

function normalizeCycleValue(value: string) {
  return value === "none" ? "" : value
}

function PlanCard({
  plan,
  cycleName,
  onView,
  onEdit,
}: {
  plan: DevelopmentPlan
  cycleName: string
  onView: (plan: DevelopmentPlan) => void
  onEdit: (plan: DevelopmentPlan) => void
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{plan.title}</p>
          <p className="text-muted-foreground text-xs">{formatName(plan.user)}</p>
        </div>
        <Badge variant={STATUS_VARIANTS[plan.status] || "outline"} className="capitalize">
          {plan.status.replace("_", " ")}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Department</p>
          <p>{plan.user?.department || "-"}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Quarter</p>
          <p>{cycleName}</p>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Progress</span>
          <span>{plan.progress_pct || 0}%</span>
        </div>
        <Progress value={plan.progress_pct || 0} className="h-2" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onView(plan)}>
          View
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEdit(plan)}>
          Edit
        </Button>
      </div>
    </div>
  )
}

export function AdminDevelopmentPlansPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  const [plans, setPlans] = useState<DevelopmentPlan[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [viewingPlan, setViewingPlan] = useState<DevelopmentPlan | null>(null)
  const [editingPlan, setEditingPlan] = useState<DevelopmentPlan | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedEmployee, setSelectedEmployee] = useState("")
  const [selectedCycle, setSelectedCycle] = useState("none")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [focusArea, setFocusArea] = useState("general")
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium")
  const [status, setStatus] = useState<"active" | "completed" | "cancelled" | "on_hold">("active")
  const [targetDate, setTargetDate] = useState("")
  const [progressPct, setProgressPct] = useState("0")
  const [actionLines, setActionLines] = useState("")

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [plansRes, profilesRes, cyclesRes] = await Promise.all([
        apiFetch("/api/hr/performance/development-plans?user_id=all_admin"),
        apiFetch("/api/hr/profiles?all=true"),
        apiFetch("/api/hr/performance/cycles"),
      ])
      const [plansData, profilesData, cyclesData] = await Promise.all([
        plansRes.json().catch(() => ({})),
        profilesRes.json().catch(() => ({})),
        cyclesRes.json().catch(() => ({})),
      ])
      if (!plansRes.ok) {
        throw new Error(plansData?.error || "Failed to load development plans")
      }
      setPlans(plansData?.data || [])
      setEmployees(profilesData?.data || [])
      setCycles(cyclesData?.data || [])
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load development plans"
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const cycleNameMap = useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle.name])), [cycles])

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(plans.map((plan) => plan.user?.department).filter(Boolean) as string[]))
        .sort()
        .map((department) => ({ value: department, label: department })),
    [plans]
  )

  const { filters: cycleFilters } = useCycleFilters<DevelopmentPlan>({
    cycles,
    getRowCycleId: (plan) => plan.review_cycle_id,
    cycleKey: "review_cycle",
    cycleLabel: "Quarter",
  })

  const focusOptions = useMemo(() => Object.entries(FOCUS_LABELS).map(([value, label]) => ({ value, label })), [])

  function resetForm() {
    setSelectedEmployee("")
    setSelectedCycle("none")
    setTitle("")
    setDescription("")
    setFocusArea("general")
    setPriority("medium")
    setStatus("active")
    setTargetDate("")
    setProgressPct("0")
    setActionLines("")
    setEditingPlan(null)
  }

  function openCreate() {
    resetForm()
    setIsCreateOpen(true)
  }

  function openEdit(plan: DevelopmentPlan) {
    setEditingPlan(plan)
    setSelectedEmployee(plan.user_id)
    setSelectedCycle(plan.review_cycle_id || "none")
    setTitle(plan.title)
    setDescription(plan.description || "")
    setFocusArea(plan.focus_area)
    setPriority(plan.priority)
    setStatus(plan.status)
    setTargetDate(plan.target_date || "")
    setProgressPct(String(plan.progress_pct || 0))
    setActionLines((plan.actions || []).map((action) => action.title).join("\n"))
    setIsEditOpen(true)
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedEmployee || !title) {
      toast.error("Employee and title are required")
      return
    }
    setIsSubmitting(true)
    try {
      const actions = actionLines
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({ title: line }))

      const res = await apiFetch("/api/hr/performance/development-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedEmployee,
          review_cycle_id: normalizeCycleValue(selectedCycle) || null,
          title,
          description: description || null,
          focus_area: focusArea,
          priority,
          target_date: targetDate || null,
          status,
          actions: actions.length > 0 ? actions : undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to create plan")
      }
      toast.success(data.message || "Development plan created")
      setIsCreateOpen(false)
      resetForm()
      void loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create plan")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleEdit(event: React.FormEvent) {
    event.preventDefault()
    if (!editingPlan) return
    setIsSubmitting(true)
    try {
      const res = await apiFetch("/api/hr/performance/development-plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingPlan.id,
          title,
          description: description || null,
          focus_area: focusArea,
          priority,
          status,
          target_date: targetDate || null,
          progress_pct: Number(progressPct) || 0,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to update plan")
      }
      toast.success(data.message || "Development plan updated")
      setIsEditOpen(false)
      resetForm()
      void loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update plan")
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalPlans = plans.length
  const activePlans = plans.filter((plan) => plan.status === "active").length
  const completedPlans = plans.filter((plan) => plan.status === "completed").length
  const avgProgress =
    plans.length > 0
      ? `${Math.round(plans.reduce((sum, plan) => sum + (plan.progress_pct || 0), 0) / plans.length)}%`
      : "-"

  const columns: DataTableColumn<DevelopmentPlan>[] = useMemo(
    () => [
      {
        key: "employee",
        label: "Employee",
        sortable: true,
        accessor: (plan) => formatName(plan.user),
        render: (plan) => <span className="font-medium">{formatName(plan.user)}</span>,
        resizable: true,
        initialWidth: 180,
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (plan) => plan.user?.department || "-",
        hideOnMobile: true,
      },
      {
        key: "title",
        label: "Plan",
        sortable: true,
        accessor: (plan) => plan.title,
        render: (plan) => <span className="block max-w-[220px] truncate">{plan.title}</span>,
        resizable: true,
        initialWidth: 220,
      },
      {
        key: "review_cycle",
        label: "Quarter",
        sortable: true,
        accessor: (plan) => cycleNameMap.get(plan.review_cycle_id || "") || "-",
        hideOnMobile: true,
      },
      {
        key: "focus_area",
        label: "Focus",
        sortable: true,
        accessor: (plan) => FOCUS_LABELS[plan.focus_area] || plan.focus_area,
        hideOnMobile: true,
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        accessor: (plan) => plan.priority,
        render: (plan) => (
          <Badge variant={PRIORITY_VARIANTS[plan.priority] || "secondary"} className="capitalize">
            {plan.priority}
          </Badge>
        ),
        hideOnMobile: true,
      },
      {
        key: "progress_pct",
        label: "Progress",
        sortable: true,
        accessor: (plan) => plan.progress_pct || 0,
        render: (plan) => (
          <div className="flex items-center gap-2">
            <Progress value={plan.progress_pct || 0} className="h-2 w-20" />
            <span className="text-muted-foreground text-xs">{plan.progress_pct || 0}%</span>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (plan) => plan.status,
        render: (plan) => (
          <Badge variant={STATUS_VARIANTS[plan.status] || "outline"} className="capitalize">
            {plan.status.replace("_", " ")}
          </Badge>
        ),
      },
      {
        key: "target_date",
        label: "Due",
        sortable: true,
        accessor: (plan) => plan.target_date || "",
        render: (plan) => <span className="text-muted-foreground text-sm">{formatDate(plan.target_date)}</span>,
        hideOnMobile: true,
      },
    ],
    [cycleNameMap]
  )

  const filters: DataTableFilter<DevelopmentPlan>[] = useMemo(
    () => [
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
        placeholder: "All Departments",
        mode: "custom",
        filterFn: (plan, values) => values.length === 0 || values.includes(plan.user?.department || ""),
      },
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "on_hold", label: "On Hold" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ],
        placeholder: "All Statuses",
      },
      ...cycleFilters,
      {
        key: "focus_area",
        label: "Focus Area",
        options: focusOptions,
        placeholder: "All Focus Areas",
      },
    ],
    [cycleFilters, departmentOptions, focusOptions]
  )

  const rowActions: RowAction<DevelopmentPlan>[] = [
    {
      label: "View",
      icon: Eye,
      onClick: (plan) => setViewingPlan(plan),
    },
    {
      label: "Edit",
      icon: Pencil,
      onClick: (plan) => openEdit(plan),
    },
  ]

  return (
    <DataTablePage
      title="Development Plans"
      description="Create and track employee development plans linked to performance reviews."
      icon={BookOpen}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms", label: "Back to PMS" }}
      actions={
        <Button onClick={openCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New Plan
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total Plans"
            value={totalPlans}
            icon={BookOpen}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Active"
            value={activePlans}
            icon={Users}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Completed"
            value={completedPlans}
            icon={Target}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Avg Progress"
            value={avgProgress}
            icon={TrendingUp}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<DevelopmentPlan>
        data={plans}
        columns={columns}
        filters={filters}
        getRowId={(plan) => plan.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search employee, department, plan title, or focus area…"
        searchFn={(plan, query) =>
          [
            formatName(plan.user),
            plan.user?.department || "",
            plan.title,
            plan.description || "",
            FOCUS_LABELS[plan.focus_area] || plan.focus_area,
            cycleNameMap.get(plan.review_cycle_id || "") || "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadData()}
        rowActions={rowActions}
        expandable={{
          render: (plan) => (
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">Employee</p>
                <p className="mt-1 font-medium">{formatName(plan.user)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Quarter</p>
                <p className="mt-1">{cycleNameMap.get(plan.review_cycle_id || "") || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Target Date</p>
                <p className="mt-1">{formatDate(plan.target_date)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Action Items</p>
                <p className="mt-1">{plan.actions?.length || 0}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (plan) =>
            plan.status === "completed"
              ? "bg-emerald-500"
              : plan.status === "active"
                ? "bg-blue-500"
                : plan.status === "cancelled"
                  ? "bg-red-500"
                  : "bg-amber-500",
          title: (plan) => `${formatName(plan.user)} · ${plan.title}`,
          subtitle: (plan) =>
            `${plan.user?.department || "No dept"} · ${FOCUS_LABELS[plan.focus_area] || plan.focus_area} · Progress: ${plan.progress_pct}%`,
          trailing: (plan) => (
            <Badge variant={STATUS_VARIANTS[plan.status] || "outline"} className="text-[10px] capitalize">
              {plan.status.replace("_", " ")}
            </Badge>
          ),
          onSelect: (plan) => setViewingPlan(plan),
        }}
        cardRenderer={(plan) => (
          <PlanCard
            plan={plan}
            cycleName={cycleNameMap.get(plan.review_cycle_id || "") || "-"}
            onView={setViewingPlan}
            onEdit={openEdit}
          />
        )}
        emptyTitle="No development plans yet"
        emptyDescription="Create a plan to start tracking employee growth and follow-up actions."
        emptyIcon={BookOpen}
        skeletonRows={6}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Development Plan</DialogTitle>
            <DialogDescription>
              Create a development plan for an employee, optionally linked to a review cycle.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleCreate(event)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>Employee *</Label>
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee…" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {formatName(employee)} {employee.department ? `(${employee.department})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Plan Title *</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Focus Area</Label>
                <Select value={focusArea} onValueChange={setFocusArea}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FOCUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as "low" | "medium" | "high")}>
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
                <Label>Review Cycle</Label>
                <Select value={selectedCycle} onValueChange={setSelectedCycle}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
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
              <div className="space-y-2">
                <Label>Target Date</Label>
                <Input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Action Steps</Label>
              <Textarea value={actionLines} onChange={(event) => setActionLines(event.target.value)} rows={4} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Development Plan</DialogTitle>
            <DialogDescription>Update the plan details, status, and progress tracking.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleEdit(event)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>Plan Title *</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Focus Area</Label>
                <Select value={focusArea} onValueChange={setFocusArea}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FOCUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as "low" | "medium" | "high")}>
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
                <Label>Status</Label>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as "active" | "completed" | "cancelled" | "on_hold")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Progress %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={progressPct}
                  onChange={(event) => setProgressPct(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Target Date</Label>
                <Input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewingPlan)} onOpenChange={() => setViewingPlan(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewingPlan?.title || "Plan Details"}</DialogTitle>
            <DialogDescription>
              {viewingPlan ? `${formatName(viewingPlan.user)} • ${viewingPlan.user?.department || "-"}` : ""}
            </DialogDescription>
          </DialogHeader>
          {viewingPlan ? (
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">Quarter</p>
                <p className="mt-1">{cycleNameMap.get(viewingPlan.review_cycle_id || "") || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Due Date</p>
                <p className="mt-1">{formatDate(viewingPlan.target_date)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Priority</p>
                <p className="mt-1 capitalize">{viewingPlan.priority}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Progress</p>
                <p className="mt-1">{viewingPlan.progress_pct || 0}%</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground text-xs">Description</p>
                <p className="mt-1 whitespace-pre-wrap">{viewingPlan.description || "No description provided."}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-muted-foreground text-xs">Action Steps</p>
                <div className="mt-1 space-y-2">
                  {(viewingPlan.actions || []).length > 0 ? (
                    (viewingPlan.actions || []).map((action, index) => (
                      <div key={action.id || `${action.title}-${index}`} className="rounded-lg border p-3">
                        <p className="font-medium">{action.title}</p>
                        <p className="text-muted-foreground text-xs">{action.status || "pending"}</p>
                      </div>
                    ))
                  ) : (
                    <p>No action steps added.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
