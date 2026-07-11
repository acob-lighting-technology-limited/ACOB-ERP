"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { ClipboardList, CheckCircle2, Plus, Trash2, Lock, Save, Send, Zap, Clock3 } from "lucide-react"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"
import {
  DAILY_TASK_STATUS_LABELS,
  DAILY_TASK_TYPE_LABELS,
  DAILY_REPORT_STATUS_LABELS,
  computeDailyTotals,
  type DailyTaskStatus,
} from "@/lib/hr/daily-report"

const log = logger("daily-activity")
const NONE_TYPE = "none"

interface EditableTask {
  description: string
  status: DailyTaskStatus
  task_type: "planned" | "unforeseen" | null
  comments: string
}

interface SummaryTask {
  id: string
  description: string
  status: DailyTaskStatus
  task_type: "planned" | "unforeseen" | null
  comments: string | null
  position: number
}

interface SummaryRow {
  id: string
  report_date: string
  status: string
  acknowledged: boolean
  task_count: number
  total_completed: number
  unforeseen_completed: number
  tasks: SummaryTask[]
}

interface DayTableRow {
  id: string
  report_date: string
  weekday: string
  report: SummaryRow | null
  completedCount: number
  inProgressCount: number
  notStartedCount: number
  plannedCount: number
  unforeseenCount: number
}

interface ExpandedDayTasksProps {
  row: DayTableRow
  onSave: (reportDate: string, tasks: EditableTask[], status: "draft" | "submitted") => Promise<void>
}

function emptyTask(): EditableTask {
  return { description: "", status: "not_started", task_type: null, comments: "" }
}

