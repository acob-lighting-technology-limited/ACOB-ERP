"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { DataTablePage, DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Calendar,
  Settings,
  Utensils,
  Loader2,
  Download,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Users,
  Award,
  CalendarDays,
  Plus,
  Vote,
} from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { LunchMenuBuilderDialog } from "./_components/lunch-menu-builder-dialog"
import { LunchDeadlineDialog } from "./_components/lunch-deadline-dialog"
import { LunchVoteOverrideDialog } from "./_components/lunch-vote-override-dialog"
import {
  DEFAULT_LUNCH_SETTINGS,
  groupHeading,
  menuHeading,
  NOT_EATING_OPTION_ID,
  type LunchMenu,
  type LunchOptionTally,
  type LunchVoteRecord,
} from "@/lib/hr/lunch-voting"
import { formatWATDate, formatWATTime } from "@/lib/utils/date"

export interface LunchEmployee {
  id: string
  full_name: string
  employee_number: string
  department: string | null
}

export interface LunchSettings {
  cost: number
  subsidy_percent: number
  eating_days?: string[]
  voting_deadline?: string
}

/** A menu row as returned by /api/admin/hr/lunch/menus — hydrated with votes. */
export interface AdminLunchMenu extends LunchMenu {
  votes: LunchVoteRecord[]
  tallies: LunchOptionTally[]
  /** Votes that will actually be charged — excludes the poll's NO answers. */
  eatingCount: number
  votingOpen: boolean
  resolvedDeadline: string
}

export interface LunchSummaryRow {
  user_id: string
  full_name: string
  employee_number: string
  department: string | null
  lunch_count: number
  total_deduction: number
}

export interface LunchRawLog {
  user_id: string
  date: string
  employee_deduction: number
}

interface LunchRegisterPageProps {
  initialEmployees: LunchEmployee[]
  initialAteUserIds: string[]
  initialSettings: LunchSettings
  todayDate: string
}

type LunchTab = "menus" | "daily" | "summary" | "leaderboard" | "calendar" | "reviews"

const LUNCH_TABS: DataTableTab[] = [
  { key: "menus", label: "Menu & Votes" },
  { key: "daily", label: "Daily Roster" },
  { key: "summary", label: "Summary" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "calendar", label: "Calendar" },
  { key: "reviews", label: "Feedback" },
]

/** One day's anonymous feedback. No author is returned by the API, by design. */
type LunchReviewSummary = {
  menu_id: string
  date: string
  review_count: number
  average_rating: number | null
  comments: { id: string; rating: number; comment: string | null; created_at: string }[]
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

function monBasedDay(jsDay: number) {
  return jsDay === 0 ? 6 : jsDay - 1
}

function buildCalendarCells(yearMonth: string): (string | null)[] {
  const [year, month] = yearMonth.split("-").map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
  const offset = monBasedDay(firstDayOfWeek)

  const cells: (string | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1
      return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    }),
  ]
  return cells
}

