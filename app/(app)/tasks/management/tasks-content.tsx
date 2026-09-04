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
  CalendarDays,
  Target,
} from "lucide-react"

import { UserTaskDetailsDialog } from "@/components/tasks/UserTaskDetailsDialog"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import { Button } from "@/components/ui/button"
import { TaskStatusControl } from "@/components/tasks/TaskStatusControl"
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

/** Read-only status pill for the row list and cards, where the whole row is
 * already the tap target and an inline control inside it would fight for taps.
 * The editable `TaskStatusControl` lives in the table cell and the detail sheet. */
function TaskStatusPill({ status }: { status: string }) {
  return (
    <Badge
      variant={
        status === "completed"
          ? "default"
          : ["failed", "cancelled", "unable_to_complete"].includes(status)
            ? "destructive"
            : "outline"
      }
      className="text-[10px] whitespace-nowrap capitalize"
    >
      {formatName(status)}
    </Badge>
  )
}

/** Past its deadline and still actionable - a cancelled task is not overdue. */
function isTaskOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (["completed", "reassigned", "cancelled"].includes(task.status)) return false
  return new Date(task.due_date).getTime() < new Date().setHours(0, 0, 0, 0)
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
      overdue: tasks.filter(isTaskOverdue).length,
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
        const isOverdue = isTaskOverdue(t)
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
      backLink={{ href: "/profile", label: "Back to Home" }}
      spacing="tight"
      stats={
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
          <StatCard
            variant="compact"
            title="Total Tasks"
            value={stats.total}
            icon={ClipboardList}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
            className="hidden sm:block"
          />
          <StatCard
            variant="compact"
            title="Pending"
            value={stats.pending}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="In Progress"
            value={stats.inProgress}
            icon={Clock}
            iconBgColor="bg-sky-500/10"
            iconColor="text-sky-500"
          />
          <StatCard
            variant="compact"
            title="Submitted"
            value={stats.submitted}
            icon={Send}
            iconBgColor="bg-purple-500/10"
            iconColor="text-purple-500"
            className="hidden sm:block"
          />
          <StatCard
            variant="compact"
            title="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
            className={stats.overdue > 0 ? "hidden sm:block" : undefined}
          />
          {/* Only when there is something to answer for — a permanent "Overdue 0"
              is noise, and the card is the page's one alarm. */}
          {stats.overdue > 0 && (
            <StatCard
              variant="compact"
              title="Overdue"
              value={stats.overdue}
              icon={AlertTriangle}
              iconBgColor="bg-rose-500/10"
              iconColor="text-rose-500"
            />
          )}
        </div>
      }
    >
      <DataTable<Task>
        data={tasks}
        columns={columns}
        getRowId={(t) => t.id}
        searchPlaceholder="Search task title, description, ID..."
        // `q` is already trimmed and lowercased by DataTable.
        searchFn={(task, q) =>
          `${task.title} ${task.description || ""} ${task.work_item_number || ""} ${task.goal_title || ""}`
            .toLowerCase()
            .includes(q)
        }
        filters={filters}
        pagination={{ pageSize: 25 }}
        stickyToolbar
        viewToggle
        contactsView
        // Eight columns are worth a table where they fit and unreadable where they
        // do not, so the opening view follows the width.
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          // Overdue outranks priority: a late task needs answering whatever its
          // priority was when it was set.
          accentClass: (t) =>
            isTaskOverdue(t) ? "bg-rose-500" : ["high", "urgent"].includes(t.priority) ? "bg-amber-500" : undefined,
          title: (t) => t.title,
          subtitle: (t) =>
            [
              t.work_item_number || null,
              t.due_date ? `Due ${formatWATDate(t.due_date)}` : "No deadline",
              (t.comment_count || 0) > 0 ? `${t.comment_count} comment${t.comment_count === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          trailing: (t) => <TaskStatusPill status={t.status} />,
          detail: {
            title: (t) => t.title,
            subtitle: (t) => t.work_item_number || undefined,
            badges: (t) => (
              <>
                <TaskStatusPill status={t.status} />
                <Badge variant="outline" className="text-[10px] capitalize">
                  {t.priority}
                </Badge>
              </>
            ),
            fields: (t) => [
              { label: "Item #", value: t.work_item_number || "-", copyable: true },
              { label: "Status", value: t.status.replace(/_/g, " ") },
              { label: "Priority", value: t.priority },
              { label: "Due Date", value: t.due_date ? formatWATDate(t.due_date) : "No deadline" },
              {
                label: "Assignee",
                value: t.assigned_to_user ? `${t.assigned_to_user.first_name} ${t.assigned_to_user.last_name}` : "-",
              },
              { label: "Department", value: t.department || t.assigned_to_user?.department || "-" },
              { label: "Description", value: t.description || null, fullWidth: true },
            ],
            actions: (t) => [
              {
                label: "View Full Details",
                onClick: () => void openTaskDetails(t),
              },
            ],
          },
        }}
        cardRenderer={(t) => (
          <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-foreground line-clamp-2 text-sm font-semibold">{t.title}</span>
                <span className="text-muted-foreground block font-mono text-xs">{t.work_item_number || "---"}</span>
              </div>
              <TaskStatusPill status={t.status} />
            </div>
            <div className="text-muted-foreground grid gap-1 text-xs">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span className={isTaskOverdue(t) ? "text-destructive font-semibold" : undefined}>
                  {t.due_date ? formatWATDate(t.due_date) : "No deadline"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t.goal_title || "Ad-Hoc / Operational"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="capitalize">{t.priority} priority</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No tasks"
        emptyDescription="Tasks assigned to you will appear here."
        emptyIcon={ClipboardList}
        skeletonRows={6}
        urlSync
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
