"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Brain, Eye, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"

type TabKey = "individual" | "department" | "cycle"

type ReviewCycle = {
  id: string
  name: string
  review_type: string | null
}

type CbtUser = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

type CbtScore = {
  user_id: string
  review_cycle_id: string
  cbt_score: number | null
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
}

type DepartmentRow = {
  id: string
  department: string
  cycleId: string
  cycle: string
  scores_recorded: number
  average_score: number | null
}

type CycleRow = {
  id: string
  cycle: string
  review_type: string
  scores_recorded: number
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

function IndividualCard({ row }: { row: IndividualRow }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{row.employee}</p>
          <p className="text-muted-foreground text-xs">{row.department}</p>
        </div>
        <Badge variant={typeof row.cbt_score === "number" && row.cbt_score >= 70 ? "default" : "secondary"}>
          {scoreLabel(row.cbt_score)}
        </Badge>
      </div>
      <div className="text-sm">
        <p className="text-muted-foreground text-xs">Cycle</p>
        <p>{row.cycle}</p>
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
          <p className="text-muted-foreground text-xs">{row.cycle}</p>
        </div>
        <Badge variant="secondary">{row.scores_recorded} scores</Badge>
      </div>
      <div className="text-sm">
        <p className="text-muted-foreground text-xs">Average Score</p>
        <p>{scoreLabel(row.average_score)}</p>
      </div>
    </div>
  )
}

function CycleCard({ row, onView }: { row: CycleRow; onView: (row: CycleRow) => void }) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{row.cycle}</p>
          <p className="text-muted-foreground text-xs">{row.review_type}</p>
        </div>
        <Badge variant="secondary">{row.questions} questions</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Scores</p>
          <p>{row.scores_recorded}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Questions</p>
          <p>{row.questions}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => onView(row)}>
        View Cycle
      </Button>
    </div>
  )
}

