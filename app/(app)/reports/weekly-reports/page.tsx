"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { formatWATDate, formatWATTimeDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek, getReportingOfficeWeek } from "@/lib/meeting-week"
import { fetchWeeklyReportLockState, getDefaultMeetingDateIso } from "@/lib/weekly-report-lock"
import { CalendarDays, Download, FileBarChart, FileSpreadsheet, Pencil, Plus } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import {
  autoNumberLines,
  exportAllToPPTX,
  sortReportsByDepartment,
  type WeeklyDeptOrder,
  type WeeklyPptxMode,
  type WeeklyPptxTheme,
  type WeeklyReport,
} from "@/lib/export-utils"
import { WeeklyReportDialog } from "@/components/dashboard/reports/weekly-report-dialog"
import { Button } from "@/components/ui/button"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { downloadWeeklyReportDocx, downloadWeeklyReportPdf } from "@/lib/reports/export-download"
import { Badge } from "@/components/ui/badge"
import { QUERY_KEYS } from "@/lib/query-keys"
import { getDepartmentAliases, normalizeDepartmentName } from "@/shared/departments"
import { PptxModeDialog } from "./_components/pptx-mode-dialog"

interface UserProfile {
  id: string
  department: string | null
  role: string
  is_department_lead: boolean
  lead_departments?: string[] | null
}

interface ReportDialogParams {
  week: number
  year: number
  dept?: string
}

interface TrackerStatus {
  id: string
  department: string
  status: string
}

interface WeeklyReportsData {
  reports: WeeklyReport[]
  trackingData: TrackerStatus[]
}

async function fetchProfileAndDepartments(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { profile: null as UserProfile | null, allDepartments: [] as string[] }
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, department, role, is_department_lead, lead_departments")
    .eq("id", user.id)
    .single()

  // staff_directory, not profiles: profiles RLS would reduce this to the
  // caller's own department, leaving the filter dropdown with one entry.
  const { data: departmentsData } = await supabase
    .from("staff_directory")
    .select("department")
    .not("department", "is", null)

  const allDepartments = Array.from(
    new Set(
      (departmentsData || [])
        .map((row) => row.department)
        .filter((department): department is string => Boolean(department))
    )
  ).sort((a, b) => a.localeCompare(b))

  return {
    profile: profileData as UserProfile | null,
    allDepartments,
  }
}