function formatDate(dateString: string) {
  return formatWATDate(dateString, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

function toYearMonth(date: string) {
  return date.slice(0, 7)
}

function isoDateRange(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${startIso}T00:00:00Z`)
  const end = new Date(`${endIso}T00:00:00Z`)
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear()
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0")
    const d = String(cursor.getUTCDate()).padStart(2, "0")
    out.push(`${y}-${m}-${d}`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function weekdayShort(dateIso: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Africa/Lagos" }).format(
    new Date(`${dateIso}T00:00:00Z`)
  )
}

function taskCountByStatus(tasks: SummaryTask[], status: DailyTaskStatus) {
  return tasks.filter((t) => t.status === status).length
}

function taskCountByType(tasks: SummaryTask[], type: "planned" | "unforeseen") {
  return tasks.filter((t) => t.task_type === type).length
}

export function DailyActivityContent() {
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [date, setDate] = useState(() => toLocalISODate())
  const [tasks, setTasks] = useState<EditableTask[]>([emptyTask()])
  const [reportStatus, setReportStatus] = useState<string>("draft")
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const today = toLocalISODate()
      const res = await apiFetch(`/api/hr/reports/daily-activity?start=1970-01-01&end=${today}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load history")
      setSummary(payload.summary || [])
    } catch (err) {
      log.error("Failed to load daily report history", err)
      toast.error("Failed to load daily activity history")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDay = useCallback(async (day: string) => {
    try {
      const res = await apiFetch(`/api/hr/reports/daily-activity?date=${day}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load report")
      const loaded: EditableTask[] = (payload.tasks || []).map(
        (t: { description: string; status: DailyTaskStatus; task_type: string | null; comments: string | null }) => ({
          description: t.description,
          status: t.status,
          task_type: (t.task_type as "planned" | "unforeseen" | null) ?? null,
          comments: t.comments ?? "",
        })
      )
      setTasks(loaded.length > 0 ? loaded : [emptyTask()])
      setReportStatus(payload.report?.status ?? "draft")
      setAcknowledged(Boolean(payload.report?.acknowledged))
    } catch (err) {
      log.error("Failed to load daily report", err)
      toast.error("Failed to load report")
    }
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const taskSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const row of summary) {
      for (const task of row.tasks || []) {
        const text = (task.description || "").trim()
        if (text) set.add(text)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [summary])

  const dayRows = useMemo<DayTableRow[]>(() => {
    const todayIso = toLocalISODate()
    const earliest = summary.reduce<string | null>(
      (acc, row) => (!acc || row.report_date < acc ? row.report_date : acc),
      null
    )
    const defaultStart = `${todayIso.slice(0, 7)}-01`
    const start = earliest || defaultStart
    const byDate = new Map(summary.map((s) => [s.report_date, s]))
    return isoDateRange(start, todayIso)
      .filter((dateIso) => dateIso <= todayIso)
      .map((dateIso) => {
        const report = byDate.get(dateIso) || null
        const tasksForDay = report?.tasks || []
        return {
          id: report?.id || `empty-${dateIso}`,
          report_date: dateIso,
          weekday: weekdayShort(dateIso),
          report,
          completedCount: taskCountByStatus(tasksForDay, "completed"),
          inProgressCount: taskCountByStatus(tasksForDay, "in_progress"),
          notStartedCount: taskCountByStatus(tasksForDay, "not_started"),
          plannedCount: taskCountByType(tasksForDay, "planned"),
          unforeseenCount: taskCountByType(tasksForDay, "unforeseen"),
        }
      })
      .reverse()
  }, [summary])

  const openEditor = useCallback(
    async (day: string) => {
      setDate(day)
      await loadDay(day)
      setDialogOpen(true)
    },
    [loadDay]
  )

  const readOnly = acknowledged

  function updateTask(index: number, patch: Partial<EditableTask>) {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  function addRow() {
    setTasks((prev) => [...prev, emptyTask()])
  }

  function removeRow(index: number) {
    setTasks((prev) => (prev.length === 1 ? [emptyTask()] : prev.filter((_, i) => i !== index)))
  }

  const save = useCallback(
    async (nextStatus: "draft" | "submitted", silent = false) => {
      const cleaned = tasks
        .map((t) => ({ ...t, description: t.description.trim(), comments: t.comments.trim() }))
        .filter((t) => t.description.length > 0)

      if (nextStatus === "submitted" && cleaned.length === 0) {
        toast.error("Add at least one task before submitting")
        return
      }

      if (nextStatus === "draft" && !silent) setSavingDraft(true)
      if (nextStatus === "submitted") setSaving(true)
      try {
        const res = await apiFetch("/api/hr/reports/daily-activity", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            report_date: date,
            status: nextStatus,
            tasks: cleaned.map((t) => ({
              description: t.description,
              status: t.status,
              task_type: t.task_type,
              comments: t.comments || null,
            })),
          }),
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error || "Failed to save")
        if (!silent) toast.success(payload?.message || "Saved")
        setReportStatus(nextStatus)
        await loadSummary()
      } catch (err) {
        if (!silent) toast.error(err instanceof Error ? err.message : "Failed to save")
      } finally {
        setSaving(false)
        setSavingDraft(false)
      }
    },
    [tasks, date, loadSummary]
  )

  const saveInlineDayTasks = useCallback(
    async (reportDate: string, inlineTasks: EditableTask[], status: "draft" | "submitted") => {
      const cleaned = inlineTasks
        .map((t) => ({ ...t, description: t.description.trim(), comments: t.comments.trim() }))
        .filter((t) => t.description.length > 0)

      const res = await apiFetch("/api/hr/reports/daily-activity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_date: reportDate,
          status,
          tasks: cleaned.map((t) => ({
            description: t.description,
            status: t.status,
            task_type: t.task_type,
            comments: t.comments || null,
          })),
        }),
      })

      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to save")
      await loadSummary()
    },
    [loadSummary]
  )

  useEffect(() => {
    if (!dialogOpen || readOnly) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      void save("draft", true)
    }, 900)
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [tasks, dialogOpen, readOnly, save])

  const dayFilterOptions = useMemo(
    () =>
      dayRows.map((row) => ({
        value: row.report_date,
        label: `${row.weekday} ${row.report_date.slice(-2)}`,
      })),
    [dayRows]
  )

  const monthFilterOptions = useMemo(() => {
    const unique = new Set<string>(dayRows.map((row) => toYearMonth(row.report_date)))
    return [...unique].sort().map((m) => ({ value: m, label: m }))
  }, [dayRows])

  const cycleOptions = [
    { value: "week_1", label: "Cycle Week 1" },
    { value: "week_2", label: "Cycle Week 2" },
    { value: "week_3", label: "Cycle Week 3" },
    { value: "week_4", label: "Cycle Week 4" },
    { value: "week_5", label: "Cycle Week 5" },
  ]

  function weekCycle(dateIso: string) {
    const day = Number(dateIso.slice(-2))
    return `week_${Math.ceil(day / 7)}`
  }

  const tableFilters: DataTableFilter<DayTableRow>[] = [
    { key: "report_date", label: "Day", options: dayFilterOptions, placeholder: "All Days", multi: false },
    {
      key: "month",
      label: "Month",
      options: monthFilterOptions,
      placeholder: "Month",
      multi: false,
      mode: "custom",
      filterFn: (r, values) => values.includes(toYearMonth(r.report_date)),
    },
    {
      key: "cycle",
      label: "Cycle",
      options: cycleOptions,
      placeholder: "Cycle",
      multi: false,
      mode: "custom",
      filterFn: (r, values) => values.includes(weekCycle(r.report_date)),
    },
  ]

  const columns: DataTableColumn<DayTableRow>[] = [
    {
      key: "day_number",
      label: "S/N",
      sortable: true,
      accessor: (r) => Number(r.report_date.slice(-2)),
      align: "center",
      render: (r) => Number(r.report_date.slice(-2)),
      initialWidth: 70,
    },
    {
      key: "report_date",
      label: "Day",
      sortable: true,
      accessor: (r) => r.report_date,
      render: (r) => (
        <div>
          <div className="font-medium">{formatDate(r.report_date)}</div>
        </div>
      ),
      initialWidth: 200,
    },
    { key: "completedCount", label: "Done", sortable: true, accessor: (r) => r.completedCount, align: "center" },
    {
      key: "inProgressCount",
      label: "In Progress",
      sortable: true,
      accessor: (r) => r.inProgressCount,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "notStartedCount",
      label: "Not Started",
      sortable: true,
      accessor: (r) => r.notStartedCount,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "plannedCount",
      label: "Planned",
      sortable: true,
      accessor: (r) => r.plannedCount,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "unforeseenCount",
      label: "Unforeseen",
      sortable: true,
      accessor: (r) => r.unforeseenCount,
      align: "center",
      hideOnMobile: true,
    },
    {
      key: "status",
      label: "Report",
      accessor: (r) => (r.report ? (r.report.acknowledged ? "acknowledged" : r.report.status) : "empty"),
      render: (r) => {
        if (!r.report) return <span className="text-muted-foreground">No Report</span>
        const statusLabel = DAILY_REPORT_STATUS_LABELS[r.report.status] ?? r.report.status
        return <span>{r.report.acknowledged ? `${statusLabel} (Acknowledged)` : statusLabel}</span>
      },
    },
  ]

  const currentReport = useMemo(() => summary.find((r) => r.report_date === date) || null, [summary, date])
  const totals = useMemo(() => {
    const completed = dayRows.reduce((sum, row) => sum + row.completedCount, 0)
    const unforeseenCompleted = dayRows.reduce((sum, row) => sum + row.unforeseenCount, 0)
    const inProgress = dayRows.reduce((sum, row) => sum + row.inProgressCount, 0)
    return { completed, unforeseenCompleted, inProgress }
  }, [dayRows])
  const currentTotals = useMemo(
    () => computeDailyTotals(tasks.map((t) => ({ status: t.status, task_type: t.task_type }))),
    [tasks]
  )
  const totalTasksLogged = tasks.filter((t) => t.description.trim()).length

  function exportCSV() {
    const headers = [
      "Date",
      "Status",
      "Acknowledged",
      "Completed",
      "In Progress",
      "Not Started",
      "Planned",
      "Unforeseen",
    ]
    const rows = dayRows.map((r) => [
      r.report_date,
      r.report ? (DAILY_REPORT_STATUS_LABELS[r.report.status] ?? r.report.status) : "No Report",
      r.report?.acknowledged ? "Yes" : "No",
      String(r.completedCount),
      String(r.inProgressCount),
      String(r.notStartedCount),
      String(r.plannedCount),
      String(r.unforeseenCount),
    ])
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "daily-activity-all.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportExcel() {
    exportCSV()
  }

  function exportPdf() {
    window.print()
  }

  return (
    <>
      <DataTablePage
        title="Daily Activity"
        description="Daily report logs with per-day status and type breakdown."
        icon={ClipboardList}
        backLink={{ href: "/reports", label: "Back to Reports" }}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = toLocalISODate()
                setDate(today)
                void loadDay(today).then(() => setDialogOpen(true))
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Report
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              Export
            </Button>
          </div>
        }
        stats={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard title="Reports Created" value={summary.length} icon={CheckCircle2} />
            <StatCard title="Completed Tasks" value={totals.completed} icon={ClipboardList} />
            <StatCard
              title="Unforeseen Completed"
              value={totals.unforeseenCompleted}
              icon={Zap}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
            <StatCard
              title="In Progress Tasks"
              value={totals.inProgress}
              icon={Clock3}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
          </div>
        }
      >
        <DataTable<DayTableRow>
          data={dayRows}
          columns={columns}
          filters={tableFilters}
          getRowId={(r) => r.id}
          searchPlaceholder="Search day, report status, or task summary..."
          searchFn={(r, q) => {
            const reportLabel = r.report
              ? (DAILY_REPORT_STATUS_LABELS[r.report.status] ?? r.report.status)
              : "no report"
            return [r.report_date, r.weekday, reportLabel, ...(r.report?.tasks || []).map((task) => task.description)]
              .join(" ")
              .toLowerCase()
              .includes(q)
          }}
          isLoading={loading}
          pagination={{ pageSize: 10 }}
          emptyTitle="No days found"
          emptyDescription="Change month or filters."
          emptyIcon={ClipboardList}
          showRowNumbers={false}
          expandableColumnPosition="start"
          rowActions={[{ label: "Open", onClick: (row) => void openEditor(row.report_date) }]}
          expandable={{
            canExpand: (row) => Boolean(row.report && row.report.tasks.length > 0),
            render: (row) => <ExpandedDayTasks row={row} onSave={saveInlineDayTasks} />,
          }}
          viewToggle
          cardRenderer={(row) => (
            <div className="space-y-2 p-1">
              <div className="font-medium">{formatDate(row.report_date)}</div>
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>Done: {row.completedCount}</span>
                <span>In Progress: {row.inProgressCount}</span>
                <span>Not Started: {row.notStartedCount}</span>
                <span>Planned: {row.plannedCount}</span>
                <span>Unforeseen: {row.unforeseenCount}</span>
              </div>
              {row.report && (
                <Badge variant="outline" className="text-xs">
                  {row.report.acknowledged
                    ? `${DAILY_REPORT_STATUS_LABELS[row.report.status] ?? row.report.status} (Acknowledged)`
                    : (DAILY_REPORT_STATUS_LABELS[row.report.status] ?? row.report.status)}
                </Badge>
              )}
            </div>
          )}
        />
      </DataTablePage>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-5xl">
          <DialogHeader>
            <div className="border-b px-6 py-4">
              <DialogTitle className="text-xl">{formatDate(date)} Daily Report</DialogTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                Edit tasks, statuses, and comments for this report day.
              </p>
            </div>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded-md border p-3">
                <Label className="mb-2 block text-xs font-semibold tracking-wide uppercase">Report Date</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={acknowledged}
                  className="h-9"
                />
              </div>
              <div className="rounded-md border p-3">
                <Label className="mb-2 block text-xs font-semibold tracking-wide uppercase">Status</Label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{DAILY_REPORT_STATUS_LABELS[reportStatus] ?? reportStatus}</span>
                  {acknowledged && (
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                      <Lock className="h-3 w-3" />
                      Acknowledged
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <Label className="mb-2 block text-xs font-semibold tracking-wide uppercase">Summary</Label>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Done</div>
                    <div className="font-semibold">{currentTotals.total_completed}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Unforeseen</div>
                    <div className="font-semibold">{currentTotals.unforeseen_completed}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Tasks</div>
                    <div className="font-semibold">{totalTasksLogged}</div>
                  </div>
                </div>
              </div>
            </div>

            <datalist id="daily-task-suggestions">
              {taskSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>

            <div className="overflow-hidden rounded-md border">
              {tasks.map((task, index) => (
                <div key={index} className="space-y-2 border-b p-3 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground min-w-[1.5rem] text-sm">{index + 1}.</span>
                    <Input
                      value={task.description}
                      disabled={acknowledged}
                      list="daily-task-suggestions"
                      placeholder="Type a task or choose from previous tasks"
                      onChange={(e) => updateTask(index, { description: e.target.value })}
                      className="h-8 flex-1"
                    />
                    {!acknowledged && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(index)}
                        title="Remove task"
                        className="h-8 w-8 shrink-0"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pl-7 sm:grid-cols-3">
                    <div className="space-y-1">
                      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Status</p>
                      <Select
                        value={task.status}
                        disabled={acknowledged}
                        onValueChange={(v) => updateTask(index, { status: v as DailyTaskStatus })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(DAILY_TASK_STATUS_LABELS) as DailyTaskStatus[]).map((s) => (
                            <SelectItem key={s} value={s}>
                              {DAILY_TASK_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Type</p>
                      <Select
                        value={task.task_type ?? NONE_TYPE}
                        disabled={acknowledged}
                        onValueChange={(v) =>
                          updateTask(index, { task_type: v === NONE_TYPE ? null : (v as "planned" | "unforeseen") })
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_TYPE}>No Type</SelectItem>
                          <SelectItem value="planned">{DAILY_TASK_TYPE_LABELS.planned}</SelectItem>
                          <SelectItem value="unforeseen">{DAILY_TASK_TYPE_LABELS.unforeseen}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 space-y-1 sm:col-span-1">
                      <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Comments</p>
                      <Input
                        value={task.comments}
                        disabled={acknowledged}
                        placeholder="-"
                        onChange={(e) => updateTask(index, { comments: e.target.value })}
                        className="h-8"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {!acknowledged && (
              <div className="bg-background/95 sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Task
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void save("draft")} disabled={saving || savingDraft}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingDraft ? "Saving..." : "Save Draft"}
                  </Button>
                  <Button onClick={() => void save("submitted")} disabled={saving || savingDraft}>
                    <Send className="mr-2 h-4 w-4" />
                    {saving ? "Submitting..." : "Submit"}
                  </Button>
                </div>
              </div>
            )}
            {currentReport?.acknowledged && (
              <p className="text-muted-foreground text-sm">
                This day was acknowledged by your lead and is now read-only.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ExportOptionsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Daily Activity"
        options={[
          { id: "pdf", label: "PDF", icon: "pdf" },
          { id: "excel", label: "Excel", icon: "excel" },
          { id: "csv", label: "CSV", icon: "word" },
        ]}
        onSelect={(id) => {
          if (id === "pdf") exportPdf()
          if (id === "excel") exportExcel()
          if (id === "csv") exportCSV()
        }}
      />
    </>
  )
}

function ExpandedDayTasks({ row, onSave }: ExpandedDayTasksProps) {
  const [items, setItems] = useState<EditableTask[]>(() =>
    (row.report?.tasks || []).map((task) => ({
      description: task.description,
      status: task.status,
      task_type: task.task_type ?? null,
      comments: task.comments ?? "",
    }))
  )
  const [saving, setSaving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setItems(
      (row.report?.tasks || []).map((task) => ({
        description: task.description,
        status: task.status,
        task_type: task.task_type ?? null,
        comments: task.comments ?? "",
      }))
    )
  }, [row.report])

  const readOnly = Boolean(row.report?.acknowledged)
  const saveStatus = (row.report?.status === "submitted" ? "submitted" : "draft") as "draft" | "submitted"

  const queueSave = useCallback(
    (next: EditableTask[]) => {
      if (readOnly) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        setSaving(true)
        try {
          await onSave(row.report_date, next, saveStatus)
        } catch {
          toast.error("Failed to save inline changes")
        } finally {
          setSaving(false)
        }
      }, 450)
    },
    [onSave, readOnly, row.report_date, saveStatus]
  )

  function updateItem(index: number, patch: Partial<EditableTask>) {
    setItems((prev) => {
      const next = prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
      queueSave(next)
      return next
    })
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border">
        {items.map((task, index) => (
          <div key={`${row.id}-${index}`} className="space-y-2 border-b p-3 last:border-0">
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground mt-0.5 min-w-[1.5rem] text-xs">{index + 1}.</span>
              <span className="flex-1 text-sm leading-snug">{task.description}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pl-5 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Status</p>
                <Select
                  value={task.status}
                  disabled={readOnly}
                  onValueChange={(v) => updateItem(index, { status: v as DailyTaskStatus })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DAILY_TASK_STATUS_LABELS) as DailyTaskStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {DAILY_TASK_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Type</p>
                <Select
                  value={task.task_type ?? NONE_TYPE}
                  disabled={readOnly}
                  onValueChange={(v) =>
                    updateItem(index, { task_type: v === NONE_TYPE ? null : (v as "planned" | "unforeseen") })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_TYPE}>No Type</SelectItem>
                    <SelectItem value="planned">{DAILY_TASK_TYPE_LABELS.planned}</SelectItem>
                    <SelectItem value="unforeseen">{DAILY_TASK_TYPE_LABELS.unforeseen}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1 sm:col-span-1">
                <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Comments</p>
                <Input
                  className="h-7 text-xs"
                  value={task.comments}
                  disabled={readOnly}
                  placeholder="-"
                  onChange={(e) => updateItem(index, { comments: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground text-xs">
        {saving ? "Saving changes..." : readOnly ? "Acknowledged report is read-only." : "Changes save automatically."}
      </div>
    </div>
  )
}
