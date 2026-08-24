"use client"

import { useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { ClipboardList, Clock, CheckCircle2, MessageSquare, Send, AlertTriangle } from "lucide-react"

import { UserTaskDetailsDialog } from "@/components/tasks/UserTaskDetailsDialog"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import { Button } from "@/components/ui/button"
import { TaskStatusControl } from "@/components/tasks/TaskStatusControl"
import { TASK_RATING_LABELS, TASK_WEIGHT_DEFAULT, TASK_WEIGHT_LABELS } from "@/lib/tasks/scoring"
import type { Task, TaskUserProfile } from "@/types/task"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { formatName, formatFullName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

export type { Task, TaskUserProfile } from "@/types/task"

const log = logger("tasks-management-tasks-content")

export interface TaskUpdate {
  id: string
  content?: string
  update_type: string
  created_at: string
  user?: {
    first_name: string
    last_name: string
  }
}

type TaskUpdateRow = Omit<TaskUpdate, "user"> & {
  user_id?: string | null
  user?: Array<{ first_name: string; last_name: string }> | { first_name: string; last_name: string } | null
}

interface TasksContentProps {
  initialTasks: Task[]
  userId: string
  userProfile: TaskUserProfile | null
}

export function TasksContent({ initialTasks, userId, userProfile }: TasksContentProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskUpdates, setTaskUpdates] = useState<TaskUpdate[]>([])
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isPostingComment, setIsPostingComment] = useState(false)
  const supabase = createClient()

  // Whether this user may approve, rate, reject or reassign a given task. The
  // control offers those decisions inline, so it needs to know per row.
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

      const rows = (data as TaskUpdateRow[] | null) || []
      const userIds = Array.from(new Set(rows.map((entry) => entry.user_id).filter(Boolean))) as string[]
      const { data: profiles } =
        userIds.length > 0
          ? await supabase.from("profiles").select("id, first_name, last_name").in("id", userIds)
          : { data: [] }
      const profileMap = new Map(
        ((profiles as Array<{ id: string; first_name: string; last_name: string }> | null) || []).map((profile) => [
          profile.id,
          { first_name: profile.first_name, last_name: profile.last_name },
        ])
      )

      const normalizedUpdates = rows.map((entry) => ({
        id: entry.id,
        content: entry.content,
        update_type: entry.update_type,
        created_at: entry.created_at,
        user: entry.user_id ? profileMap.get(entry.user_id) : undefined,
      }))
      setTaskUpdates(normalizedUpdates)
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

  // Status changes go through TaskStatusControl directly against the API now
  // — this used to be a second path (updateTaskStatus/handleUpdateStatus) that
  // existed only to serve the old "My Actions" tab, which no longer exists.

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

  const columns: DataTableColumn<Task>[] = [
    {
      key: "work_item_number",
      label: "Task ID",
      sortable: true,
      accessor: (t) => t.work_item_number,
      render: (t) => <span className="font-mono text-xs font-bold">{t.work_item_number || "---"}</span>,
      hideOnMobile: true,
    },
    {
      key: "title",
      label: "Task",
      sortable: true,
      resizable: true,
      initialWidth: 300,
      accessor: (t) => t.title,
      render: (t) => (
        <div className="flex flex-col">
          <span className="line-clamp-1 font-medium">{t.title}</span>
          {t.goal_title && <span className="text-muted-foreground line-clamp-1 text-[10px]">{t.goal_title}</span>}
        </div>
      ),
    },
    {
      key: "goal",
      label: "Strategic Goal",
      sortable: true,
      accessor: (t) => t.goal_title || "",
      render: (t) =>
        t.goal_title ? (
          <span className="text-foreground line-clamp-1 text-xs font-medium">{t.goal_title}</span>
        ) : (
          <span className="text-muted-foreground text-xs italic">Ad-Hoc / Operational</span>
        ),
      hideOnMobile: true,
    },
    {
      key: "priority",
      label: "Priority",
      sortable: true,
      accessor: (t) => t.priority,
      render: (t) => (
        <Badge
          variant={t.priority === "high" || t.priority === "urgent" ? "destructive" : "outline"}
          className="text-[11px] capitalize"
        >
          {t.priority}
        </Badge>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (t) => t.status,
      // Changed straight from the row: opening a modal to move a task through
      // three states was the slowest part of the whole workflow.
      render: (t) => (
        <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <TaskStatusControl task={t} canReview={canReviewTask(t)} onChanged={() => void loadTasks()} size="sm" />
        </div>
      ),
    },
    {
      key: "due_date",
      label: "Due Date",
      sortable: true,
      accessor: (t) => t.due_date || "",
      render: (t) => {
        const isOverdue =
          t.due_date &&
          new Date(t.due_date).getTime() < new Date().setHours(0, 0, 0, 0) &&
          !["completed", "reassigned", "cancelled"].includes(t.status)
        return (
          <div className="flex items-center gap-1.5 text-xs">
            <span className={isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"}>
              {t.due_date ? formatWATDate(t.due_date) : "No deadline"}
            </span>
            {isOverdue && <AlertTriangle className="text-destructive h-3 w-3" />}
          </div>
        )
      },
    },
    {
      key: "assigned_by",
      label: "Assigned By",
      accessor: (t) => t.assigned_by_user?.first_name || "",
      render: (t) => (
        <span className="text-muted-foreground text-xs">
          {t.assigned_by_user ? formatFullName(t.assigned_by_user.first_name, t.assigned_by_user.last_name) : "System"}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "comments",
      label: "Comments",
      sortable: true,
      accessor: (t) => t.comment_count || 0,
      // Comments live in Details → Activity now, not a second dialog reached
      // from a different button. This is one click through to that tab.
      render: (t) =>
        (t.comment_count || 0) > 0 ? (
          <button
            type="button"
            className="inline-flex"
            onClick={(event) => {
              event.stopPropagation()
              void openTaskDetails(t)
            }}
            title="View comments"
          >
            <Badge variant="outline" className="gap-1 text-xs">
              <MessageSquare className="h-3 w-3" />
              {t.comment_count}
            </Badge>
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        ),
      hideOnMobile: true,
    },
  ]

  const filters: DataTableFilter<Task>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "pending", label: "Pending" },
        { value: "in_progress", label: "In Progress" },
        { value: "submitted_for_review", label: "Submitted for Review" },
        { value: "completed", label: "Completed" },
        { value: "unable_to_complete", label: "Unable to Complete" },
        { value: "reassigned", label: "Reassigned" },
        { value: "failed", label: "Failed" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
    {
      key: "priority",
      label: "Priority",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" },
      ],
    },
  ]

  return (
    <DataTablePage
      title="My Tasks"
      description="Manage your operational tasks, track deadlines, and submit completed work for review."
      icon={ClipboardList}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
          <StatCard
            title="Total Tasks"
            value={stats.total}
            icon={ClipboardList}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="In Progress"
            value={stats.inProgress}
            icon={Clock}
            iconBgColor="bg-sky-500/10"
            iconColor="text-sky-500"
          />
          <StatCard
            title="Submitted"
            value={stats.submitted}
            icon={Send}
            iconBgColor="bg-purple-500/10"
            iconColor="text-purple-500"
          />
          <StatCard
            title="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
        </div>
      }
    >
      <DataTable<Task>
        data={tasks}
        columns={columns}
        getRowId={(t) => t.id}
        searchPlaceholder="Search task title, description, ID..."
        searchFn={(task, q) =>
          task.title.toLowerCase().includes(q.toLowerCase()) ||
          (task.description || "").toLowerCase().includes(q.toLowerCase()) ||
          (task.work_item_number || "").toLowerCase().includes(q.toLowerCase()) ||
          (task.goal_title || "").toLowerCase().includes(q.toLowerCase())
        }
        filters={filters}
        rowActions={[
          {
            label: "Open Details",
            onClick: (task) => void openTaskDetails(task),
          },
        ]}
        expandable={{
          render: (task) => (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Description</p>
                <p className="mt-1 text-sm">{task.description || "No description provided."}</p>
                <div className="text-muted-foreground mt-3 space-y-1 text-xs">
                  <p>
                    Assigned to{" "}
                    {task.assigned_to_user
                      ? formatFullName(task.assigned_to_user.first_name, task.assigned_to_user.last_name)
                      : task.assignment_type === "department"
                        ? `${task.department || "the department"} (whole department)`
                        : "nobody"}
                  </p>
                  <p>
                    Starts {task.task_start_date ? formatWATDate(task.task_start_date) : "-"} · Due{" "}
                    {task.task_end_date || task.due_date
                      ? formatWATDate((task.task_end_date || task.due_date) as string)
                      : "no deadline"}
                  </p>
                  {task.group_id && <p>Part of a task assigned to several people.</p>}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Weight</span>
                  <span className="font-medium">
                    {task.weight ?? TASK_WEIGHT_DEFAULT} — {TASK_WEIGHT_LABELS[task.weight ?? TASK_WEIGHT_DEFAULT]}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Rating</span>
                  <span className="font-medium">
                    {task.rating ? `${task.rating}/5 — ${TASK_RATING_LABELS[task.rating]}` : "Not yet rated"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Goal</span>
                  <span className="max-w-[65%] truncate font-medium">{task.goal_title || "Not linked"}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Corporate KPI</span>
                  <span className="max-w-[65%] truncate font-medium">{task.kpi_measure || "Not linked"}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full text-xs"
                  onClick={() => void openTaskDetails(task)}
                >
                  <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                  Comments &amp; activity
                  {(task.comment_count || 0) > 0 ? ` (${task.comment_count})` : ""}
                </Button>
              </div>
            </div>
          ),
        }}
      />

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
    </DataTablePage>
  )
}
