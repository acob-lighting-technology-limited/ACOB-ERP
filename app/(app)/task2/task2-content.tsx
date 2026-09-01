"use client"

import { useMemo, useState } from "react"
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
} from "lucide-react"

import { UserTaskDetailsDialog } from "@/components/tasks/UserTaskDetailsDialog"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { TaskStatusControl } from "@/components/tasks/TaskStatusControl"
import { TASK_STATUS_CONFIG } from "@/lib/tasks/constants"
import type { Task, TaskUserProfile } from "@/types/task"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatFullName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"

const log = logger("task2-content")

interface Task2ContentProps {
  initialTasks: Task[]
  userId: string
  userProfile: TaskUserProfile | null
}

const STATUS_OPTIONS = Object.entries(TASK_STATUS_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label }))
const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
]

export function Task2Content({ initialTasks, userId, userProfile }: Task2ContentProps) {
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
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [priorityFilter, setPriorityFilter] = useState<string>("all")
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

  const stats = useMemo(
    () => ({
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      submitted: tasks.filter((t) => t.status === "submitted_for_review").length,
      completed: tasks.filter((t) => t.status === "completed").length,
    }),
    [tasks]
  )

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.work_item_number || "").toLowerCase().includes(q) ||
        (t.goal_title || "").toLowerCase().includes(q)
      )
    })
  }, [tasks, search, statusFilter, priorityFilter])

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (priorityFilter !== "all" ? 1 : 0)

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

  const isOverdue = (t: Task) =>
    Boolean(
      t.due_date &&
        new Date(t.due_date).getTime() < new Date().setHours(0, 0, 0, 0) &&
        !["completed", "reassigned", "cancelled"].includes(t.status)
    )

  const filterSheet = (
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 shrink-0 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>Filter tasks</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-medium">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-medium">Priority</label>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <SheetFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              setStatusFilter("all")
              setPriorityFilter("all")
            }}
          >
            Clear
          </Button>
          <SheetClose asChild>
            <Button className="flex-1">Apply</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader title="My Tasks" icon={ClipboardList} backLink={{ href: "/pms", label: "Back" }} />

      {/* Stats: one horizontally-scrollable row instead of a tall 2-column grid */}
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:overflow-visible sm:px-0">
        <StatCard
          title="Total"
          value={stats.total}
          icon={ClipboardList}
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
          variant="compact"
          className="min-w-[8.5rem] shrink-0 snap-start sm:min-w-0"
        />
        <StatCard
          title="Pending"
          value={stats.pending}
          icon={Clock}
          iconBgColor="bg-amber-500/10"
          iconColor="text-amber-500"
          variant="compact"
          className="min-w-[8.5rem] shrink-0 snap-start sm:min-w-0"
        />
        <StatCard
          title="In Progress"
          value={stats.inProgress}
          icon={Clock}
          iconBgColor="bg-sky-500/10"
          iconColor="text-sky-500"
          variant="compact"
          className="min-w-[8.5rem] shrink-0 snap-start sm:min-w-0"
        />
        <StatCard
          title="Submitted"
          value={stats.submitted}
          icon={Send}
          iconBgColor="bg-purple-500/10"
          iconColor="text-purple-500"
          variant="compact"
          className="min-w-[8.5rem] shrink-0 snap-start sm:min-w-0"
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          iconBgColor="bg-emerald-500/10"
          iconColor="text-emerald-500"
          variant="compact"
          className="min-w-[8.5rem] shrink-0 snap-start sm:min-w-0"
        />
      </div>

      {/* Search + a single filter trigger, one row, no stacked dropdowns */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9 pl-10"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {filterSheet}
      </div>

      <p className="text-muted-foreground text-xs">
        {filteredTasks.length} of {tasks.length} task{tasks.length === 1 ? "" : "s"}
      </p>

      {/* Mobile: stacked cards, full task title, no clipped columns */}
      <div className="space-y-2.5 md:hidden">
        {filteredTasks.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">No tasks match.</CardContent>
          </Card>
        ) : (
          filteredTasks.map((task) => {
            const overdue = isOverdue(task)
            return (
              <Card key={task.id} className="cursor-pointer" onClick={() => void openTaskDetails(task)}>
                <CardContent className="space-y-2.5 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm leading-snug font-medium">{task.title}</p>
                      {task.goal_title && (
                        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px]">{task.goal_title}</p>
                      )}
                    </div>
                    <Badge
                      variant={task.priority === "high" || task.priority === "urgent" ? "destructive" : "outline"}
                      className="shrink-0 text-[10px] capitalize"
                    >
                      {task.priority}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={
                        overdue ? "text-destructive flex items-center gap-1 font-semibold" : "text-muted-foreground"
                      }
                    >
                      {task.due_date ? formatWATDate(task.due_date) : "No deadline"}
                      {overdue && <AlertTriangle className="h-3 w-3" />}
                    </span>
                    {(task.comment_count || 0) > 0 && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <MessageSquare className="h-3 w-3" />
                        {task.comment_count}
                      </Badge>
                    )}
                  </div>

                  <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                    <TaskStatusControl
                      task={task}
                      canReview={canReviewTask(task)}
                      onChanged={() => void loadTasks()}
                      size="sm"
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Desktop / tablet: real table, no columns crammed below their breakpoint */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/80 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Due date</th>
                <th className="px-4 py-2.5 font-medium">Assigned by</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground py-10 text-center text-sm">
                    No tasks match.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => {
                  const overdue = isOverdue(task)
                  return (
                    <tr
                      key={task.id}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => void openTaskDetails(task)}
                    >
                      <td className="max-w-[22rem] px-4 py-2.5">
                        <p className="line-clamp-1 font-medium">{task.title}</p>
                        {task.goal_title && (
                          <p className="text-muted-foreground line-clamp-1 text-[11px]">{task.goal_title}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={task.priority === "high" || task.priority === "urgent" ? "destructive" : "outline"}
                          className="text-[11px] capitalize"
                        >
                          {task.priority}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <TaskStatusControl
                          task={task}
                          canReview={canReviewTask(task)}
                          onChanged={() => void loadTasks()}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            overdue
                              ? "text-destructive flex items-center gap-1 text-xs font-semibold"
                              : "text-muted-foreground text-xs"
                          }
                        >
                          {task.due_date ? formatWATDate(task.due_date) : "No deadline"}
                          {overdue && <AlertTriangle className="h-3 w-3" />}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-muted-foreground text-xs">
                          {task.assigned_by_user
                            ? formatFullName(task.assigned_by_user.first_name, task.assigned_by_user.last_name)
                            : "System"}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

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
