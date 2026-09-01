"use client"

import { useMemo, useState, useTransition } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  MessageSquare,
  Send,
  AlertTriangle,
  Search,
  SlidersHorizontal,
  X,
  RotateCcw,
  LayoutList,
  Kanban,
  Table as TableIcon,
  ArrowUpDown,
  Filter,
  Check,
  ChevronRight,
  Flame,
  Calendar,
  User,
  Sparkles,
  ArrowRight,
  ChevronDown,
  Info,
} from "lucide-react"

import { UserTaskDetailsDialog } from "@/components/tasks/UserTaskDetailsDialog"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { TaskStatusControl, statusLabel, TaskStatusBadge } from "@/components/tasks/TaskStatusControl"
import { TASK_STATUS_CONFIG, type TaskStatus } from "@/lib/tasks/constants"
import { TASK_RATING_LABELS, TASK_WEIGHT_DEFAULT, TASK_WEIGHT_LABELS } from "@/lib/tasks/scoring"
import type { Task, TaskUserProfile } from "@/types/task"
import { PageHeader, PageWrapper } from "@/components/layout"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatFullName, cn } from "@/lib/utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"

const log = logger("task3-content")

interface Task3ContentProps {
  initialTasks: Task[]
  userId: string
  userProfile: TaskUserProfile | null
}

type ViewMode = "cards" | "table" | "board"
type SortOption = "due_date_asc" | "due_date_desc" | "priority_desc" | "created_desc" | "title_asc"

const STATUS_TABS: Array<{ id: string; label: string; icon: typeof ClipboardList; color: string }> = [
  { id: "all", label: "All", icon: ClipboardList, color: "text-foreground" },
  { id: "in_progress", label: "In Progress", icon: Clock, color: "text-sky-500" },
  { id: "pending", label: "Pending", icon: Clock, color: "text-amber-500" },
  { id: "submitted_for_review", label: "In Review", icon: Send, color: "text-purple-500" },
  { id: "completed", label: "Completed", icon: CheckCircle2, color: "text-emerald-500" },
]

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  urgent: {
    label: "Urgent",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/10 border-rose-500/30",
    dot: "bg-rose-500",
  },
  high: {
    label: "High",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    dot: "bg-amber-500",
  },
  medium: {
    label: "Medium",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30",
    dot: "bg-blue-500",
  },
  low: {
    label: "Low",
    color: "text-zinc-600 dark:text-zinc-400",
    bg: "bg-zinc-500/10 border-zinc-500/30",
    dot: "bg-zinc-400",
  },
}

function getRelativeDueInfo(dueDateStr?: string | null, status?: string) {
  if (!dueDateStr) return { text: "No deadline", isOverdue: false, isUrgent: false, color: "text-muted-foreground" }
  const due = new Date(dueDateStr)
  if (Number.isNaN(due.getTime()))
    return { text: "Invalid date", isOverdue: false, isUrgent: false, color: "text-muted-foreground" }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDay = new Date(due)
  dueDay.setHours(0, 0, 0, 0)

  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  const isTerminal = ["completed", "reassigned", "cancelled"].includes(status || "")

  if (!isTerminal && diffDays < 0) {
    const daysOver = Math.abs(diffDays)
    return {
      text: daysOver === 1 ? "Overdue (1 day)" : `Overdue (${daysOver} days)`,
      isOverdue: true,
      isUrgent: true,
      color: "text-rose-600 dark:text-rose-400 font-semibold",
    }
  }

  if (diffDays === 0) {
    return {
      text: "Due today",
      isOverdue: false,
      isUrgent: !isTerminal,
      color: !isTerminal ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground",
    }
  }

  if (diffDays === 1) {
    return {
      text: "Due tomorrow",
      isOverdue: false,
      isUrgent: false,
      color: "text-foreground font-medium",
    }
  }

  return {
    text: `Due ${formatWATDate(dueDateStr)}`,
    isOverdue: false,
    isUrgent: false,
    color: "text-muted-foreground",
  }
}

