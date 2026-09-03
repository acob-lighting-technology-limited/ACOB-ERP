"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Download, FileText, Plus, Users, BarChart3, CheckCircle2, RefreshCw, Clock, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardContent } from "@/components/ui/card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { CreateReviewDialog } from "../../performance/_components/create-review-dialog"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { exportPmsRowsToExcel, exportPmsRowsToPdf } from "@/lib/pms/export"
import { CalibrationView } from "./_components/calibration-view"
import { toLocalISODate } from "@/lib/utils/date"

// ─── Types ────────────────────────────────────────────────────────────────────

type ReviewRow = {
  id: string
  created_at: string
  status: string | null
  user_id: string | null
  review_cycle_id: string | null
  kpi_score: number | null
  cbt_score: number | null
  attendance_score: number | null
  behaviour_score: number | null
  final_score: number | null
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
    start_date?: string | null
    end_date?: string | null
  } | null
}

type DeptRow = {
  id: string
  cycleId: string
  cycle: string
  department: string
  reviews: number
  submitted: number
  kpi: string
  cbt: string
  attendance: string
  behaviour: string
  final: string
}

type CycleRow = {
  id: string
  cycleId: string
  cycle: string
  review_type: string
  reviews: number
  submitted: number
  departments: number
  completed: number
}

type TabMode = "individual" | "department" | "cycle" | "calibration"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMetric(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, "") : "-"
}

function isSubmittedReview(r: ReviewRow) {
  return ["submitted", "completed"].includes(String(r.status ?? "").toLowerCase())
}

function isCompletedReview(r: ReviewRow) {
  return String(r.status ?? "").toLowerCase() === "completed"
}

function reviewStatusPriority(status: string | null | undefined) {
  const s = String(status ?? "").toLowerCase()
  if (s === "completed") return 3
  if (s === "submitted") return 2
  if (s === "draft") return 1
  return 0
}

function pickCanonicalReview(rows: ReviewRow[]): ReviewRow {
  return [...rows].sort((a, b) => {
    const diff = reviewStatusPriority(b.status) - reviewStatusPriority(a.status)
    if (diff !== 0) return diff
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })[0]
}

function employeeName(r: ReviewRow) {
  return `${r.user?.first_name ?? ""} ${r.user?.last_name ?? ""}`.trim() || "Employee"
}

function StatusBadge({ status }: { status: string | null }) {
  const s = String(status ?? "").toLowerCase()
  if (s === "completed")
    return (
      <Badge variant="default" className="bg-emerald-600">
        Completed
      </Badge>
    )
  if (s === "submitted") return <Badge variant="secondary">Submitted</Badge>
  if (s === "draft") return <Badge variant="outline">Draft</Badge>
  return <span className="text-muted-foreground text-sm">—</span>
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (value === null || !Number.isFinite(value)) return null
  const pct = Math.min(100, Math.max(0, value))
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value?.toFixed(1)}%</span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Individual review — expandable detail ────────────────────────────────────

