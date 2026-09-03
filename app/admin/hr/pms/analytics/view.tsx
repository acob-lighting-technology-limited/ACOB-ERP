"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, Download, TrendingDown, TrendingUp, Users } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { StatCard } from "@/components/ui/stat-card"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"
import { exportPmsRowsToExcel } from "@/lib/pms/export"
import { toLocalISODate } from "@/lib/utils/date"

type ReviewRow = {
  id: string
  user_id: string | null
  review_cycle_id: string | null
  kpi_score: number | null
  cbt_score: number | null
  attendance_score: number | null
  behaviour_score: number | null
  final_score: number | null
  status: string | null
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    department?: string | null
  } | null
  cycle?: {
    id: string
    name: string
    review_type: string
  } | null
}

type Cycle = {
  id: string
  name: string
  status: string | null
  review_type?: string | null
  start_date?: string | null
  end_date?: string | null
}

type AnalyticsRow = {
  id: string
  employee: string
  department: string
  cycle: string
  reviewType: string
  kpi: number | null
  cbt: number | null
  attendance: number | null
  behaviour: number | null
  final: number | null
  tier: string
  status: string
}

function formatName(user: ReviewRow["user"]) {
  if (!user) return "Unknown"
  return `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Unknown"
}

function scoreToTier(score: number | null): {
  label: string
  variant: "default" | "secondary" | "outline" | "destructive"
} {
  if (score === null) return { label: "No Score", variant: "outline" }
  if (score >= 80) return { label: "High Performer", variant: "default" }
  if (score >= 60) return { label: "Meets Expectations", variant: "secondary" }
  if (score >= 40) return { label: "Needs Improvement", variant: "outline" }
  return { label: "At Risk", variant: "destructive" }
}

function scoreText(score: number | null) {
  return score === null ? "-" : `${Math.round(score * 100) / 100}%`
}

function AnalyticsCard({ row }: { row: AnalyticsRow }) {
  const finalPct = row.final ?? 0
  const tier = scoreToTier(row.final)
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{row.employee}</p>
          <p className="text-muted-foreground text-xs">{row.department}</p>
        </div>
        <Badge variant={tier.variant}>{tier.label}</Badge>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Final Score</span>
          <span>{scoreText(row.final)}</span>
        </div>
        <Progress value={finalPct} className="h-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Quarter</p>
          <p>{row.cycle}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Review Type</p>
          <p>{row.reviewType}</p>
        </div>
      </div>
    </div>
  )
}

export function PmsAnalyticsPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [cycles, setCycles] = useState<Cycle[]>([])
  // Rows currently visible in the table (after search + filters + sort).
  const [processedRows, setProcessedRows] = useState<AnalyticsRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [reviewsRes, cyclesRes] = await Promise.all([
        fetch("/api/hr/performance/reviews?limit=200"),
        fetch("/api/hr/performance/cycles"),
      ])
      const [reviewsData, cyclesData] = await Promise.all([
        reviewsRes.json().catch(() => ({})),
        cyclesRes.json().catch(() => ({})),
      ])
      if (!reviewsRes.ok) {
        throw new Error(reviewsData?.error || "Failed to load reviews")
      }
      setReviews(reviewsData?.data || [])
      setCycles(cyclesData?.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const rows = useMemo<AnalyticsRow[]>(
    () =>
      reviews.map((review) => ({
        id: review.id,
        employee: formatName(review.user),
        department: review.user?.department || "-",
        cycle: review.cycle?.name || "-",
        reviewType: review.cycle?.review_type || "-",
        kpi: review.kpi_score,
        cbt: review.cbt_score,
        attendance: review.attendance_score,
        behaviour: review.behaviour_score,
        final: review.final_score,
        tier: scoreToTier(review.final_score).label,
        status: review.status || "draft",
      })),
    [reviews]
  )

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.department).filter(Boolean)))
        .sort()
        .map((department) => ({ value: department, label: department })),
    [rows]
  )

  const reviewCycleIdByRowId = useMemo(
    () => new Map(reviews.map((review) => [review.id, review.review_cycle_id])),
    [reviews]
  )
  const { filters: cycleFilters } = useCycleFilters<AnalyticsRow>({
    cycles,
    getRowCycleId: useCallback((row) => reviewCycleIdByRowId.get(row.id) ?? null, [reviewCycleIdByRowId]),
    cycleLabel: "Quarter",
  })

  const tierOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.tier)))
        .sort()
        .map((tier) => ({ value: tier, label: tier })),
    [rows]
  )

  const scoredRows = rows.filter((row) => typeof row.final === "number")
  const scores = scoredRows.map((row) => row.final as number)
  const mean =
    scores.length > 0 ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100) / 100 : null
  const highPerformers = scoredRows.filter((row) => (row.final as number) >= 80).length
  const atRisk = scoredRows.filter((row) => (row.final as number) < 40).length
  const activeCycles = cycles.filter((cycle) => cycle.status === "active").length

  // Export the rows currently visible in the table (respects search + filters + sort).
  const exportSource = processedRows.length ? processedRows : rows
  const exportRows = exportSource.map((row, index) => ({
    "S/N": index + 1,
    Employee: row.employee,
    Department: row.department,
    Quarter: row.cycle,
    "Review Type": row.reviewType,
    KPI: row.kpi ?? "-",
    CBT: row.cbt ?? "-",
    Attendance: row.attendance ?? "-",
    Behaviour: row.behaviour ?? "-",
    Final: row.final ?? "-",
    Tier: row.tier,
    Status: row.status,
  }))

  const columns: DataTableColumn<AnalyticsRow>[] = useMemo(
    () => [
      {
        key: "employee",
        label: "Employee",
        sortable: true,
        accessor: (row) => row.employee,
        render: (row) => <span className="font-medium">{row.employee}</span>,
        resizable: true,
        initialWidth: 190,
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department,
        hideOnMobile: true,
      },
      {
        key: "cycle",
        label: "Quarter",
        sortable: true,
        accessor: (row) => row.cycle,
        resizable: true,
        initialWidth: 180,
        hideOnMobile: true,
      },
      {
        key: "reviewType",
        label: "Review Type",
        sortable: true,
        accessor: (row) => row.reviewType,
        hideOnMobile: true,
      },
      {
        key: "kpi",
        label: "KPI",
        sortable: true,
        accessor: (row) => row.kpi ?? -1,
        render: (row) => scoreText(row.kpi),
        hideOnMobile: true,
      },
      {
        key: "cbt",
        label: "CBT",
        sortable: true,
        accessor: (row) => row.cbt ?? -1,
        render: (row) => scoreText(row.cbt),
        hideOnMobile: true,
      },
      {
        key: "attendance",
        label: "Attendance",
        sortable: true,
        accessor: (row) => row.attendance ?? -1,
        render: (row) => scoreText(row.attendance),
        hideOnMobile: true,
      },
      {
        key: "behaviour",
        label: "Behaviour",
        sortable: true,
        accessor: (row) => row.behaviour ?? -1,
        render: (row) => scoreText(row.behaviour),
        hideOnMobile: true,
      },
      {
        key: "final",
        label: "Final",
        sortable: true,
        accessor: (row) => row.final ?? -1,
        render: (row) => <span className="font-medium">{scoreText(row.final)}</span>,
      },
      {
        key: "tier",
        label: "Tier",
        sortable: true,
        accessor: (row) => row.tier,
        render: (row) => {
          const tier = scoreToTier(row.final)
          return <Badge variant={tier.variant}>{tier.label}</Badge>
        },
      },
    ],
    []
  )

  const filters: DataTableFilter<AnalyticsRow>[] = useMemo(
    () => [
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
        placeholder: "All Departments",
      },
      {
        key: "tier",
        label: "Tier",
        options: tierOptions,
        placeholder: "All Tiers",
      },
      ...cycleFilters,
    ],
    [cycleFilters, departmentOptions, tierOptions]
  )

  return (
    <DataTablePage
      title="PMS Analytics"
      description="Performance distribution, review outcomes, and department benchmarking in one unified analytics table."
      icon={BarChart3}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms", label: "Back to PMS" }}
      actions={
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={exportRows.length === 0}
          onClick={() => void exportPmsRowsToExcel(exportRows, `pms-analytics-${toLocalISODate()}`)}
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Employees"
            value={rows.length}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Mean Score"
            value={mean !== null ? `${mean}%` : "-"}
            icon={BarChart3}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="High Performers"
            value={highPerformers}
            icon={TrendingUp}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="At Risk"
            value={atRisk}
            icon={TrendingDown}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard variant="compact" title="Active Cycles" value={activeCycles} icon={BarChart3} />
        <StatCard
          variant="compact"
          title="Reviewed"
          value={rows.filter((row) => row.status === "completed").length}
          icon={Users}
        />
        <StatCard
          variant="compact"
          title="Drafts"
          value={rows.filter((row) => row.status === "draft").length}
          icon={TrendingDown}
        />
        <StatCard
          variant="compact"
          title="Submitted"
          value={rows.filter((row) => row.status === "submitted").length}
          icon={TrendingUp}
        />
      </div>

      <DataTable<AnalyticsRow>
        data={rows}
        columns={columns}
        onProcessedDataChange={setProcessedRows}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search employee, department, quarter, or review type…"
        searchFn={(row, query) =>
          [row.employee, row.department, row.cycle, row.reviewType, row.tier, row.status]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadData()}
        expandable={{
          render: (row) => (
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <p className="text-muted-foreground text-xs">KPI</p>
                <p className="mt-1">{scoreText(row.kpi)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">CBT</p>
                <p className="mt-1">{scoreText(row.cbt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Attendance</p>
                <p className="mt-1">{scoreText(row.attendance)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Behaviour</p>
                <p className="mt-1">{scoreText(row.behaviour)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Status</p>
                <p className="mt-1 capitalize">{row.status}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (row) =>
            (row.final ?? 0) >= 80 ? "bg-emerald-500" : (row.final ?? 0) >= 60 ? "bg-amber-500" : "bg-red-500",
          title: (row) => row.employee,
          subtitle: (row) => `${row.department} · ${row.cycle} · Final: ${row.final !== null ? `${row.final}%` : "-"}`,
          trailing: (row) => {
            const tier = scoreToTier(row.final)
            return (
              <Badge variant={tier.variant} className="text-[10px]">
                {tier.label}
              </Badge>
            )
          },
        }}
        cardRenderer={(row) => <AnalyticsCard row={row} />}
        emptyTitle="No analytics rows found"
        emptyDescription="Performance analytics will appear here once reviews have been created and scored."
        emptyIcon={BarChart3}
        skeletonRows={8}
      />
    </DataTablePage>
  )
}
