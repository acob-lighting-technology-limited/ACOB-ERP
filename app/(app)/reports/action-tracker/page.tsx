"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { formatWATDateTime } from "@/lib/utils/date"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek, getOfficeWeekMonday } from "@/lib/meeting-week"
import { toast } from "sonner"
import {
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Gavel,
  CalendarDays,
  CircleDashed,
  Paperclip,
  Users,
  RefreshCw,
  TriangleAlert,
} from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DetailCallout, DetailSectionHeading } from "@/components/ui/detail-dialog"
import { QUERY_KEYS } from "@/lib/query-keys"
import { fetchWeeklyReportLockState } from "@/lib/weekly-report-lock"
import { type ActionItem } from "@/lib/export-utils"
import { logger } from "@/lib/logger"
import { fetchActionTrackerMetadata, fetchActionTrackerTasks, type ActionTask } from "./_lib/queries"
import { canUpdateActionProgress } from "@/lib/reports/action-tracker-permissions"
import { apiFetch } from "@/lib/api-client"
import { BlockerDialog, type BlockerTarget } from "@/components/admin/action-tracker/blocker-dialog"

const log = logger("dashboard-reports-action-tracker")

interface DepartmentActionRow {
  id: string
  department: string
  tasks: ActionTask[]
  totalPoints: number
  completedPoints: number
  notStartedPoints: number
  inProgressPoints: number
  pendingPoints: number
  summaryStatus: "Finished" | "Started" | "Not Started" | "Pending"
}

interface ExportScope {
  label: string
  department?: string
  items: ActionItem[]
}

function resolveDueDate(task: ActionTask) {
  if (task.due_date) {
    const explicitDueDate = new Date(task.due_date)
    if (!Number.isNaN(explicitDueDate.getTime())) return explicitDueDate
  }
  const sunday = getOfficeWeekMonday(task.week_number, task.year)
  sunday.setDate(sunday.getDate() + 6)
  sunday.setHours(23, 59, 0, 0)
  return sunday
}

function formatDueDate(task: ActionTask) {
  return formatWATDateTime(resolveDueDate(task), { day: "2-digit", month: "short", year: "numeric" })
}

function getDueDateClassName(task: ActionTask) {
  const status = task.status.toLowerCase()
  if (status === "completed") return "font-medium text-green-600 dark:text-green-400"
  const dueDate = resolveDueDate(task)
  if (dueDate.getTime() < Date.now()) return "font-semibold text-red-600 dark:text-red-400"
  return "font-semibold text-yellow-600 dark:text-yellow-400"
}

function getDeptSummaryStatus(tasks: ActionTask[]): DepartmentActionRow["summaryStatus"] {
  if (tasks.length === 0) return "Pending"
  if (tasks.every((task) => task.status === "completed")) return "Finished"
  if (tasks.some((task) => task.status === "in_progress" || task.status === "completed")) return "Started"
  if (tasks.some((task) => task.status === "not_started")) return "Not Started"
  return "Pending"
}

type TrackerTab = "weekly" | "directives"

function getItemStatusBadgeClass(status: string) {
  if (status === "completed") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
  if (status === "in_progress") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
  if (status === "not_started") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
  return "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400"
}

function getSummaryBadgeClass(status: DepartmentActionRow["summaryStatus"]) {
  if (status === "Finished") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
  if (status === "Started") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
  if (status === "Not Started") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
  return "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400"
}