export default function AdminPmsCbtPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>("individual")
  const [selectedCycleId, setSelectedCycleId] = useState("all")
  const [data, setData] = useState<CbtPayload>({ users: [], cycles: [], scores: [] })
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({})
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedSnapshotRef = useRef(false)

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

  const usersById = useMemo(() => new Map(data.users.map((user) => [user.id, user])), [data.users])
  const cycleNameById = useMemo(() => new Map(data.cycles.map((cycle) => [cycle.id, cycle.name])), [data.cycles])
  const scoresForSelectedCycle = useMemo(
    () => data.scores.filter((score) => selectedCycleId === "all" || score.review_cycle_id === selectedCycleId),
    [data.scores, selectedCycleId]
  )

  const individualRows = useMemo<IndividualRow[]>(
    () =>
      data.scores.map((score, index) => {
        const user = usersById.get(score.user_id)
        return {
          id: `${score.user_id}-${score.review_cycle_id}-${index}`,
          user_id: score.user_id,
          review_cycle_id: score.review_cycle_id,
          employee: employeeName(user),
          department: user?.department || "-",
          cycle: cycleNameById.get(score.review_cycle_id) || "-",
          cbt_score: score.cbt_score,
        }
      }),
    [cycleNameById, data.scores, usersById]
  )

  const departmentRows = useMemo<DepartmentRow[]>(() => {
    const grouped = new Map<string, number[]>()
    for (const score of scoresForSelectedCycle) {
      const department = usersById.get(score.user_id)?.department || "Unassigned"
      const key = `${department}::${selectedCycleId}`
      const current = grouped.get(key) || []
      if (typeof score.cbt_score === "number") current.push(score.cbt_score)
      grouped.set(key, current)
    }
    return Array.from(grouped.entries()).map(([key, values]) => {
      const [department, cycleId] = key.split("::")
      return {
        id: key,
        department,
        cycleId,
        cycle: cycleNameById.get(cycleId) || "-",
        scores_recorded: values.length,
        average_score:
          values.length > 0
            ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
            : null,
      }
    })
  }, [cycleNameById, scoresForSelectedCycle, selectedCycleId, usersById])

  const cycleRows = useMemo<CycleRow[]>(
    () =>
      data.cycles.map((cycle) => ({
        id: cycle.id,
        cycle: cycle.name,
        review_type: cycle.review_type || "-",
        scores_recorded: data.scores.filter((score) => score.review_cycle_id === cycle.id).length,
        questions: questionCounts[cycle.id] || 0,
      })),
    [data.cycles, data.scores, questionCounts]
  )

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(data.users.map((user) => user.department).filter(Boolean) as string[]))
        .sort()
        .map((department) => ({ value: department, label: department })),
    [data.users]
  )

  const userOptions = useMemo(
    () =>
      data.users
        .map((user) => ({ value: user.id, label: employeeName(user) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [data.users]
  )

  const cycleOptions = useMemo(
    () => data.cycles.map((cycle) => ({ value: cycle.id, label: cycle.name })),
    [data.cycles]
  )

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
      key: "cycle",
      label: "Cycle",
      sortable: true,
      accessor: (row) => row.cycle,
      resizable: true,
      initialWidth: 220,
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
  ]

  const departmentColumns: DataTableColumn<DepartmentRow>[] = [
    {
      key: "department",
      label: "Department",
      sortable: true,
      accessor: (row) => row.department,
      resizable: true,
      initialWidth: 220,
    },
    {
      key: "cycle",
      label: "Cycle",
      sortable: true,
      accessor: (row) => row.cycle,
      resizable: true,
      initialWidth: 220,
      hideOnMobile: true,
    },
    {
      key: "scores_recorded",
      label: "Scores Recorded",
      sortable: true,
      accessor: (row) => row.scores_recorded,
      hideOnMobile: true,
    },
    {
      key: "average_score",
      label: "Average Score",
      sortable: true,
      accessor: (row) => row.average_score ?? -1,
      render: (row) => scoreLabel(row.average_score),
    },
  ]

  const cycleColumns: DataTableColumn<CycleRow>[] = [
    { key: "cycle", label: "Cycle", sortable: true, accessor: (row) => row.cycle, resizable: true, initialWidth: 240 },
    {
      key: "review_type",
      label: "Review Type",
      sortable: true,
      accessor: (row) => row.review_type,
      hideOnMobile: true,
    },
    {
      key: "scores_recorded",
      label: "Scores Recorded",
      sortable: true,
      accessor: (row) => row.scores_recorded,
      hideOnMobile: true,
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
      key: "user_id",
      label: "Employee",
      options: userOptions,
      placeholder: "All Employees",
      mode: "custom",
      filterFn: (row, values) => values.length === 0 || values.includes(row.user_id),
    },
    {
      key: "cycle",
      label: "Cycle",
      options: cycleOptions,
      placeholder: "All Cycles",
      mode: "custom",
      filterFn: (row, values) => values.length === 0 || values.includes(row.review_cycle_id),
    },
  ]

  const departmentFilters: DataTableFilter<DepartmentRow>[] = [
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: "All Departments",
    },
    {
      key: "cycle",
      label: "Cycle",
      options: cycleOptions,
      placeholder: "All Cycles",
      mode: "custom",
      filterFn: (row, values) => values.length === 0 || values.includes(row.cycleId),
    },
  ]

  const cycleFilters: DataTableFilter<CycleRow>[] = [
    {
      key: "review_type",
      label: "Review Type",
      options: Array.from(new Set(data.cycles.map((cycle) => cycle.review_type || "-"))).map((value) => ({
        value,
        label: value,
      })),
      placeholder: "All Types",
    },
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

  const cycleRowActions: RowAction<CycleRow>[] = [
    {
      label: "Manage Questions",
      icon: Eye,
      onClick: (row) => router.push(`/admin/hr/pms/cbt/question?cycleId=${encodeURIComponent(row.id)}`),
    },
  ]

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
      backLink={{ href: "/admin/hr/pms", label: "Back to PMS" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={(value) => setTab(value as TabKey)}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadCbtSnapshot()} disabled={isRefreshing}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Link href="/admin/hr/pms/cbt/question">
            <Button size="sm">Create Test</Button>
          </Link>
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
          searchPlaceholder="Search employee, department, cycle, or score..."
          searchFn={(row, query) =>
            [row.employee, row.department, row.cycle, scoreLabel(row.cbt_score)].join(" ").toLowerCase().includes(query)
          }
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadCbtSnapshot()}
          expandable={{
            render: (row) => (
              <div className="grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground text-xs">Employee</p>
                  <p className="mt-1">{row.employee}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Department</p>
                  <p className="mt-1">{row.department}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">CBT Score</p>
                  <p className="mt-1">{scoreLabel(row.cbt_score)}</p>
                </div>
              </div>
            ),
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
              onView={(item) => router.push(`/admin/hr/pms/cbt/question?cycleId=${encodeURIComponent(item.id)}`)}
            />
          )}
          emptyTitle="No CBT cycles found"
          emptyDescription="Create a cycle question bank to start collecting CBT results."
          emptyIcon={Brain}
          skeletonRows={6}
        />
      ) : null}
    </DataTablePage>
  )
}
