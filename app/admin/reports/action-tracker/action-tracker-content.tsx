"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { formatWATDateTime } from "@/lib/utils/date"
import { getCurrentOfficeWeek, getOfficeWeekMonday } from "@/lib/meeting-week"
import { toast } from "sonner"
import {
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  Gavel,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
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
import { QUERY_KEYS } from "@/lib/query-keys"
import { type ActionItem } from "@/lib/export-utils"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"
import { DirectiveFormDialog, type EditableDirective } from "@/components/admin/action-tracker/directive-form-dialog"
import { BlockerDialog, type BlockerTarget } from "@/components/admin/action-tracker/blocker-dialog"

const log = logger("reports-action-tracker-action-tracker-co")

interface ActionTask {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  department: string
  due_date?: string
  week_number: number
  year: number
  original_week?: number
  work_item_number?: string
  /**
   * weekly_report = parsed from the department's "Tasks for New Week".
   * management_directive = raised by management at the general meeting.
   * The two are tracked side by side but never mixed into one list.
   */
  origin?: "weekly_report" | "management_directive"
  meeting_date?: string
  timeline_text?: string
  assignees?: { id: string; name: string; department?: string }[]
  /** What is preventing completion, with optional supporting evidence attached. */
  blocker_note?: string
  blocker_reported_at?: string
  blocker_reported_by_name?: string
  evidence_count?: number
}

type TrackerTab = "weekly" | "directives"

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

interface ActionTrackerContentProps {
  initialDepartments: string[]
  scopedDepartments?: string[]
  editableDepartments?: string[]
  canGlobalEdit?: boolean
}

async function fetchAdminActionTrackerTasks(
  weekFilter: number,
  yearFilter: number,
  deptFilter: string,
  scopedDepartments: string[]
): Promise<ActionTask[]> {
  const params = new URLSearchParams({
    week: String(weekFilter),
    year: String(yearFilter),
    dept: deptFilter,
  })
  if (scopedDepartments.length > 0) {
    params.set("scoped_departments", scopedDepartments.join(","))
  }
  const response = await apiFetch(`/api/reports/action-tracker?${params.toString()}`, { cache: "no-store" })
  const payload = (await response.json().catch(() => null)) as { data?: ActionTask[]; error?: string } | null
  if (!response.ok) throw new Error(payload?.error || "Failed to fetch action items")
  return payload?.data || []
}

function resolveDueDate(task: ActionTask) {
  if (task.due_date) {
    const explicitDueDate = new Date(task.due_date)
    if (!Number.isNaN(explicitDueDate.getTime())) {
      return explicitDueDate
    }
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
  if (status === "completed") {
    return "font-medium text-green-600 dark:text-green-400"
  }

  const dueDate = resolveDueDate(task)
  if (dueDate.getTime() < Date.now()) {
    return "font-semibold text-red-600 dark:text-red-400"
  }

  return "font-semibold text-yellow-600 dark:text-yellow-400"
}

function getDeptSummaryStatus(tasks: ActionTask[]): DepartmentActionRow["summaryStatus"] {
  if (tasks.length === 0) return "Pending"
  if (tasks.every((task) => task.status === "completed")) return "Finished"
  if (tasks.some((task) => task.status === "in_progress" || task.status === "completed")) return "Started"
  if (tasks.some((task) => task.status === "not_started")) return "Not Started"
  return "Pending"
}

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

export function ActionTrackerContent({
  initialDepartments,
  scopedDepartments = [],
  editableDepartments = [],
  canGlobalEdit = false,
}: ActionTrackerContentProps) {
  const currentOfficeWeek = getCurrentOfficeWeek()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  // Week/year drive a server-side refetch, so they are page state surfaced as
  // custom controls in the table filter row rather than DataTable filters
  // (which only narrow the rows already fetched for one week).
  const [weekFilter, setWeekFilter] = useState(() => {
    const week = searchParams.get("week")
    return week ? parseInt(week, 10) : currentOfficeWeek.week
  })
  const [yearFilter, setYearFilter] = useState(() => {
    const year = searchParams.get("year")
    return year ? parseInt(year, 10) : currentOfficeWeek.year
  })
  const weekOptions = useMemo(() => Array.from({ length: 53 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(
    () => [currentOfficeWeek.year - 1, currentOfficeWeek.year, currentOfficeWeek.year + 1],
    [currentOfficeWeek.year]
  )
  const [deptFilter] = useState(() => searchParams.get("dept") || "all")
  const [isCarryForwarding, setIsCarryForwarding] = useState(false)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [exportScope, setExportScope] = useState<ExportScope>({
    label: "All Departments",
    items: [],
  })
  const [viewingDepartment, setViewingDepartment] = useState<DepartmentActionRow | null>(null)
  // Rows currently visible in the table (after search + filters + sort).
  const [processedDepartmentRows, setProcessedDepartmentRows] = useState<DepartmentActionRow[]>([])
  const [activeTab, setActiveTab] = useState<TrackerTab>(() =>
    searchParams.get("tab") === "directives" ? "directives" : "weekly"
  )
  const [directiveDialogOpen, setDirectiveDialogOpen] = useState(false)
  const [editingDirective, setEditingDirective] = useState<EditableDirective | null>(null)
  const [processedDirectives, setProcessedDirectives] = useState<ActionTask[]>([])
  const [blockerTarget, setBlockerTarget] = useState<(BlockerTarget & { department: string }) | null>(null)

  const canMutateTask = (task: ActionTask) => canGlobalEdit || editableDepartments.includes(task.department)

  const {
    data: tasks = [],
    isLoading,
    refetch,
    error,
  } = useQuery({
    queryKey: QUERY_KEYS.adminActionTrackerTasks({ weekFilter, yearFilter, deptFilter, scopedDepartments }),
    queryFn: () => fetchAdminActionTrackerTasks(weekFilter, yearFilter, deptFilter, scopedDepartments),
  })

  const { data: lockState } = useQuery({
    queryKey: QUERY_KEYS.adminWeeklyReportLockState(weekFilter, yearFilter),
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/reports/weekly-lock-state?week=${weekFilter}&year=${yearFilter}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Failed to resolve lock state")
      return res.json()
    },
  })

  const tasksQueryKey = QUERY_KEYS.adminActionTrackerTasks({ weekFilter, yearFilter, deptFilter, scopedDepartments })

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    const targetTask = tasks.find((task) => task.id === taskId)
    if (targetTask && !canMutateTask(targetTask)) {
      toast.error("You can only edit actions in your departments")
      return
    }

    const previousTasks = [...tasks]
    queryClient.setQueryData(
      tasksQueryKey,
      tasks.map((task) => (task.id === taskId ? { ...task, status: newStatus } : task))
    )

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
      queryClient.setQueryData(tasksQueryKey, previousTasks)
      toast.error("Failed to update status")
    }
  }

  const handleCarryForward = async () => {
    setIsCarryForwarding(true)
    try {
      const response = await apiFetch("/api/reports/action-tracker/carry-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_number: weekFilter, year: yearFilter }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; carried_count?: number } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to carry forward items")
      toast.success(`Carried forward ${payload?.carried_count || 0} items`)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminActionTrackerTasks() })
    } catch (carryForwardError) {
      toast.error(carryForwardError instanceof Error ? carryForwardError.message : "Failed to carry forward items")
    } finally {
      setIsCarryForwarding(false)
    }
  }

  // One fetch, two categories: the department's report-derived action points and
  // the directives management raised at the meeting. Splitting here (rather than
  // with a second request) keeps the week/year controls driving both.
  const weeklyTasks = useMemo(() => tasks.filter((task) => task.origin !== "management_directive"), [tasks])
  const directives = useMemo(() => tasks.filter((task) => task.origin === "management_directive"), [tasks])

  const handleDeleteDirective = async (directive: ActionTask) => {
    if (!canMutateTask(directive)) {
      toast.error("You can only edit actions in your departments")
      return
    }
    if (!window.confirm(`Delete this directive?\n\n${directive.title}`)) return
    try {
      const response = await apiFetch(`/api/reports/action-tracker/${directive.id}`, { method: "DELETE" })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to delete directive")
      toast.success("Directive deleted")
      void refetch()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Failed to delete directive")
    }
  }

  const openBlockerDialog = (task: ActionTask) => {
    setBlockerTarget({
      id: task.id,
      title: task.title,
      department: task.department,
      blocker_note: task.blocker_note,
      blocker_reported_at: task.blocker_reported_at,
      blocker_reported_by_name: task.blocker_reported_by_name,
    })
  }

  /**
   * One control for both categories: an amber warning when a hindrance is on
   * record, a quiet outline when there is nothing to report yet.
   */
  const renderBlockerButton = (task: ActionTask) => {
    const hasBlocker = Boolean(task.blocker_note)
    const evidenceCount = task.evidence_count || 0
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

  const openDirectiveEditor = (directive: ActionTask) => {
    setEditingDirective({
      id: directive.id,
      title: directive.title,
      description: directive.description,
      status: directive.status,
      department: directive.department,
      week_number: directive.week_number,
      year: directive.year,
      meeting_date: directive.meeting_date,
      timeline_text: directive.timeline_text,
      assignees: (directive.assignees || []).map((person) => ({ id: person.id, name: person.name })),
    })
    setDirectiveDialogOpen(true)
  }

  const stats = useMemo(() => {
    const source = activeTab === "directives" ? directives : weeklyTasks
    const total = source.length
    const completed = source.filter((task) => task.status === "completed").length
    const pending = source.filter((task) => task.status !== "completed").length
    const notStarted = source.filter((task) => task.status === "not_started").length
    const inProgress = source.filter((task) => task.status === "in_progress").length

    return { total, completed, pending, notStarted, inProgress }
  }, [activeTab, directives, weeklyTasks])

  // Built from the currently visible (search/filter/sort) rows, falling back to all tasks
  // before the table has reported its processed rows.
  const actionItemsForExport: ActionItem[] = useMemo(() => {
    if (activeTab === "directives") {
      const directiveSource = processedDirectives.length ? processedDirectives : directives
      return directiveSource.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        department: task.department,
        status: task.status,
        week_number: task.week_number,
        year: task.year,
      }))
    }
    const source = processedDepartmentRows.length ? processedDepartmentRows.flatMap((row) => row.tasks) : weeklyTasks
    return source.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      department: task.department,
      status: task.status,
      week_number: task.week_number,
      year: task.year,
    }))
  }, [activeTab, directives, processedDirectives, weeklyTasks, processedDepartmentRows])

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

  const departmentOptions = useMemo(
    () =>
      initialDepartments.map((department) => ({
        value: department,
        label: department,
      })),
    [initialDepartments]
  )

  const priorityOptions = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.priority).filter((priority): priority is string => Boolean(priority)))
      )
        .sort()
        .map((priority) => ({
          value: priority,
          label: priority.replace(/_/g, " "),
        })),
    [tasks]
  )

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
        resizable: true,
        initialWidth: 180,
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
        accessor: (row) =>
          `${row.notStartedPoints}/${row.inProgressPoints}/${row.pendingPoints}/${row.completedPoints}`,
        render: (row) => (
          <span className="text-muted-foreground text-xs">
            NS: {row.notStartedPoints} | IP: {row.inProgressPoints} | P: {row.pendingPoints} | C: {row.completedPoints}
          </span>
        ),
        hideOnMobile: true,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<DepartmentActionRow>[]>(
    () => [
      // Render their own controls and never feed a client-side filterFn: the
      // server has already filtered to this week/year.
      {
        key: "week",
        label: "Week",
        options: [],
        render: () => (
          <Select value={String(weekFilter)} onValueChange={(value) => setWeekFilter(Number(value))}>
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
          <Select value={String(yearFilter)} onValueChange={(value) => setYearFilter(Number(value))}>
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
    [departmentOptions, priorityOptions, weekFilter, weekOptions, yearFilter, yearOptions]
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
        resizable: true,
        initialWidth: 340,
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
        resizable: true,
        initialWidth: 220,
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
        render: (row) => (
          <Select
            value={row.status}
            disabled={!canMutateTask(row)}
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
    // handleStatusChange and canMutateTask close over the current task list; the
    // status select must see fresh permissions after a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, editableDepartments, canGlobalEdit]
  )

  const directiveFilters = useMemo<DataTableFilter<ActionTask>[]>(
    () => [
      {
        key: "week",
        label: "Week",
        options: [],
        render: () => (
          <Select value={String(weekFilter)} onValueChange={(value) => setWeekFilter(Number(value))}>
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
          <Select value={String(yearFilter)} onValueChange={(value) => setYearFilter(Number(value))}>
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
    [departmentOptions, weekFilter, weekOptions, yearFilter, yearOptions]
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
      description="Monitor and manage weekly departmental actions."
      icon={FileSpreadsheet}
      backLink={{ href: "/admin/reports/general-meeting", label: "Back to General Meeting" }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab === "directives" ? "directives" : "weekly")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === "directives" && (canGlobalEdit || editableDepartments.length > 0) ? (
            <Button
              size="sm"
              className="h-8 gap-2"
              onClick={() => {
                setEditingDirective(null)
                setDirectiveDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              Add Directive
            </Button>
          ) : null}
          {actionItemsForExport.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => {
                setExportScope({
                  label: activeTab === "directives" ? "Management Directives" : "All Departments",
                  items: actionItemsForExport,
                })
                setExportOptionsOpen(true)
              }}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          ) : null}
          <Button variant="outline" onClick={handleCarryForward} disabled={isCarryForwarding} className="h-8">
            <RefreshCw className="mr-2 h-4 w-4" />
            Carry Forward
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
          <StatCard
            title={activeTab === "directives" ? "Total Directives" : "Total Action Points"}
            value={stats.total}
            icon={activeTab === "directives" ? Gavel : FileSpreadsheet}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Not Started"
            value={stats.notStarted}
            icon={Clock}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="In Progress"
            value={stats.inProgress}
            icon={RefreshCw}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      {activeTab === "weekly" ? (
        <DataTable<DepartmentActionRow>
          data={departmentRows}
          onProcessedDataChange={setProcessedDepartmentRows}
          columns={columns}
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
              label: "View",
              icon: Eye,
              onClick: (row) => setViewingDepartment(row),
            },
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
          expandable={{
            render: (row) => (
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Action Points</p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">#</th>
                        <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Action Point</th>
                        <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Hindrance</th>
                        <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Due Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.tasks.map((task, index) => (
                        <tr key={task.id} className="border-t">
                          <td className="text-muted-foreground px-3 py-2 text-xs">{index + 1}</td>
                          <td className="px-3 py-2">
                            <p className="font-medium">{task.title}</p>
                            {task.description ? (
                              <p className="text-muted-foreground text-xs">{task.description}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={task.status}
                              disabled={!canMutateTask(task)}
                              onValueChange={(newStatus) => {
                                void handleStatusChange(task.id, newStatus)
                              }}
                            >
                              <SelectTrigger className="h-8 w-[160px] text-xs font-semibold uppercase">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="not_started">Not Started</SelectItem>
                                <SelectItem value="in_progress">In Progress</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">{renderBlockerButton(task)}</td>
                          <td className={`px-3 py-2 text-xs ${getDueDateClassName(task)}`}>{formatDueDate(task)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          }}
          viewToggle
          cardRenderer={(row) => (
            <div className="space-y-3 rounded-xl border p-4">
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
          onProcessedDataChange={setProcessedDirectives}
          columns={directiveColumns}
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
          rowActions={[
            {
              label: "Edit",
              icon: Pencil,
              onClick: (row) => openDirectiveEditor(row),
            },
            {
              label: "Delete",
              icon: Trash2,
              onClick: (row) => {
                void handleDeleteDirective(row)
              },
            },
          ]}
          viewToggle
          cardRenderer={(row) => (
            <div className="space-y-3 rounded-xl border p-4">
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
          emptyDescription="No directives were recorded for this week. Add one from the meeting minutes."
          emptyIcon={Gavel}
          skeletonRows={6}
          urlSync
        />
      )}

      <DirectiveFormDialog
        isOpen={directiveDialogOpen}
        onClose={() => {
          setDirectiveDialogOpen(false)
          setEditingDirective(null)
        }}
        onComplete={() => {
          void refetch()
        }}
        departments={canGlobalEdit ? initialDepartments : editableDepartments}
        editingDirective={editingDirective}
        defaultWeek={weekFilter}
        defaultYear={yearFilter}
        defaultMeetingDate={lockState?.meetingDate}
      />

      <BlockerDialog
        isOpen={Boolean(blockerTarget)}
        onClose={() => setBlockerTarget(null)}
        onComplete={() => {
          void refetch()
        }}
        target={blockerTarget}
        canEdit={canGlobalEdit || (blockerTarget ? editableDepartments.includes(blockerTarget.department) : false)}
      />

      <Dialog open={Boolean(viewingDepartment)} onOpenChange={(open) => !open && setViewingDepartment(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewingDepartment?.department || "Department"} Action Points</DialogTitle>
            <DialogDescription>Update individual action point statuses.</DialogDescription>
          </DialogHeader>
          {viewingDepartment ? (
            <div className="space-y-3">
              {viewingDepartment.tasks.map((task, index) => (
                <div key={task.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-muted-foreground text-xs">#{index + 1}</p>
                      <p className="font-medium">{task.title}</p>
                      {task.description ? <p className="text-muted-foreground text-xs">{task.description}</p> : null}
                    </div>
                    <div className="min-w-[170px]">
                      <Select
                        value={task.status}
                        disabled={!canMutateTask(task)}
                        onValueChange={(newStatus) => {
                          void handleStatusChange(task.id, newStatus)
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs font-semibold uppercase">
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-xs ${getDueDateClassName(task)}`}>Due: {formatDueDate(task)}</p>
                    {renderBlockerButton(task)}
                  </div>
                  {task.blocker_note ? (
                    <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-800 dark:text-amber-300">
                      {task.blocker_note}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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
              exportActionPointsPdf(
                exportScope.items,
                weekFilter,
                yearFilter,
                lockState?.meetingDate,
                exportScope.department
              )
            )
            return
          }
          if (id === "pptx") {
            void import("@/lib/export-utils").then(({ exportActionPointToPPTX }) =>
              exportActionPointToPPTX(
                exportScope.items,
                weekFilter,
                yearFilter,
                lockState?.meetingDate,
                exportScope.department
              )
            )
            return
          }
          if (id === "word") {
            void import("@/lib/action-points-export").then(({ exportActionPointsDocx }) =>
              exportActionPointsDocx(
                exportScope.items,
                weekFilter,
                yearFilter,
                lockState?.meetingDate,
                exportScope.department
              )
            )
            return
          }
          void import("@/lib/export-utils").then(({ exportActionPointToXLSX }) =>
            exportActionPointToXLSX(
              exportScope.items,
              weekFilter,
              yearFilter,
              exportScope.department,
              lockState?.meetingDate
            )
          )
        }}
      />
    </DataTablePage>
  )
}