function ReviewExpandedDetail({ row }: { row: ReviewRow }) {
  const scores = [
    { label: "KPI Score", value: row.kpi_score },
    { label: "Competency (CBT)", value: row.cbt_score },
    { label: "Attendance", value: row.attendance_score },
    { label: "Behaviour", value: row.behaviour_score },
  ]
  const hasScores = scores.some((s) => s.value !== null)

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1 lg:col-span-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Score Breakdown</p>
        {hasScores ? (
          <div className="space-y-3 pt-1">
            {scores.map((s) => (s.value !== null ? <ScoreBar key={s.label} label={s.label} value={s.value} /> : null))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No scores recorded yet.</p>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Summary</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Final Score</span>
            <span className="font-semibold">{row.final_score !== null ? `${row.final_score?.toFixed(2)}%` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <StatusBadge status={row.status} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cycle</span>
            <span>{row.cycle?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Type</span>
            <span>{row.cycle?.review_type ?? "—"}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Employee</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{employeeName(row)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Department</span>
            <span>{row.user?.department ?? "—"}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Individual review — card renderer ───────────────────────────────────────

function ReviewCard({ row, onEdit }: { row: ReviewRow; onEdit: (r: ReviewRow) => void }) {
  const final = row.final_score
  const pct = final !== null && Number.isFinite(final) ? Math.min(100, Math.max(0, final)) : null
  const color =
    pct !== null
      ? pct >= 80
        ? "text-emerald-600"
        : pct >= 60
          ? "text-amber-600"
          : "text-red-600"
      : "text-muted-foreground"

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="leading-tight font-semibold">{employeeName(row)}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{row.user?.department ?? "—"}</p>
          </div>
          <StatusBadge status={row.status} />
        </div>

        {/* Quarter chip */}
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Clock className="h-3.5 w-3.5" />
          {row.cycle?.name ?? "No cycle"}
        </div>

        {/* Final score */}
        {pct !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Final Score</span>
              <span className={`font-bold ${color}`}>{final?.toFixed(1)}%</span>
            </div>
            <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Score chips */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          {[
            { label: "KPI", value: row.kpi_score },
            { label: "CBT", value: row.cbt_score },
            { label: "Att.", value: row.attendance_score },
            { label: "Beh.", value: row.behaviour_score },
          ].map((s) => (
            <span key={s.label} className="bg-muted rounded px-1.5 py-0.5 font-mono">
              {s.label} {formatMetric(s.value)}
            </span>
          ))}
        </div>

        {/* Edit button */}
        {row.review_cycle_id && (
          <Button size="sm" variant="outline" className="w-full" onClick={() => onEdit(row)}>
            Edit Review
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

const TABS: DataTableTab[] = [
  { key: "individual", label: "Individual" },
  { key: "department", label: "Department" },
  { key: "cycle", label: "Cycle" },
  { key: "calibration", label: "Calibration" },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminPmsReviewsPage({
  backLinkHref,
  reviewCycleBasePath,
}: { backLinkHref?: string; reviewCycleBasePath?: string } = {}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabMode>("individual")
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  // Rows currently visible in the department/cycle tables (after search + filters + sort).
  // The individual tab is server-paginated (search/filters there aren't wired to refetch yet
  // — a separate pre-existing issue — so its export intentionally mirrors canonicalReviews).
  const [processedDeptRows, setProcessedDeptRows] = useState<DeptRow[]>([])
  const [processedCycleRows, setProcessedCycleRows] = useState<CycleRow[]>([])
  const [totalReviews, setTotalReviews] = useState(0)
  const [serverPage, setServerPage] = useState(0)
  const hasLoadedRef = useRef(false)

  // ─── Data ─────────────────────────────────────────────────────────────────

  const loadReviews = useCallback(async (pageIndex = 0) => {
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setIsInitialLoading(true)
    }
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageIndex * PAGE_SIZE),
      })
      const res = await fetch(`/api/hr/performance/reviews?${params}`, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as {
        data?: ReviewRow[]
        error?: string
        meta?: { total?: number }
      } | null
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load reviews")
      setReviews(payload?.data ?? [])
      setTotalReviews(payload?.meta?.total ?? payload?.data?.length ?? 0)
      setServerPage(pageIndex)
      hasLoadedRef.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reviews")
    } finally {
      setIsInitialLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  // ─── Derived: canonical reviews (one per employee per cycle) ─────────────

  const canonicalReviews = useMemo(() => {
    const grouped = new Map<string, ReviewRow[]>()
    for (const r of reviews) {
      const key = `${r.user_id ?? r.id}:${r.review_cycle_id ?? "no-cycle"}`
      grouped.set(key, [...(grouped.get(key) ?? []), r])
    }
    return Array.from(grouped.values()).map(pickCanonicalReview)
  }, [reviews])

  const departmentOptions = useMemo(
    () => Array.from(new Set(canonicalReviews.map((r) => r.user?.department).filter(Boolean) as string[])).sort(),
    [canonicalReviews]
  )

  const quarterOptions = useMemo(
    () => Array.from(new Set(canonicalReviews.map((r) => r.cycle?.name).filter(Boolean) as string[])).sort(),
    [canonicalReviews]
  )

  // Reviews carry their cycle inline; dedupe it into the list the shared cycle
  // filters need.
  const cycles = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; review_type: string | null; start_date?: string | null; end_date?: string | null }
    >()
    for (const review of canonicalReviews) {
      if (review.cycle) byId.set(review.cycle.id, review.cycle)
    }
    return Array.from(byId.values())
  }, [canonicalReviews])

  const { filters: individualCycleFilters } = useCycleFilters<ReviewRow>({
    cycles,
    getRowCycleId: (row) => row.review_cycle_id,
    cycleLabel: "Quarter",
  })
  const { filters: deptCycleFilters } = useCycleFilters<DeptRow>({
    cycles,
    getRowCycleId: (row) => row.cycleId,
    cycleLabel: "Quarter",
  })
  const { filters: cycleTabCycleFilters } = useCycleFilters<CycleRow>({
    cycles,
    getRowCycleId: (row) => row.cycleId,
    cycleLabel: "Quarter",
  })

  const reviewTypeOptions = useMemo(
    () => Array.from(new Set(canonicalReviews.map((r) => r.cycle?.review_type).filter(Boolean) as string[])).sort(),
    [canonicalReviews]
  )

  // ─── Derived: department rows ─────────────────────────────────────────────

  const deptRows = useMemo((): DeptRow[] => {
    const grouped = new Map<string, ReviewRow[]>()
    for (const r of canonicalReviews) {
      const key = `${r.cycle?.id ?? "no-cycle"}::${r.user?.department ?? "Unknown"}`
      grouped.set(key, [...(grouped.get(key) ?? []), r])
    }
    return Array.from(grouped.entries()).map(([key, rows]) => {
      const [cycleId, department] = key.split("::")
      const avg = (pick: (r: ReviewRow) => number | null): string => {
        const vals = rows
          .filter(isSubmittedReview)
          .map(pick)
          .filter((v): v is number => v !== null)
        return vals.length === 0 ? "-" : formatMetric(vals.reduce((s, v) => s + v, 0) / vals.length)
      }
      return {
        id: key,
        cycleId: cycleId ?? "no-cycle",
        cycle: rows[0]?.cycle?.name ?? "Performance Review",
        department: department ?? "Unknown",
        reviews: rows.length,
        submitted: rows.filter(isSubmittedReview).length,
        kpi: avg((r) => r.kpi_score),
        cbt: avg((r) => r.cbt_score),
        attendance: avg((r) => r.attendance_score),
        behaviour: avg((r) => r.behaviour_score),
        final: avg((r) => r.final_score),
      }
    })
  }, [canonicalReviews])

  // ─── Derived: cycle rows ──────────────────────────────────────────────────

  const cycleRows = useMemo((): CycleRow[] => {
    const grouped = new Map<string, ReviewRow[]>()
    for (const r of canonicalReviews) {
      const key = r.cycle?.id ?? "no-cycle"
      grouped.set(key, [...(grouped.get(key) ?? []), r])
    }
    return Array.from(grouped.entries()).map(([cycleId, rows]) => ({
      id: cycleId,
      cycleId,
      cycle: rows[0]?.cycle?.name ?? "Performance Review",
      review_type: rows[0]?.cycle?.review_type ?? "-",
      reviews: rows.length,
      submitted: rows.filter(isSubmittedReview).length,
      departments: new Set(rows.map((r) => r.user?.department).filter(Boolean)).size,
      completed: rows.filter(isCompletedReview).length,
    }))
  }, [canonicalReviews])

  // ─── Stats ────────────────────────────────────────────────────────────────

  const totalCount =
    tab === "individual" ? canonicalReviews.length : tab === "department" ? deptRows.length : cycleRows.length

  const submittedCount = useMemo(() => {
    if (tab === "individual") return canonicalReviews.filter(isSubmittedReview).length
    if (tab === "department") return deptRows.reduce((s, r) => s + r.submitted, 0)
    return cycleRows.reduce((s, r) => s + r.submitted, 0)
  }, [tab, canonicalReviews, deptRows, cycleRows])

  const completedCount = useMemo(() => {
    if (tab === "individual") return canonicalReviews.filter(isCompletedReview).length
    if (tab === "department") return 0
    return cycleRows.reduce((s, r) => s + r.completed, 0)
  }, [tab, canonicalReviews, cycleRows])

  const activeQuarter = quarterOptions.at(-1) ?? "—"

  // ─── Export rows ──────────────────────────────────────────────────────────

  const exportRows = useMemo(() => {
    if (tab === "individual")
      return canonicalReviews.map((r, i) => ({
        "S/N": i + 1,
        Employee: employeeName(r),
        Department: r.user?.department ?? "-",
        Quarter: r.cycle?.name ?? "-",
        "Review Type": r.cycle?.review_type ?? "-",
        KPI: formatMetric(r.kpi_score),
        CBT: formatMetric(r.cbt_score),
        Attendance: formatMetric(r.attendance_score),
        Behaviour: formatMetric(r.behaviour_score),
        "Final Score": formatMetric(r.final_score),
        Status: r.status ?? "-",
      }))
    if (tab === "department")
      return (processedDeptRows.length ? processedDeptRows : deptRows).map((r, i) => ({
        "S/N": i + 1,
        Department: r.department,
        Quarter: r.cycle,
        "Total Reviews": r.reviews,
        Submitted: r.submitted,
        "Avg KPI": r.kpi,
        "Avg CBT": r.cbt,
        "Avg Attendance": r.attendance,
        "Avg Behaviour": r.behaviour,
        "Avg Final": r.final,
      }))
    return (processedCycleRows.length ? processedCycleRows : cycleRows).map((r, i) => ({
      "S/N": i + 1,
      Quarter: r.cycle,
      "Review Type": r.review_type,
      "Employee Count": r.reviews,
      Submitted: r.submitted,
      Departments: r.departments,
      Completed: r.completed,
    }))
  }, [tab, canonicalReviews, deptRows, cycleRows, processedDeptRows, processedCycleRows])

  // ─── Navigation helpers ───────────────────────────────────────────────────

  const goToIndividualCycle = useCallback(
    (cycleId: string) => {
      router.push(`${reviewCycleBasePath ?? "/admin/hr/pms/reviews"}/${encodeURIComponent(cycleId)}?mode=individual`)
    },
    [router, reviewCycleBasePath]
  )

  const goDeptCycle = useCallback(
    (cycleId: string, department: string) => {
      router.push(
        `/admin/hr/pms/reviews/${encodeURIComponent(cycleId)}?mode=department&department=${encodeURIComponent(department)}`
      )
    },
    [router]
  )

  // ─── Column definitions ───────────────────────────────────────────────────

  const individualColumns: DataTableColumn<ReviewRow>[] = useMemo(
    () => [
      {
        key: "employee",
        label: "Employee",
        sortable: true,
        resizable: true,
        initialWidth: 180,
        accessor: (r) => employeeName(r),
        render: (r) => <span className="font-medium">{employeeName(r)}</span>,
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => r.user?.department ?? "",
        hideOnMobile: true,
      },
      {
        key: "quarter",
        label: "Quarter",
        sortable: true,
        accessor: (r) => r.cycle?.name ?? "",
        hideOnMobile: true,
      },
      {
        key: "kpi",
        label: "KPI",
        accessor: (r) => formatMetric(r.kpi_score),
        align: "center",
        hideOnMobile: true,
      },
      {
        key: "cbt",
        label: "CBT",
        accessor: (r) => formatMetric(r.cbt_score),
        align: "center",
        hideOnMobile: true,
      },
      {
        key: "attendance",
        label: "Attendance",
        accessor: (r) => formatMetric(r.attendance_score),
        align: "center",
        hideOnMobile: true,
      },
      {
        key: "behaviour",
        label: "Behaviour",
        accessor: (r) => formatMetric(r.behaviour_score),
        align: "center",
        hideOnMobile: true,
      },
      {
        key: "final",
        label: "Final",
        align: "center",
        accessor: (r) => r.final_score ?? -1,
        render: (r) => {
          const v = r.final_score
          if (v === null || !Number.isFinite(v)) return <span className="text-muted-foreground">—</span>
          const color = v >= 80 ? "text-emerald-600" : v >= 60 ? "text-amber-600" : "text-red-600"
          return <span className={`font-semibold ${color}`}>{v.toFixed(1)}%</span>
        },
      },
      {
        key: "status",
        label: "Status",
        // accessor is required so the "Status" filter can match against it
        accessor: (r) => String(r.status ?? "").toLowerCase(),
        render: (r) => <StatusBadge status={r.status} />,
      },
    ],
    []
  )

  const deptColumns: DataTableColumn<DeptRow>[] = useMemo(
    () => [
      {
        key: "department",
        label: "Department",
        sortable: true,
        resizable: true,
        initialWidth: 180,
        accessor: (r) => r.department,
        render: (r) => <span className="font-medium">{r.department}</span>,
      },
      { key: "cycle", label: "Quarter", sortable: true, accessor: (r) => r.cycle, hideOnMobile: true },
      {
        key: "reviews",
        label: "Reviews",
        align: "center",
        accessor: (r) => String(r.reviews),
        render: (r) => <span className="font-medium">{r.reviews}</span>,
        hideOnMobile: true,
      },
      {
        key: "submitted",
        label: "Submitted",
        align: "center",
        accessor: (r) => String(r.submitted),
        render: (r) => {
          const pct = r.reviews > 0 ? Math.round((r.submitted / r.reviews) * 100) : 0
          return (
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-medium">{r.submitted}</span>
              <span className="text-muted-foreground text-xs">{pct}%</span>
            </div>
          )
        },
      },
      { key: "kpi", label: "Avg KPI", align: "center", accessor: (r) => r.kpi },
      { key: "cbt", label: "Avg CBT", align: "center", accessor: (r) => r.cbt, hideOnMobile: true },
      { key: "attendance", label: "Avg Att.", align: "center", accessor: (r) => r.attendance, hideOnMobile: true },
      { key: "behaviour", label: "Avg Beh.", align: "center", accessor: (r) => r.behaviour, hideOnMobile: true },
      {
        key: "final",
        label: "Avg Final",
        align: "center",
        accessor: (r) => r.final,
        render: (r) => <span className="font-semibold">{r.final}</span>,
      },
    ],
    []
  )

  const cycleColumns: DataTableColumn<CycleRow>[] = useMemo(
    () => [
      {
        key: "cycle",
        label: "Quarter",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) => r.cycle,
        render: (r) => <span className="font-medium">{r.cycle}</span>,
      },
      { key: "review_type", label: "Review Type", accessor: (r) => r.review_type, hideOnMobile: true },
      {
        key: "reviews",
        label: "Employees",
        align: "center",
        accessor: (r) => String(r.reviews),
        render: (r) => <span className="font-medium">{r.reviews}</span>,
        hideOnMobile: true,
      },
      {
        key: "submitted",
        label: "Submitted",
        align: "center",
        accessor: (r) => String(r.submitted),
        render: (r) => {
          const pct = r.reviews > 0 ? Math.round((r.submitted / r.reviews) * 100) : 0
          return (
            <div className="min-w-[80px] space-y-1">
              <div className="flex justify-between text-xs">
                <span>{r.submitted}</span>
                <span className="text-muted-foreground">{pct}%</span>
              </div>
              <Progress value={pct} className="h-1.5" />
            </div>
          )
        },
        hideOnMobile: true,
      },
      {
        key: "departments",
        label: "Depts",
        align: "center",
        accessor: (r) => String(r.departments),
        hideOnMobile: true,
      },
      {
        key: "completed",
        label: "Completed",
        align: "center",
        accessor: (r) => String(r.completed),
        render: (r) => {
          const pct = r.reviews > 0 ? Math.round((r.completed / r.reviews) * 100) : 0
          return (
            <span className={r.completed > 0 ? "font-semibold text-emerald-600" : "text-muted-foreground"}>
              {r.completed} <span className="text-xs font-normal">({pct}%)</span>
            </span>
          )
        },
      },
    ],
    []
  )

  // ─── Filters ──────────────────────────────────────────────────────────────

  const individualFilters: DataTableFilter<ReviewRow>[] = useMemo(
    () => [
      {
        key: "department",
        label: "Department",
        options: departmentOptions.map((d) => ({ value: d, label: d })),
        placeholder: "All Departments",
      },
      ...individualCycleFilters,
      {
        key: "status",
        label: "Status",
        options: [
          { value: "draft", label: "Draft" },
          { value: "submitted", label: "Submitted" },
          { value: "completed", label: "Completed" },
        ],
        placeholder: "All Statuses",
      },
      {
        key: "review_type",
        label: "Review Type",
        mode: "custom",
        options: reviewTypeOptions.map((t) => ({ value: t, label: t })),
        filterFn: (row, selected) => selected.includes(row.cycle?.review_type ?? ""),
        placeholder: "All Types",
      },
    ],
    [departmentOptions, individualCycleFilters, reviewTypeOptions]
  )

  const deptFilters: DataTableFilter<DeptRow>[] = useMemo(
    () => [
      ...deptCycleFilters,
      {
        key: "department",
        label: "Department",
        options: departmentOptions.map((d) => ({ value: d, label: d })),
        placeholder: "All Departments",
      },
      {
        key: "submission",
        label: "Submission",
        mode: "custom",
        options: [
          { value: "full", label: "Fully Submitted" },
          { value: "partial", label: "Partial" },
          { value: "none", label: "Not Started" },
        ],
        filterFn: (row, selected) => {
          const pct = row.reviews > 0 ? row.submitted / row.reviews : 0
          if (selected.includes("full") && pct === 1) return true
          if (selected.includes("partial") && pct > 0 && pct < 1) return true
          if (selected.includes("none") && pct === 0) return true
          return false
        },
        placeholder: "All Statuses",
      },
    ],
    [deptCycleFilters, departmentOptions]
  )

  const cycleFilters: DataTableFilter<CycleRow>[] = useMemo(
    () => [
      ...cycleTabCycleFilters,
      {
        key: "completion",
        label: "Completion",
        mode: "custom",
        options: [
          { value: "complete", label: "Fully Complete" },
          { value: "in_progress", label: "In Progress" },
          { value: "not_started", label: "Not Started" },
        ],
        filterFn: (row, selected) => {
          const pct = row.reviews > 0 ? row.completed / row.reviews : 0
          if (selected.includes("complete") && pct === 1) return true
          if (selected.includes("in_progress") && pct > 0 && pct < 1) return true
          if (selected.includes("not_started") && pct === 0) return true
          return false
        },
        placeholder: "All Stages",
      },
    ],
    [cycleTabCycleFilters]
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <DataTablePage
      title="PMS Reviews"
      description="Manage quarterly performance reviews by individual, department, or cycle."
      icon={FileText}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms", label: "Back to PMS" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={(t) => setTab(t as TabMode)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {isRefreshing && <RefreshCw className="text-muted-foreground h-4 w-4 animate-spin" />}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExportOpen(true)}
            disabled={exportRows.length === 0 || tab === "calibration"}
            className="h-8 gap-2"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button size="sm" className="h-8 gap-2" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Review
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title={tab === "individual" ? "Total Reviews" : tab === "department" ? "Departments" : "Cycles"}
            value={totalCount}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Submitted"
            value={submittedCount}
            icon={TrendingUp}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Completed"
            value={completedCount}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Active Quarter"
            value={activeQuarter}
            icon={BarChart3}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      {/* ── Calibration tab ──────────────────────────────────────────────── */}
      {tab === "calibration" ? (
        <CalibrationView reviews={canonicalReviews} />
      ) : /* ── Individual tab ──────────────────────────────────────────────── */
      tab === "individual" ? (
        <DataTable<ReviewRow>
          data={canonicalReviews}
          columns={individualColumns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search employee, department, quarter…"
          searchFn={(row, q) => {
            const name = employeeName(row).toLowerCase()
            const dept = String(row.user?.department ?? "").toLowerCase()
            const cycle = String(row.cycle?.name ?? "").toLowerCase()
            const type = String(row.cycle?.review_type ?? "").toLowerCase()
            return name.includes(q) || dept.includes(q) || cycle.includes(q) || type.includes(q)
          }}
          filters={individualFilters}
          pagination={{ pageSize: PAGE_SIZE, serverSide: true }}
          totalRows={totalReviews}
          currentPage={serverPage}
          onPageChange={(p) => void loadReviews(p)}
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadReviews()}
          expandable={{
            render: (row) => <ReviewExpandedDetail row={row} />,
          }}
          rowActions={[
            {
              label: "Edit",
              icon: FileText,
              onClick: (row) => {
                if (row.review_cycle_id) goToIndividualCycle(row.review_cycle_id)
              },
              hidden: (row) => !row.review_cycle_id,
            },
          ]}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (r) =>
              r.status === "completed" ? "bg-emerald-500" : r.status === "submitted" ? "bg-blue-500" : "bg-amber-500",
            title: (r) => employeeName(r),
            subtitle: (r) =>
              `${r.user?.department ?? "No dept"} · ${r.cycle?.name ?? "No cycle"} · ${r.final_score !== null ? `${r.final_score?.toFixed(1)}%` : "No score"}`,
            trailing: (r) => <StatusBadge status={r.status} />,
            onSelect: (r) => {
              if (r.review_cycle_id) goToIndividualCycle(r.review_cycle_id)
            },
          }}
          cardRenderer={(row) => (
            <ReviewCard
              row={row}
              onEdit={(r) => {
                if (r.review_cycle_id) goToIndividualCycle(r.review_cycle_id)
              }}
            />
          )}
          emptyIcon={FileText}
          emptyTitle="No reviews found"
          emptyDescription="No reviews match your current search or filters."
        />
      ) : /* ── Department tab ──────────────────────────────────────────────── */
      tab === "department" ? (
        <DataTable<DeptRow>
          data={deptRows}
          columns={deptColumns}
          onProcessedDataChange={setProcessedDeptRows}
          getRowId={(r) => r.id}
          searchPlaceholder="Search department or quarter…"
          searchFn={(row, q) => row.department.toLowerCase().includes(q) || row.cycle.toLowerCase().includes(q)}
          filters={deptFilters}
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadReviews()}
          expandable={{
            render: (row) => (
              <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-4">
                {[
                  { label: "Avg KPI", value: row.kpi },
                  { label: "Avg CBT", value: row.cbt },
                  { label: "Avg Attendance", value: row.attendance },
                  { label: "Avg Behaviour", value: row.behaviour },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-muted-foreground text-xs">{s.label}</p>
                    <p className="mt-0.5 text-lg font-semibold">{s.value}</p>
                  </div>
                ))}
              </div>
            ),
          }}
          rowActions={[
            {
              label: "Open",
              icon: FileText,
              onClick: (row) => {
                if (row.cycleId !== "no-cycle") goDeptCycle(row.cycleId, row.department)
              },
              hidden: (row) => row.cycleId === "no-cycle",
            },
          ]}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: () => "bg-blue-500",
            title: (r) => r.department,
            subtitle: (r) => `${r.cycle} · Reviews: ${r.submitted}/${r.reviews} · Avg: ${r.final}`,
            trailing: (r) => <span className="text-xs font-semibold">{r.final}</span>,
            onSelect: (r) => {
              if (r.cycleId !== "no-cycle") goDeptCycle(r.cycleId, r.department)
            },
          }}
          cardRenderer={(r) => (
            <div
              className="bg-card cursor-pointer space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md"
              onClick={() => {
                if (r.cycleId !== "no-cycle") goDeptCycle(r.cycleId, r.department)
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{r.department}</p>
                  <p className="text-muted-foreground text-xs">{r.cycle}</p>
                </div>
                <Badge variant="outline">{r.final}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs">
                <div>
                  Reviews: {r.submitted}/{r.reviews}
                </div>
                <div>Avg KPI: {r.kpi}</div>
              </div>
            </div>
          )}
          emptyIcon={Users}
          emptyTitle="No department data"
          emptyDescription="No department review data matches your filters."
        />
      ) : (
        /* ── Cycle tab ───────────────────────────────────────────────────── */
        <DataTable<CycleRow>
          data={cycleRows}
          columns={cycleColumns}
          onProcessedDataChange={setProcessedCycleRows}
          getRowId={(r) => r.id}
          searchPlaceholder="Search quarter or review type…"
          searchFn={(row, q) => row.cycle.toLowerCase().includes(q) || row.review_type.toLowerCase().includes(q)}
          filters={cycleFilters}
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadReviews()}
          expandable={{
            render: (row) => (
              <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-4">
                {[
                  { label: "Total Employees", value: row.reviews },
                  {
                    label: "Submitted",
                    value: `${row.submitted} (${row.reviews > 0 ? Math.round((row.submitted / row.reviews) * 100) : 0}%)`,
                  },
                  { label: "Departments", value: row.departments },
                  {
                    label: "Completed",
                    value: `${row.completed} (${row.reviews > 0 ? Math.round((row.completed / row.reviews) * 100) : 0}%)`,
                  },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-muted-foreground text-xs">{s.label}</p>
                    <p className="mt-0.5 text-lg font-semibold">{s.value}</p>
                  </div>
                ))}
              </div>
            ),
          }}
          rowActions={[
            {
              label: "Open",
              icon: FileText,
              onClick: (row) => {
                if (row.cycleId !== "no-cycle") goToIndividualCycle(row.cycleId)
              },
              hidden: (row) => row.cycleId === "no-cycle",
            },
          ]}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: () => "bg-purple-500",
            title: (r) => r.cycle,
            subtitle: (r) => `${r.review_type} · ${r.reviews} staff · Completed: ${r.completed}`,
            trailing: (r) => (
              <span className="text-xs font-medium text-emerald-600">
                {r.reviews > 0 ? Math.round((r.completed / r.reviews) * 100) : 0}%
              </span>
            ),
            onSelect: (r) => {
              if (r.cycleId !== "no-cycle") goToIndividualCycle(r.cycleId)
            },
          }}
          cardRenderer={(r) => (
            <div
              className="bg-card cursor-pointer space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md"
              onClick={() => {
                if (r.cycleId !== "no-cycle") goToIndividualCycle(r.cycleId)
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{r.cycle}</p>
                  <p className="text-muted-foreground text-xs">{r.review_type}</p>
                </div>
                <Badge variant="outline">{r.reviews} staff</Badge>
              </div>
              <div className="space-y-1 border-t pt-2">
                <div className="flex justify-between text-xs">
                  <span>Completed</span>
                  <span className="font-semibold text-emerald-600">
                    {r.completed}/{r.reviews} ({r.reviews > 0 ? Math.round((r.completed / r.reviews) * 100) : 0}%)
                  </span>
                </div>
              </div>
            </div>
          )}
          emptyIcon={Clock}
          emptyTitle="No cycles found"
          emptyDescription="No review cycles match your filters."
        />
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <CreateReviewDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        queryClient={queryClient}
        mode={tab === "department" ? "department" : "individual"}
        onSaved={() => void loadReviews()}
      />
      <ExportOptionsDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        title="Export PMS Reviews"
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
        ]}
        onSelect={(id) => {
          const filename = `pms-reviews-${tab}-${toLocalISODate()}`
          if (id === "excel") void exportPmsRowsToExcel(exportRows, filename)
          else void exportPmsRowsToPdf(exportRows, filename, "PMS Reviews")
        }}
      />
    </DataTablePage>
  )
}
