"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Download, FileText, Plus, Users, CheckCircle2, Clock, BarChart3 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"
import { CreateReviewDialog } from "../../../performance/_components/create-review-dialog"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { exportPmsRowsToExcel, exportPmsRowsToPdf } from "@/lib/pms/export"
import { toLocalISODate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

// ─── Types ────────────────────────────────────────────────────────────────────

type ReviewRow = {
  id: string
  created_at: string
  status: "draft" | "submitted" | "completed" | null
  user_id: string | null
  review_cycle_id: string | null
  kpi_score: number | null
  cbt_score: number | null
  attendance_score: number | null
  behaviour_score: number | null
  final_score: number | null
  strengths: string | null
  areas_for_improvement: string | null
  manager_comments: string | null
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

type DeptSummaryRow = {
  id: string
  department: string
  reviews: number
  submitted: number
  completed: number
  kpi: string
  cbt: string
  attendance: string
  behaviour: string
  final: string
}

type CycleSummaryRow = {
  id: string
  cycle: string
  review_type: string
  employee_count: number
  submitted: number
  departments: number
  completed: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reviewStatusPriority(status: string | null | undefined) {
  const n = String(status || "").toLowerCase()
  if (n === "completed") return 3
  if (n === "submitted") return 2
  if (n === "draft") return 1
  return 0
}

function pickCanonicalReview(rows: ReviewRow[]) {
  return [...rows].sort((a, b) => {
    const diff = reviewStatusPriority(b.status) - reviewStatusPriority(a.status)
    if (diff !== 0) return diff
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })[0]
}

function fmt(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/, "") : "-"
}

function isSubmitted(review: ReviewRow) {
  return ["submitted", "completed"].includes(String(review.status || "").toLowerCase())
}

function canComplete(review: ReviewRow) {
  return [review.kpi_score, review.cbt_score, review.attendance_score, review.behaviour_score].every(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0
  )
}

function statusBadge(status: string | null) {
  const s = String(status || "draft").toLowerCase()
  const cls =
    s === "completed"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : s === "submitted"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
        : "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
  return (
    <Badge className={cls} variant="outline">
      {s}
    </Badge>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminPmsQuarterReviewsPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  const params = useParams<{ cycleId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const cycleId = String(params.cycleId || "")
  const mode = ((searchParams.get("mode") as "individual" | "department" | "cycle") || "individual") as
    | "individual"
    | "department"
    | "cycle"

  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  // Rows currently visible in each mode's table (after search + filters + sort).
  const [processedIndividualRows, setProcessedIndividualRows] = useState<ReviewRow[]>([])
  const [processedDeptRows, setProcessedDeptRows] = useState<DeptSummaryRow[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingTarget, setEditingTarget] = useState<ReviewRow | null>(null)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const hasLoadedRef = useRef(false)

  const loadReviews = useCallback(async () => {
    if (!hasLoadedRef.current) setIsInitialLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/hr/performance/reviews?cycle_id=${encodeURIComponent(cycleId)}`, {
        cache: "no-store",
      })
      const payload = (await res.json().catch(() => null)) as { data?: ReviewRow[]; error?: string } | null
      if (!res.ok) throw new Error(payload?.error || "Failed to load quarter reviews")
      setReviews(payload?.data || [])
      hasLoadedRef.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quarter reviews")
    } finally {
      setIsInitialLoading(false)
    }
  }, [cycleId])

  useEffect(() => {
    if (!cycleId) return
    void loadReviews()
  }, [cycleId, loadReviews])

  // ── Derived data ─────────────────────────────────────────────────────────

  const canonicalReviews = useMemo(() => {
    const grouped = new Map<string, ReviewRow[]>()
    for (const r of reviews) {
      const key = r.user_id || r.id
      grouped.set(key, [...(grouped.get(key) || []), r])
    }
    return Array.from(grouped.values())
      .map((rows) => pickCanonicalReview(rows))
      .sort((a, b) => {
        const an = `${a.user?.first_name || ""} ${a.user?.last_name || ""}`.trim().toLowerCase()
        const bn = `${b.user?.first_name || ""} ${b.user?.last_name || ""}`.trim().toLowerCase()
        return an.localeCompare(bn)
      })
  }, [reviews])

  const cycleName = canonicalReviews[0]?.cycle?.name || reviews[0]?.cycle?.name || "Quarter Review"

  const availableDepts = useMemo(
    () => Array.from(new Set(canonicalReviews.map((r) => r.user?.department).filter(Boolean) as string[])).sort(),
    [canonicalReviews]
  )

  const deptRows = useMemo<DeptSummaryRow[]>(() => {
    const grouped = new Map<string, ReviewRow[]>()
    for (const r of canonicalReviews) {
      const dept = r.user?.department || "Unknown"
      grouped.set(dept, [...(grouped.get(dept) || []), r])
    }
    return Array.from(grouped.entries()).map(([dept, rows]) => {
      const submitted = rows.filter(isSubmitted)
      const avg = (field: keyof ReviewRow) => {
        const vals = submitted.map((r) => r[field]).filter((v): v is number => typeof v === "number")
        return vals.length > 0 ? fmt(vals.reduce((s, v) => s + v, 0) / vals.length) : "-"
      }
      return {
        id: dept,
        department: dept,
        reviews: rows.length,
        submitted: submitted.length,
        completed: rows.filter((r) => r.status === "completed").length,
        kpi: avg("kpi_score"),
        cbt: avg("cbt_score"),
        attendance: avg("attendance_score"),
        behaviour: avg("behaviour_score"),
        final: avg("final_score"),
      }
    })
  }, [canonicalReviews])

  const cycleRows = useMemo<CycleSummaryRow[]>(
    () => [
      {
        id: cycleId,
        cycle: cycleName,
        review_type: canonicalReviews[0]?.cycle?.review_type || reviews[0]?.cycle?.review_type || "-",
        employee_count: canonicalReviews.length,
        submitted: canonicalReviews.filter(isSubmitted).length,
        departments: availableDepts.length,
        completed: canonicalReviews.filter((r) => r.status === "completed").length,
      },
    ],
    [availableDepts.length, canonicalReviews, cycleId, cycleName, reviews]
  )

  // ── Status update ────────────────────────────────────────────────────────

  async function handleStatusUpdate(reviewId: string, status: "draft" | "submitted" | "completed") {
    const target = canonicalReviews.find((r) => r.id === reviewId)
    try {
      const res = await apiFetch("/api/hr/performance/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reviewId,
          user_id: target?.user_id || undefined,
          review_cycle_id: target?.review_cycle_id || cycleId,
          status,
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(payload?.error || "Failed to update review status")
      toast.success("Review status updated")
      await loadReviews()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update review status")
    }
  }

  function handleTabChange(nextMode: string) {
    const p = new URLSearchParams(searchParams.toString())
    p.set("mode", nextMode)
    if (nextMode !== "department") p.delete("department")
    router.replace(`/admin/hr/pms/reviews/${encodeURIComponent(cycleId)}?${p.toString()}`)
  }

  // ── Export rows ──────────────────────────────────────────────────────────

  // Export the rows currently visible in the active mode's table (respects search + filters + sort).
  const exportRows =
    mode === "individual"
      ? (processedIndividualRows.length ? processedIndividualRows : canonicalReviews).map((r, i) => ({
          "S/N": i + 1,
          Employee: `${r.user?.first_name || ""} ${r.user?.last_name || ""}`.trim() || "Employee",
          Department: r.user?.department || "-",
          KPI: fmt(r.kpi_score),
          CBT: fmt(r.cbt_score),
          Attendance: fmt(r.attendance_score),
          Behaviour: fmt(r.behaviour_score),
          Final: fmt(r.final_score),
          Status: String(r.status || "draft"),
        }))
      : mode === "department"
        ? (processedDeptRows.length ? processedDeptRows : deptRows).map((row, i) => ({
            "S/N": i + 1,
            Department: row.department,
            Reviews: row.reviews,
            Submitted: row.submitted,
            KPI: row.kpi,
            CBT: row.cbt,
            Attendance: row.attendance,
            Behaviour: row.behaviour,
            Final: row.final,
            Completed: row.completed,
          }))
        : cycleRows.map((row, i) => ({
            "S/N": i + 1,
            Quarter: row.cycle,
            "Review Type": row.review_type,
            "Employee Count": row.employee_count,
            Submitted: row.submitted,
            Departments: row.departments,
            Completed: row.completed,
          }))

  // ── Column / filter definitions ──────────────────────────────────────────

  const deptFilterOptions = useMemo(() => availableDepts.map((d) => ({ value: d, label: d })), [availableDepts])

  const individualColumns = useMemo<DataTableColumn<ReviewRow>[]>(
    () => [
      {
        key: "employee",
        label: "Employee",
        sortable: true,
        resizable: true,
        initialWidth: 180,
        accessor: (r) => `${r.user?.first_name || ""} ${r.user?.last_name || ""}`.trim() || "Employee",
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        resizable: true,
        initialWidth: 160,
        accessor: (r) => r.user?.department || "-",
        hideOnMobile: true,
      },
      {
        key: "kpi_score",
        label: "KPI",
        sortable: true,
        width: "w-20",
        accessor: (r) => fmt(r.kpi_score),
        hideOnMobile: true,
      },
      {
        key: "cbt_score",
        label: "CBT",
        sortable: true,
        width: "w-20",
        accessor: (r) => fmt(r.cbt_score),
        hideOnMobile: true,
      },
      {
        key: "attendance_score",
        label: "Attendance",
        sortable: true,
        width: "w-24",
        accessor: (r) => fmt(r.attendance_score),
        hideOnMobile: true,
      },
      {
        key: "behaviour_score",
        label: "Behaviour",
        sortable: true,
        width: "w-24",
        accessor: (r) => fmt(r.behaviour_score),
        hideOnMobile: true,
      },
      {
        key: "final_score",
        label: "Final",
        sortable: true,
        width: "w-20",
        accessor: (r) => fmt(r.final_score),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        width: "w-28",
        accessor: (review: ReviewRow) => String(review.status || "draft"),
        render: (r) => statusBadge(r.status),
      },
    ],
    []
  )

  const individualFilters = useMemo<DataTableFilter<ReviewRow>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        options: deptFilterOptions,
        placeholder: "All Departments",
        mode: "custom",
        filterFn: (r: ReviewRow, vals) => vals.length === 0 || vals.includes(r.user?.department || ""),
      },
      {
        key: "status",
        label: "Status",
        options: [
          { value: "draft", label: "Draft" },
          { value: "submitted", label: "Submitted" },
          { value: "completed", label: "Completed" },
        ],
        placeholder: "All Statuses",
        accessor: (review: ReviewRow) => String(review.status || "draft"),
        mode: "column",
      },
    ],
    [deptFilterOptions]
  )

  const individualRowActions = useMemo<RowAction<ReviewRow>[]>(
    () => [
      {
        label: "Edit",
        onClick: (review: ReviewRow) => {
          setEditingTarget(review)
          setIsDialogOpen(true)
        },
      },
      {
        label: "Mark Completed",
        onClick: (review: ReviewRow) => void handleStatusUpdate(review.id, "completed"),
        hidden: (review: ReviewRow) => review.status === "completed" || !canComplete(review),
      },
      {
        label: "Reopen Draft",
        onClick: (review: ReviewRow) => void handleStatusUpdate(review.id, "draft"),
        hidden: (review: ReviewRow) => review.status !== "completed",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const deptColumns = useMemo<DataTableColumn<DeptSummaryRow>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) => r.department,
      },
      {
        key: "reviews",
        label: "Reviews",
        sortable: true,
        width: "w-20",
        accessor: (r) => String(r.reviews),
        hideOnMobile: true,
      },
      {
        key: "submitted",
        label: "Submitted",
        sortable: true,
        width: "w-24",
        accessor: (r) => String(r.submitted),
        hideOnMobile: true,
      },
      { key: "kpi", label: "KPI", sortable: true, width: "w-20", accessor: (r) => r.kpi, hideOnMobile: true },
      { key: "cbt", label: "CBT", sortable: true, width: "w-20", accessor: (r) => r.cbt, hideOnMobile: true },
      {
        key: "attendance",
        label: "Attendance",
        sortable: true,
        width: "w-24",
        accessor: (r) => r.attendance,
        hideOnMobile: true,
      },
      {
        key: "behaviour",
        label: "Behaviour",
        sortable: true,
        width: "w-24",
        accessor: (r) => r.behaviour,
        hideOnMobile: true,
      },
      { key: "final", label: "Final", sortable: true, width: "w-20", accessor: (r) => r.final },
      {
        key: "completed",
        label: "Completed",
        sortable: true,
        width: "w-24",
        accessor: (r) => String(r.completed),
        hideOnMobile: true,
      },
    ],
    []
  )

  const deptFilters = useMemo<DataTableFilter<DeptSummaryRow>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        options: deptFilterOptions,
        placeholder: "All Departments",
        mode: "column",
      },
    ],
    [deptFilterOptions]
  )

  const deptRowActions = useMemo<RowAction<DeptSummaryRow>[]>(
    () => [
      {
        label: "Open",
        onClick: (row) => {
          const p = new URLSearchParams()
          p.set("mode", "individual")
          p.set("department", row.department)
          router.replace(`/admin/hr/pms/reviews/${encodeURIComponent(cycleId)}?${p.toString()}`)
        },
      },
    ],
    [cycleId, router]
  )

  const cycleColumns = useMemo<DataTableColumn<CycleSummaryRow>[]>(
    () => [
      { key: "cycle", label: "Quarter", sortable: true, resizable: true, initialWidth: 220, accessor: (r) => r.cycle },
      {
        key: "review_type",
        label: "Review Type",
        sortable: true,
        width: "w-32",
        accessor: (r) => r.review_type,
        hideOnMobile: true,
      },
      {
        key: "employee_count",
        label: "Employees",
        sortable: true,
        width: "w-24",
        accessor: (r) => String(r.employee_count),
        hideOnMobile: true,
      },
      {
        key: "submitted",
        label: "Submitted",
        sortable: true,
        width: "w-24",
        accessor: (r) => String(r.submitted),
        hideOnMobile: true,
      },
      {
        key: "departments",
        label: "Depts",
        sortable: true,
        width: "w-20",
        accessor: (r) => String(r.departments),
        hideOnMobile: true,
      },
      {
        key: "completed",
        label: "Completed",
        sortable: true,
        width: "w-24",
        accessor: (r) => String(r.completed),
        hideOnMobile: true,
      },
    ],
    []
  )

  // ── Stats ────────────────────────────────────────────────────────────────

  const totalCount = canonicalReviews.length
  const submittedCount = canonicalReviews.filter(isSubmitted).length
  const completedCount = canonicalReviews.filter((r) => r.status === "completed").length

  const pageTabs: DataTableTab[] = [
    { key: "individual", label: "Individual" },
    { key: "department", label: "Department" },
    { key: "cycle", label: "Cycle" },
  ]

  return (
    <DataTablePage
      title={cycleName}
      description="Review and edit employee records for this quarter."
      icon={FileText}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms/reviews", label: "Back to PMS Reviews" }}
      tabs={pageTabs}
      activeTab={mode}
      onTabChange={handleTabChange}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total"
            value={totalCount}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Submitted"
            value={submittedCount}
            icon={BarChart3}
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
            title="Departments"
            value={availableDepts.length}
            icon={Clock}
            iconBgColor="bg-purple-500/10"
            iconColor="text-purple-500"
          />
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIsExportOpen(true)}
            disabled={exportRows.length === 0}
            className="h-8 gap-2"
            size="sm"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          <Button
            onClick={() => {
              setEditingTarget(null)
              setIsDialogOpen(true)
            }}
            className="h-8 gap-2"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Review</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      }
    >
      {mode === "individual" && (
        <DataTable<ReviewRow>
          data={canonicalReviews}
          columns={individualColumns}
          onProcessedDataChange={setProcessedIndividualRows}
          filters={individualFilters}
          getRowId={(r) => r.id}
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadReviews()}
          skeletonRows={6}
          rowActions={individualRowActions}
          searchPlaceholder="Search employee, department or status…"
          searchFn={(r, q) => {
            const name = `${r.user?.first_name || ""} ${r.user?.last_name || ""}`.toLowerCase()
            return (
              name.includes(q) ||
              (r.user?.department || "").toLowerCase().includes(q) ||
              String(r.status || "")
                .toLowerCase()
                .includes(q)
            )
          }}
          expandable={{
            render: (r) => (
              <div className="space-y-2 p-4 text-sm">
                {r.strengths && (
                  <div>
                    <span className="text-muted-foreground font-medium">Strengths: </span>
                    {r.strengths}
                  </div>
                )}
                {r.areas_for_improvement && (
                  <div>
                    <span className="text-muted-foreground font-medium">Areas for Improvement: </span>
                    {r.areas_for_improvement}
                  </div>
                )}
                {r.manager_comments && (
                  <div>
                    <span className="text-muted-foreground font-medium">Manager Comments: </span>
                    {r.manager_comments}
                  </div>
                )}
                {!r.strengths && !r.areas_for_improvement && !r.manager_comments && (
                  <span className="text-muted-foreground">No additional details.</span>
                )}
              </div>
            ),
            canExpand: (r) => !!(r.strengths || r.areas_for_improvement || r.manager_comments),
          }}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (r) =>
              r.status === "completed" ? "bg-emerald-500" : r.status === "submitted" ? "bg-blue-500" : "bg-amber-500",
            title: (r) => `${r.user?.first_name || ""} ${r.user?.last_name || ""}`.trim() || "Unknown",
            subtitle: (r) =>
              `${r.user?.department || "No dept"} · KPI: ${fmt(r.kpi_score)} · Final: ${fmt(r.final_score)}`,
            trailing: (r) => statusBadge(r.status),
            onSelect: (r) => {
              setEditingTarget(r)
              setIsDialogOpen(true)
            },
          }}
          cardRenderer={(r) => (
            <div
              className="bg-card cursor-pointer space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md"
              onClick={() => {
                setEditingTarget(r)
                setIsDialogOpen(true)
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    {`${r.user?.first_name || ""} ${r.user?.last_name || ""}`.trim() || "Unknown"}
                  </p>
                  <p className="text-muted-foreground text-xs">{r.user?.department || "No dept"}</p>
                </div>
                {statusBadge(r.status)}
              </div>
              <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs">
                <div>KPI: {fmt(r.kpi_score)}</div>
                <div>Final: {fmt(r.final_score)}</div>
              </div>
            </div>
          )}
          emptyIcon={FileText}
          emptyTitle="No reviews found"
          emptyDescription="No reviews have been submitted for this cycle yet."
        />
      )}

      {mode === "department" && (
        <DataTable<DeptSummaryRow>
          data={deptRows}
          columns={deptColumns}
          onProcessedDataChange={setProcessedDeptRows}
          filters={deptFilters}
          getRowId={(r) => r.id}
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadReviews()}
          skeletonRows={4}
          rowActions={deptRowActions}
          searchPlaceholder="Search department…"
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: () => "bg-blue-500",
            title: (r) => r.department,
            subtitle: (r) => `Reviews: ${r.submitted}/${r.reviews} · Avg Final: ${r.final}`,
            trailing: (r) => <span className="text-xs font-semibold">{r.final}</span>,
            onSelect: (r) => {
              const p = new URLSearchParams()
              p.set("mode", "individual")
              p.set("department", r.department)
              router.replace(`/admin/hr/pms/reviews/${encodeURIComponent(cycleId)}?${p.toString()}`)
            },
          }}
          cardRenderer={(r) => (
            <div
              className="bg-card cursor-pointer space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md"
              onClick={() => {
                const p = new URLSearchParams()
                p.set("mode", "individual")
                p.set("department", r.department)
                router.replace(`/admin/hr/pms/reviews/${encodeURIComponent(cycleId)}?${p.toString()}`)
              }}
            >
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold">{r.department}</p>
                <Badge variant="outline">{r.final}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs">
                <div>
                  Submitted: {r.submitted}/{r.reviews}
                </div>
                <div>KPI: {r.kpi}</div>
              </div>
            </div>
          )}
          emptyIcon={FileText}
          emptyTitle="No departments found"
          emptyDescription="No reviews have been grouped by department yet."
        />
      )}

      {mode === "cycle" && (
        <DataTable<CycleSummaryRow>
          data={cycleRows}
          columns={cycleColumns}
          getRowId={(r) => r.id}
          isLoading={isInitialLoading}
          error={error}
          onRetry={() => void loadReviews()}
          skeletonRows={1}
          searchDisabled
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: () => "bg-purple-500",
            title: (r) => r.cycle,
            subtitle: (r) => `${r.review_type} · ${r.employee_count} staff · Completed: ${r.completed}`,
            trailing: (r) => (
              <span className="text-xs font-medium text-emerald-600">
                {r.employee_count > 0 ? Math.round((r.completed / r.employee_count) * 100) : 0}%
              </span>
            ),
          }}
          cardRenderer={(r) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{r.cycle}</p>
                  <p className="text-muted-foreground text-xs">{r.review_type}</p>
                </div>
                <Badge variant="outline">{r.employee_count} staff</Badge>
              </div>
              <div className="space-y-1 border-t pt-2">
                <div className="flex justify-between text-xs">
                  <span>Completed</span>
                  <span className="font-semibold text-emerald-600">
                    {r.completed}/{r.employee_count} (
                    {r.employee_count > 0 ? Math.round((r.completed / r.employee_count) * 100) : 0}%)
                  </span>
                </div>
              </div>
            </div>
          )}
          emptyIcon={FileText}
          emptyTitle="No cycle data"
          emptyDescription="No reviews found for this cycle."
        />
      )}

      <CreateReviewDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        queryClient={queryClient}
        mode={mode === "department" ? "department" : "individual"}
        initialUserId={editingTarget?.user_id || ""}
        initialCycleId={cycleId}
        initialDepartment={editingTarget?.user?.department || ""}
        initialStatus={editingTarget?.status || "draft"}
        onSaved={() => void loadReviews()}
      />

      <ExportOptionsDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        title={`Export ${cycleName}`}
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
        ]}
        onSelect={(id) => {
          const filename = `${cycleName.replace(/\s+/g, "-").toLowerCase()}-reviews-${toLocalISODate()}`
          if (id === "excel") {
            void exportPmsRowsToExcel(exportRows, filename)
            return
          }
          void exportPmsRowsToPdf(exportRows, filename, cycleName)
        }}
      />
    </DataTablePage>
  )
}