export function LunchRegisterPage({
  initialEmployees,
  initialAteUserIds,
  initialSettings,
  todayDate,
}: LunchRegisterPageProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<LunchTab>("menus")
  const [reviews, setReviews] = useState<LunchReviewSummary[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)
  const [employees] = useState<LunchEmployee[]>(initialEmployees)
  // Rows currently visible in each table (after search + filters + sort).
  const [processedDailyRows, setProcessedDailyRows] = useState<{ id: string; employee: LunchEmployee }[]>([])

  // Daily Register tab states
  const [selectedDate, setSelectedDate] = useState<string>(todayDate)
  const [ateUserIds, setAteUserIds] = useState<string[]>(initialAteUserIds)
  const [fetchingLogs, setFetchingLogs] = useState(false)

  // Monthly Summary & Calendar tab states
  const [selectedMonth, setSelectedMonth] = useState<string>(todayDate.substring(0, 7))
  const [summaryData, setSummaryData] = useState<LunchSummaryRow[]>([])
  const [processedSummaryData, setProcessedSummaryData] = useState<LunchSummaryRow[]>([])
  const [rawLogs, setRawLogs] = useState<LunchRawLog[]>([])
  const [fetchingSummary, setFetchingSummary] = useState(false)

  // Leaderboard specific states
  const [leaderboardPeriodMode, setLeaderboardPeriodMode] = useState<"month" | "year" | "all">("month")
  const [leaderboardMonth, setLeaderboardMonth] = useState<string>(todayDate.substring(0, 7))
  const [leaderboardYear, setLeaderboardYear] = useState<string>("2026")
  const [selectedLeaderboardDept, setSelectedLeaderboardDept] = useState<string>("all")
  const [leaderboardSummaryData, setLeaderboardSummaryData] = useState<LunchSummaryRow[]>([])
  const [fetchingLeaderboard, setFetchingLeaderboard] = useState(false)

  // Calendar tab specific states
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(initialEmployees[0]?.id || "")

  // General settings states
  const [settings, setSettings] = useState<LunchSettings>(initialSettings)
  const [loading, setLoading] = useState(false)
  const [openSettings, setOpenSettings] = useState(false)

  // Settings form state
  const [settingsForm, setSettingsForm] = useState({
    cost: initialSettings.cost,
    subsidy_percent: initialSettings.subsidy_percent,
    eating_days: initialSettings.eating_days || ["Monday", "Wednesday", "Friday"],
    voting_deadline: initialSettings.voting_deadline || DEFAULT_LUNCH_SETTINGS.voting_deadline,
  })

  // Menu & Votes tab states
  const [menus, setMenus] = useState<AdminLunchMenu[]>([])
  const [fetchingMenus, setFetchingMenus] = useState(false)
  const [menusError, setMenusError] = useState<string | null>(null)
  const [openMenuBuilder, setOpenMenuBuilder] = useState(false)
  const [editingMenu, setEditingMenu] = useState<AdminLunchMenu | null>(null)
  const [deadlineMenu, setDeadlineMenu] = useState<AdminLunchMenu | null>(null)
  const [deletingMenu, setDeletingMenu] = useState<AdminLunchMenu | null>(null)
  const [archivingMenu, setArchivingMenu] = useState<AdminLunchMenu | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [overrideMenu, setOverrideMenu] = useState<AdminLunchMenu | null>(null)

  // Export states
  const [openExport, setOpenExport] = useState(false)
  const [openCustomPeriodDialog, setOpenCustomPeriodDialog] = useState(false)
  const [customStartDate, setCustomStartDate] = useState<string>(todayDate.substring(0, 8) + "01")
  const [customEndDate, setCustomEndDate] = useState<string>(todayDate)

  // Generate Month list options for Select filter dropdowns
  const monthOptions = useMemo(() => {
    const opts = []
    const now = new Date()
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const lbl = d.toLocaleString("en-US", { month: "long", year: "numeric" })
      opts.push({ value: val, label: lbl })
    }
    return opts
  }, [])

  // Generate Year list options
  const yearOptions = ["2026", "2025"]

  // Fetch daily lunch logs when the selected date changes
  useEffect(() => {
    if (activeTab !== "daily") return
    if (selectedDate === todayDate && initialAteUserIds === ateUserIds) return

    async function loadDateLogs() {
      setFetchingLogs(true)
      try {
        const res = await fetch(`/api/admin/hr/lunch?date=${selectedDate}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to load logs")

        setAteUserIds(data.ateUserIds || [])
        if (data.settings) {
          setSettings(data.settings)
          setSettingsForm({
            cost: data.settings.cost,
            subsidy_percent: data.settings.subsidy_percent,
            eating_days: data.settings.eating_days || ["Monday", "Wednesday", "Friday"],
            voting_deadline: data.settings.voting_deadline || DEFAULT_LUNCH_SETTINGS.voting_deadline,
          })
        }
      } catch (err) {
        toast.error("Failed to load lunch register for selected date")
      } finally {
        setFetchingLogs(false)
      }
    }

    void loadDateLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, activeTab])

  // Fetch monthly summary logs (and raw logs) when month or tab changes
  useEffect(() => {
    if (activeTab !== "summary" && activeTab !== "calendar") return

    async function loadMonthlyData() {
      setFetchingSummary(true)
      try {
        const res = await fetch(`/api/admin/hr/lunch?month=${selectedMonth}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to load monthly summary")

        setSummaryData(data.summary || [])
        setRawLogs(data.logs || [])
        if (data.settings) {
          setSettings(data.settings)
          setSettingsForm({
            cost: data.settings.cost,
            subsidy_percent: data.settings.subsidy_percent,
            eating_days: data.settings.eating_days || ["Monday", "Wednesday", "Friday"],
            voting_deadline: data.settings.voting_deadline || DEFAULT_LUNCH_SETTINGS.voting_deadline,
          })
        }
      } catch (err) {
        toast.error("Failed to load monthly lunch logs")
      } finally {
        setFetchingSummary(false)
      }
    }

    void loadMonthlyData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, activeTab])

  // Fetch leaderboard data when cycle or parameters change
  useEffect(() => {
    if (activeTab !== "leaderboard") return

    async function loadLeaderboardData() {
      setFetchingLeaderboard(true)
      try {
        let url = "/api/admin/hr/lunch"
        if (leaderboardPeriodMode === "month") {
          url += `?month=${leaderboardMonth}`
        } else if (leaderboardPeriodMode === "year") {
          url += `?year=${leaderboardYear}`
        } else {
          url += "?all_time=true"
        }

        const res = await fetch(url)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to load leaderboard data")

        setLeaderboardSummaryData(data.summary || [])
      } catch (err) {
        toast.error("Failed to load leaderboard data")
      } finally {
        setFetchingLeaderboard(false)
      }
    }

    void loadLeaderboardData()
  }, [activeTab, leaderboardPeriodMode, leaderboardMonth, leaderboardYear])

  // Load published/draft menus with their live vote tallies
  const loadMenus = useCallback(async () => {
    setFetchingMenus(true)
    setMenusError(null)
    try {
      const res = await fetch("/api/admin/hr/lunch/menus")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load menus")
      setMenus((data.menus || []) as AdminLunchMenu[])
      if (data.settings) {
        setSettings(data.settings)
        setSettingsForm({
          cost: data.settings.cost,
          subsidy_percent: data.settings.subsidy_percent,
          eating_days: data.settings.eating_days || ["Monday", "Wednesday", "Friday"],
          voting_deadline: data.settings.voting_deadline || DEFAULT_LUNCH_SETTINGS.voting_deadline,
        })
      }
    } catch (err) {
      setMenusError(err instanceof Error ? err.message : "Failed to load menus")
    } finally {
      setFetchingMenus(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab !== "menus") return
    void loadMenus()
  }, [activeTab, loadMenus])

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true)
    setReviewsError(null)
    try {
      const res = await apiFetch("/api/admin/hr/lunch/reviews", { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load lunch feedback")
      setReviews(payload.data || [])
    } catch (err) {
      setReviewsError(err instanceof Error ? err.message : "Failed to load lunch feedback")
    } finally {
      setReviewsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab !== "reviews") return
    void loadReviews()
  }, [activeTab, loadReviews])

  // Publish / close / reopen a menu
  async function updateMenuStatus(menu: AdminLunchMenu, status: "draft" | "published" | "closed") {
    try {
      const res = await apiFetch(`/api/admin/hr/lunch/menus/${menu.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update menu")

      toast.success(
        status === "published"
          ? "Menu published — staff can vote now."
          : status === "closed"
            ? "Voting closed."
            : "Menu moved back to draft."
      )
      void loadMenus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update menu")
    }
  }

  // Cancelling a day drops its lunch charges but keeps the votes on record.
  async function setArchived(menu: AdminLunchMenu, archived: boolean) {
    try {
      const res = await apiFetch(`/api/admin/hr/lunch/menus/${menu.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update menu")

      toast.success(
        archived
          ? "Day cancelled — nobody is charged for it, and the votes are kept."
          : "Day restored — the lunch charges are back."
      )
      setArchivingMenu(null)
      void loadMenus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update menu")
    }
  }

  async function deleteMenu(menu: AdminLunchMenu) {
    setDeleting(true)
    try {
      // Votes are only discarded because the confirmation said so out loud.
      const clearVotes = menu.votes.length > 0 ? "?clear_votes=true" : ""
      const res = await apiFetch(`/api/admin/hr/lunch/menus/${menu.id}${clearVotes}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to delete menu")
      toast.success("Menu deleted.")
      setDeletingMenu(null)
      void loadMenus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete menu")
    } finally {
      setDeleting(false)
    }
  }

  // Pricing calculations
  const cost = Number(settings.cost)
  const subsidyPercent = Number(settings.subsidy_percent)
  const employeeSurcharge = cost * (1 - subsidyPercent / 100)
  const companySubsidy = cost * (subsidyPercent / 100)

  // Monthly stats
  const totalMealsRegisteredMonth = summaryData.reduce((sum, row) => sum + row.lunch_count, 0)
  const totalDeductionsMonth = summaryData.reduce((sum, row) => sum + row.total_deduction, 0)

  // Navigate dates (daily view)
  function adjustDate(days: number) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    setSelectedDate(d.toISOString().substring(0, 10))
  }

  // Navigate months (calendar view)
  function adjustCalendarMonth(delta: number) {
    const [year, month] = selectedMonth.split("-").map(Number)
    const d = new Date(year, month - 1 + delta, 1)
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }

  // Toggle meal register with automatic save in background
  async function toggleEmployeeLunch(employeeId: string, checked: boolean) {
    let updatedAteUserIds: string[]
    if (checked) {
      updatedAteUserIds = [...ateUserIds, employeeId]
    } else {
      updatedAteUserIds = ateUserIds.filter((id) => id !== employeeId)
    }
    setAteUserIds(updatedAteUserIds)

    try {
      const res = await apiFetch("/api/admin/hr/lunch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          userIds: updatedAteUserIds,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save lunch status")

      toast.success("Lunch status updated.", { duration: 1000 })
    } catch (err) {
      // Revert state
      setAteUserIds(ateUserIds)
      toast.error(err instanceof Error ? err.message : "Failed to update lunch status")
    }
  }

  // Save settings
  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await apiFetch("/api/admin/hr/lunch/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save settings")

      setSettings(data.settings)
      toast.success("Lunch settings updated! Changes apply starting today.")
      setOpenSettings(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings")
    } finally {
      setLoading(false)
    }
  }

  // Toggle weekday selection in form
  function toggleFormWeekday(day: string, checked: boolean) {
    const current = settingsForm.eating_days
    let next: string[]
    if (checked) {
      next = [...current, day]
    } else {
      next = current.filter((d) => d !== day)
    }
    setSettingsForm({ ...settingsForm, eating_days: next })
  }

  // Trigger open the export options picker
  function handleExportClick() {
    setOpenExport(true)
  }

  // Export Daily Roster
  function exportDaily() {
    const headers = [
      "Employee Name",
      "Staff Code",
      "Department",
      "Date",
      "Cost",
      "Company Subsidy",
      "Employee Deduction",
      "Status",
    ]
    const csvRows = [headers.join(",")]

    const source = processedDailyRows.length ? processedDailyRows.map((r) => r.employee) : employees
    source.forEach((emp) => {
      const hasEaten = ateUserIds.includes(emp.id)
      const row = [
        `"${emp.full_name}"`,
        `"${emp.employee_number}"`,
        `"${emp.department || "General"}"`,
        selectedDate,
        hasEaten ? cost : 0,
        hasEaten ? companySubsidy : 0,
        hasEaten ? employeeSurcharge : 0,
        hasEaten ? "Eaten" : "Skipped",
      ]
      csvRows.push(row.join(","))
    })

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `lunch_register_${selectedDate}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("Daily report exported successfully!")
  }

  // Export Monthly Summary
  function exportMonthly() {
    const headers = ["Employee Name", "Staff Code", "Department", "Month", "Lunch Days Count", "Total Deduction"]
    const csvRows = [headers.join(",")]

    const source = processedSummaryData.length ? processedSummaryData : summaryData
    source.forEach((row) => {
      const r = [
        `"${row.full_name}"`,
        `"${row.employee_number}"`,
        `"${row.department || "General"}"`,
        selectedMonth,
        row.lunch_count,
        row.total_deduction,
      ]
      csvRows.push(r.join(","))
    })

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `lunch_summary_${selectedMonth}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success("Monthly report exported successfully!")
  }

  // Export Custom Period
  async function exportCustom(start: string, end: string) {
    try {
      const res = await fetch(`/api/admin/hr/lunch?start_date=${start}&end_date=${end}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load custom period data")

      const headers = ["Employee Name", "Staff Code", "Department", "Period", "Lunch Days Count", "Total Deduction"]
      const csvRows = [headers.join(",")]

      const summary = data.summary || []
      summary.forEach((row: any) => {
        const r = [
          `"${row.full_name}"`,
          `"${row.employee_number}"`,
          `"${row.department || "General"}"`,
          `"${start} to ${end}"`,
          row.lunch_count,
          row.total_deduction,
        ]
        csvRows.push(r.join(","))
      })

      const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n")
      const encodedUri = encodeURI(csvContent)
      const link = document.createElement("a")
      link.setAttribute("href", encodedUri)
      link.setAttribute("download", `lunch_summary_${start}_to_${end}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success("Custom period report exported successfully!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export report")
    }
  }

  // Daily checklist columns
  const dailyColumns: DataTableColumn<{ id: string; employee: LunchEmployee }>[] = [
    {
      key: "checkbox",
      label: "Checked",
      render: (row) => (
        <Checkbox
          checked={ateUserIds.includes(row.employee.id)}
          onCheckedChange={(checked) => {
            void toggleEmployeeLunch(row.employee.id, !!checked)
          }}
          className="h-5 w-5 border-2"
        />
      ),
    },
    {
      key: "employee_name",
      label: "Employee Name",
      accessor: (row) => row.employee.full_name,
      sortable: true,
      render: (row) => (
        <div>
          <span className="text-foreground font-semibold">{row.employee.full_name}</span>
          <div className="text-muted-foreground text-xs">{row.employee.department || "General"}</div>
        </div>
      ),
    },
    {
      key: "employee_number",
      label: "Staff Code",
      accessor: (row) => row.employee.employee_number,
      render: (row) => <span className="font-mono text-xs">{row.employee.employee_number}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => {
        const hasEaten = ateUserIds.includes(row.employee.id)
        return (
          <Badge
            className={
              hasEaten
                ? "border-0 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                : "border bg-gray-100 text-gray-400 hover:bg-gray-100/80"
            }
          >
            {hasEaten ? "Eaten" : "Skipped"}
          </Badge>
        )
      },
    },
  ]

  // Menu & Votes columns
  const menuColumns: DataTableColumn<AdminLunchMenu>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      accessor: (row) => row.date,
      render: (row) => (
        <div>
          <span className="text-foreground font-semibold">{menuHeading(row.date, todayDate)}</span>
          <div className="text-muted-foreground text-xs">
            {formatWATDate(row.date, { weekday: "long", day: "numeric", month: "short" })}
          </div>
        </div>
      ),
    },
    {
      key: "menu",
      label: "Menu",
      // Single-category menus have no group name, so list the dishes directly;
      // multi-category ones list the category names and their counts.
      accessor: (row) => row.groups.flatMap((g) => g.options.map((o) => o.name)).join(" "),
      render: (row) => {
        if (row.groups.length === 0) {
          return <span className="text-muted-foreground text-xs">No dishes yet</span>
        }
        const summary =
          row.groups.length === 1
            ? row.groups[0].options.map((o) => o.name).join(" · ")
            : row.groups.map((g, i) => `${groupHeading(g, i)} (${g.options.length})`).join(" · ")
        return <span className="text-sm">{summary}</span>
      },
    },
    {
      key: "status",
      label: "Status",
      accessor: (row) => row.status,
      render: (row) => {
        if (row.archived_at) {
          return <Badge className="border bg-gray-100 text-gray-500 hover:bg-gray-100/80">Cancelled</Badge>
        }
        const tone =
          row.status === "published" && row.votingOpen
            ? "border-0 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
            : row.status === "draft"
              ? "border bg-gray-100 text-gray-500 hover:bg-gray-100/80"
              : "border-0 bg-red-500/10 text-red-500 hover:bg-red-500/20"
        const label =
          row.status === "draft"
            ? "Draft"
            : row.status === "closed"
              ? "Closed"
              : row.votingOpen
                ? "Voting open"
                : "Deadline passed"
        return <Badge className={tone}>{label}</Badge>
      },
    },
    {
      key: "deadline",
      label: "Voting Closes",
      accessor: (row) => row.resolvedDeadline,
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs">{formatWATTime(row.resolvedDeadline)}</span>
          {/* A stored value means this day was deliberately overridden; the
              rest simply follow the lunch settings deadline. */}
          {row.voting_deadline && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              custom
            </Badge>
          )}
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: "votes",
      label: "Eating",
      sortable: true,
      accessor: (row) => row.eatingCount,
      render: (row) => {
        const notEating = row.votes.length - row.eatingCount
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="border-2 px-2.5 py-0.5 font-semibold">
              {row.eatingCount}
            </Badge>
            {notEating > 0 && <span className="text-muted-foreground text-xs">{notEating} said no</span>}
          </div>
        )
      },
    },
  ]

  const menuFilters: DataTableFilter<AdminLunchMenu>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "published", label: "Published" },
        { value: "closed", label: "Closed" },
      ],
    },
    {
      key: "has_votes",
      label: "Votes",
      options: [
        { value: "with", label: "Has votes" },
        { value: "without", label: "No votes yet" },
      ],
      mode: "custom" as const,
      filterFn: (row, selectedValues) => {
        if (selectedValues.length === 0) return true
        return selectedValues.includes(row.votes.length > 0 ? "with" : "without")
      },
    },
  ]

  // Monthly summary columns
  const summaryColumns: DataTableColumn<LunchSummaryRow>[] = [
    {
      key: "employee_name",
      label: "Employee Name",
      accessor: (row) => row.full_name,
      sortable: true,
      render: (row) => (
        <div>
          <span className="text-foreground font-semibold">{row.full_name}</span>
          <div className="text-muted-foreground text-xs">{row.department || "General"}</div>
        </div>
      ),
    },
    {
      key: "employee_number",
      label: "Staff Code",
      accessor: (row) => row.employee_number,
      render: (row) => <span className="font-mono text-xs">{row.employee_number}</span>,
    },
    {
      key: "lunch_count",
      label: "Lunch Days",
      accessor: (row) => row.lunch_count,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className="border-2 px-2.5 py-0.5 font-semibold">
          {row.lunch_count} {row.lunch_count === 1 ? "day" : "days"}
        </Badge>
      ),
    },
    {
      key: "total_deduction",
      label: "Total Surcharge (₦)",
      accessor: (row) => row.total_deduction,
      sortable: true,
      render: (row) => (
        <span className="font-mono font-bold text-red-600">
          ₦{Number(row.total_deduction).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
  ]

  // Leaderboard sorting & filtering
  const sortedLeaderboard = [...leaderboardSummaryData]
    .filter((r) => selectedLeaderboardDept === "all" || r.department === selectedLeaderboardDept)
    .sort((a, b) => b.lunch_count - a.lunch_count)

  // Calendar dates calculations
  const calendarCells = buildCalendarCells(selectedMonth)
  const employeeSelectedLogs = rawLogs.filter((log) => log.user_id === selectedEmployeeId)

  const dailyMappedRows = employees.map((emp) => ({
    id: emp.id,
    employee: emp,
  }))

  // Check if selected date is a configured eating day
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const selectedDayName = daysOfWeek[new Date(selectedDate).getDay()]
  const eatingDays = settings.eating_days || ["Monday", "Wednesday", "Friday"]
  const isEatingDay = eatingDays.includes(selectedDayName)

  // Filters for Daily Register Tab (Date inside table, before Department)
  const dailyFilters = [
    {
      key: "date",
      label: "Date",
      options: [],
      render: () => (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => adjustDate(-1)}
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <input
            type="date"
            value={selectedDate}
            max={todayDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 py-1.5 text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => adjustDate(1)}
            disabled={selectedDate >= todayDate}
            title="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
    {
      key: "department",
      label: "Department",
      options: Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).map((d) => ({
        value: d!,
        label: d!,
      })),
      mode: "custom" as const,
      filterFn: (row: any, selectedValues: string[]) => {
        if (selectedValues.length === 0) return true
        return selectedValues.includes(row.employee.department || "")
      },
    },
  ]

  // Filters for Summary Tab (Month Select & Department)
  const summaryFilters = [
    {
      key: "department",
      label: "Department",
      options: Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).map((d) => ({
        value: d!,
        label: d!,
      })),
    },
    {
      key: "month",
      label: "Month",
      options: monthOptions,
      placeholder: "Select Month",
      multi: false,
      defaultValues: [selectedMonth],
      mode: "custom" as const,
      filterFn: () => true,
    },
  ]

  return (
    <DataTablePage
      title="Lunch Register"
      description={
        activeTab === "summary"
          ? "Monthly lunch surcharge summary by employee."
          : activeTab === "daily"
            ? "Daily lunch checklist register."
            : activeTab === "leaderboard"
              ? "Rankings of lunch attendance for the selected period."
              : "Individual employee lunch calendar view."
      }
      icon={Utensils}
      backLink={{ href: "/admin/hr", label: "Back to HR" }}
      tabs={LUNCH_TABS}
      activeTab={activeTab}
      onTabChange={(t) => setActiveTab(t as LunchTab)}
      stats={
        activeTab === "summary" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              title="Total Meals Registered"
              value={totalMealsRegisteredMonth}
              icon={Utensils}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title="Meal Cost (Unit)"
              value={`₦${cost.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              icon={Settings}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
            <StatCard
              title="Surcharge (Unit)"
              value={`₦${employeeSurcharge.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              icon={Utensils}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
            <StatCard
              title="Total Surcharges"
              value={`₦${totalDeductionsMonth.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              icon={Utensils}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
          </div>
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-2">
          {activeTab === "menus" && (
            <Button
              size="sm"
              onClick={() => {
                setEditingMenu(null)
                setOpenMenuBuilder(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> New Menu
            </Button>
          )}

          {/* Settings Dialog */}
          <Dialog open={openSettings} onOpenChange={setOpenSettings}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings className="mr-2 h-4 w-4" /> Settings
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <form onSubmit={handleSaveSettings}>
                <DialogHeader>
                  <DialogTitle>Lunch Price & Eating Days Settings</DialogTitle>
                  <DialogDescription>
                    Adjust the daily price of food, subsidy, and configured eating days of the week. Changes apply to
                    logs starting today.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4 text-sm">
                  <div className="space-y-2">
                    <Label htmlFor="cost">Food Cost per Meal (₦)</Label>
                    <Input
                      id="cost"
                      type="number"
                      value={settingsForm.cost || ""}
                      onChange={(e) => setSettingsForm({ ...settingsForm, cost: parseFloat(e.target.value) || 0 })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subsidy">Company Subsidy Percentage (%)</Label>
                    <Input
                      id="subsidy"
                      type="number"
                      min="0"
                      max="100"
                      value={settingsForm.subsidy_percent}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, subsidy_percent: parseFloat(e.target.value) || 0 })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="voting-deadline">Voting Deadline</Label>
                    <Input
                      id="voting-deadline"
                      type="time"
                      value={settingsForm.voting_deadline}
                      onChange={(e) => setSettingsForm({ ...settingsForm, voting_deadline: e.target.value })}
                      required
                    />
                    <p className="text-muted-foreground text-xs">
                      Default cut-off for staff to vote on each day&apos;s menu. Individual menus can override it.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Configured Eating Days</Label>
                    <div className="bg-muted/20 mt-1 grid grid-cols-2 gap-2 rounded-lg border p-3">
                      {WEEKDAYS.map((day) => {
                        const isChecked = settingsForm.eating_days.includes(day)
                        return (
                          <div key={day} className="flex items-center gap-2">
                            <Checkbox
                              id={`day-${day}`}
                              checked={isChecked}
                              onCheckedChange={(checked) => toggleFormWeekday(day, !!checked)}
                            />
                            <Label htmlFor={`day-${day}`} className="cursor-pointer text-xs font-medium">
                              {day}
                            </Label>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="bg-muted/40 space-y-1.5 rounded-lg border p-3 text-xs">
                    <div className="flex justify-between">
                      <span>Calculated Employee Pay:</span>
                      <span className="font-bold text-red-600">
                        ₦
                        {(settingsForm.cost * (1 - settingsForm.subsidy_percent / 100)).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Calculated Company Subsidy:</span>
                      <span className="font-bold text-emerald-600">
                        ₦
                        {(settingsForm.cost * (settingsForm.subsidy_percent / 100)).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpenSettings(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    Save Settings
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Export Report */}
          <Button variant="outline" onClick={handleExportClick} size="sm">
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
      }
    >
      {activeTab === "menus" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              title="Menus Published"
              value={menus.filter((m) => m.status !== "draft").length}
              icon={Utensils}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title="Open for Voting"
              value={menus.filter((m) => m.votingOpen).length}
              icon={Vote}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
            <StatCard
              title="Drafts"
              value={menus.filter((m) => m.status === "draft").length}
              icon={CalendarDays}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
            <StatCard
              title="Votes Cast"
              value={menus.reduce((sum, m) => sum + m.votes.length, 0)}
              icon={Users}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
          </div>

          <DataTable<AdminLunchMenu>
            data={menus}
            columns={menuColumns}
            getRowId={(row) => row.id}
            searchPlaceholder="Search a dish…"
            searchFn={(row, q) => {
              const needle = q.toLowerCase()
              return row.groups.some((g) => g.options.some((o) => o.name.toLowerCase().includes(needle)))
            }}
            filters={menuFilters}
            isLoading={fetchingMenus}
            error={menusError}
            onRetry={() => void loadMenus()}
            expandable={{ render: (row) => <MenuVotesPanel menu={row} totalStaff={employees.length} /> }}
            rowActions={[
              {
                // Always offered. When votes exist the builder warns that
                // changing the dishes clears them, rather than the action
                // silently disappearing.
                label: "Edit menu",
                onClick: (row) => {
                  setEditingMenu(row)
                  setOpenMenuBuilder(true)
                },
              },
              {
                // The clock stays editable after votes exist — only rebuilding
                // the dishes is destructive. Past days are left alone.
                label: "Change deadline",
                hidden: (row) => row.date < todayDate,
                onClick: (row) => setDeadlineMenu(row),
              },
              {
                label: "Change someone's answer",
                onClick: (row) => setOverrideMenu(row),
              },
              {
                label: "Publish for voting",
                hidden: (row) => row.status === "published",
                onClick: (row) => void updateMenuStatus(row, "published"),
              },
              {
                // Only worth offering while voting is genuinely still open —
                // it closes itself at the deadline, so after that this would
                // just be a button that changes nothing anyone can see.
                label: "Close voting early",
                hidden: (row) => !row.votingOpen,
                onClick: (row) => void updateMenuStatus(row, "closed"),
              },
              {
                label: "Reopen voting",
                hidden: (row) => row.status !== "closed" || row.date < todayDate,
                onClick: (row) => void updateMenuStatus(row, "published"),
              },
              {
                // The everyday "this day is off" action: keeps the record,
                // drops the charges.
                label: "Cancel this day",
                hidden: (row) => Boolean(row.archived_at),
                onClick: (row) => setArchivingMenu(row),
              },
              {
                label: "Restore this day",
                hidden: (row) => !row.archived_at,
                onClick: (row) => void setArchived(row, false),
              },
              {
                label: "Delete permanently",
                variant: "destructive",
                onClick: (row) => setDeletingMenu(row),
              },
            ]}
          />
        </div>
      )}

      {activeTab === "daily" && (
        <div className="space-y-4">
          {/* Daily Stats Cards (Always Visible) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              title="Total Meals Registered"
              value={ateUserIds.length}
              icon={Utensils}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title="Meal Cost (Unit)"
              value={`₦${cost.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              icon={Settings}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
            <StatCard
              title="Surcharge (Unit)"
              value={`₦${employeeSurcharge.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              icon={Utensils}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
            <StatCard
              title="Total Surcharges"
              value={`₦${(ateUserIds.length * employeeSurcharge).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              icon={Utensils}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
          </div>

          {/* Date Navigator (Always Visible) */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Date</Label>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => adjustDate(-1)}
                title="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <input
                type="date"
                value={selectedDate}
                max={todayDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border-input bg-background h-9 rounded-md border px-3 py-1.5 text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => adjustDate(1)}
                disabled={selectedDate >= todayDate}
                title="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content Block */}
          {fetchingLogs ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 p-12">
              <Loader2 className="text-primary h-8 w-8 animate-spin" />
              <span>Loading daily lunch register...</span>
            </div>
          ) : !isEatingDay ? (
            <div className="bg-muted/10 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-16 text-center">
              <Utensils className="text-muted-foreground/50 h-8 w-8" />
              <span className="text-foreground text-sm font-semibold">No Lunch Scheduled</span>
              <span className="text-muted-foreground max-w-sm text-xs">
                {selectedDayName} is not configured as a lunch eating day. You can change this in settings (top right)
                or navigate to another day using the selector above.
              </span>
            </div>
          ) : (
            <DataTable
              data={dailyMappedRows}
              columns={dailyColumns}
              getRowId={(row) => row.id}
              onProcessedDataChange={setProcessedDailyRows}
              searchPlaceholder="Search staff name..."
              searchFn={(row, q) => row.employee.full_name.toLowerCase().includes(q.toLowerCase())}
              filters={dailyFilters.filter((f) => f.key !== "date")}
              isLoading={false}
            />
          )}
        </div>
      )}

      {activeTab === "summary" &&
        (fetchingSummary ? (
          <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 p-12">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
            <span>Loading summary report...</span>
          </div>
        ) : (
          <DataTable
            data={summaryData}
            columns={summaryColumns}
            getRowId={(row) => row.user_id}
            onProcessedDataChange={setProcessedSummaryData}
            searchPlaceholder="Search staff name..."
            searchFn={(row, q) => row.full_name.toLowerCase().includes(q.toLowerCase())}
            filters={summaryFilters}
            onFilterChange={(filters) => {
              const newMonth = filters.month?.[0]
              if (newMonth && newMonth !== selectedMonth) {
                setSelectedMonth(newMonth)
              }
            }}
            expandable={{
              render: (r) => (
                <EmployeeLunchExpandPanel
                  row={r}
                  selectedMonth={selectedMonth}
                  rawLogs={rawLogs}
                  eatingDays={eatingDays}
                />
              ),
            }}
            isLoading={false}
          />
        ))}

      {activeTab === "leaderboard" && (
        <div className="space-y-4">
          {/* Inline controls matching LeaderboardView filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Cycle</Label>
              <Select
                value={leaderboardPeriodMode}
                onValueChange={(v) => setLeaderboardPeriodMode(v as "month" | "year" | "all")}
              >
                <SelectTrigger className="border-input bg-background h-9 w-[140px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Monthly</SelectItem>
                  <SelectItem value="year">Yearly</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {leaderboardPeriodMode === "month" && (
              <div className="space-y-1">
                <Label className="text-xs">Month</Label>
                <Select value={leaderboardMonth} onValueChange={setLeaderboardMonth}>
                  <SelectTrigger className="border-input bg-background h-9 w-[180px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {leaderboardPeriodMode === "year" && (
              <div className="space-y-1">
                <Label className="text-xs">Year</Label>
                <Select value={leaderboardYear} onValueChange={setLeaderboardYear}>
                  <SelectTrigger className="border-input bg-background h-9 w-[140px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Select value={selectedLeaderboardDept} onValueChange={setSelectedLeaderboardDept}>
                <SelectTrigger className="border-input bg-background h-9 w-[180px] text-sm">
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).map((d) => (
                    <SelectItem key={d} value={d!}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {fetchingLeaderboard ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 p-12">
              <Loader2 className="text-primary h-8 w-8 animate-spin" />
              <span>Loading leaderboard...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {/* Metric 1: Most Lunch Meals Eaten */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Utensils className="h-4 w-4 text-emerald-500" />
                    Most Meals Eaten
                  </CardTitle>
                  <p className="text-muted-foreground text-xs">Highest count of lunch meals logged</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-64">
                    <div className="space-y-1 pr-3">
                      {sortedLeaderboard.map((row, idx) => (
                        <div
                          key={row.user_id}
                          className="hover:bg-muted/30 flex items-center justify-between gap-2 rounded px-1.5 py-1.5 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge variant="outline" className="w-6 shrink-0 justify-center px-0 text-[10px]">
                              {idx + 1}
                            </Badge>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold">{row.full_name}</div>
                              <div className="text-muted-foreground truncate text-[10px]">
                                {row.department || "General"}
                              </div>
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-semibold">{row.lunch_count} meals</span>
                        </div>
                      ))}
                      {sortedLeaderboard.length === 0 && (
                        <p className="text-muted-foreground py-4 text-center text-xs">No data for this period.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Metric 2: Highest Surcharges */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Award className="h-4 w-4 text-red-500" />
                    Highest Surcharges
                  </CardTitle>
                  <p className="text-muted-foreground text-xs">Highest total surcharges deducted</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-64">
                    <div className="space-y-1 pr-3">
                      {sortedLeaderboard.map((row, idx) => (
                        <div
                          key={row.user_id}
                          className="hover:bg-muted/30 flex items-center justify-between gap-2 rounded px-1.5 py-1.5 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge variant="outline" className="w-6 shrink-0 justify-center px-0 text-[10px]">
                              {idx + 1}
                            </Badge>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold">{row.full_name}</div>
                              <div className="text-muted-foreground truncate text-[10px]">
                                {row.department || "General"}
                              </div>
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-xs font-bold text-red-600">
                            ₦{row.total_deduction.toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {sortedLeaderboard.length === 0 && (
                        <p className="text-muted-foreground py-4 text-center text-xs">No data for this period.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Metric 3: Least Meals Eaten */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-blue-500" />
                    Least Meals Eaten
                  </CardTitle>
                  <p className="text-muted-foreground text-xs">Lowest count of lunch meals logged</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-64">
                    <div className="space-y-1 pr-3">
                      {[...sortedLeaderboard].reverse().map((row, idx) => (
                        <div
                          key={row.user_id}
                          className="hover:bg-muted/30 flex items-center justify-between gap-2 rounded px-1.5 py-1.5 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge variant="outline" className="w-6 shrink-0 justify-center px-0 text-[10px]">
                              {idx + 1}
                            </Badge>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold">{row.full_name}</div>
                              <div className="text-muted-foreground truncate text-[10px]">
                                {row.department || "General"}
                              </div>
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-semibold">{row.lunch_count} meals</span>
                        </div>
                      ))}
                      {sortedLeaderboard.length === 0 && (
                        <p className="text-muted-foreground py-4 text-center text-xs">No data for this period.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {activeTab === "calendar" &&
        (fetchingSummary ? (
          <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 p-12">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
            <span>Loading calendar view...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Custom filters panel for Calendar view matching CalendarView controls */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="max-w-72 min-w-48 flex-1">
                <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                  <SelectTrigger className="bg-background border-input h-9 text-sm">
                    <SelectValue placeholder="Select employee…" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id} className="text-xs">
                        {e.full_name}
                        <span className="text-muted-foreground ml-2 text-xs">({e.department || "General"})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => adjustCalendarMonth(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-36 text-center text-sm font-medium">
                  {new Date(selectedMonth + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => adjustCalendarMonth(1)}
                  disabled={selectedMonth >= todayDate.substring(0, 7)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Calendar Grid Card matching attendance CalendarView exact UI styling */}
            {!selectedEmployeeId ? (
              <div className="text-muted-foreground py-16 text-center text-sm">
                Select an employee to view their lunch calendar.
              </div>
            ) : (
              <div className="rounded-lg border">
                {/* Day-of-week headers */}
                <div className="grid grid-cols-7 border-b">
                  {DAY_HEADERS.map((d) => (
                    <div key={d} className="text-muted-foreground py-2 text-center text-xs font-semibold">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar cells */}
                <div className="grid grid-cols-7">
                  {calendarCells.map((date, i) => {
                    const isLastInRow = (i + 1) % 7 === 0
                    if (!date) {
                      return (
                        <div
                          key={`empty-${i}`}
                          className={`bg-muted/20 min-h-16 border-b p-1 ${isLastInRow ? "" : "border-r"}`}
                        />
                      )
                    }

                    const hasEaten = employeeSelectedLogs.some((log) => log.date === date)
                    const bg = hasEaten ? "bg-emerald-500/5 hover:bg-emerald-500/10" : "bg-background hover:bg-muted/10"

                    return (
                      <div
                        key={date}
                        className={`min-h-16 border-b p-1.5 text-xs transition-colors ${isLastInRow ? "" : "border-r"} ${bg}`}
                      >
                        <div className="text-muted-foreground mb-1 font-medium">{date.slice(8)}</div>
                        {hasEaten ? (
                          <>
                            <div
                              className="truncate leading-tight font-bold text-emerald-600"
                              style={{ fontSize: "10px" }}
                            >
                              Eaten
                            </div>
                            <div className="text-muted-foreground leading-tight" style={{ fontSize: "10px" }}>
                              Deducted: ₦1,100
                            </div>
                          </>
                        ) : (
                          <div className="text-muted-foreground/60 mt-1 leading-tight" style={{ fontSize: "10px" }}>
                            —
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Legend matching attendance CalendarView exact UI styling */}
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className="border-0 bg-emerald-500/10 text-xs text-emerald-500 hover:bg-emerald-500/10">
                Eaten
              </Badge>
              <Badge className="border bg-gray-100 text-xs text-gray-400 hover:bg-gray-100">Skipped</Badge>
            </div>
          </div>
        ))}
      <AlertDialog open={archivingMenu !== null} onOpenChange={(open) => !open && setArchivingMenu(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel lunch for{" "}
              {archivingMenu
                ? formatWATDate(archivingMenu.date, { weekday: "long", day: "numeric", month: "long" })
                : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archivingMenu && archivingMenu.eatingCount > 0
                ? `The day disappears from everyone's /lunch page and the ${archivingMenu.eatingCount} lunch ${archivingMenu.eatingCount === 1 ? "charge" : "charges"} for it are removed, so nobody is deducted. The votes are kept, so you can restore the day and the charges together if lunch goes ahead after all.`
                : "The day disappears from everyone's /lunch page. Nobody is charged. You can restore it at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (archivingMenu) void setArchived(archivingMenu, true)
              }}
            >
              Cancel the day
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deletingMenu !== null} onOpenChange={(open) => !open && setDeletingMenu(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the menu for{" "}
              {deletingMenu ? formatWATDate(deletingMenu.date, { weekday: "long", day: "numeric", month: "long" }) : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletingMenu && deletingMenu.votes.length > 0
                ? `${deletingMenu.votes.length} ${deletingMenu.votes.length === 1 ? "person has" : "people have"} already voted. This erases the menu, their votes and the lunch charges for good — there is no record left of who chose what. If you only need lunch called off, use "Cancel this day" instead; it removes the charges but keeps the record.`
                : "This menu has no votes yet, so nothing else is affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                if (deletingMenu) void deleteMenu(deletingMenu)
              }}
            >
              {deleting ? "Deleting…" : "Delete menu"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LunchDeadlineDialog
        open={deadlineMenu !== null}
        onOpenChange={(open) => !open && setDeadlineMenu(null)}
        menu={deadlineMenu}
        defaultDeadline={settings.voting_deadline || DEFAULT_LUNCH_SETTINGS.voting_deadline}
        onSaved={() => void loadMenus()}
      />

      <LunchVoteOverrideDialog
        open={overrideMenu !== null}
        onOpenChange={(open) => !open && setOverrideMenu(null)}
        menu={overrideMenu}
        employees={employees.map((e) => ({ id: e.id, full_name: e.full_name }))}
        onSaved={() => void loadMenus()}
      />

      <LunchMenuBuilderDialog
        open={openMenuBuilder}
        onOpenChange={setOpenMenuBuilder}
        menu={editingMenu}
        voteCount={editingMenu?.votes.length ?? 0}
        defaultDate={selectedDate}
        todayDate={todayDate}
        defaultDeadline={settings.voting_deadline || DEFAULT_LUNCH_SETTINGS.voting_deadline}
        onSaved={() => void loadMenus()}
      />

      <ExportOptionsDialog
        open={openExport}
        onOpenChange={setOpenExport}
        title="Export Lunch Report"
        options={[
          { id: "day", label: "Daily Roster (CSV)", icon: "excel" },
          { id: "month", label: "Monthly Summary (CSV)", icon: "excel" },
          { id: "custom", label: "Custom Period (CSV)", icon: "excel" },
        ]}
        onSelect={(id) => {
          if (id === "day") exportDaily()
          else if (id === "month") exportMonthly()
          else if (id === "custom") setOpenCustomPeriodDialog(true)
        }}
      />

      {/* Custom Period Range Selector Dialog */}
      <Dialog open={openCustomPeriodDialog} onOpenChange={setOpenCustomPeriodDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Custom Period Range</DialogTitle>
            <DialogDescription>
              Select the start and end dates to export the summary of meals and surcharges.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 text-sm">
            <div className="space-y-2">
              <Label htmlFor="custom-start">Start Date</Label>
              <Input
                id="custom-start"
                type="date"
                value={customStartDate}
                max={todayDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-end">End Date</Label>
              <Input
                id="custom-end"
                type="date"
                value={customEndDate}
                max={todayDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCustomPeriodDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void exportCustom(customStartDate, customEndDate)
                setOpenCustomPeriodDialog(false)
              }}
              disabled={!customStartDate || !customEndDate || customStartDate > customEndDate}
            >
              Export Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {activeTab === "reviews" &&
        (reviewsLoading ? (
          <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 p-12">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
            <span>Loading feedback...</span>
          </div>
        ) : reviewsError ? (
          <Card>
            <CardContent className="text-destructive p-6 text-sm">{reviewsError}</CardContent>
          </Card>
        ) : reviews.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground p-12 text-center text-sm">
              No feedback yet. Staff can review a meal from their lunch history once the day has passed.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs">
              Feedback is submitted anonymously — ratings and comments are never attributed to a staff member.
            </p>
            {reviews.map((entry) => (
              <Card key={entry.menu_id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {formatWATDate(entry.date, { weekday: "long", day: "numeric", month: "long" })}
                    </CardTitle>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-semibold text-amber-500">
                        {entry.average_rating !== null ? `${entry.average_rating.toFixed(1)} / 5` : "—"}
                      </span>
                      <span className="text-muted-foreground">
                        {entry.review_count} review{entry.review_count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                {entry.comments.length > 0 && (
                  <CardContent className="space-y-2">
                    {entry.comments.map((comment) => (
                      <div key={comment.id} className="bg-muted/30 rounded-lg border p-3 text-sm">
                        <div className="text-muted-foreground mb-1 text-xs font-semibold">{comment.rating} / 5</div>
                        <p className="whitespace-pre-wrap">{comment.comment}</p>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        ))}
    </DataTablePage>
  )
}

/**
 * Per-menu breakdown: the tally for every option with the staff behind it,
 * plus anyone who has not voted yet on a menu that is still open.
 */
/**
 * What the kitchen and Admin & HR actually need off a menu: how many portions
 * of each dish to prepare, and who gets what. Deliberately not a copy of the
 * staff poll — percentages and progress bars answer "what is winning", which
 * is not a question anybody has once voting is done.
 */
function MenuVotesPanel({ menu, totalStaff }: { menu: AdminLunchMenu; totalStaff: number }) {
  const notEating = menu.tallies.find((t) => t.option_id === NOT_EATING_OPTION_ID)
  const notEatingCount = notEating?.count ?? 0
  const noAnswer = Math.max(totalStaff - menu.votes.length, 0)

  // Each eater with their full combination, so a two-category day reads
  // "Afang + Eba" per person instead of two disconnected lists.
  const eaters = menu.votes
    .filter((vote) => vote.is_eating)
    .map((vote) => ({
      user_id: vote.user_id,
      full_name: vote.full_name,
      department: vote.department,
      combo: menu.groups
        .map((group) => group.options.find((o) => o.id === vote.selections[group.id])?.name)
        .filter(Boolean)
        .join(" + "),
    }))
    .sort((a, b) => a.combo.localeCompare(b.combo) || a.full_name.localeCompare(b.full_name))

  if (menu.groups.length === 0) {
    return (
      <div className="bg-muted/20 border-b px-6 py-4">
        <p className="text-muted-foreground text-xs">No dishes on this menu yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-muted/20 space-y-5 border-b px-6 py-4">
      {/* 1 ── the cooking list */}
      <div className="space-y-2">
        <p className="text-foreground text-xs font-bold">How many to prepare</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {menu.groups.map((group, index) => {
            const groupTallies = menu.tallies
              .filter((t) => t.group_id === group.id && t.option_id !== NOT_EATING_OPTION_ID)
              .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

            return (
              <div key={group.id} className="bg-background rounded-lg border p-3">
                {menu.groups.length > 1 && (
                  <p className="text-muted-foreground mb-2 text-[10px] font-bold tracking-wider uppercase">
                    {groupHeading(group, index)}
                  </p>
                )}
                <div className="space-y-1.5">
                  {groupTallies.map((tally) => (
                    <div key={tally.option_id} className="flex items-baseline justify-between gap-3">
                      <span className={cn("text-sm", tally.count > 0 ? "font-semibold" : "text-muted-foreground")}>
                        {tally.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-sm tabular-nums",
                          tally.count > 0 ? "text-foreground font-bold" : "text-muted-foreground/50"
                        )}
                      >
                        {tally.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 2 ── the serving list */}
      <div className="space-y-2">
        <p className="text-foreground text-xs font-bold">
          Who gets what{" "}
          <span className="text-muted-foreground font-normal">
            ({eaters.length} {eaters.length === 1 ? "person" : "people"})
          </span>
        </p>
        {eaters.length === 0 ? (
          <p className="text-muted-foreground text-xs">Nobody has chosen a meal yet.</p>
        ) : (
          <div className="bg-background divide-border max-h-64 divide-y overflow-y-auto rounded-lg border">
            {eaters.map((eater) => (
              <div key={eater.user_id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-foreground truncate text-sm font-medium">{eater.full_name}</span>
                  <div className="text-muted-foreground truncate text-[10px]">{eater.department || "General"}</div>
                </div>
                <span className="text-foreground shrink-0 text-xs font-semibold">{eater.combo || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3 ── everyone who is not being cooked for */}
      {(notEatingCount > 0 || noAnswer > 0) && (
        <div className="space-y-2">
          <p className="text-foreground text-xs font-bold">Not being cooked for</p>
          <div className="text-muted-foreground space-y-1 text-xs">
            {notEatingCount > 0 && (
              <p>
                <span className="text-foreground font-semibold">{notEatingCount}</span> said no:{" "}
                {notEating?.voters.map((v) => v.full_name).join(", ")}
              </p>
            )}
            {noAnswer > 0 && (
              <p>
                <span className="text-foreground font-semibold">{noAnswer}</span> never answered — they are not on the
                list and will not be charged.
              </p>
            )}
          </div>
        </div>
      )}

      <p className="text-muted-foreground border-t pt-2 text-xs">
        Cook for <span className="text-foreground font-semibold">{menu.eatingCount}</span>. Those{" "}
        {menu.eatingCount === 1 ? "is the person" : "are the people"} charged for lunch on this day.
      </p>
    </div>
  )
}

function EmployeeLunchExpandPanel({
  row,
  selectedMonth,
  rawLogs,
  eatingDays,
}: {
  row: LunchSummaryRow
  selectedMonth: string
  rawLogs: LunchRawLog[]
  eatingDays: string[]
}) {
  const employeeLogs = rawLogs.filter((log) => log.user_id === row.user_id)

  // Build calendar cells (dates) for this month
  const cells = buildCalendarCells(selectedMonth).filter(Boolean) as string[]
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

  // Filter days to show only eating days
  const visibleCells = cells.filter((dateStr) => {
    const d = new Date(dateStr)
    const dayName = daysOfWeek[d.getDay()]
    return eatingDays.includes(dayName)
  })

  // Format day short: e.g. "Mon, Jul 13"
  function formatDayShort(dateString: string) {
    const d = new Date(dateString)
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  }

  return (
    <div className="bg-muted/20 space-y-1 border-b px-6 py-4">
      <div className="text-muted-foreground grid grid-cols-[160px_120px_100px_120px_120px] items-center gap-3 border-b px-2 pb-2 text-[10px] font-bold tracking-wider uppercase">
        <span>Day</span>
        <span>Status</span>
        <span>Meal Price</span>
        <span>Company Subsidy</span>
        <span>Employee Surcharge</span>
      </div>
      <div className="divide-border max-h-[300px] divide-y overflow-y-auto pr-2">
        {visibleCells.map((dateStr) => {
          const log = employeeLogs.find((l) => l.date === dateStr)
          const hasEaten = !!log
          const dayName = formatDayShort(dateStr)

          return (
            <div
              key={dateStr}
              className="hover:bg-muted/40 grid grid-cols-[160px_120px_100px_120px_120px] items-center gap-3 px-2 py-2.5 text-xs transition-colors duration-150"
            >
              <span className="text-foreground font-semibold">{dayName}</span>
              <div>
                <Badge
                  className={
                    hasEaten
                      ? "border-0 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                      : "border bg-gray-100 text-gray-400"
                  }
                >
                  {hasEaten ? "Eaten" : "Skipped"}
                </Badge>
              </div>
              <span className="text-muted-foreground font-mono">₦{hasEaten ? "2,200.00" : "0.00"}</span>
              <span className="font-mono font-medium text-emerald-600">₦{hasEaten ? "1,100.00" : "0.00"}</span>
              <span className={`font-mono font-bold ${hasEaten ? "text-red-600" : "text-muted-foreground"}`}>
                ₦{hasEaten ? "1,100.00" : "0.00"}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