export default function ActionTrackerPortal() {
  const currentOfficeWeek = getCurrentOfficeWeek()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const supabase = createClient()

  // Week/year drive a server-side refetch, so they are page state with their own
  // controls rather than DataTable filters (which only narrow the rows already
  // fetched for one week).
  const [week, setWeek] = useState(() => {
    const w = searchParams.get("week")
    return w ? parseInt(w, 10) : currentOfficeWeek.week
  })
  const [year, setYear] = useState(() => {
    const y = searchParams.get("year")
    return y ? parseInt(y, 10) : currentOfficeWeek.year
  })
  const weekOptions = useMemo(() => Array.from({ length: 53 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(
    () => [currentOfficeWeek.year - 1, currentOfficeWeek.year, currentOfficeWeek.year + 1],
    [currentOfficeWeek.year]
  )
  const [deptFilter] = useState(() => searchParams.get("dept") || "all")
  const [isCarryForwarding, setIsCarryForwarding] = useState(false)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [exportScope, setExportScope] = useState<ExportScope>({ label: "All Departments", items: [] })
  const [viewingDepartment, setViewingDepartment] = useState<DepartmentActionRow | null>(null)
  // Rows currently visible in the table (after search + filters + sort).
  const [processedDepartmentRows, setProcessedDepartmentRows] = useState<DepartmentActionRow[]>([])
  const [activeTab, setActiveTab] = useState<TrackerTab>(() =>
    searchParams.get("tab") === "directives" ? "directives" : "weekly"
  )
  const [processedDirectives, setProcessedDirectives] = useState<ActionTask[]>([])
  const [blockerTarget, setBlockerTarget] = useState<
    | (BlockerTarget & {
        department: string
        origin?: ActionTask["origin"]
        assigneeIds?: string[]
      })
    | null
  >(null)

  const { data: metaData } = useQuery({
    queryKey: QUERY_KEYS.actionTrackerMetadata(),
    queryFn: () => fetchActionTrackerMetadata(supabase),
  })

  const profile = metaData?.profile ?? null
  const allDepartments = useMemo(() => metaData?.allDepartments ?? [], [metaData?.allDepartments])

  const {
    data: tasksData,
    isLoading,
    refetch,
    error,
  } = useQuery({
    queryKey: QUERY_KEYS.actionTrackerTasks({ week, year, deptFilter }),
    queryFn: () => fetchActionTrackerTasks(supabase, week, year, deptFilter),
  })

  const { data: lockState } = useQuery({
    queryKey: ["dashboard-action-tracker-meeting-date", week, year],
    queryFn: () => fetchWeeklyReportLockState(supabase, week, year),
  })

  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData?.tasks])
  /**
   * Status and hindrance follow accountability, not the department stamp: a
   * directive that names responsible staff is theirs to move, wherever they sit,
   * and a colleague in the stamped department who was never tagged is a reader.
   */
  const canMutateTask = (task: ActionTask) =>
    canUpdateActionProgress(profile, {
      department: task.department,
      origin: task.origin,
      assigneeIds: (task.assignees || []).map((person) => person.id),
    })

  const toActionItems = (sourceTasks: ActionTask[]): ActionItem[] =>
    sourceTasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      department: task.department,
      status: task.status,
      week_number: task.week_number,
      year: task.year,
    }))

  const openBlockerDialog = (task: ActionTask) => {
    setBlockerTarget({
      id: task.id,
      title: task.title,
      department: task.department,
      origin: task.origin,
      assigneeIds: (task.assignees || []).map((person) => person.id),
      blocker_note: task.blocker_note,
      blocker_reported_at: task.blocker_reported_at,
      blocker_reported_by_name: task.blocker_reported_by_name,
    })
  }

  /**
   * One control for both categories: an amber warning when a hindrance is on
   * record, a quiet outline when there is nothing to report yet. Staff outside
   * the owning department can open it to read, but not to change anything.
   */
  const renderBlockerButton = (task: ActionTask) => {
    const hasBlocker = Boolean(task.blocker_note)
    const evidenceCount = task.evidence_count || 0
    if (!hasBlocker && !canMutateTask(task)) {
      return <span className="text-muted-foreground text-xs">—</span>
    }
    return (
      <Button
        size="sm"
        variant={hasBlocker ? "secondary" : "ghost"}
        className={`h-8 gap-1.5 ${hasBlocker ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
        onClick={() => openBlockerDialog(task)}
      >
        <TriangleAlert className="h-3.5 w-3.5" />
        <span className="text-xs">{hasBlocker ? "Hindrance" : "Add"}</span>
        {evidenceCount > 0 ? (
          <span className="flex items-center gap-0.5 text-[11px]">
            <Paperclip className="h-3 w-3" />
            {evidenceCount}
          </span>
        ) : null}
      </Button>
    )
  }

  // One fetch, two categories: the department's report-derived action points and
  // the directives management raised at the meeting.
  const weeklyTasks = useMemo(() => tasks.filter((task) => task.origin !== "management_directive"), [tasks])
  const directives = useMemo(() => tasks.filter((task) => task.origin === "management_directive"), [tasks])

  // Built from the currently visible (search/filter/sort) rows of the active tab,
  // falling back to all of that tab's rows before the table reports them.
  const actionItemsForExport = useMemo(() => {
    if (activeTab === "directives") {
      return toActionItems(processedDirectives.length ? processedDirectives : directives)
    }
    return toActionItems(
      processedDepartmentRows.length ? processedDepartmentRows.flatMap((row) => row.tasks) : weeklyTasks
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, directives, processedDirectives, weeklyTasks, processedDepartmentRows])

  const tasksQueryKey = QUERY_KEYS.actionTrackerTasks({ week, year, deptFilter })

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    if (!canMutateTask(task)) {
      toast.error("You can only update statuses for your department")
      return
    }

    const previousTasks = [...tasks]
    queryClient.setQueryData(tasksQueryKey, {
      tasks: tasks.map((item) => (item.id === taskId ? { ...item, status: newStatus } : item)),
    })

    try {
      const response = await apiFetch(`/api/reports/action-tracker/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to update status")
      toast.success("Status updated")
    } catch (updateError) {
      log.error({ err: String(updateError) }, "error")
      queryClient.setQueryData(tasksQueryKey, { tasks: previousTasks })
      toast.error("Failed to update status")
    }
  }

  const handleCarryForward = async () => {
    setIsCarryForwarding(true)
    try {
      const response = await apiFetch("/api/reports/action-tracker/carry-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_number: week, year }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; carried_count?: number } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to carry forward items")
      toast.success(`Carried forward ${payload?.carried_count || 0} items`)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.actionTrackerTasks({ week, year, deptFilter }) })
    } catch (carryForwardError) {
      toast.error(carryForwardError instanceof Error ? carryForwardError.message : "Failed to carry forward items")
    } finally {
      setIsCarryForwarding(false)
    }
  }

  const stats = useMemo(() => {
    const source = activeTab === "directives" ? directives : weeklyTasks
    const total = source.length
    const completed = source.filter((task) => task.status === "completed").length
    // Was `status !== "completed"`, which made this card the sum of the three
    // beside it — so the five never added up to the total and it disagreed with
    // the per-department breakdown, which counts the real `pending` status.
    const pending = source.filter((task) => task.status === "pending").length
    const notStarted = source.filter((task) => task.status === "not_started").length
    const inProgress = source.filter((task) => task.status === "in_progress").length
    return { total, completed, pending, notStarted, inProgress }
  }, [activeTab, directives, weeklyTasks])

  const departmentRows = useMemo<DepartmentActionRow[]>(() => {
    const grouped = new Map<string, ActionTask[]>()
    weeklyTasks.forEach((task) => {
      const existing = grouped.get(task.department) || []
      existing.push(task)
      grouped.set(task.department, existing)
    })

    return Array.from(grouped.entries())
      .map(([department, deptTasks]) => {
        const completedPoints = deptTasks.filter((task) => task.status === "completed").length
        const notStartedPoints = deptTasks.filter((task) => task.status === "not_started").length
        const inProgressPoints = deptTasks.filter((task) => task.status === "in_progress").length
        const pendingPoints = deptTasks.filter((task) => task.status === "pending").length
        return {
          id: department,
          department,
          tasks: deptTasks,
          totalPoints: deptTasks.length,
          completedPoints,
          notStartedPoints,
          inProgressPoints,
          pendingPoints,
          summaryStatus: getDeptSummaryStatus(deptTasks),
        }
      })
      .sort((a, b) => a.department.localeCompare(b.department))
  }, [weeklyTasks])

  const columns = useMemo<DataTableColumn<DepartmentActionRow>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department,
      },
      {
        key: "total_points",
        label: "Action Points",
        sortable: true,
        accessor: (row) => row.totalPoints,
        render: (row) => (
          <span className="text-muted-foreground text-sm">
            {row.completedPoints} of {row.totalPoints} completed
          </span>
        ),
      },
      {
        key: "summary_status",
        label: "Summary Status",
        sortable: true,
        accessor: (row) => row.summaryStatus,
        render: (row) => <Badge className={getSummaryBadgeClass(row.summaryStatus)}>{row.summaryStatus}</Badge>,
      },
      {
        key: "point_breakdown",
        label: "Breakdown",
        sortable: true,
        hideOnMobile: true,
        accessor: (row) =>
          `${row.notStartedPoints}/${row.inProgressPoints}/${row.pendingPoints}/${row.completedPoints}`,
        render: (row) => (
          <span className="text-muted-foreground text-xs">
            NS: {row.notStartedPoints} | IP: {row.inProgressPoints} | P: {row.pendingPoints} | C: {row.completedPoints}
          </span>
        ),
      },
    ],
    []
  )

  const departmentOptions = useMemo(
    () => allDepartments.map((department) => ({ value: department, label: department })),
    [allDepartments]
  )

  const priorityOptions = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.priority).filter((priority): priority is string => Boolean(priority)))
      )
        .sort()
        .map((priority) => ({ value: priority, label: priority.replace(/_/g, " ") })),
    [tasks]
  )

  const filters = useMemo<DataTableFilter<DepartmentActionRow>[]>(
    () => [
      // Week and year refetch from the server rather than narrowing the rows
      // already loaded, so they render their own controls and never feed a
      // client-side filterFn. They live here so every control sits in one row.
      {
        key: "week",
        label: "Week",
        options: [],
        render: () => (
          <Select value={String(week)} onValueChange={(value) => setWeek(Number(value))}>
            <SelectTrigger className="w-full" aria-label="Week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  Week {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        key: "year",
        label: "Year",
        options: [],
        render: () => (
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger className="w-full" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        key: "summary_status",
        label: "Summary Status",
        options: [
          { value: "Pending", label: "Pending" },
          { value: "Not Started", label: "Not Started" },
          { value: "Started", label: "Started" },
          { value: "Finished", label: "Finished" },
        ],
      },
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
      },
      {
        key: "point_priority",
        label: "Point Priority",
        mode: "custom",
        options: priorityOptions,
        filterFn: (row, values) => {
          if (!values || values.length === 0) return true
          return row.tasks.some((task) => values.includes(task.priority))
        },
      },
    ],
    [departmentOptions, priorityOptions, week, weekOptions, year, yearOptions]
  )

  const directiveColumns = useMemo<DataTableColumn<ActionTask>[]>(
    () => [
      {
        key: "title",
        label: "Directive / Action Point",
        sortable: true,
        accessor: (row) => row.title,
        render: (row) => (
          <div className="min-w-[240px]">
            <p className="font-medium">{row.title}</p>
            {row.description ? <p className="text-muted-foreground text-xs">{row.description}</p> : null}
          </div>
        ),
      },
      {
        key: "responsible",
        label: "Responsible Staff",
        sortable: true,
        accessor: (row) => (row.assignees || []).map((person) => person.name).join(", ") || row.department,
        render: (row) =>
          row.assignees && row.assignees.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.assignees.map((person) => (
                <Badge key={person.id} variant="secondary" className="text-[11px] font-normal">
                  {person.name}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">{row.department}</span>
          ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department,
        hideOnMobile: true,
      },
      {
        key: "timeline",
        label: "Timeline",
        sortable: true,
        accessor: (row) => row.timeline_text || "",
        render: (row) => <span className="text-sm">{row.timeline_text || "—"}</span>,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) =>
          canMutateTask(row) ? (
            <Select
              value={row.status}
              onValueChange={(newStatus) => {
                void handleStatusChange(row.id, newStatus)
              }}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs font-semibold uppercase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="not_started">Not Started</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Badge className={`${getItemStatusBadgeClass(row.status)} capitalize`}>
              {row.status.replace(/_/g, " ")}
            </Badge>
          ),
      },
      {
        key: "hindrance",
        label: "Hindrance",
        sortable: true,
        accessor: (row) => row.blocker_note || "",
        render: (row) => renderBlockerButton(row),
      },
      {
        key: "meeting_date",
        label: "Meeting",
        sortable: true,
        accessor: (row) => row.meeting_date || "",
        render: (row) => (
          <span className="text-muted-foreground text-xs">
            {row.meeting_date
              ? formatWATDateTime(new Date(row.meeting_date), { day: "2-digit", month: "short", year: "numeric" })
              : "—"}
          </span>
        ),
        hideOnMobile: true,
      },
    ],
    // handleStatusChange and canMutateTask close over the current task list and
    // profile, so the status control must be rebuilt when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, profile?.department]
  )

  const directiveFilters = useMemo<DataTableFilter<ActionTask>[]>(
    () => [
      {
        key: "week",
        label: "Week",
        options: [],
        render: () => (
          <Select value={String(week)} onValueChange={(value) => setWeek(Number(value))}>
            <SelectTrigger className="w-full" aria-label="Week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  Week {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        key: "year",
        label: "Year",
        options: [],
        render: () => (
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger className="w-full" aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        key: "status",
        label: "Status",
        options: [
          { value: "pending", label: "Pending" },
          { value: "not_started", label: "Not Started" },
          { value: "in_progress", label: "In Progress" },
          { value: "completed", label: "Completed" },
        ],
      },
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
      },
    ],
    [departmentOptions, week, weekOptions, year, yearOptions]
  )

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { key: "weekly", label: `Weekly Action Points (${weeklyTasks.length})`, icon: FileSpreadsheet },
      { key: "directives", label: `Management Directives (${directives.length})`, icon: Gavel },
    ],
    [weeklyTasks.length, directives.length]
  )

  return (
    <DataTablePage
      title="Action Tracker"
      description="Monitor and update weekly departmental action points and management directives."
      icon={FileSpreadsheet}
      backLink={{ href: "/reports/general-meeting", label: "Back to General Meeting" }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab === "directives" ? "directives" : "weekly")}
      spacing="tight"
      actionsPlacement="inline-always"
      actions={
        <div className="flex items-center gap-2">
          {actionItemsForExport.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExportScope({
                  label: activeTab === "directives" ? "Management Directives" : "All Departments",
                  items: actionItemsForExport,
                })
                setExportOptionsOpen(true)
              }}
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          ) : null}
          <Button variant="outline" onClick={handleCarryForward} disabled={isCarryForwarding} size="sm">
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Carry Forward</span>
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
          <StatCard
            variant="compact"
            title={activeTab === "directives" ? "Total Directives" : "Total Action Points"}
            value={stats.total}
            icon={activeTab === "directives" ? Gavel : FileSpreadsheet}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="In Progress"
            value={stats.inProgress}
            icon={RefreshCw}
            iconBgColor="bg-sky-500/10"
            iconColor="text-sky-500"
          />
          <StatCard
            variant="compact"
            title="Not Started"
            value={stats.notStarted}
            icon={CircleDashed}
            iconBgColor="bg-slate-500/10"
            iconColor="text-slate-500"
          />
          <StatCard
            variant="compact"
            title="Pending"
            value={stats.pending}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      {activeTab === "weekly" ? (
        <DataTable<DepartmentActionRow>
          data={departmentRows}
          columns={columns}
          onProcessedDataChange={setProcessedDepartmentRows}
          filters={filters}
          getRowId={(row) => row.id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search department or action points..."
          searchFn={(row, query) => {
            const normalizedQuery = query.toLowerCase()
            return (
              row.department.toLowerCase().includes(normalizedQuery) ||
              row.tasks.some(
                (task) =>
                  task.title.toLowerCase().includes(normalizedQuery) ||
                  (task.description || "").toLowerCase().includes(normalizedQuery)
              )
            )
          }}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : null}
          onRetry={() => {
            void refetch()
          }}
          rowActions={[
            {
              label: "Export",
              icon: Download,
              onClick: (row) => {
                setExportScope({
                  label: row.department,
                  department: row.department,
                  items: toActionItems(row.tasks),
                })
                setExportOptionsOpen(true)
              },
            },
          ]}
          stickyToolbar
          viewToggle
          contactsView
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (row) =>
              row.summaryStatus === "Finished"
                ? "bg-emerald-500"
                : row.summaryStatus === "Not Started"
                  ? "bg-rose-500"
                  : "bg-amber-500",
            title: (row) => row.department,
            subtitle: (row) =>
              `${row.completedPoints} of ${row.totalPoints} done · ${row.inProgressPoints} in progress · ${row.notStartedPoints} not started`,
            trailing: (row) => (
              <Badge className={`${getSummaryBadgeClass(row.summaryStatus)} text-[10px]`}>{row.summaryStatus}</Badge>
            ),
            // The department's action points are an editable list, not a set of
            // read-only fields, so this opens the dialog rather than the standard
            // detail sheet — which is also why the expandable row that rendered a
            // second, hand-rolled copy of that same list is gone.
            onSelect: (row) => setViewingDepartment(row),
          }}
          cardRenderer={(row) => (
            <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{row.department}</p>
                  <p className="text-muted-foreground text-sm">{row.totalPoints} action points</p>
                </div>
                <Badge className={getSummaryBadgeClass(row.summaryStatus)}>{row.summaryStatus}</Badge>
              </div>
              <div className="grid gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Completed</span>
                  <span>{row.completedPoints}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">In Progress</span>
                  <span>{row.inProgressPoints}</span>
                </div>
              </div>
            </div>
          )}
          emptyTitle="No action points found"
          emptyDescription="No action points matched the current filters."
          emptyIcon={FileSpreadsheet}
          skeletonRows={6}
          urlSync
        />
      ) : (
        <DataTable<ActionTask>
          data={directives}
          columns={directiveColumns}
          onProcessedDataChange={setProcessedDirectives}
          filters={directiveFilters}
          getRowId={(row) => row.id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search directives, staff or department..."
          searchFn={(row, query) => {
            const normalizedQuery = query.toLowerCase()
            return (
              row.title.toLowerCase().includes(normalizedQuery) ||
              (row.description || "").toLowerCase().includes(normalizedQuery) ||
              row.department.toLowerCase().includes(normalizedQuery) ||
              (row.timeline_text || "").toLowerCase().includes(normalizedQuery) ||
              (row.assignees || []).some((person) => person.name.toLowerCase().includes(normalizedQuery))
            )
          }}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : null}
          onRetry={() => {
            void refetch()
          }}
          stickyToolbar
          viewToggle
          contactsView
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (row) =>
              row.status === "completed"
                ? "bg-emerald-500"
                : row.status === "not_started"
                  ? "bg-rose-500"
                  : "bg-amber-500",
            title: (row) => row.title,
            subtitle: (row) =>
              [(row.assignees || []).map((person) => person.name).join(", ") || row.department, row.timeline_text]
                .filter(Boolean)
                .join(" · "),
            trailing: (row) => (
              <Badge className={`${getItemStatusBadgeClass(row.status)} text-[10px] capitalize`}>
                {row.status.replace(/_/g, " ")}
              </Badge>
            ),
            detail: {
              title: (row) => row.title,
              subtitle: (row) => (
                <span className="text-muted-foreground text-xs">
                  {row.department}
                  {row.timeline_text ? ` · ${row.timeline_text}` : ""}
                </span>
              ),
              badges: (row) => (
                <Badge className={`${getItemStatusBadgeClass(row.status)} text-[10px] capitalize`}>
                  {row.status.replace(/_/g, " ")}
                </Badge>
              ),
              // `description` was searchable but displayed nowhere — not in a column,
              // not in the card, and this tab has no expandable row.
              fields: (row) => [
                { icon: Gavel, label: "Directive", value: row.description, copyable: true },
                {
                  icon: Users,
                  label: "Responsible",
                  value: (row.assignees || []).map((person) => person.name).join(", ") || row.department,
                },
                { icon: Clock, label: "Timeline", value: row.timeline_text },
                { icon: CalendarDays, label: "Due", value: formatDueDate(row), copyable: false },
                {
                  icon: TriangleAlert,
                  label: "Hindrance",
                  value: row.blocker_note,
                  copyable: true,
                },
                {
                  icon: CalendarDays,
                  label: "Meeting",
                  value: row.meeting_date ? `${row.meeting_date} · week ${row.week_number}` : `Week ${row.week_number}`,
                  copyable: false,
                },
              ],
            },
          }}
          cardRenderer={(row) => (
            <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{row.title}</p>
                <Badge className={`${getItemStatusBadgeClass(row.status)} shrink-0 capitalize`}>
                  {row.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <div className="grid gap-1 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Responsible</span>
                  <span className="text-right">
                    {(row.assignees || []).map((person) => person.name).join(", ") || row.department}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Timeline</span>
                  <span>{row.timeline_text || "—"}</span>
                </div>
              </div>
            </div>
          )}
          emptyTitle="No management directives"
          emptyDescription="No directives were recorded for this week."
          emptyIcon={Gavel}
          skeletonRows={6}
          urlSync
        />
      )}

      {/* The one place a department's action points are listed and edited. It
          replaces both the old expandable row (a hand-rolled <table> nested inside
          the data table) and this dialog's own earlier markup, which were two
          implementations of the same list that had already drifted — only one of
          them showed the blocker note. */}
      <Dialog open={Boolean(viewingDepartment)} onOpenChange={(open) => !open && setViewingDepartment(null)}>
        <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="space-y-2 border-b px-4 py-4 text-left sm:px-6">
            {viewingDepartment && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge className={`${getSummaryBadgeClass(viewingDepartment.summaryStatus)} text-[11px]`}>
                  {viewingDepartment.summaryStatus}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  Week {week} · {year}
                </Badge>
              </div>
            )}
            <DialogTitle className="text-base leading-snug font-semibold">
              {viewingDepartment?.department || "Department"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {viewingDepartment
                ? `${viewingDepartment.completedPoints} of ${viewingDepartment.totalPoints} action points completed · ${viewingDepartment.inProgressPoints} in progress · ${viewingDepartment.notStartedPoints} not started`
                : "Update individual action point statuses."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 px-4 py-4 sm:px-6">
              {viewingDepartment?.tasks.map((task, index) => (
                <section key={task.id} className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <DetailSectionHeading>{`${index + 1}. ${task.title}`}</DetailSectionHeading>
                      {task.description ? (
                        <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed whitespace-pre-wrap">
                          {task.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="w-full sm:w-44">
                      <Select
                        value={task.status}
                        disabled={!canMutateTask(task)}
                        onValueChange={(newStatus) => {
                          void handleStatusChange(task.id, newStatus)
                        }}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="not_started">Not Started</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {task.blocker_note ? (
                    <DetailCallout tone="amber" label="Hindrance">
                      {task.blocker_note}
                    </DetailCallout>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-xs ${getDueDateClassName(task)}`}>Due {formatDueDate(task)}</span>
                    {renderBlockerButton(task)}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BlockerDialog
        isOpen={Boolean(blockerTarget)}
        onClose={() => setBlockerTarget(null)}
        onComplete={() => {
          void refetch()
        }}
        target={blockerTarget}
        canEdit={
          blockerTarget
            ? canUpdateActionProgress(profile, {
                department: blockerTarget.department,
                origin: blockerTarget.origin,
                assigneeIds: blockerTarget.assigneeIds,
              })
            : false
        }
      />

      <ExportOptionsDialog
        open={exportOptionsOpen}
        onOpenChange={setExportOptionsOpen}
        title={`Export Action Tracker${exportScope.label ? ` - ${exportScope.label}` : ""}`}
        options={[
          { id: "pdf", label: "PDF", icon: "pdf" },
          { id: "pptx", label: "PowerPoint (.pptx)", icon: "pptx" },
          { id: "word", label: "Word (.docx)", icon: "word" },
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
        ]}
        onSelect={(id) => {
          if (id === "pdf") {
            void import("@/lib/action-points-export").then(({ exportActionPointsPdf }) =>
              exportActionPointsPdf(exportScope.items, week, year, lockState?.meetingDate, exportScope.department)
            )
            return
          }
          if (id === "pptx") {
            void import("@/lib/export-utils").then(({ exportActionPointToPPTX }) =>
              exportActionPointToPPTX(exportScope.items, week, year, lockState?.meetingDate, exportScope.department)
            )
            return
          }
          if (id === "word") {
            void import("@/lib/action-points-export").then(({ exportActionPointsDocx }) =>
              exportActionPointsDocx(exportScope.items, week, year, lockState?.meetingDate, exportScope.department)
            )
            return
          }
          void import("@/lib/export-utils").then(({ exportActionPointToXLSX }) =>
            exportActionPointToXLSX(exportScope.items, week, year, exportScope.department, lockState?.meetingDate)
          )
        }}
      />
    </DataTablePage>
  )
}
