"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Brain, Eye, RefreshCw, RotateCcw } from "lucide-react"
import { CbtAttemptDetail } from "@/components/pms/cbt-attempt-detail"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type TabKey = "individual" | "department" | "cycle"

type ReviewCycle = {
  id: string
  name: string
  review_type: string | null
  start_date?: string | null
  end_date?: string | null
}

type CbtUser = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
  employment_type?: "full_time" | "part_time" | "contract" | null
  employment_status?: string | null
}

type CbtScore = {
  user_id: string
  review_cycle_id: string
  cbt_score: number | null
  tab_switch_count?: number
}

type CbtPayload = {
  users: CbtUser[]
  cycles: ReviewCycle[]
  scores: CbtScore[]
}

type IndividualRow = {
  id: string
  user_id: string
  review_cycle_id: string
  employee: string
  department: string
  cycle: string
  cbt_score: number | null
  tab_switch_count: number
  employment_type: "full_time" | "part_time" | "contract" | null
  employment_status: string | null
}

type DepartmentRow = {
  id: string
  department: string
  cycleId: string
  cycle: string
  total_employees: number
  scores_recorded: number
  average_score: number | null
}

type CycleRow = {
  id: string
  cycle: string
  review_type: string
  total_employees: number
  scores_recorded: number
  average_score: number | null
  questions: number
}

const TABS: DataTableTab[] = [
  { key: "individual", label: "Individual" },
  { key: "department", label: "Department" },
  { key: "cycle", label: "Cycle" },
]

function employeeName(user: CbtUser | undefined) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Employee"
}

function scoreLabel(score: number | null) {
  return typeof score === "number" ? `${score}%` : "-"
}

function formatCycleName(name: string | null | undefined): string {
  if (!name) return "-"
  const cleaned = name.replace(/[-–—:]?\s*performance\s+review\s*[-–—:]?/gi, "").trim()
  return cleaned || name
}

function IndividualCard({ row }: { row: IndividualRow }) {
  const hasTaken = typeof row.cbt_score === "number"
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{row.employee}</p>
          <p className="text-muted-foreground text-xs">{row.department}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge
            className={
              hasTaken
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 shadow-none dark:text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            }
          >
            {hasTaken ? "Taken" : "Not Taken"}
          </Badge>
          <Badge variant={hasTaken && (row.cbt_score ?? 0) >= 70 ? "default" : "secondary"}>
            {scoreLabel(row.cbt_score)}
          </Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Cycle</p>
          <p>{formatCycleName(row.cycle)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Tab Switches</p>
          <Badge
            variant="outline"
            className={
              row.tab_switch_count > 0
                ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-border text-muted-foreground"
            }
          >
            {row.tab_switch_count}
          </Badge>
        </div>
      </div>
    </div>
  )
}

function DepartmentCard({ row }: { row: DepartmentRow }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{row.department}</p>
          <p className="text-muted-foreground text-xs">{formatCycleName(row.cycle)}</p>
        </div>
        <Badge variant="secondary">
          {row.scores_recorded} / {row.total_employees} completed
        </Badge>
      </div>
      <div className="text-sm">
        <p className="text-muted-foreground text-xs">Average Score</p>
        <p className="font-medium">{scoreLabel(row.average_score)}</p>
      </div>
    </div>
  )
}

function CycleCard({ row, onView }: { row: CycleRow; onView?: (row: CycleRow) => void }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{formatCycleName(row.cycle)}</p>
          <p className="text-muted-foreground text-xs">{row.review_type}</p>
        </div>
        <Badge variant="secondary">{row.questions} questions</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Completed</p>
          <p>
            {row.scores_recorded} / {row.total_employees}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Average Score</p>
          <p>{scoreLabel(row.average_score)}</p>
        </div>
      </div>
      {onView && (
        <Button size="sm" variant="outline" onClick={() => onView(row)}>
          Manage Questions
        </Button>
      )}
    </div>
  )
}

