"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookOpen, CheckCircle2, Clock } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { apiFetch } from "@/lib/api-client"
import { useCycleFilters, type CycleFilterCycle } from "@/components/pms/use-cycle-filters"

type PlanAction = {
  id: string
  title: string
  description: string | null
  status: "pending" | "in_progress" | "completed" | "skipped"
  due_date: string | null
  completed_at: string | null
}

type DevelopmentPlan = {
  id: string
  title: string
  description: string | null
  focus_area: string
  priority: "low" | "medium" | "high"
  status: "active" | "completed" | "cancelled" | "on_hold"
  target_date: string | null
  progress_pct: number | null
  completed_at: string | null
  created_at: string
  review_cycle_id: string | null
  actions?: PlanAction[]
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

function formatDate(date: string | null) {
  if (!date) return "-"
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

function planProgress(plan: DevelopmentPlan) {
  const totalActions = plan.actions?.length || 0
  const completedActions = (plan.actions || []).filter((a) => a.status === "completed").length
  return totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : (plan.progress_pct ?? 0)
}

export default function DevelopmentPlansPage() {
  const [plans, setPlans] = useState<DevelopmentPlan[]>([])
  const [cycles, setCycles] = useState<CycleFilterCycle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPlans = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [plansRes, cyclesRes] = await Promise.all([
        apiFetch("/api/hr/performance/development-plans"),
        apiFetch("/api/hr/performance/cycles"),
      ])
      const data = (await plansRes.json().catch(() => ({}))) as { data?: DevelopmentPlan[]; error?: string }
      const cyclesData = (await cyclesRes.json().catch(() => ({}))) as { data?: CycleFilterCycle[] }
      if (!plansRes.ok) throw new Error(data.error || "Failed to load plans")
      setPlans(data.data || [])
      setCycles(cyclesData.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const { filters: cycleFilters } = useCycleFilters<DevelopmentPlan>({
    cycles,
    getRowCycleId: (plan) => plan.review_cycle_id,
    cycleKey: "review_cycle",
    cycleLabel: "Quarter",
  })

  async function markActionDone(planId: string, actionId: string) {
    try {
      const res = await apiFetch("/api/hr/performance/development-plans/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: actionId, status: "completed" }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Failed to update")
      }
      toast.success("Action marked complete")
      setPlans((current) =>
        current.map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                actions: (plan.actions || []).map((action) =>
                  action.id === actionId
                    ? { ...action, status: "completed" as const, completed_at: new Date().toISOString() }
                    : action
                ),
              }
            : plan
        )
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update action")
    }
  }

  const activePlans = plans.filter((p) => p.status === "active")
  const completedPlans = plans.filter((p) => p.status === "completed")

  const columns = useMemo<DataTableColumn<DevelopmentPlan>[]>(
    () => [
      {
        key: "title",
        label: "Plan",
        sortable: true,
        accessor: (plan) => plan.title,
        render: (plan) => (
          <div className="flex flex-col">
            <span className="font-medium">{plan.title}</span>
            <span className="text-muted-foreground text-[11px]">
              {FOCUS_LABELS[plan.focus_area] || plan.focus_area}
            </span>
          </div>
        ),
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
        key: "progress",
        label: "Progress",
        sortable: true,
        accessor: (plan) => planProgress(plan),
        render: (plan) => {
          const totalActions = plan.actions?.length || 0
          const completedActions = (plan.actions || []).filter((a) => a.status === "completed").length
          return (
            <div className="w-28 space-y-1">
              <Progress value={planProgress(plan)} className="h-1.5" />
              <span className="text-muted-foreground text-[11px]">
                {totalActions > 0 ? `${completedActions}/${totalActions} actions` : `${planProgress(plan)}%`}
              </span>
            </div>
          )
        },
      },
      {
        key: "target_date",
        label: "Due",
        sortable: true,
        accessor: (plan) => plan.target_date || "",
        render: (plan) => <span className="text-xs">{formatDate(plan.target_date)}</span>,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<DevelopmentPlan>[]>(
    () => [
      ...cycleFilters,
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "on_hold", label: "On Hold" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        key: "priority",
        label: "Priority",
        options: [
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
    ],
    [cycleFilters]
  )

  return (
    <DataTablePage
      title="Development Plans"
      description="Your personal development goals and action steps, set by your manager."
      icon={BookOpen}
      backLink={{ href: "/pms", label: "Back to PMS" }}
      spacing="tight"
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            variant="compact"
            title="Active Plans"
            value={activePlans.length}
            icon={BookOpen}
            description="In progress"
          />
          <StatCard
            variant="compact"
            title="Completed"
            value={completedPlans.length}
            icon={CheckCircle2}
            description="Finished plans"
          />
          <StatCard
            variant="compact"
            title="Total Actions"
            value={plans.reduce((sum, p) => sum + (p.actions?.length || 0), 0)}
            icon={Clock}
            description="Across all plans"
          />
        </div>
      }
    >
      <DataTable<DevelopmentPlan>
        data={plans}
        columns={columns}
        filters={filters}
        getRowId={(plan) => plan.id}
        searchPlaceholder="Search plan title or focus area..."
        searchFn={(plan, query) =>
          `${plan.title} ${plan.description || ""} ${FOCUS_LABELS[plan.focus_area] || plan.focus_area}`
            .toLowerCase()
            .includes(query.toLowerCase())
        }
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadPlans()}
        emptyTitle="No Development Plans Yet"
        emptyDescription="Your manager will create development plans linked to your performance reviews. Check back after your next review."
        emptyIcon={BookOpen}
        viewToggle
        stickyToolbar
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          title: (plan) => plan.title,
          subtitle: (plan) => FOCUS_LABELS[plan.focus_area] || plan.focus_area,
          trailing: (plan) => (
            <Badge variant={STATUS_VARIANTS[plan.status] || "outline"} className="text-[10px] capitalize">
              {plan.status.replace("_", " ")}
            </Badge>
          ),
          detail: {
            title: (plan) => plan.title,
            badges: (plan) => (
              <Badge variant={STATUS_VARIANTS[plan.status] || "outline"} className="capitalize">
                {plan.status.replace("_", " ")}
              </Badge>
            ),
            fields: (plan) => [
              { label: "Focus area", value: FOCUS_LABELS[plan.focus_area] || plan.focus_area },
              { label: "Priority", value: plan.priority },
              {
                label: "Progress",
                value: `${planProgress(plan)}% — ${(plan.actions || []).filter((a) => a.status === "completed").length}/${plan.actions?.length || 0} actions`,
              },
              { label: "Due date", value: formatDate(plan.target_date) },
              { label: "Description", value: plan.description || null },
            ],
          },
        }}
        expandable={{
          render: (plan) => (
            <div className="space-y-3">
              {plan.description && <p className="text-muted-foreground text-sm">{plan.description}</p>}
              {plan.actions && plan.actions.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide uppercase">Action Steps</p>
                  {plan.actions.map((action) => (
                    <div
                      key={action.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                        action.status === "completed" ? "bg-muted/30" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => action.status !== "completed" && void markActionDone(plan.id, action.id)}
                        disabled={action.status === "completed"}
                        className="mt-0.5 shrink-0"
                      >
                        {action.status === "completed" ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                        ) : (
                          <div className="border-muted-foreground h-5 w-5 rounded-full border-2" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-medium ${action.status === "completed" ? "line-through opacity-60" : ""}`}
                        >
                          {action.title}
                        </p>
                        {action.description && (
                          <p className="text-muted-foreground mt-0.5 text-xs">{action.description}</p>
                        )}
                        {action.due_date && (
                          <p className="text-muted-foreground mt-1 text-xs">Due: {formatDate(action.due_date)}</p>
                        )}
                      </div>
                      <Badge
                        variant={action.status === "completed" ? "secondary" : "outline"}
                        className="shrink-0 text-xs capitalize"
                      >
                        {action.status.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No action steps defined for this plan yet.</p>
              )}
            </div>
          ),
        }}
        urlSync
      />
    </DataTablePage>
  )
}
