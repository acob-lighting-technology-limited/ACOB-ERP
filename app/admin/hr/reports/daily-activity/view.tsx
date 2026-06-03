"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { ClipboardList, CheckCircle2, Clock, Download, Check, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"
import {
  DAILY_TASK_STATUS_LABELS,
  DAILY_TASK_STATUS_COLORS,
  DAILY_TASK_TYPE_LABELS,
  DAILY_REPORT_STATUS_LABELS,
  DAILY_REPORT_STATUS_COLORS,
  type DailyTaskStatus,
  type DailyTaskType,
} from "@/lib/hr/daily-report"

const log = logger("admin-daily-activity")

interface ReportTask {
  id: string
  description: string
  status: DailyTaskStatus
  task_type: DailyTaskType | null
  comments: string | null
  position: number
}

interface DailyReport {
  id: string
  user_id: string
  user_name: string
  department: string
  report_date: string
  status: string
  acknowledged: boolean
  acknowledged_at: string | null
  task_count: number
  total_completed: number
  unforeseen_completed: number
  tasks: ReportTask[]
}

function formatDate(dateString: string) {
  return formatWATDate(dateString, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

export function AdminDailyActivityPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(false)
  const [acking, setAcking] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    start_date: toLocalISODate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    end_date: toLocalISODate(),
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ start_date: filters.start_date, end_date: filters.end_date })
      const res = await fetch(`/api/admin/hr/reports/daily-activity?${params}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load reports")
      setReports(payload.reports || [])
    } catch (err) {
      log.error("Failed to load daily reports", err)
      toast.error("Failed to load reports")
    } finally {
      setLoading(false)
    }
  }, [filters.start_date, filters.end_date])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleAck(report: DailyReport) {
    setAcking(report.id)
    try {
      const res = await fetch(`/api/admin/hr/reports/daily-activity/${report.id}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: !report.acknowledged }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to update")
      toast.success(payload?.message || "Updated")
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    } finally {
      setAcking(null)
    }
  }

  function downloadCSV() {
    const headers = ["Date", "Employee", "Department", "Total Completed", "Unforeseen Completed", "Tasks", "Status", "Acknowledged"]
    const rows = reports.map((r) => [
      formatDate(r.report_date),
      r.user_name,
      r.department,
      String(r.total_completed),
      String(r.unforeseen_completed),
      String(r.task_count),
      DAILY_REPORT_STATUS_LABELS[r.status] ?? r.status,
      r.acknowledged ? "Yes" : "No",
    ])
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `daily-activity-${filters.start_date}-to-${filters.end_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const submittedCount = reports.filter((r) => r.status === "submitted").length
  const acknowledgedCount = reports.filter((r) => r.acknowledged).length
  const pendingCount = reports.filter((r) => r.status === "submitted" && !r.acknowledged).length

  const departmentOptions = useMemo(() => {
    const set = new Set(reports.map((r) => r.department).filter(Boolean))
    return [...set].sort().map((d) => ({ value: d, label: d }))
  }, [reports])

  const columns: DataTableColumn<DailyReport>[] = [
    {
      key: "report_date",
      label: "Date",
      sortable: true,
      accessor: (r) => r.report_date,
      render: (r) => <span className="font-medium">{formatDate(r.report_date)}</span>,
      initialWidth: 180,
    },
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
      initialWidth: 180,
    },
    {
      key: "department",
      label: "Department",
      accessor: (r) => r.department,
      defaultVisible: false,
      render: (r) => r.department || "-",
    },
    {
      key: "total_completed",
      label: "Completed",
      sortable: true,
      accessor: (r) => r.total_completed,
      render: (r) => r.total_completed,
      align: "center",
    },
    {
      key: "unforeseen_completed",
      label: "Unforeseen",
      sortable: true,
      accessor: (r) => r.unforeseen_completed,
      render: (r) => r.unforeseen_completed,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "task_count",
      label: "Tasks",
      sortable: true,
      accessor: (r) => r.task_count,
      render: (r) => r.task_count,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (r) => (r.acknowledged ? "acknowledged" : r.status),
      render: (r) => (
        <div className="flex items-center gap-1">
          <Badge className={DAILY_REPORT_STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-700"}>
            {DAILY_REPORT_STATUS_LABELS[r.status] ?? r.status}
          </Badge>
          {r.acknowledged && <Badge className="bg-green-100 text-green-800">Acknowledged</Badge>}
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      accessor: () => "",
      align: "center",
      render: (r) => (
        <Button
          variant={r.acknowledged ? "ghost" : "outline"}
          size="sm"
          disabled={acking === r.id}
          onClick={() => toggleAck(r)}
        >
          {r.acknowledged ? (
            <>
              <RotateCcw className="mr-1 h-3 w-3" />
              Undo
            </>
          ) : (
            <>
              <Check className="mr-1 h-3 w-3" />
              Acknowledge
            </>
          )}
        </Button>
      ),
    },
  ]

  const tableFilters: DataTableFilter<DailyReport>[] = [
    {
      key: "status",
      label: "Status",
      placeholder: "All Statuses",
      mode: "custom",
      filterFn: (r, values) => values.includes(r.acknowledged ? "acknowledged" : r.status),
      options: [
        { value: "draft", label: "Draft" },
        { value: "submitted", label: "Submitted" },
        { value: "acknowledged", label: "Acknowledged" },
      ],
    },
    {
      key: "department",
      label: "Department",
      placeholder: "All Departments",
      options: departmentOptions,
    },
  ]

  return (
    <DataTablePage
      title="Daily Activity Reports"
      description="Review employees' daily activity reports and acknowledge them."
      icon={ClipboardList}
      backLink={{ href: backLinkHref ?? "/admin/hr", label: "Back to HR" }}
      actions={
        <Button variant="outline" size="sm" onClick={downloadCSV} disabled={reports.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard title="Reports" value={reports.length} icon={ClipboardList} />
          <StatCard title="Submitted" value={submittedCount} icon={CheckCircle2} />
          <StatCard
            title="Pending Review"
            value={pendingCount}
            icon={Clock}
            iconBgColor="bg-orange-500/10"
            iconColor="text-orange-500"
          />
          <StatCard title="Acknowledged" value={acknowledgedCount} icon={Check} />
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 rounded-xl border p-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Start Date</Label>
          <Input
            type="date"
            value={filters.start_date}
            onChange={(e) => setFilters((f) => ({ ...f, start_date: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>End Date</Label>
          <Input
            type="date"
            value={filters.end_date}
            onChange={(e) => setFilters((f) => ({ ...f, end_date: e.target.value }))}
          />
        </div>
        <div className="flex items-end">
          <Button onClick={load} disabled={loading} className="w-full">
            {loading ? "Loading..." : "Apply"}
          </Button>
        </div>
      </div>

      <DataTable<DailyReport>
        data={reports}
        columns={columns}
        filters={tableFilters}
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search employee or department..."
        searchFn={(r, q) => [r.user_name, r.department].join(" ").toLowerCase().includes(q)}
        isLoading={loading}
        emptyTitle="No reports found"
        emptyDescription="Adjust the date range and try again."
        emptyIcon={ClipboardList}
        skeletonRows={8}
        expandable={{
          canExpand: (r) => r.tasks.length > 0,
          render: (r) => (
            <div className="space-y-2 p-2">
              {r.tasks.map((t) => (
                <div key={t.id} className="flex flex-wrap items-start gap-2 rounded-lg border p-2 text-sm">
                  <Badge className={DAILY_TASK_STATUS_COLORS[t.status] ?? "bg-gray-100 text-gray-700"}>
                    {DAILY_TASK_STATUS_LABELS[t.status] ?? t.status}
                  </Badge>
                  {t.task_type && (
                    <Badge className="bg-slate-100 text-slate-700">{DAILY_TASK_TYPE_LABELS[t.task_type]}</Badge>
                  )}
                  <span className="flex-1 font-medium">{t.description}</span>
                  {t.comments && <span className="text-muted-foreground w-full text-xs">{t.comments}</span>}
                </div>
              ))}
            </div>
          ),
        }}
      />
    </DataTablePage>
  )
}
