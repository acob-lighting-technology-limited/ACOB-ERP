"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Clock, CheckCircle2, XCircle, FileQuestion } from "lucide-react"
import { toast } from "sonner"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import type { UnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { formatWATDate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"
import { AppealReviewDialog } from "./appeal-review-dialog"
import type { AppealRow } from "./appeal-review-dialog"

const log = logger("admin-attendance-appeals-view")

interface AppealsViewProps {
  lockedDepartment?: string
}

function statusBadge(status: AppealRow["status"]) {
  if (status === "approved")
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Approved</Badge>
    )
  if (status === "rejected")
    return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">Rejected</Badge>
  return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Pending</Badge>
}

export function AppealsView({ lockedDepartment }: AppealsViewProps) {
  const [appeals, setAppeals] = useState<AppealRow[]>([])
  const [loading, setLoading] = useState(false)
  const [reviewAppeal, setReviewAppeal] = useState<AppealRow | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (lockedDepartment) params.set("department", lockedDepartment)
      const res = await fetch(`/api/admin/hr/attendance/appeals?${params.toString()}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load appeals")
      setAppeals((payload?.data as AppealRow[]) ?? [])
    } catch (err) {
      log.error({ err: String(err) }, "Failed to load appeals")
      toast.error("Failed to load appeals")
    } finally {
      setLoading(false)
    }
  }, [statusFilter, lockedDepartment])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    const now = new Date()
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const pending = appeals.filter((a) => a.status === "pending").length
    const approvedThisMonth = appeals.filter(
      (a) => a.status === "approved" && a.created_at.startsWith(currentYM)
    ).length
    const rejectedThisMonth = appeals.filter(
      (a) => a.status === "rejected" && a.created_at.startsWith(currentYM)
    ).length
    return { pending, approvedThisMonth, rejectedThisMonth }
  }, [appeals])

  // Collect unique departments for filter
  const departmentOptions = useMemo(() => {
    if (lockedDepartment) return [{ value: lockedDepartment, label: lockedDepartment }]
    const depts = Array.from(new Set(appeals.map((a) => a.department).filter(Boolean)))
    return depts.map((d) => ({ value: d, label: d }))
  }, [appeals, lockedDepartment])

  const columns = useMemo<DataTableColumn<AppealRow>[]>(
    () => [
      {
        key: "user_name",
        label: "Employee",
        sortable: true,
        accessor: (r) => r.user_name,
        render: (r) => (
          <div>
            <div className="font-medium">{r.user_name}</div>
            <div className="text-muted-foreground text-xs">{r.department}</div>
          </div>
        ),
        resizable: true,
        initialWidth: 180,
      },
      {
        key: "appeal_date",
        label: "Date",
        sortable: true,
        accessor: (r) => r.appeal_date,
        render: (r) => (
          <span className="font-medium">
            {formatWATDate(r.appeal_date, { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        ),
      },
      {
        key: "current_status",
        label: "Current Status",
        accessor: (r) => r.current_status,
        render: (r) => (
          <Badge
            className={
              ATTENDANCE_STATUS_COLORS[r.current_status as UnifiedAttendanceStatus] ?? "bg-gray-100 text-gray-800"
            }
          >
            {ATTENDANCE_STATUS_LABELS[r.current_status as UnifiedAttendanceStatus] ?? r.current_status}
          </Badge>
        ),
      },
      {
        key: "requested_status",
        label: "Requesting",
        accessor: (r) => r.requested_status,
        render: (r) => (
          <Badge
            className={
              ATTENDANCE_STATUS_COLORS[r.requested_status as UnifiedAttendanceStatus] ?? "bg-blue-100 text-blue-800"
            }
          >
            {ATTENDANCE_STATUS_LABELS[r.requested_status as UnifiedAttendanceStatus] ?? r.requested_status}
          </Badge>
        ),
      },

      {
        key: "created_at",
        label: "Submitted",
        sortable: true,
        accessor: (r) => r.created_at,
        render: (r) => (
          <span className="text-muted-foreground text-sm">
            {formatWATDate(r.created_at, { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        ),
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => statusBadge(r.status),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<AppealRow>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
        ],
        placeholder: "All Statuses",
      },
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
        placeholder: lockedDepartment || "All Departments",
      },
    ],
    [departmentOptions, lockedDepartment]
  )

  return (
    <>
      {/* Stats */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard
          variant="compact"
          title="Total Pending"
          value={stats.pending}
          icon={Clock}
          iconBgColor="bg-amber-500/10"
          iconColor="text-amber-500"
        />
        <StatCard
          variant="compact"
          title="Approved This Month"
          value={stats.approvedThisMonth}
          icon={CheckCircle2}
          iconBgColor="bg-emerald-500/10"
          iconColor="text-emerald-500"
        />
        <StatCard
          variant="compact"
          title="Rejected This Month"
          value={stats.rejectedThisMonth}
          icon={XCircle}
          iconBgColor="bg-red-500/10"
          iconColor="text-red-500"
        />
      </div>

      <DataTable<AppealRow>
        data={appeals}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.id}
        searchPlaceholder="Search employee or department…"
        searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
        pagination={{ pageSize: 50 }}
        isLoading={loading}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (r) =>
            r.status === "approved" ? "bg-emerald-500" : r.status === "rejected" ? "bg-rose-500" : "bg-amber-500",
          title: (r) => `${r.user_name} · ${r.department}`,
          subtitle: (r) => `${formatWATDate(r.appeal_date)} · ${r.current_status} ➔ ${r.requested_status}`,
          trailing: (r) => statusBadge(r.status),
          onSelect: (r) => {
            if (r.status === "pending") setReviewAppeal(r)
          },
        }}
        cardRenderer={(r) => (
          <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{r.user_name}</p>
                <p className="text-muted-foreground text-xs">{r.department}</p>
              </div>
              {statusBadge(r.status)}
            </div>
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span>Date: {formatWATDate(r.appeal_date)}</span>
              <span>
                {r.current_status} ➔ {r.requested_status}
              </span>
            </div>
            {r.appeal_reason && (
              <p className="text-muted-foreground line-clamp-2 border-t pt-2 text-[11px]">{r.appeal_reason}</p>
            )}
          </div>
        )}
        emptyTitle="No appeals found"
        emptyDescription="No attendance appeals match your current filters."
        emptyIcon={FileQuestion}
        rowActions={[
          {
            label: "Review",
            onClick: (row) => setReviewAppeal(row),
            hidden: (row) => row.status !== "pending",
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 space-y-3 border-y p-4 text-sm">
              <div>
                <span className="text-muted-foreground mb-1 block text-xs font-semibold tracking-wide uppercase">
                  Appeal Reason
                </span>
                <p className="text-foreground text-sm font-medium whitespace-pre-wrap">{r.appeal_reason}</p>
              </div>
              {r.resolution_note && (
                <div>
                  <span className="text-muted-foreground mb-1 block text-xs font-semibold tracking-wide uppercase">
                    Resolution Note
                  </span>
                  <p className="text-muted-foreground text-sm font-medium whitespace-pre-wrap">{r.resolution_note}</p>
                </div>
              )}
            </div>
          ),
        }}
      />

      <AppealReviewDialog
        appeal={reviewAppeal}
        open={reviewAppeal !== null}
        onClose={() => setReviewAppeal(null)}
        onSuccess={() => {
          setReviewAppeal(null)
          void load()
        }}
      />
    </>
  )
}
