"use client"

import { useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { logger } from "@/lib/logger"
import { ClipboardList, Clock, TrendingUp, CheckCircle2, Eye, MessageSquare } from "lucide-react"

import { UserTaskDetailsDialog } from "@/components/tasks/UserTaskDetailsDialog"
import { UserTaskCommentDialog } from "@/components/tasks/UserTaskCommentDialog"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import type { Task, TaskUserProfile } from "@/types/task"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatName } from "@/lib/utils"
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

function mapTaskStatusToHelpDeskStatus(task: Task, status: string): string {
  if (status === "completed") return "resolved"
  if (status === "in_progress") return "in_progress"
  if (status === "cancelled") return "cancelled"
  if (status === "pending") {
    return task.assignment_type === "department" ? "department_assigned" : "assigned"
  }
  return status
}

const ASSIGNMENT_TABS: DataTableTab[] = [
  { key: "individual", label: "Individual" },
  { key: "department", label: "Department" },
]

export function TasksContent({ initialTasks, userId, userProfile }: TasksContentProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskUpdates, setTaskUpdates] = useState<TaskUpdate[]>([])
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isCommentOpen, setIsCommentOpen] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [assignmentTab, setAssignmentTab] = useState("individual")
  const [newStatus, setNewStatus] = useState("")
  const supabase = createClient()

  const assignmentScopedData = useMemo(() => {
    return tasks.filter((task) =>
      assignmentTab === "department" ? task.assignment_type === "department" : task.assignment_type !== "department"
    )
  }, [tasks, assignmentTab])

  const filteredData = assignmentScopedData

  const stats = useMemo(
    () => ({
      total: filteredData.length,
      pending: filteredData.filter((t) => t.status === "pending").length,
      inProgress: filteredData.filter((t) => t.status === "in_progress").length,
      completed: filteredData.filter((t) => t.status === "completed").length,
    }),
    [filteredData]
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
    statusNote?: string,
    options?: { closeDialog?: boolean }
  ) => {
    if (!task?.id) return
    setIsSaving(true)
    try {
      const endpoint =
        task.source_type === "help_desk" && task.source_id
          ? `/api/help-desk/tickets/${task.source_id}`
          : `/api/tasks/${task.id}/status`

      const body =
        task.source_type === "help_desk" && task.source_id
          ? { status: mapTaskStatusToHelpDeskStatus(task, status), status_note: statusNote || null }
          : { status, comment: statusNote || undefined }

      const response = await apiFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Failed to update task")
      }

      toast.success("Task updated")
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

  const handleUpdateStatus = async (status: string) => {
    if (!selectedTask) return
    await updateTaskStatus(selectedTask, status, newComment.trim(), { closeDialog: true })
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
      label: "Title",
      sortable: true,
      resizable: true,
      initialWidth: 300,
      accessor: (t) => t.title,
      render: (t) => (
        <div className="flex flex-col">
          <span className="line-clamp-1 font-medium">{t.title}</span>
          <span className="text-muted-foreground text-[10px] uppercase">{t.department}</span>
        </div>
      ),
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
    },
    {
      key: "priority",
      label: "Priority",
      sortable: true,
      accessor: (t) => t.priority,
      render: (t) => (
        <Badge
          variant={t.priority === "high" || t.priority === "urgent" ? "destructive" : "outline"}
          className="capitalize"
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
      render: (t) => (
        <Badge variant={t.status === "completed" ? "default" : "secondary"} className="capitalize">
          {formatName(t.status)}
        </Badge>
      ),
    },
    {
      key: "goal",
      label: "Goal",
      sortable: true,
      accessor: (t) => t.goal_title || "",
      render: (t) =>
        t.goal_title ? (
          <span className="line-clamp-1 text-xs font-medium">{t.goal_title}</span>
        ) : (
          <span className="text-muted-foreground text-xs">Not linked</span>
        ),
      hideOnMobile: true,
    },
    {
      key: "dates",
      label: "Assigned",
      accessor: (t) => t.created_at,
      render: (t) => <span className="text-muted-foreground text-xs">{formatWATDate(t.created_at)}</span>,
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
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
    {
      key: "assignment_type",
      label: "Assignment",
      options: [
        { value: "individual", label: "Individual" },
        { value: "department", label: "Department" },
      ],
    },
    {
      key: "priority",
      label: "Priority",
      options: [
        { value: "low", label: "Low" },
        { value: "normal", label: "Normal" },
        { value: "high", label: "High" },
        { value: "urgent", label: "Urgent" },
      ],
    },
  ]

  return (
    <DataTablePage
      title="Task Management"
      description="Track your daily work, department tasks, and service tickets."
      icon={ClipboardList}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      tabs={ASSIGNMENT_TABS}
      activeTab={assignmentTab}
      onTabChange={setAssignmentTab}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Total Assigned"
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
            icon={TrendingUp}
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
        </div>
      }
    >
      <DataTable<Task>
        data={filteredData}
        columns={columns}
        getRowId={(t) => t.id}
        filters={filters}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search task title, ID or department..."
        searchFn={(t, q) => `${t.work_item_number} ${t.title} ${t.department}`.toLowerCase().includes(q)}
        rowActions={[
          {
            label: "View Details",
            icon: Eye,
            onClick: (t) => openTaskDetails(t),
          },
          {
            label: "Add Comment",
            icon: MessageSquare,
            onClick: (t) => openTaskCommentDialog(t),
          },
        ]}
        expandable={{
          render: (t) => (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Description</p>
                <p className="mt-1 text-sm">{t.description || "No description provided."}</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Update Status</span>
                  <div className="w-40">
                    <Select
                      value={t.status}
                      onValueChange={(value) => {
                        void updateTaskStatus(t, value)
                      }}
                      disabled={isSaving || t.assignment_type === "department"}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {t.assignment_type === "department" && (
                  <p className="text-[11px] text-yellow-600 dark:text-yellow-400">
                    Department task status can only be updated by leads from Admin Tasks.
                  </p>
                )}
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Assignment</span>
                  <span className="font-medium capitalize">{t.assignment_type || "individual"}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Source</span>
                  <span className="font-medium">{formatName(t.source_type || "manual")}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Goal</span>
                  <span className="max-w-[65%] truncate font-medium">{t.goal_title || "Not linked"}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">Due Date</span>
                  <span className="font-medium">{t.due_date ? formatWATDate(t.due_date) : "Not set"}</span>
                </div>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(t) => (
          <div
            className="bg-card hover:border-primary cursor-pointer rounded-xl border-2 p-4 transition-all"
            onClick={() => openTaskDetails(t)}
          >
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-[10px] font-bold">{t.work_item_number}</span>
                {(t.comment_count || 0) > 0 && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <MessageSquare className="h-3 w-3" />
                    {t.comment_count}
                  </Badge>
                )}
              </div>
              <Badge
                variant={t.priority === "high" || t.priority === "urgent" ? "destructive" : "outline"}
                className="text-[10px]"
              >
                {t.priority}
              </Badge>
            </div>
            <h4 className="line-clamp-1 text-sm font-semibold">{t.title}</h4>
            <p className="text-muted-foreground mt-1 mb-3 text-[10px] uppercase">{t.department}</p>
            <div className="flex items-center justify-between border-t pt-2">
              <Badge variant={t.status === "completed" ? "default" : "secondary"} className="text-[10px]">
                {formatName(t.status)}
              </Badge>
              <span className="text-muted-foreground text-[10px]">{formatWATDate(t.created_at)}</span>
            </div>
          </div>
        )}
        urlSync
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
          if (!newComment.trim() || !selectedTask) return
          setIsSaving(true)
          try {
            const response = await apiFetch(`/api/tasks/${selectedTask.id}/comments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: newComment.trim() }),
            })
            if (!response.ok) throw new Error("Failed to post comment")
            setNewComment("")
            await Promise.all([loadTaskUpdates(selectedTask.id), loadTasks()])
            toast.success("Comment posted")
          } catch (_error) {
            toast.error("Failed to post comment")
          } finally {
            setIsSaving(false)
          }
        }}
      />
    </DataTablePage>
  )
}
