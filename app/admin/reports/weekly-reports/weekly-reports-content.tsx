"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { toast } from "sonner"
import { fetchWeeklyReportLockState, getDefaultMeetingDateIso } from "@/lib/weekly-report-lock"
import { getDepartmentAliases, normalizeDepartmentName } from "@/shared/departments"
import { CalendarDays, Download, FileBarChart, FileSpreadsheet, Plus } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import {
  exportAllToPPTX,
  autoNumberLines,
  sortReportsByDepartment,
  type WeeklyDeptOrder,
  type WeeklyPptxMode,
  type WeeklyPptxTheme,
  type WeeklyReport,
} from "@/lib/export-utils"
import { WeeklyReportAdminDialog } from "@/components/admin/reports/weekly-report-dialog"
import { PptxModeDialog } from "./_components/pptx-mode-dialog"
import { DeleteReportDialog } from "./_components/delete-report-dialog"
import { Button } from "@/components/ui/button"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { downloadWeeklyReportDocx, downloadWeeklyReportPdf } from "@/lib/reports/export-download"
import { Badge } from "@/components/ui/badge"

interface AdminWeeklyReportsData {
  reports: WeeklyReport[]
  trackingData: TrackerStatus[]
}

function expandDepartmentScope(departments: string[]) {
  const scoped = new Set<string>()
  departments.forEach((department) => {
    getDepartmentAliases(department).forEach((alias) => scoped.add(alias))
  })
  return Array.from(scoped)
}

async function fetchAdminWeeklyReports(
  supabase: ReturnType<typeof createClient>,
  weekFilter: number,
  yearFilter: number,
  initialDepartments: string[]
): Promise<AdminWeeklyReportsData> {
  const query = supabase
    .from("weekly_reports")
    .select(
      "id, department, week_number, year, work_done, tasks_new_week, challenges, status, user_id, created_at, updated_at, profiles(first_name, last_name)"
    )
    .eq("status", "submitted")
    .eq("week_number", weekFilter)
    .eq("year", yearFilter)
    .order("department", { ascending: true })

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const sortedData = sortReportsByDepartment((data || []) as WeeklyReport[])

  const { data: actions, error: actionsError } = await supabase
    .from("tasks")
    .select("id, department, status")
    .eq("category", "weekly_action")
    .eq("week_number", weekFilter)
    .eq("year", yearFilter)
    .in("department", expandDepartmentScope(initialDepartments))

  return {
    reports: sortedData,
    trackingData: actionsError ? [] : ((actions || []) as TrackerStatus[]),
  }
}

async function fetchAdminWeeklyReportLockState(supabase: ReturnType<typeof createClient>, week: number, year: number) {
  return fetchWeeklyReportLockState(supabase, week, year)
}

interface TrackerStatus {
  id: string
  department: string
  status: string
}

interface WeeklyReportsContentProps {
  initialDepartments: string[]
  scopedDepartments?: string[]
  editableDepartments?: string[]
  currentUser: {
    id: string
    role: string
    department: string | null
    is_department_lead: boolean
    lead_departments?: string[]
    admin_routes?: string[] | null
  }
}