export function Task3Content({ initialTasks, userId, userProfile }: Task3ContentProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskUpdates, setTaskUpdates] = useState<
    {
      id: string
      content?: string
      update_type: string
      created_at: string
      user?: { first_name: string; last_name: string }
    }[]
  >([])
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isPostingComment, setIsPostingComment] = useState(false)
  const [isRefreshing, startRefresh] = useTransition()

  // Filters & State
  const [search, setSearch] = useState("")
  const [statusTab, setStatusTab] = useState<string>("all")
  const [priorityFilter, setPriorityFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortOption>("due_date_asc")
  const [viewMode, setViewMode] = useState<ViewMode>("cards")
  const [filtersOpen, setFiltersOpen] = useState(false)

  const supabase = createClient()

  const canReviewTask = (task: Task) => {
    const role = String(userProfile?.role || "").toLowerCase()
    if (["admin", "super_admin", "developer"].includes(role)) return true
    if (!userProfile?.is_department_lead) return false
    const leadDepartments = Array.isArray(userProfile.lead_departments) ? userProfile.lead_departments : []
    const scope = [userProfile.department, ...leadDepartments].filter(Boolean) as string[]
    return Boolean(task.department && scope.includes(task.department))
  }

  const stats = useMemo(() => {
    const total = tasks.length
    const pending = tasks.filter((t) => t.status === "pending").length
    const inProgress = tasks.filter((t) => t.status === "in_progress").length
    const submitted = tasks.filter((t) => t.status === "submitted_for_review").length
    const completed = tasks.filter((t) => t.status === "completed").length
    const overdue = tasks.filter((t) => {
      if (["completed", "reassigned", "cancelled"].includes(t.status)) return false
      return t.due_date && new Date(t.due_date).getTime() < new Date().setHours(0, 0, 0, 0)
    }).length

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

    return { total, pending, inProgress, submitted, completed, overdue, completionRate }
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()

    let result = tasks.filter((t) => {
      // Status filter
      if (statusTab === "overdue") {
        const isPast = t.due_date && new Date(t.due_date).getTime() < new Date().setHours(0, 0, 0, 0)
        if (!isPast || ["completed", "reassigned", "cancelled"].includes(t.status)) return false
      } else if (statusTab !== "all" && t.status !== statusTab) {
        return false
      }

      // Priority filter
      if (priorityFilter !== "all" && t.priority !== priorityFilter) {
        return false
      }

      // Search query
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.work_item_number || "").toLowerCase().includes(q) ||
        (t.goal_title || "").toLowerCase().includes(q) ||
        (t.department || "").toLowerCase().includes(q)
      )
    })

    // Sorting
    result = [...result].sort((a, b) => {
      if (sortBy === "due_date_asc") {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      }
      if (sortBy === "due_date_desc") {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(b.due_date).getTime() - new Date(a.due_date).getTime()
      }
      if (sortBy === "priority_desc") {
        const weights: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 }
        return (weights[b.priority] || 0) - (weights[a.priority] || 0)
      }
      if (sortBy === "created_desc") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      if (sortBy === "title_asc") {
        return a.title.localeCompare(b.title)
      }
      return 0
    })

    return result
  }, [tasks, search, statusTab, priorityFilter, sortBy])

  const loadTasks = async () => {
    try {
      const loaded = await loadUserTasks(supabase, userId, userProfile)
      setTasks(loaded)
      return loaded
    } catch (error: unknown) {
      log.error("Error loading tasks:", error)
      toast.error("Failed to load tasks")
      return null
    }
  }

  const handleRefresh = () => {
    startRefresh(async () => {
      await loadTasks()
      toast.success("Tasks refreshed")
    })
  }

  const loadTaskUpdates = async (taskId: string) => {
    try {
      const { data, error } = await supabase
        .from("task_updates")
        .select("id, content, update_type, created_at, user_id")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })

      if (error) throw error

      const rows =
        (data as
          | {
              id: string
              content?: string
              update_type: string
              created_at: string
              user_id?: string | null
            }[]
          | null) || []
      const userIds = Array.from(new Set(rows.map((entry) => entry.user_id).filter(Boolean))) as string[]
      const { data: profiles } =
        userIds.length > 0
          ? await supabase.from("profiles").select("id, first_name, last_name").in("id", userIds)
          : { data: [] }
      const profileMap = new Map(
        ((profiles as { id: string; first_name: string; last_name: string }[] | null) || []).map((profile) => [
          profile.id,
          { first_name: profile.first_name, last_name: profile.last_name },
        ])
      )

      setTaskUpdates(
        rows.map((entry) => ({
          id: entry.id,
          content: entry.content,
          update_type: entry.update_type,
          created_at: entry.created_at,
          user: entry.user_id ? profileMap.get(entry.user_id) : undefined,
        }))
      )
    } catch (error) {
      log.error("Error loading task updates:", error)
      setTaskUpdates([])
    }
  }

  const openTaskDetails = async (task: Task) => {
    setSelectedTask(task)
    await loadTaskUpdates(task.id)
    setIsDetailsOpen(true)
  }

  const postComment = async (content: string) => {
    if (!selectedTask || !content.trim()) return
    setIsPostingComment(true)
    try {
      await supabase.from("task_updates").insert({
        task_id: selectedTask.id,
        user_id: userId,
        update_type: "comment",
        content: content.trim(),
      })
      toast.success("Comment added")
      await loadTaskUpdates(selectedTask.id)
      await loadTasks()
    } catch {
      toast.error("Failed to add comment")
    } finally {
      setIsPostingComment(false)
    }
  }

  const activeFilterCount = (priorityFilter !== "all" ? 1 : 0) + (statusTab !== "all" ? 1 : 0)

  return (
    <PageWrapper maxWidth="full" background="gradient" spacing="responsive" className="pb-12">
      {/* ── 1. Page Header & View Switcher ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader
            title="My Tasks"
            description="Manage your operational deliverables, track deadlines, and progress work items."
            icon={ClipboardList}
            backLink={{ href: "/pms", label: "Back to PMS" }}
            className="mb-0 pb-0"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-xs shadow-xs"
          >
            <RotateCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          {/* View Mode Toggle for Desktop */}
          <div className="bg-muted/80 hidden items-center rounded-lg p-0.5 md:flex">
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "cards"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Card View"
            >
              <LayoutList className="h-3.5 w-3.5" />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "table"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Table View"
            >
              <TableIcon className="h-3.5 w-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "board"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Board / Kanban View"
            >
              <Kanban className="h-3.5 w-3.5" />
              Board
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. Modern Segmented Status Tabs / Filter Strip ── */}
      <div className="space-y-2">
        <div className="scrollbar-none -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1.5 sm:mx-0 sm:overflow-visible sm:px-0">
          {STATUS_TABS.map((tab) => {
            const isActive = statusTab === tab.id
            const count =
              tab.id === "all"
                ? stats.total
                : tab.id === "pending"
                  ? stats.pending
                  : tab.id === "in_progress"
                    ? stats.inProgress
                    : tab.id === "submitted_for_review"
                      ? stats.submitted
                      : stats.completed

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusTab(tab.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-2xs transition-all",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                    : "border-border bg-card/60 hover:bg-card hover:border-foreground/20 text-muted-foreground"
                )}
              >
                <tab.icon className={cn("h-3.5 w-3.5", isActive ? "text-primary-foreground" : tab.color)} />
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px]",
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-foreground/80 font-semibold"
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}

          {/* Overdue Quick Filter Pill */}
          {stats.overdue > 0 && (
            <button
              type="button"
              onClick={() => setStatusTab(statusTab === "overdue" ? "all" : "overdue")}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-2xs transition-all",
                statusTab === "overdue"
                  ? "border-rose-600 bg-rose-600 font-semibold text-white shadow-xs"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Overdue</span>
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px]",
                  statusTab === "overdue"
                    ? "bg-white/20 text-white"
                    : "bg-rose-500/20 font-bold text-rose-700 dark:text-rose-300"
                )}
              >
                {stats.overdue}
              </span>
            </button>
          )}
        </div>

        {/* Progress summary bar */}
        <div className="bg-card/70 text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-foreground font-medium">
              {stats.completed} of {stats.total} completed
            </span>
            <span>•</span>
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {stats.completionRate}% Done
            </span>
          </div>

          <div className="bg-muted h-1.5 w-28 overflow-hidden rounded-full sm:w-36">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
              style={{ width: `${stats.completionRate}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── 3. Search, Priority Filters, & Sort Bar ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search by title, description, ID, goal, department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pr-8 pl-9 text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick Priority Filter for Mobile & Desktop */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 text-xs shadow-xs">
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Priority:</span>
                <span className="font-medium capitalize">{priorityFilter === "all" ? "All" : priorityFilter}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 text-xs">
              <DropdownMenuLabel>Filter by Priority</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPriorityFilter("all")} className="flex items-center justify-between">
                <span>All Priorities</span>
                {priorityFilter === "all" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => setPriorityFilter(key)}
                  className="flex items-center justify-between"
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
                    {cfg.label}
                  </span>
                  {priorityFilter === key && <Check className="text-primary h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 text-xs shadow-xs">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Sort</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 text-xs">
              <DropdownMenuLabel>Sort Tasks</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSortBy("due_date_asc")} className="flex items-center justify-between">
                <span>Due Date (Earliest first)</span>
                {sortBy === "due_date_asc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortBy("due_date_desc")}
                className="flex items-center justify-between"
              >
                <span>Due Date (Latest first)</span>
                {sortBy === "due_date_desc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortBy("priority_desc")}
                className="flex items-center justify-between"
              >
                <span>Priority (Urgent first)</span>
                {sortBy === "priority_desc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("created_desc")} className="flex items-center justify-between">
                <span>Recently Created</span>
                {sortBy === "created_desc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("title_asc")} className="flex items-center justify-between">
                <span>Title (A-Z)</span>
                {sortBy === "title_asc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Active Filter summary & Reset */}
        <div className="text-muted-foreground flex items-center justify-between text-xs sm:justify-end sm:gap-3">
          <span>
            Showing <strong className="text-foreground">{filteredTasks.length}</strong> of {tasks.length} tasks
          </span>
          {(search || priorityFilter !== "all" || statusTab !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearch("")
                setPriorityFilter("all")
                setStatusTab("all")
              }}
              className="text-primary font-medium hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* ── 4. Main Tasks List / Cards / Board Presentation ── */}

      {/* A. MOBILE VIEW & DESKTOP CARD VIEW */}
      {(viewMode === "cards" || true) && (
        <div className={cn("space-y-3", viewMode === "cards" ? "block" : "block md:hidden")}>
          {filteredTasks.length === 0 ? (
            <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center shadow-xs">
              <div className="bg-muted text-muted-foreground rounded-full p-3">
                <ClipboardList className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-sm font-semibold">No tasks found</h3>
              <p className="text-muted-foreground mt-1 max-w-sm text-xs">
                {search || statusTab !== "all" || priorityFilter !== "all"
                  ? "No tasks match your current filter criteria. Try clearing filters or searching for something else."
                  : "You currently have no tasks assigned to you."}
              </p>
              {(search || statusTab !== "all" || priorityFilter !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("")
                    setStatusTab("all")
                    setPriorityFilter("all")
                  }}
                  className="mt-4 text-xs"
                >
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTasks.map((task) => {
                const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium
                const dueInfo = getRelativeDueInfo(task.due_date, task.status)
                const config = TASK_STATUS_CONFIG[task.status as TaskStatus] || TASK_STATUS_CONFIG.pending

                return (
                  <div
                    key={task.id}
                    onClick={() => void openTaskDetails(task)}
                    className={cn(
                      "group bg-card hover:bg-muted/10 hover:border-primary/40 relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 shadow-2xs transition-all hover:shadow-xs",
                      dueInfo.isOverdue && "border-rose-500/30 dark:border-rose-900/40"
                    )}
                  >
                    <div className="space-y-2.5">
                      {/* Top Row: Priority Badge + ID + Due Date */}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                              priority.bg,
                              priority.color
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", priority.dot)} />
                            {priority.label}
                          </span>

                          {task.work_item_number && (
                            <span className="text-muted-foreground font-mono text-[11px] font-medium">
                              #{task.work_item_number}
                            </span>
                          )}
                        </div>

                        {/* Due Date Indicator */}
                        <span className={cn("flex items-center gap-1 text-[11px]", dueInfo.color)}>
                          <Calendar className="h-3 w-3 opacity-70" />
                          {dueInfo.text}
                          {dueInfo.isOverdue && <AlertTriangle className="h-3 w-3 text-rose-600" />}
                        </span>
                      </div>

                      {/* Middle: Title & Goal / Department */}
                      <div>
                        <h4 className="text-foreground group-hover:text-primary line-clamp-2 text-sm leading-snug font-semibold transition-colors">
                          {task.title}
                        </h4>
                        {task.goal_title && (
                          <p className="text-muted-foreground mt-1 line-clamp-1 flex items-center gap-1 text-[11px]">
                            <span className="text-primary/80 font-medium">Goal:</span> {task.goal_title}
                          </p>
                        )}
                        {task.department && !task.goal_title && (
                          <p className="text-muted-foreground mt-1 text-[11px]">
                            Dept: <span className="text-foreground/80 font-medium">{task.department}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Bottom Metadata & Inline Action */}
                    <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                      {/* People & Comment Counter */}
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <span className="flex items-center gap-1 text-[11px]">
                          <User className="h-3 w-3 opacity-60" />
                          {task.assigned_by_user
                            ? formatFullName(task.assigned_by_user.first_name, task.assigned_by_user.last_name)
                            : "System"}
                        </span>

                        {(task.comment_count || 0) > 0 && (
                          <span className="bg-muted text-foreground inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                            <MessageSquare className="h-3 w-3" />
                            {task.comment_count}
                          </span>
                        )}
                      </div>

                      {/* Direct Status Changer */}
                      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                        <TaskStatusControl
                          task={task}
                          canReview={canReviewTask(task)}
                          onChanged={() => void loadTasks()}
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* B. DESKTOP FULL TABLE VIEW */}
      {viewMode === "table" && (
        <div className="bg-card hidden overflow-hidden rounded-xl border shadow-xs md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-medium tracking-wider uppercase">
                <tr>
                  <th className="w-12 px-3 py-3 text-center">S/N</th>
                  <th className="px-4 py-3">Task ID</th>
                  <th className="px-4 py-3">Deliverable / Title</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Assigned By</th>
                  <th className="px-4 py-3 text-center">Activity</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-muted-foreground py-12 text-center">
                      No tasks found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((task, index) => {
                    const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium
                    const dueInfo = getRelativeDueInfo(task.due_date, task.status)

                    return (
                      <tr
                        key={task.id}
                        onClick={() => void openTaskDetails(task)}
                        className="hover:bg-muted/40 cursor-pointer transition-colors"
                      >
                        <td className="text-muted-foreground px-3 py-3 text-center font-mono text-[11px]">
                          {index + 1}
                        </td>
                        <td className="text-foreground/80 px-4 py-3 font-mono font-medium">
                          {task.work_item_number || "—"}
                        </td>
                        <td className="max-w-md px-4 py-3">
                          <p className="text-foreground line-clamp-1 font-semibold">{task.title}</p>
                          {task.goal_title && (
                            <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px]">
                              <span className="text-primary font-medium">Goal:</span> {task.goal_title}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium",
                              priority.bg,
                              priority.color
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", priority.dot)} />
                            {priority.label}
                          </span>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <TaskStatusControl
                            task={task}
                            canReview={canReviewTask(task)}
                            onChanged={() => void loadTasks()}
                            size="sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("flex items-center gap-1 text-[11px]", dueInfo.color)}>
                            {dueInfo.text}
                            {dueInfo.isOverdue && <AlertTriangle className="h-3 w-3 text-rose-600" />}
                          </span>
                        </td>
                        <td className="text-muted-foreground px-4 py-3">
                          {task.assigned_by_user
                            ? formatFullName(task.assigned_by_user.first_name, task.assigned_by_user.last_name)
                            : "System"}
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {(task.comment_count || 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => void openTaskDetails(task)}
                              className="bg-muted hover:bg-muted/80 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
                            >
                              <MessageSquare className="h-3 w-3" />
                              {task.comment_count}
                            </button>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              void openTaskDetails(task)
                            }}
                            className="h-7 text-xs"
                          >
                            Details
                            <ChevronRight className="ml-1 h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* C. DESKTOP BOARD / KANBAN VIEW */}
      {viewMode === "board" && (
        <div className="hidden items-start gap-4 md:grid md:grid-cols-4">
          {[
            { id: "pending", title: "Pending", icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
            { id: "in_progress", title: "In Progress", icon: Clock, color: "text-sky-500", bg: "bg-sky-500/10" },
            {
              id: "submitted_for_review",
              title: "In Review",
              icon: Send,
              color: "text-purple-500",
              bg: "bg-purple-500/10",
            },
            {
              id: "completed",
              title: "Completed",
              icon: CheckCircle2,
              color: "text-emerald-500",
              bg: "bg-emerald-500/10",
            },
          ].map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.id)
            return (
              <div key={col.id} className="bg-muted/30 min-h-[400px] space-y-3 rounded-xl border p-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("rounded-md p-1", col.bg, col.color)}>
                      <col.icon className="h-3.5 w-3.5" />
                    </div>
                    <h4 className="text-xs font-semibold">{col.title}</h4>
                  </div>
                  <span className="text-muted-foreground bg-background rounded-full border px-2 py-0.5 font-mono text-xs font-bold">
                    {colTasks.length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {colTasks.length === 0 ? (
                    <p className="text-muted-foreground py-8 text-center text-xs italic">No tasks</p>
                  ) : (
                    colTasks.map((task) => {
                      const priority = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium
                      const dueInfo = getRelativeDueInfo(task.due_date, task.status)
                      return (
                        <div
                          key={task.id}
                          onClick={() => void openTaskDetails(task)}
                          className="bg-card hover:border-primary/40 cursor-pointer space-y-2 rounded-lg border p-3 shadow-2xs transition-all hover:shadow-xs"
                        >
                          <div className="flex items-center justify-between text-[10px]">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium",
                                priority.bg,
                                priority.color
                              )}
                            >
                              <span className={cn("h-1 w-1 rounded-full", priority.dot)} />
                              {priority.label}
                            </span>
                            <span className={cn("text-[10px]", dueInfo.color)}>{dueInfo.text}</span>
                          </div>

                          <p className="line-clamp-2 text-xs font-semibold">{task.title}</p>

                          <div className="text-muted-foreground flex items-center justify-between border-t pt-1 text-[11px]">
                            <span className="max-w-[100px] truncate">
                              {task.assigned_by_user ? task.assigned_by_user.first_name : "System"}
                            </span>
                            {(task.comment_count || 0) > 0 && (
                              <span className="flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" />
                                {task.comment_count}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 5. Full Task Details Modal ── */}
      <UserTaskDetailsDialog
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        selectedTask={selectedTask}
        taskUpdates={taskUpdates}
        canReview={selectedTask ? canReviewTask(selectedTask) : false}
        onChanged={async () => {
          const loaded = await loadTasks()
          if (loaded && selectedTask) {
            setSelectedTask(loaded.find((entry) => entry.id === selectedTask.id) ?? null)
          }
        }}
        onAddComment={postComment}
        isPostingComment={isPostingComment}
      />
    </PageWrapper>
  )
}