async function fetchWeeklyReports(
  supabase: ReturnType<typeof createClient>,
  week: number,
  year: number,
  deptFilter: string
): Promise<WeeklyReportsData> {
  // The submitter name is resolved separately rather than embedded as
  // profiles(...): the embed runs under profiles RLS, which hides everyone but
  // the caller and rendered "Submitted By" as "Unknown" for plain employees.
  let query = supabase
    .from("weekly_reports")
    .select(
      "id, department, week_number, year, work_done, tasks_new_week, challenges, status, user_id, created_at, updated_at"
    )
    .eq("status", "submitted")
    .eq("week_number", week)
    .eq("year", year)
    .order("department", { ascending: true })

  if (deptFilter !== "all") {
    query = query.eq("department", deptFilter)
  }

  const { data: reportsData, error } = await query
  if (error) throw new Error(error.message)

  const submitterIds = Array.from(
    new Set((reportsData || []).map((report) => report.user_id).filter((id): id is string => Boolean(id)))
  )

  const submitterById = new Map<string, { first_name: string | null; last_name: string | null }>()
  if (submitterIds.length > 0) {
    const { data: submitters } = await supabase
      .from("staff_directory")
      .select("id, first_name, last_name")
      .in("id", submitterIds)
    for (const submitter of submitters || []) {
      submitterById.set(String(submitter.id), {
        first_name: submitter.first_name,
        last_name: submitter.last_name,
      })
    }
  }

  const reports = sortReportsByDepartment(
    (reportsData || []).map((report) => ({
      ...report,
      profiles: report.user_id ? (submitterById.get(report.user_id) ?? null) : null,
    })) as WeeklyReport[]
  )
  const departments = Array.from(new Set(reports.map((report) => report.department))).filter(Boolean)
  const departmentsForTasks = Array.from(new Set(departments.flatMap((department) => getDepartmentAliases(department))))

  if (departments.length === 0) {
    return { reports, trackingData: [] }
  }

  const { data: tasksData, error: tasksError } = await supabase
    .from("tasks")
    .select("id, department, status")
    .eq("category", "weekly_action")
    .eq("week_number", week)
    .eq("year", year)
    .in("department", departmentsForTasks)

  if (tasksError) {
    return { reports, trackingData: [] }
  }

  return {
    reports,
    trackingData: (tasksData || []) as TrackerStatus[],
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

export default function WeeklyReportsPortal() {
  const currentOfficeWeek = getCurrentOfficeWeek()
  // The week people are reporting on, which from Friday is the next one — that
  // is when reports for the coming Monday's meeting start arriving. The table
  // and the Add Report button both follow it, so a report is never filed into a
  // week the page is not showing.
  const reportingWeek = useMemo(() => getReportingOfficeWeek(), [])
  const [weekFilter, setWeekFilter] = useState(reportingWeek.week)
  const [yearFilter, setYearFilter] = useState(reportingWeek.year)
  // Once the user picks a week themselves, that choice wins over the default.
  const [hasManualWeekSelection, setHasManualWeekSelection] = useState(false)
  const [deptFilter, setDeptFilter] = useState("all")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedReportParams, setSelectedReportParams] = useState<ReportDialogParams | null>(null)
  const [pptxModeDialogOpen, setPptxModeDialogOpen] = useState(false)
  const [pendingPptxExport, setPendingPptxExport] = useState<
    { kind: "single"; report: WeeklyReport } | { kind: "all" } | null
  >(null)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [exportTarget, setExportTarget] = useState<{ kind: "all" } | { kind: "single"; report: WeeklyReport }>({
    kind: "all",
  })

  const supabase = createClient()
  const queryClient = useQueryClient()

  const { data: profileData } = useQuery({
    queryKey: ["portal-weekly-reports-profile"],
    queryFn: () => fetchProfileAndDepartments(supabase),
  })

  const profile = profileData?.profile ?? null
  const allDepartments = useMemo(() => profileData?.allDepartments ?? [], [profileData?.allDepartments])

  const {
    data: reportsData,
    isLoading,
    refetch,
    error,
  } = useQuery({
    queryKey: QUERY_KEYS.weeklyReports({ week: weekFilter, year: yearFilter, dept: deptFilter }),
    queryFn: () => fetchWeeklyReports(supabase, weekFilter, yearFilter, deptFilter),
    enabled: Boolean(profile),
  })

  const reports = useMemo(() => reportsData?.reports ?? [], [reportsData?.reports])
  const trackingData = useMemo(() => reportsData?.trackingData ?? [], [reportsData?.trackingData])

  const { data: lockState } = useQuery({
    queryKey: ["portal-weekly-report-lock", weekFilter, yearFilter],
    queryFn: () => fetchWeeklyReportLockState(supabase, weekFilter, yearFilter),
  })

  const meetingDate = lockState?.meetingDate || getDefaultMeetingDateIso(weekFilter, yearFilter)
  const canMutateFilteredWeek = lockState?.canMutate ?? !lockState?.isLocked

  const managedDepartments = useMemo(
    () => [profile?.department, ...(profile?.lead_departments || [])].filter((d): d is string => Boolean(d)),
    [profile?.department, profile?.lead_departments]
  )

  const canMutateReport = (report: WeeklyReport) => {
    const normalizedReportDepartment = normalizeDepartmentName(report.department)
    return managedDepartments.some((department) =>
      getDepartmentAliases(department).includes(normalizedReportDepartment)
    )
  }

  const targetWeek = useMemo(
    () => (hasManualWeekSelection ? { week: weekFilter, year: yearFilter } : reportingWeek),
    [hasManualWeekSelection, weekFilter, yearFilter, reportingWeek]
  )

  const existingReportForUserDept = useMemo(() => {
    const deptToCheck = deptFilter !== "all" ? deptFilter : profile?.department
    if (!deptToCheck) return null
    const targetDeptAliases = getDepartmentAliases(deptToCheck)
    return (
      reports.find(
        (r) =>
          r.week_number === targetWeek.week &&
          r.year === targetWeek.year &&
          targetDeptAliases.includes(normalizeDepartmentName(r.department))
      ) ?? null
    )
  }, [deptFilter, profile?.department, reports, targetWeek.week, targetWeek.year])

  const hasUnsubmittedManagedDept = useMemo(() => {
    if (deptFilter !== "all" || managedDepartments.length <= 1) return false
    return managedDepartments.some((dept) => {
      const aliases = getDepartmentAliases(dept)
      return !reports.some(
        (r) =>
          r.week_number === targetWeek.week &&
          r.year === targetWeek.year &&
          aliases.includes(normalizeDepartmentName(r.department))
      )
    })
  }, [deptFilter, managedDepartments, reports, targetWeek.week, targetWeek.year])

  const showEditButton = Boolean(existingReportForUserDept && !hasUnsubmittedManagedDept)

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

    if (pendingPptxExport.kind === "all") {
      await exportAllToPPTX(reports, weekFilter, yearFilter, mode, theme, meetingDate, order)
    } else {
      const { exportToPPTX } = await import("@/lib/export-utils")
      await exportToPPTX(pendingPptxExport.report, mode, theme, meetingDate)
    }

    setPptxModeDialogOpen(false)
    setPendingPptxExport(null)
  }

  const stats = useMemo(() => {
    const total = reports.length
    const withTrackerStarted = reports.filter((report) => {
      const trackerStatus = getActionTrackerStatus(report.department, trackingData)
      return trackerStatus.label === "Started" || trackerStatus.label === "Finished"
    }).length
    const finished = reports.filter(
      (report) => getActionTrackerStatus(report.department, trackingData).label === "Finished"
    ).length
    const locked = lockState?.isLocked ? reports.length : 0
    return { total, withTrackerStarted, finished, locked }
  }, [lockState?.isLocked, reports, trackingData])

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
          const profileInfo = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
          return profileInfo ? `${profileInfo.first_name} ${profileInfo.last_name}` : "Unknown"
        },
        render: (report) => {
          const profileInfo = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
          return profileInfo ? `${profileInfo.first_name} ${profileInfo.last_name}` : "Unknown"
        },
      },
      {
        key: "created_at",
        label: "Submission Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (report) => report.created_at,
        render: (report) => {
          const created = formatWATTimeDate(report.created_at)
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
        sortable: true,
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
        options: allDepartments.map((department) => ({ value: department, label: department })),
        multi: false,
        placeholder: "Every Department",
      },
      {
        key: "tracker_status",
        label: "Action Tracker",
        options: trackerStatusOptions,
      },
    ],
    [allDepartments, currentOfficeWeek.year, trackerStatusOptions, weekFilter, yearFilter]
  )

  return (
    <DataTablePage
      title="Weekly Reports"
      description="Review and export departmental reports."
      icon={FileBarChart}
      backLink={{ href: "/reports/general-meeting", label: "Back to General Meeting" }}
      spacing="tight"
      actionsPlacement="inline-always"
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
          {showEditButton && existingReportForUserDept ? (
            <Button
              size="sm"
              className="h-8 gap-2"
              disabled={!canMutateFilteredWeek || !canMutateReport(existingReportForUserDept)}
              onClick={() => {
                setSelectedReportParams({
                  week: existingReportForUserDept.week_number,
                  year: existingReportForUserDept.year,
                  dept: existingReportForUserDept.department,
                })
                setIsDialogOpen(true)
              }}
            >
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Edit Report</span>
              <span className="sm:hidden">Edit</span>
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 gap-2"
              disabled={!canMutateFilteredWeek}
              onClick={() => {
                setSelectedReportParams({
                  week: targetWeek.week,
                  year: targetWeek.year,
                  dept: (deptFilter !== "all" ? deptFilter : profile?.department) || undefined,
                })
                setIsDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add Report</span>
              <span className="sm:hidden">Add</span>
            </Button>
          )}
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Reports"
            value={stats.total}
            icon={FileBarChart}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Tracker Started"
            value={stats.withTrackerStarted}
            icon={CalendarDays}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Finished"
            value={stats.finished}
            icon={FileSpreadsheet}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
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
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search department or report details..."
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
          const deptValue = filterValues.department?.[0]

          if (weekValue) {
            const parsedWeek = Number(weekValue)
            if (!Number.isNaN(parsedWeek)) {
              setHasManualWeekSelection(true)
              if (parsedWeek !== weekFilter) setWeekFilter(parsedWeek)
            }
          }

          if (yearValue) {
            const parsedYear = Number(yearValue)
            if (!Number.isNaN(parsedYear)) {
              setHasManualWeekSelection(true)
              if (parsedYear !== yearFilter) setYearFilter(parsedYear)
            }
          }

          if (deptValue !== undefined && deptValue !== deptFilter) {
            setDeptFilter(deptValue)
          }
        }}
        rowActions={[
          {
            label: "Edit",
            onClick: (report) => {
              if (!canMutateFilteredWeek) {
                return
              }
              if (!canMutateReport(report)) {
                return
              }
              setSelectedReportParams({
                week: report.week_number,
                year: report.year,
                dept: report.department,
              })
              setIsDialogOpen(true)
            },
            hidden: (report) => !canMutateFilteredWeek || !canMutateReport(report),
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
                  href={`/reports/general-meeting/action-tracker?week=${report.week_number}&year=${report.year}&dept=${report.department}`}
                  className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  View action tracker
                </Link>
              </div>
            </div>
          ),
        }}
        viewToggle
        stickyToolbar
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          title: (report) => report.department,
          subtitle: (report) => {
            const profileInfo = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
            const submitterName = profileInfo ? `${profileInfo.first_name} ${profileInfo.last_name}` : "Unknown"
            return `${submitterName} (W${report.week_number}) · ${report.year}`
          },
          trailing: (report) => {
            const trackerStatus = getActionTrackerStatus(report.department, trackingData)
            return <Badge className={trackerStatus.color}>{trackerStatus.label}</Badge>
          },
          detail: {
            title: (report) => report.department,
            fields: (report) => {
              const profileInfo = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
              const submitterName = profileInfo ? `${profileInfo.first_name} ${profileInfo.last_name}` : "Unknown"
              const trackerStatus = getActionTrackerStatus(report.department, trackingData)
              return [
                { label: "Week", value: `W${report.week_number}, ${report.year}` },
                { label: "Meeting Date", value: meetingDate },
                { label: "Submitted By", value: submitterName },
                { label: "Action Tracker", value: trackerStatus.label },
                { label: "Submitted", value: formatWATTimeDate(report.created_at) },
              ]
            },
          },
        }}
        cardRenderer={(report) => {
          const profileInfo = Array.isArray(report.profiles) ? report.profiles[0] : report.profiles
          const submitterName = profileInfo ? `${profileInfo.first_name} ${profileInfo.last_name}` : "Unknown"
          const trackerStatus = getActionTrackerStatus(report.department, trackingData)

          return (
            <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{report.department}</p>
                  <p className="text-muted-foreground text-sm">
                    {submitterName} (W{report.week_number})
                  </p>
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
                  <span>{formatWATTimeDate(report.created_at)}</span>
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

      <WeeklyReportDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false)
          setSelectedReportParams(null)
        }}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.weeklyReports() })}
        initialData={selectedReportParams ?? undefined}
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
            const report = exportTarget.report
            if (id === "pdf") {
              void downloadWeeklyReportPdf({
                week: report.week_number,
                year: report.year,
                department: report.department,
              })
              return
            }
            if (id === "word") {
              void downloadWeeklyReportDocx({
                week: report.week_number,
                year: report.year,
                department: report.department,
              })
              return
            }
            if (id === "excel") {
              void import("@/lib/export-utils").then(({ exportToXLSX }) => exportToXLSX(report, meetingDate))
              return
            }
            openSinglePptxModeDialog(report)
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

      <PptxModeDialog
        isOpen={pptxModeDialogOpen}
        onOpenChange={(open) => {
          setPptxModeDialogOpen(open)
          if (!open) setPendingPptxExport(null)
        }}
        onExport={runPptxExport}
        showOrderStep={pendingPptxExport?.kind === "all"}
      />
    </DataTablePage>
  )
}