function getActionTrackerStatus(department: string, trackingData: TrackerStatus[]) {
  const normalizedDepartment = normalizeDepartmentName(department)
  const deptActions = trackingData.filter(
    (action) => normalizeDepartmentName(action.department) === normalizedDepartment
  )
  if (deptActions.length === 0) {
    return { label: "Pending", color: "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400" }
  }
  if (deptActions.every((action) => action.status === "completed")) {
    return { label: "Finished", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" }
  }
  if (deptActions.some((action) => action.status === "in_progress" || action.status === "completed")) {
    return { label: "Started", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" }
  }
  if (deptActions.some((action) => action.status === "not_started")) {
    return { label: "Not Started", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" }
  }
  return { label: "Pending", color: "bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400" }
}

export function WeeklyReportsContent({
  initialDepartments,
  scopedDepartments: _scopedDepartments = [],
  editableDepartments = [],
  currentUser,
}: WeeklyReportsContentProps) {
  const currentOfficeWeek = getCurrentOfficeWeek()
  const [weekFilter, setWeekFilter] = useState(currentOfficeWeek.week)
  const [yearFilter, setYearFilter] = useState(currentOfficeWeek.year)
  const [isAdminDialogOpen, setIsAdminDialogOpen] = useState(false)
  const [editingReport, setEditingReport] = useState<WeeklyReport | null>(null)
  const [pptxModeDialogOpen, setPptxModeDialogOpen] = useState(false)
  const [pendingPptxExport, setPendingPptxExport] = useState<
    { kind: "single"; report: WeeklyReport } | { kind: "all" } | null
  >(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [exportTarget, setExportTarget] = useState<{ kind: "all" } | { kind: "single"; report: WeeklyReport }>({
    kind: "all",
  })

  const supabase = createClient()
  const queryClient = useQueryClient()
  const normalizedRole = (currentUser.role || "").trim().toLowerCase()
  const isGlobalReportsEditor =
    normalizedRole === "developer" ||
    normalizedRole === "super_admin" ||
    (normalizedRole === "admin" &&
      Array.isArray(currentUser.admin_routes) &&
      (currentUser.admin_routes.includes("reports.weekly") || currentUser.admin_routes.includes("reports.other")))

  const managedDepartments =
    editableDepartments.length > 0
      ? editableDepartments
      : ([currentUser.department, ...(currentUser.lead_departments || [])].filter(Boolean) as string[])

  const canMutateReport = (report: WeeklyReport) => {
    if (isGlobalReportsEditor) return true
    const normalizedReportDepartment = normalizeDepartmentName(report.department)
    return managedDepartments.some((department) =>
      getDepartmentAliases(department).includes(normalizedReportDepartment)
    )
  }

  const {
    data: reportsData,
    isLoading,
    refetch,
    error,
  } = useQuery({
    queryKey: QUERY_KEYS.adminWeeklyReports({ weekFilter, yearFilter }),
    queryFn: () => fetchAdminWeeklyReports(supabase, weekFilter, yearFilter, initialDepartments),
  })

  const reports = useMemo(() => reportsData?.reports ?? [], [reportsData?.reports])
  const trackingData = useMemo(() => reportsData?.trackingData ?? [], [reportsData?.trackingData])

  const { data: lockState } = useQuery({
    queryKey: QUERY_KEYS.adminWeeklyReportLockState(weekFilter, yearFilter),
    queryFn: () => fetchAdminWeeklyReportLockState(supabase, weekFilter, yearFilter),
  })

  const isFilteredWeekLocked = lockState?.isLocked ?? false
  const canMutateFilteredWeek = lockState?.canMutate ?? !isFilteredWeekLocked
  const meetingDate = lockState?.meetingDate || getDefaultMeetingDateIso(weekFilter, yearFilter)

  const handleDelete = async (id: string) => {
    const target = reports.find((report) => report.id === id)
    if (target && !canMutateReport(target)) {
      toast.error("You can only modify reports you created")
      return
    }
    if (target) {
      const lock = await fetchWeeklyReportLockState(supabase, target.week_number, target.year)
      if (lock.isLocked) {
        toast.error("This report week is locked. Delete is no longer allowed.")
        return
      }
    }
    try {
      const { error: deleteError } = await supabase.from("weekly_reports").delete().eq("id", id)
      if (deleteError) throw deleteError
      toast.success("Report deleted")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminWeeklyReports() })
    } catch {
      toast.error("Delete failed")
    }
  }

  const openAllPptxModeDialog = () => {
    setPendingPptxExport({ kind: "all" })
    setPptxModeDialogOpen(true)
  }

  const openSinglePptxModeDialog = (report: WeeklyReport) => {
    setPendingPptxExport({ kind: "single", report })
    setPptxModeDialogOpen(true)
  }

  const runPptxExport = async (
    mode: WeeklyPptxMode,
    theme: WeeklyPptxTheme = "light",
    order: WeeklyDeptOrder = "default"
  ) => {
    if (!pendingPptxExport) return
    const exportMeetingDate = meetingDate
    if (pendingPptxExport.kind === "all") {
      await exportAllToPPTX(reports, weekFilter, yearFilter, mode, theme, exportMeetingDate, order)
    } else {
      const { exportToPPTX } = await import("@/lib/export-utils")
      await exportToPPTX(pendingPptxExport.report, mode, theme, exportMeetingDate)
    }
    setPptxModeDialogOpen(false)
    setPendingPptxExport(null)
  }

  const stats = useMemo(() => {
    const total = reports.length
    const withTrackerStarted = reports.filter((report) => {
      const status = getActionTrackerStatus(report.department, trackingData)
      return status.label === "Started" || status.label === "Finished"
    }).length
    const finished = reports.filter(
      (report) => getActionTrackerStatus(report.department, trackingData).label === "Finished"
    ).length
    const locked = isFilteredWeekLocked ? reports.length : 0

    return { total, withTrackerStarted, finished, locked }
  }, [isFilteredWeekLocked, reports, trackingData])

  const trackerStatusOptions = useMemo(
    () => [
      { value: "Pending", label: "Pending" },
      { value: "Started", label: "Started" },
      { value: "Finished", label: "Finished" },
      { value: "Not Started", label: "Not Started" },
    ],
    []
  )

  const columns = useMemo<DataTableColumn<WeeklyReport>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (report) => report.department,
        resizable: true,
        initialWidth: 180,
      },
      {
        key: "meeting_date",
        label: "Meeting Date",
        sortable: true,
        hideOnMobile: true,
        accessor: () => meetingDate,
        render: () => {
          const date = new Date(`${meetingDate}T00:00:00`)
          if (Number.isNaN(date.getTime())) return "-"
          return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
        },
      },
      {
        key: "week_number",
        label: "Week",
        sortable: true,
        hideOnMobile: true,
        accessor: (report) => report.week_number,
        render: (report) => <span className="font-medium">{`W${report.week_number}`}</span>,
      },
      {
        key: "year",
        label: "Year",
        sortable: true,
        hideOnMobile: true,
        accessor: (report) => report.year,
      },
      {
        key: "submitted_by",
        label: "Submitted By",
        sortable: true,
        hideOnMobile: true,
        accessor: (report) => {
          const profile = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
          return profile ? `${profile.first_name} ${profile.last_name}` : "Unknown"
        },
        render: (report) => {
          const profile = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
          return profile ? `${profile.first_name} ${profile.last_name}` : "Unknown"
        },
      },
      {
        key: "created_at",
        label: "Submission Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (report) => report.created_at,
        render: (report) => {
          const created = formatWATDate(report.created_at, { day: "2-digit", month: "short", year: "numeric" })
          const updatedAt = (report as WeeklyReport & { updated_at?: string | null }).updated_at
          const wasEdited = Boolean(updatedAt && new Date(updatedAt).getTime() > new Date(report.created_at).getTime())
          return (
            <div className="flex flex-col">
              <span>{created}</span>
              {wasEdited ? <span className="text-muted-foreground text-[11px]">(edited)</span> : null}
            </div>
          )
        },
      },
      {
        key: "tracker_status",
        label: "Action Tracker",
        accessor: (report) => getActionTrackerStatus(report.department, trackingData).label,
        render: (report) => {
          const trackerStatus = getActionTrackerStatus(report.department, trackingData)
          return <Badge className={trackerStatus.color}>{trackerStatus.label}</Badge>
        },
      },
    ],
    [meetingDate, trackingData]
  )

  const filters = useMemo<DataTableFilter<WeeklyReport>[]>(
    () => [
      {
        key: "week_number",
        label: "Week",
        options: Array.from({ length: 53 }, (_, index) => {
          const week = index + 1
          return { value: String(week), label: `Week ${week}` }
        }),
        multi: false,
        placeholder: `Week ${weekFilter}`,
      },
      {
        key: "year",
        label: "Year",
        options: [
          currentOfficeWeek.year - 1,
          currentOfficeWeek.year,
          currentOfficeWeek.year + 1,
          currentOfficeWeek.year + 2,
        ].map((year) => ({
          value: String(year),
          label: String(year),
        })),
        multi: false,
        placeholder: String(yearFilter),
      },
      {
        key: "department",
        label: "Department",
        options: initialDepartments.map((department) => ({ value: department, label: department })),
        multi: false,
        placeholder: "Every Department",
      },
      {
        key: "tracker_status",
        label: "Action Tracker",
        options: trackerStatusOptions,
      },
    ],
    [currentOfficeWeek.year, initialDepartments, trackerStatusOptions, weekFilter, yearFilter]
  )

  return (
    <DataTablePage
      title="Weekly Reports"
      description="Review and export departmental reports."
      icon={FileBarChart}
      backLink={{ href: "/admin/reports/general-meeting", label: "Back to General Meeting" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            onClick={() => {
              setExportTarget({ kind: "all" })
              setExportOptionsOpen(true)
            }}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            onClick={() => {
              if (!canMutateFilteredWeek) {
                toast.error("This report week is locked after the grace period.")
                return
              }
              setEditingReport(null)
              setIsAdminDialogOpen(true)
            }}
            className="h-8 gap-2"
            size="sm"
            disabled={!canMutateFilteredWeek}
          >
            <Plus className="h-4 w-4" />
            Add Report
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Reports"
            value={stats.total}
            icon={FileBarChart}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Tracker Started"
            value={stats.withTrackerStarted}
            icon={CalendarDays}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Finished"
            value={stats.finished}
            icon={FileSpreadsheet}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Locked Week"
            value={stats.locked}
            icon={Download}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<WeeklyReport>
        data={reports}
        columns={columns}
        filters={filters}
        getRowId={(report) => report.id}
        searchPlaceholder="Search department or work done..."
        searchFn={(report, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            report.department.toLowerCase().includes(normalizedQuery) ||
            report.work_done.toLowerCase().includes(normalizedQuery) ||
            report.tasks_new_week.toLowerCase().includes(normalizedQuery) ||
            report.challenges.toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        onFilterChange={(filterValues) => {
          const weekValue = filterValues.week_number?.[0]
          const yearValue = filterValues.year?.[0]

          if (weekValue) {
            const parsedWeek = Number(weekValue)
            if (!Number.isNaN(parsedWeek) && parsedWeek !== weekFilter) {
              setWeekFilter(parsedWeek)
            }
          }

          if (yearValue) {
            const parsedYear = Number(yearValue)
            if (!Number.isNaN(parsedYear) && parsedYear !== yearFilter) {
              setYearFilter(parsedYear)
            }
          }
        }}
        rowActions={[
          {
            label: "Edit",
            onClick: (report) => {
              if (!canMutateFilteredWeek) {
                toast.error("This report week is locked after the grace period.")
                return
              }
              if (!canMutateReport(report)) {
                toast.error("You can only edit your own reports")
                return
              }
              setEditingReport(report)
              setIsAdminDialogOpen(true)
            },
            hidden: () => !canMutateFilteredWeek,
          },
          {
            label: "Delete",
            variant: "destructive",
            onClick: (report) => setPendingDeleteId(report.id),
            hidden: () => !canMutateFilteredWeek,
          },
          {
            label: "Export",
            onClick: (report) => {
              setExportTarget({ kind: "single", report })
              setExportOptionsOpen(true)
            },
          },
        ]}
        expandable={{
          render: (report) => (
            <div className="grid gap-6 md:grid-cols-3">
              <div className="space-y-3">
                <h4 className="text-[10px] font-black tracking-widest text-blue-600 uppercase">Work Done</h4>
                <div className="space-y-1.5 border-l-2 border-blue-100 pl-3 text-sm dark:border-blue-900/30">
                  {autoNumberLines(report.work_done)
                    .split("\n")
                    .map((line, index) => (
                      <div key={index}>{line}</div>
                    ))}
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-[10px] font-black tracking-widest text-emerald-600 uppercase">
                  Tasks for New Week
                </h4>
                <div className="space-y-1.5 border-l-2 border-emerald-100 pl-3 text-sm dark:border-emerald-900/30">
                  {autoNumberLines(report.tasks_new_week)
                    .split("\n")
                    .map((line, index) => (
                      <div key={index}>{line}</div>
                    ))}
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-[10px] font-black tracking-widest text-rose-600 uppercase">Challenges</h4>
                <div className="space-y-1.5 border-l-2 border-rose-100 pl-3 text-sm dark:border-rose-900/30">
                  {autoNumberLines(report.challenges)
                    .split("\n")
                    .map((line, index) => (
                      <div key={index}>{line}</div>
                    ))}
                </div>
              </div>
              <div className="md:col-span-3">
                <Link
                  href={`/admin/reports/general-meeting/action-tracker?week=${report.week_number}&year=${report.year}&dept=${report.department}`}
                  className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  View action tracker
                </Link>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(report) => {
          const profile = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
          const submitterName = profile ? `${profile.first_name} ${profile.last_name}` : "Unknown"
          const trackerStatus = getActionTrackerStatus(report.department, trackingData)

          return (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{report.department}</p>
                  <p className="text-muted-foreground text-sm">{submitterName}</p>
                </div>
                <Badge className={trackerStatus.color}>{trackerStatus.label}</Badge>
              </div>
              <div className="grid gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Week</span>
                  <span>{`W${report.week_number}, ${report.year}`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submitted</span>
                  <span>{formatWATDate(report.created_at)}</span>
                </div>
              </div>
            </div>
          )
        }}
        emptyTitle="No weekly reports found"
        emptyDescription="No records were found for the selected criteria."
        emptyIcon={FileBarChart}
        skeletonRows={5}
        urlSync
      />

      <WeeklyReportAdminDialog
        isOpen={isAdminDialogOpen}
        onClose={() => setIsAdminDialogOpen(false)}
        report={editingReport}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminWeeklyReports() })}
        currentUser={currentUser}
      />

      <DeleteReportDialog
        pendingDeleteId={pendingDeleteId}
        onOpenChange={() => setPendingDeleteId(null)}
        onConfirm={(id) => {
          void handleDelete(id)
          setPendingDeleteId(null)
        }}
      />

      <PptxModeDialog
        open={pptxModeDialogOpen}
        onOpenChange={(open) => {
          setPptxModeDialogOpen(open)
          if (!open) setPendingPptxExport(null)
        }}
        onSelect={runPptxExport}
        showOrderStep={pendingPptxExport?.kind === "all"}
      />

      <ExportOptionsDialog
        open={exportOptionsOpen}
        onOpenChange={setExportOptionsOpen}
        title="Export Weekly Reports"
        options={[
          { id: "pdf", label: "PDF", icon: "pdf" },
          { id: "word", label: "Word (.docx)", icon: "word" },
          { id: "pptx", label: "PowerPoint (.pptx)", icon: "pptx" },
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
        ]}
        onSelect={(id) => {
          if (exportTarget.kind === "single") {
            const targetReport = exportTarget.report
            if (id === "pdf") {
              void downloadWeeklyReportPdf({
                week: targetReport.week_number,
                year: targetReport.year,
                department: targetReport.department,
              })
              return
            }
            if (id === "word") {
              void downloadWeeklyReportDocx({
                week: targetReport.week_number,
                year: targetReport.year,
                department: targetReport.department,
              })
              return
            }
            if (id === "excel") {
              void import("@/lib/export-utils").then(({ exportToXLSX }) => exportToXLSX(targetReport, meetingDate))
              return
            }
            openSinglePptxModeDialog(targetReport)
            return
          }

          if (id === "pdf") {
            void downloadWeeklyReportPdf({ week: weekFilter, year: yearFilter })
            return
          }
          if (id === "word") {
            void downloadWeeklyReportDocx({ week: weekFilter, year: yearFilter })
            return
          }
          if (id === "excel") {
            void import("@/lib/export-utils").then(({ exportAllToXLSX }) =>
              exportAllToXLSX(reports, weekFilter, yearFilter, meetingDate)
            )
            return
          }
          openAllPptxModeDialog()
        }}
      />
    </DataTablePage>
  )
}