export default function AdminPmsCbtPage({ deptId }: { deptId?: string } = {}) {
  const isLeadView = Boolean(deptId)
  const basePath = deptId ? `/dept/${deptId}/hr/pms/cbt` : "/admin/hr/pms/cbt"
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>("individual")
  const [selectedCycleId, setSelectedCycleId] = useState("all")
  const [data, setData] = useState<CbtPayload>({ users: [], cycles: [], scores: [] })
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({})
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedSnapshotRef = useRef(false)
  const [resetConfirmRow, setResetConfirmRow] = useState<IndividualRow | null>(null)
  const [isResetting, setIsResetting] = useState(false)

  const loadCbtSnapshot = useCallback(async () => {
    if (hasLoadedSnapshotRef.current) {
      setIsRefreshing(true)
    } else {
      setIsInitialLoading(true)
    }
    setError(null)
    try {
      const response = await fetch("/api/hr/performance/cbt", { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as { data?: CbtPayload; error?: string } | null
      if (!response.ok || !payload?.data) throw new Error(payload?.error || "Failed to load CBT data")
      const snapshot = payload.data
      setData(snapshot)
      hasLoadedSnapshotRef.current = true
      setSelectedCycleId((current) => current || "all")

      const counts = await Promise.all(
        snapshot.cycles.map(async (cycle) => {
          const questionsResponse = await fetch(
            `/api/hr/performance/cbt/questions?cycle_id=${encodeURIComponent(cycle.id)}`,
            {
              cache: "no-store",
            }
          )
          const questionsPayload = (await questionsResponse.json().catch(() => null)) as {
            data?: Array<{ id: string }>
          } | null
          return [cycle.id, questionsPayload?.data?.length || 0] as const
        })
      )
      setQuestionCounts(Object.fromEntries(counts))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load CBT data"
      setError(message)
      toast.error(message)
    } finally {
      setIsInitialLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadCbtSnapshot()
  }, [loadCbtSnapshot])

  const cycleNameById = useMemo(() => new Map(data.cycles.map((cycle) => [cycle.id, cycle.name])), [data.cycles])

  const individualRows = useMemo<IndividualRow[]>(() => {
    const scoreMap = new Map<string, CbtScore>()
    for (const score of data.scores) {
      scoreMap.set(`${score.user_id}:${score.review_cycle_id}`, score)
    }

    const rows: IndividualRow[] = []

    if (data.cycles.length > 0) {
      for (const cycle of data.cycles) {
        for (const user of data.users) {
          const key = `${user.id}:${cycle.id}`
          const score = scoreMap.get(key)
          rows.push({
            id: `${user.id}-${cycle.id}`,
            user_id: user.id,
            review_cycle_id: cycle.id,
            employee: employeeName(user),
            department: user.department || "-",
            cycle: cycle.name,
            cbt_score: score ? score.cbt_score : null,
            tab_switch_count: score ? (score.tab_switch_count ?? 0) : 0,
            employment_type: user.employment_type || "full_time",
            employment_status: user.employment_status || "active",
          })
        }
      }
    } else {
      for (const user of data.users) {
        rows.push({
          id: `${user.id}-none`,
          user_id: user.id,
          review_cycle_id: "",
          employee: employeeName(user),
          department: user.department || "-",
          cycle: "-",
          cbt_score: null,
          tab_switch_count: 0,
          employment_type: user.employment_type || "full_time",
          employment_status: user.employment_status || "active",
        })
      }
    }

    return rows
  }, [data.cycles, data.scores, data.users])

  const departmentRows = useMemo<DepartmentRow[]>(() => {
    const allDepts = Array.from(new Set(data.users.map((u) => u.department).filter(Boolean) as string[])).sort()
    const rows: DepartmentRow[] = []

    for (const cycle of data.cycles) {
      for (const dept of allDepts) {
        const deptUsers = data.users.filter((u) => u.department === dept)
        const deptUserIds = new Set(deptUsers.map((u) => u.id))
        const scores = data.scores.filter(
          (s) => s.review_cycle_id === cycle.id && deptUserIds.has(s.user_id) && typeof s.cbt_score === "number"
        )

        const totalScores = scores.reduce((sum, s) => sum + (s.cbt_score ?? 0), 0)
        const avg = scores.length > 0 ? Math.round((totalScores / scores.length) * 10) / 10 : null

        rows.push({
          id: `${dept}::${cycle.id}`,
          department: dept,
          cycleId: cycle.id,
          cycle: cycle.name,
          total_employees: deptUsers.length,
          scores_recorded: scores.length,
          average_score: avg,
        })
      }
    }

    return rows
  }, [data.cycles, data.scores, data.users])

  const cycleRows = useMemo<CycleRow[]>(() => {
    return data.cycles.map((cycle) => {
      const scores = data.scores.filter((s) => s.review_cycle_id === cycle.id && typeof s.cbt_score === "number")
      const totalScores = scores.reduce((sum, s) => sum + (s.cbt_score ?? 0), 0)
      const avg = scores.length > 0 ? Math.round((totalScores / scores.length) * 10) / 10 : null

      return {
        id: cycle.id,
        cycle: cycle.name,
        review_type: cycle.review_type || "-",
        total_employees: data.users.length,
        scores_recorded: scores.length,
        average_score: avg,
        questions: questionCounts[cycle.id] || 0,
      }
    })
  }, [data.cycles, data.scores, data.users.length, questionCounts])

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(data.users.map((user) => user.department).filter(Boolean) as string[]))
        .sort()
        .map((department) => ({ value: department, label: department })),
    [data.users]
  )

  const { filters: individualCycleFilters } = useCycleFilters<IndividualRow>({
    cycles: data.cycles,
    getRowCycleId: (row) => row.review_cycle_id,
    defaultCadence: "all",
  })
  const { filters: departmentCycleFilters } = useCycleFilters<DepartmentRow>({
    cycles: data.cycles,
    getRowCycleId: (row) => row.cycleId,
    defaultCadence: "all",
  })
  const { filters: cycleTabCycleFilters } = useCycleFilters<CycleRow>({
    cycles: data.cycles,
    getRowCycleId: (row) => row.id,
    defaultCadence: "all",
  })

  const individualColumns: DataTableColumn<IndividualRow>[] = [
    {
      key: "employee",
      label: "Employee",
      sortable: true,
      accessor: (row) => row.employee,
      render: (row) => <span className="font-medium">{row.employee}</span>,
      resizable: true,
      initialWidth: 200,
    },
    { key: "department", label: "Department", sortable: true, accessor: (row) => row.department, hideOnMobile: true },
    {
      key: "employment_type",
      label: "Staff type",
      sortable: true,
      accessor: (row) => row.employment_type || "full_time",
      render: (row) => {
        const type = row.employment_type || "full_time"
        const display = type === "full_time" ? "Full Time" : type === "part_time" ? "Part Time" : "Contract"
        const badgeColor =
          type === "full_time"
            ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/10 border-transparent shadow-none"
            : type === "part_time"
              ? "bg-purple-500/10 text-purple-500 hover:bg-purple-500/10 border-transparent shadow-none"
              : "bg-orange-500/10 text-orange-500 hover:bg-orange-500/10 border-transparent shadow-none"
        return <Badge className={badgeColor}>{display}</Badge>
      },
      hideOnMobile: true,
    },
    {
      key: "cbt_status",
      label: "CBT Status",
      sortable: true,
      accessor: (row) => (typeof row.cbt_score === "number" ? "Taken" : "Not Taken"),
      render: (row) => {
        const hasTaken = typeof row.cbt_score === "number"
        return hasTaken ? (
          <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 shadow-none hover:bg-emerald-500/10 dark:text-emerald-400">
            Taken
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            Not Taken
          </Badge>
        )
      },
    },
    {
      key: "cycle",
      label: "Cycle",
      sortable: true,
      accessor: (row) => formatCycleName(row.cycle),
      render: (row) => formatCycleName(row.cycle),
      resizable: true,
      initialWidth: 150,
      hideOnMobile: true,
    },
    {
      key: "cbt_score",
      label: "CBT Score",
      sortable: true,
      accessor: (row) => row.cbt_score ?? -1,
      render: (row) => (
        <Badge variant={typeof row.cbt_score === "number" && row.cbt_score >= 70 ? "default" : "secondary"}>
          {scoreLabel(row.cbt_score)}
        </Badge>
      ),
    },
    {
      key: "tab_switch_count",
      label: "Tab Switches",
      sortable: true,
      accessor: (row) => row.tab_switch_count,
      render: (row) => (
        <Badge
          variant="outline"
          className={
            row.tab_switch_count > 0
              ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "border-border text-muted-foreground"
          }
        >
          {row.tab_switch_count}
        </Badge>
      ),
      hideOnMobile: true,
    },
  ]

  const departmentColumns: DataTableColumn<DepartmentRow>[] = [
    {
      key: "department",
      label: "Department",
      sortable: true,
      accessor: (row) => row.department,
      resizable: true,
      initialWidth: 200,
    },
    {
      key: "cycle",
      label: "Cycle",
      sortable: true,
      accessor: (row) => formatCycleName(row.cycle),
      render: (row) => formatCycleName(row.cycle),
      resizable: true,
      initialWidth: 150,
      hideOnMobile: true,
    },
    {
      key: "total_employees",
      label: "Total Staff",
      sortable: true,
      accessor: (row) => row.total_employees,
      hideOnMobile: true,
    },
    {
      key: "scores_recorded",
      label: "Completed",
      sortable: true,
      accessor: (row) => row.scores_recorded,
      render: (row) => (
        <span>
          {row.scores_recorded} / {row.total_employees}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "average_score",
      label: "Average Score",
      sortable: true,
      accessor: (row) => row.average_score ?? -1,
      render: (row) => (
        <Badge variant={typeof row.average_score === "number" && row.average_score >= 70 ? "default" : "secondary"}>
          {scoreLabel(row.average_score)}
        </Badge>
      ),
    },
  ]

  const cycleColumns: DataTableColumn<CycleRow>[] = [
    {
      key: "cycle",
      label: "Cycle",
      sortable: true,
      accessor: (row) => formatCycleName(row.cycle),
      render: (row) => <span className="font-medium">{formatCycleName(row.cycle)}</span>,
      resizable: true,
      initialWidth: 180,
    },
    {
      key: "review_type",
      label: "Review Type",
      sortable: true,
      accessor: (row) => row.review_type,
      hideOnMobile: true,
    },
    {
      key: "total_employees",
      label: "Total Staff",
      sortable: true,
      accessor: (row) => row.total_employees,
      hideOnMobile: true,
    },
    {
      key: "scores_recorded",
      label: "Completed",
      sortable: true,
      accessor: (row) => row.scores_recorded,
      render: (row) => (
        <span>
          {row.scores_recorded} / {row.total_employees}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "average_score",
      label: "Average Score",
      sortable: true,
      accessor: (row) => row.average_score ?? -1,
      render: (row) => (
        <Badge variant={typeof row.average_score === "number" && row.average_score >= 70 ? "default" : "secondary"}>
          {scoreLabel(row.average_score)}
        </Badge>
      ),
    },
    { key: "questions", label: "Questions", sortable: true, accessor: (row) => row.questions, hideOnMobile: true },
  ]

  const individualFilters: DataTableFilter<IndividualRow>[] = [
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: "All Departments",
    },
    {
      key: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "contract", label: "Contract" },
        { value: "suspended", label: "Suspended" },
        { value: "on_leave", label: "On Leave" },
        { value: "exited", label: "Exited" },
      ],
      placeholder: "Active Statuses",
      defaultValues: ["active", "contract", "suspended", "on_leave"],
      mode: "custom",
      filterFn: (row, selected) => selected.includes(row.employment_status || "active"),
    },
    {
      key: "employment_type",
      label: "Staff type",
      options: [
        { value: "full_time", label: "Full Time" },
        { value: "part_time", label: "Part Time" },
        { value: "contract", label: "Contract" },
      ],
      placeholder: "All Types",
      defaultValues: ["full_time"],
      mode: "custom",
      filterFn: (row, selected) => selected.includes(row.employment_type || "full_time"),
    },
    {
      key: "cbt_status",
      label: "CBT Status",
      options: [
        { value: "taken", label: "Taken" },
        { value: "not_taken", label: "Not Taken" },
      ],
      placeholder: "All CBT Statuses",
      mode: "custom",
      filterFn: (row, selected) => {
        const isTaken = typeof row.cbt_score === "number"
        if (selected.includes("taken") && isTaken) return true
        if (selected.includes("not_taken") && !isTaken) return true
        return false
      },
    },
    ...individualCycleFilters,
  ]

  const departmentFilters: DataTableFilter<DepartmentRow>[] = [
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: "All Departments",
    },
    ...departmentCycleFilters,
  ]

  const cycleFilters: DataTableFilter<CycleRow>[] = [
    ...cycleTabCycleFilters,
    {
      key: "question_band",
      label: "Question Count",
      options: [
        { value: "0", label: "No Questions" },
        { value: "1-10", label: "1-10" },
        { value: "11+", label: "11+" },
      ],
      placeholder: "All Counts",
      mode: "custom",
      filterFn: (row, values) => {
        if (values.length === 0) return true
        return values.some((value) => {
          if (value === "0") return row.questions === 0
          if (value === "1-10") return row.questions >= 1 && row.questions <= 10
          if (value === "11+") return row.questions >= 11
          return false
        })
      },
    },
  ]

  // Regular CBT questions are authored by the department lead who owns them —
  // admins never get a "Manage Questions" action here, only the score/count
  // view (see the API-level content redaction in the questions route).
  const cycleRowActions: RowAction<CycleRow>[] = isLeadView
    ? [
        {
          label: "Manage Questions",
          icon: Eye,
          onClick: (row) => router.push(`${basePath}/question?cycleId=${encodeURIComponent(row.id)}`),
        },
      ]
    : []

  const individualRowActions: RowAction<IndividualRow>[] = [
    {
      label: "Reset CBT Attempt",
      icon: RotateCcw,
      variant: "destructive",
      hidden: (row) => row.cbt_score === null,
      onClick: (row) => setResetConfirmRow(row),
    },
  ]

  async function handleResetAttempt() {
    if (!resetConfirmRow) return
    setIsResetting(true)
    try {
      const response = await apiFetch("/api/admin/hr/performance/cbt/attempts/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: resetConfirmRow.user_id,
          review_cycle_id: resetConfirmRow.review_cycle_id,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || "Failed to reset CBT attempt")
      toast.success(payload?.message || "CBT attempt reset")
      setResetConfirmRow(null)
      void loadCbtSnapshot()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset CBT attempt")
    } finally {
      setIsResetting(false)
    }
  }

  const activeRowCount =
    tab === "individual" ? individualRows.length : tab === "department" ? departmentRows.length : cycleRows.length
  const scoreCount =
    tab === "individual"
      ? individualRows.filter((row) => typeof row.cbt_score === "number").length
      : tab === "department"
        ? departmentRows.reduce((sum, row) => sum + row.scores_recorded, 0)
        : cycleRows.reduce((sum, row) => sum + row.scores_recorded, 0)

  return (
    <DataTablePage
      title="PMS CBT"
      description="Review CBT results by employee, department, or cycle, then open the question manager to add or edit CBT tests."
      icon={Brain}
      backLink={{ href: deptId ? `/dept/${deptId}/hr/pms` : "/admin/hr/pms", label: "Back to PMS" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={(value) => setTab(value as TabKey)}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadCbtSnapshot()} disabled={isRefreshing}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {isLeadView ? (
            // Bonus questions are an admin-only concern (leads can't author
            // for the "Bonus" pseudo-department), so this stays hidden here.
            <Link href={`${basePath}/question`}>
              <Button size="sm">Create Test</Button>
            </Link>
          ) : (
            // Regular question creation moved to the owning department lead —
            // admins keep Bonus Questions only.
            <Link href="/admin/hr/pms/cbt/extra">
              <Button variant="outline" size="sm">
                Bonus Questions
              </Button>
            </Link>
          )}
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Rows"
            value={activeRowCount}
            icon={Brain}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Scores Recorded"
            value={scoreCount}
            icon={Brain}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Cycles"
            value={data.cycles.length}
            icon={Brain}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Selected Cycle"
            value={selectedCycleId === "all" ? "All" : cycleNameById.get(selectedCycleId) || "Current"}
            icon={Brain}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      {tab === "individual" ? (
        <DataTable<IndividualRow>
          data={individualRows}
          columns={individualColumns}
          filters={individualFilters}
          getRowId={(row) => row.id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search employee, department, cycle, status, or score..."
          searchFn={(row, query) =>
            [
              row.employee,
              row.department,
              row.cycle,
              typeof row.cbt_score === "number" ? "taken completed" : "not taken pending",
              scoreLabel(row.cbt_score),
            ]
              .join(" ")
              .toLowerCase()
              .includes(query)
          }
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadCbtSnapshot()}
          rowActions={individualRowActions}
          forceRowActionsDropdown
          expandable={{
            render: (row) => <CbtAttemptDetail profileId={row.user_id} reviewCycleId={row.review_cycle_id} />,
          }}
          viewToggle
          cardRenderer={(row) => <IndividualCard row={row} />}
          emptyTitle="No CBT records found"
          emptyDescription="Scores will appear here once employees start completing CBT assessments."
          emptyIcon={Brain}
          skeletonRows={6}
        />
      ) : null}

      {tab === "department" ? (
        <DataTable<DepartmentRow>
          data={departmentRows}
          columns={departmentColumns}
          filters={departmentFilters}
          getRowId={(row) => row.id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search department, cycle, or average score..."
          searchFn={(row, query) =>
            [row.department, row.cycle, scoreLabel(row.average_score)].join(" ").toLowerCase().includes(query)
          }
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadCbtSnapshot()}
          expandable={{
            render: (row) => (
              <div className="grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground text-xs">Department</p>
                  <p className="mt-1">{row.department}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Scores Recorded</p>
                  <p className="mt-1">{row.scores_recorded}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Average Score</p>
                  <p className="mt-1">{scoreLabel(row.average_score)}</p>
                </div>
              </div>
            ),
          }}
          viewToggle
          cardRenderer={(row) => <DepartmentCard row={row} />}
          emptyTitle="No department CBT summary found"
          emptyDescription="Department averages will appear here when cycles have CBT scores."
          emptyIcon={Brain}
          skeletonRows={6}
        />
      ) : null}

      {tab === "cycle" ? (
        <DataTable<CycleRow>
          data={cycleRows}
          columns={cycleColumns}
          filters={cycleFilters}
          getRowId={(row) => row.id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search cycle or review type..."
          searchFn={(row, query) => [row.cycle, row.review_type].join(" ").toLowerCase().includes(query)}
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadCbtSnapshot()}
          rowActions={cycleRowActions}
          expandable={{
            render: (row) => (
              <div className="grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground text-xs">Review Type</p>
                  <p className="mt-1">{row.review_type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Scores Recorded</p>
                  <p className="mt-1">{row.scores_recorded}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Questions</p>
                  <p className="mt-1">{row.questions}</p>
                </div>
              </div>
            ),
          }}
          viewToggle
          cardRenderer={(row) => (
            <CycleCard
              row={row}
              onView={
                isLeadView
                  ? (item) => router.push(`${basePath}/question?cycleId=${encodeURIComponent(item.id)}`)
                  : undefined
              }
            />
          )}
          emptyTitle="No CBT cycles found"
          emptyDescription="Create a cycle question bank to start collecting CBT results."
          emptyIcon={Brain}
          skeletonRows={6}
        />
      ) : null}

      <AlertDialog open={resetConfirmRow !== null} onOpenChange={(isOpen) => !isOpen && setResetConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset CBT attempt?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes {resetConfirmRow?.employee}&apos;s CBT attempt for {resetConfirmRow?.cycle} and clears their
              recorded score. They will be able to retake the assessment for this cycle from scratch. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={isResetting}
              onClick={(event) => {
                event.preventDefault()
                void handleResetAttempt()
              }}
            >
              {isResetting ? "Resetting..." : "Reset Attempt"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
