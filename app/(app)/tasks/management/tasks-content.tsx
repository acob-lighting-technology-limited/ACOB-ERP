"use client"

import { useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { ClipboardList, Clock, CheckCircle2, MessageSquare, Send, AlertTriangle } from "lucide-react"

import { UserTaskDetailsDialog } from "@/components/tasks/UserTaskDetailsDialog"
import { UserTaskCommentDialog } from "@/components/tasks/UserTaskCommentDialog"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import type { Task, TaskUserProfile } from "@/types/task"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { formatName, formatFullName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"
import { TASK_STATUS_CONFIG, type TaskStatus } from "@/lib/tasks/constants"

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
  const [isCommentOpen, setIsCommentOpen] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [newStatus, setNewStatus] = useState("")
  const supabase = createClient()

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
    setNewStatus(task.status)
    setNewComment("")
    await loadTaskUpdates(task.id)
    setIsDetailsOpen(true)
  }

  const openTaskCommentDialog = async (task: Task) => {
    setSelectedTask(task)
    setNewComment("")
    await loadTaskUpdates(task.id)
    setIsCommentOpen(true)
  }

  const updateTaskStatus = async (
    task: Task,
    status: string,
    reasonOrNote?: string,
    options?: { closeDialog?: boolean }
  ) => {
    if (!task?.id) return
    setIsSaving(true)
    try {
      const endpoint = `/api/tasks/${task.id}/status`
      const body = {
        status,
        comment: status === "submitted_for_review" ? reasonOrNote : undefined,
        reason: status === "unable_to_complete" ? reasonOrNote : undefined,
      }

      const response = await apiFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Failed to update task")
      }

      toast.success("Task updated successfully")
      await loadTasks()
      setSelectedTask((prev) => (prev && prev.id === task.id ? { ...prev, status } : prev))
      if (options?.closeDialog) {
        setIsDetailsOpen(false)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status")
    } finally {
      setIsSaving(false)
    }
  }

  const handleUpdateStatus = async (status: string, reason?: string) => {
    if (!selectedTask) return
    await updateTaskStatus(selectedTask, status, reason || newComment.trim(), { closeDialog: true })
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
      label: "Title & Department",
      sortable: true,
      resizable: true,
      initialWidth: 280,
      accessor: (t) => t.title,
      render: (t) => (
        <div className="flex flex-col">
          <span className="line-clamp-1 font-medium">{t.title}</span>
          <span className="text-muted-foreground text-[10px] uppercase">{t.department || "General"}</span>
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
      render: (t) => {
        const cfg = TASK_STATUS_CONFIG[t.status as TaskStatus] || TASK_STATUS_CONFIG.pending
        return (
          <Badge variant={cfg.badgeVariant} className={`text-[11px] capitalize ${cfg.color}`}>
            {cfg.label}
          </Badge>
        )
      },
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
      render: (t) =>
        (t.comment_count || 0) > 0 ? (
          <button
            type="button"
            className="inline-flex"
            onClick={(event) => {
              event.stopPropagation()
              void openTaskCommentDialog(t)
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
          {
            label: "Add Comment",
            onClick: (task) => void openTaskCommentDialog(task),
          },
        ]}
      />

      <UserTaskDetailsDialog
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        selectedTask={selectedTask}
        taskUpdates={taskUpdates}
        newStatus={newStatus}
        isSaving={isSaving}
        onUpdateStatus={handleUpdateStatus}
      />

      <UserTaskCommentDialog
        open={isCommentOpen}
        onOpenChange={setIsCommentOpen}
        selectedTask={selectedTask}
        taskUpdates={taskUpdates}
        newComment={newComment}
        setNewComment={setNewComment}
        isSaving={isSaving}
        onAddComment={async () => {
          if (!selectedTask || !newComment.trim()) return
          setIsSaving(true)
          try {
            await supabase.from("task_updates").insert({
              task_id: selectedTask.id,
              user_id: userId,
              update_type: "comment",
              content: newComment.trim(),
            })
            toast.success("Comment added")
            setNewComment("")
            await loadTaskUpdates(selectedTask.id)
            await loadTasks()
          } catch (e) {
            toast.error("Failed to add comment")
          } finally {
            setIsSaving(false)
          }
        }}
      />
    </DataTablePage>
  )
}
