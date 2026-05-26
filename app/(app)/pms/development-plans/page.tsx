"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2 } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"

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
  if (!date) return null
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

export default function DevelopmentPlansPage() {
  const [plans, setPlans] = useState<DevelopmentPlan[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [statusFilter, setStatusFilter] = useState("all")

  const loadPlans = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/hr/performance/development-plans")
      const data = (await res.json().catch(() => ({}))) as { data?: DevelopmentPlan[]; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to load plans")
      setPlans(data.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  async function markActionDone(planId: string, actionId: string) {
    try {
      const res = await fetch("/api/hr/performance/development-plans/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: actionId, status: "completed" }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Failed to update")
      }
      toast.success("Action marked complete")
      // Optimistic update
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

  const filtered = useMemo(
    () => plans.filter((p) => statusFilter === "all" || p.status === statusFilter),
    [plans, statusFilter]
  )

  const activePlans = plans.filter((p) => p.status === "active")
  const completedPlans = plans.filter((p) => p.status === "completed")

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Development Plans"
        description="Track your personal development goals and action steps set by your manager."
        icon={BookOpen}
        backLink={{ href: "/pms", label: "Back to PMS" }}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard title="Active Plans" value={activePlans.length} icon={BookOpen} description="In progress" />
        <StatCard title="Completed" value={completedPlans.length} icon={CheckCircle2} description="Finished plans" />
        <StatCard
          title="Total Actions"
          value={plans.reduce((sum, p) => sum + (p.actions?.length || 0), 0)}
          icon={Clock}
          description="Across all plans"
        />
      </div>

      <div className="mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-16">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading your development plans…
        </div>
      ) : error ? (
        <div className="space-y-2 py-8">
          <p className="text-sm text-red-500">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void loadPlans()}>
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="text-muted-foreground mx-auto mb-3 h-10 w-10" />
            <p className="font-medium">No development plans yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Your manager will create development plans linked to your performance reviews. Check back after your next
              review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((plan) => {
            const isExpanded = expanded[plan.id] ?? true
            const completedActions = (plan.actions || []).filter((a) => a.status === "completed").length
            const totalActions = plan.actions?.length || 0
            const progress =
              totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : (plan.progress_pct ?? 0)

            return (
              <Card key={plan.id}>
                <CardHeader
                  className="cursor-pointer select-none"
                  onClick={() => setExpanded((prev) => ({ ...prev, [plan.id]: !isExpanded }))}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      {isExpanded ? (
                        <ChevronDown className="text-muted-foreground mt-1 h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="text-muted-foreground mt-1 h-4 w-4 shrink-0" />
                      )}
                      <div>
                        <CardTitle className="text-base">{plan.title}</CardTitle>
                        <CardDescription className="mt-1">
                          {FOCUS_LABELS[plan.focus_area] || plan.focus_area}
                          {plan.target_date ? ` · Due ${formatDate(plan.target_date)}` : ""}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={PRIORITY_VARIANTS[plan.priority] || "secondary"} className="capitalize">
                        {plan.priority}
                      </Badge>
                      <Badge variant={STATUS_VARIANTS[plan.status] || "outline"} className="capitalize">
                        {plan.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>
                  {totalActions > 0 && (
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={progress} className="h-2 flex-1" />
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {completedActions}/{totalActions} actions
                      </span>
                    </div>
                  )}
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0">
                    {plan.description && <p className="text-muted-foreground mb-4 text-sm">{plan.description}</p>}

                    {plan.actions && plan.actions.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold">Action Steps</p>
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
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </PageWrapper>
  )
}
