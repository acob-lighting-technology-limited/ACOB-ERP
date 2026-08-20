"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { formatName, formatFullName } from "@/lib/utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import {
  ClipboardList,
  Plus,
  ArrowRight,
  Pencil,
  Trash2,
  Calendar,
  User,
  Target,
  CheckCircle2,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Send,
} from "lucide-react"
import { isAssignableProfile } from "@/lib/workforce/assignment-policy"
import { logger } from "@/lib/logger"
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog"
import type { TaskFormState } from "@/components/tasks/TaskFormDialog"
import { TaskDeleteDialog } from "@/components/tasks/TaskDeleteDialog"
import { TaskReviewDecisionDialog } from "@/components/tasks/TaskReviewDecisionDialog"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import type { Task } from "@/types/task"
import { apiFetch } from "@/lib/api-client"
import {
  filterByDepartments,
  buildDepartmentLeadMap,
  validateTaskForm,
  sendUpdateNotifications,
  sendCreateNotifications,
} from "./tasks-content-utils"
import { filterAssignableTaskDepartments, filterAssignableTaskUsers } from "@/lib/tasks/assignment-scope"
import { TASK_STATUS_CONFIG, type TaskStatus } from "@/lib/tasks/constants"

const log = logger("tasks-management-admin-tasks-content")

export type { Task } from "@/types/task"

export interface employee {
  id: string
  first_name: string
  last_name: string
  company_email: string
  department: string
  employment_status?: string | null
  is_department_lead?: boolean
  lead_departments?: string[] | null
}

export interface UserProfile {
  id: string
  role: string
  department?: string | null
  is_department_lead?: boolean
  lead_departments?: string[]
  managed_departments?: string[]
  is_global_task_assigner?: boolean
}

interface GoalFilterOption {
  id: string
  title: string
}

interface AdminTasksContentProps {
  initialTasks: Task[]
  initialemployee: employee[]
  initialDepartments: string[]
  initialGoals?: GoalFilterOption[]
  userProfile: UserProfile
  initialGoalId?: string
}

const INITIAL_TASK_FORM: TaskFormState = {
  title: "",
  description: "",
  priority: "medium",
  status: "pending",
  assigned_to: "",
  department: "",
  due_date: "",
  assignment_type: "individual",
  assigned_users: [],
  project_id: "",
  goal_id: "",
  task_start_date: "",
  task_end_date: "",
}

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "submitted_for_review", label: "Submitted for Review" },
  { value: "completed", label: "Completed" },
  { value: "unable_to_complete", label: "Unable to Complete" },
  { value: "reassigned", label: "Reassigned" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
]

export function AdminTasksContent({
  initialTasks,
  initialemployee,
  initialDepartments,
  initialGoals = [],
  userProfile,
  initialGoalId = "",
}: AdminTasksContentProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [employee] = useState<employee[]>(initialemployee)
  const assignerProfile = {
    id: userProfile.id,
    role: userProfile.role,
    department: userProfile.department || null,
    is_department_lead: userProfile.is_department_lead ?? false,
    lead_departments: userProfile.lead_departments ?? [],
    isAdminLike: userProfile.is_global_task_assigner,
  }
  const activeEmployees = employee.filter((member) => isAssignableProfile(member, { allowLegacyNullStatus: true }))
  const scopedAssignableEmployees = filterAssignableTaskUsers(assignerProfile, activeEmployees)
  const assignableEmployees = scopedAssignableEmployees.length > 0 ? scopedAssignableEmployees : activeEmployees
  const [departments] = useState<string[]>(initialDepartments)
  const goals = useMemo(() => (Array.isArray(initialGoals) ? initialGoals : []), [initialGoals])
  const departmentOptions = useMemo(() => (Array.isArray(departments) ? departments : []), [departments])
  const scopedAssignableDepartments = filterAssignableTaskDepartments(assignerProfile, departments)
  const [isLoading, setIsLoading] = useState(false)

  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)
  const [reviewTask, setReviewTask] = useState<Task | null>(null)
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false)

  const [taskForm, setTaskForm] = useState<TaskFormState>(INITIAL_TASK_FORM)
  const consumedInitialGoalIdRef = useRef("")

  const scopedDepartments = userProfile.is_global_task_assigner
    ? []
    : (userProfile.managed_departments ?? userProfile.lead_departments ?? [])

  useEffect(() => {
    if (!initialGoalId || consumedInitialGoalIdRef.current === initialGoalId) return
    consumedInitialGoalIdRef.current = initialGoalId
    setSelectedTask(null)
    setTaskForm({ ...INITIAL_TASK_FORM, goal_id: initialGoalId })
    setIsTaskDialogOpen(true)
  }, [initialGoalId])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const res = await apiFetch("/api/tasks", { cache: "no-store" })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load tasks")
      const json = await res.json()
      let result = (json.data || []) as Task[]
      if (userProfile?.is_department_lead && !userProfile.is_global_task_assigner && scopedDepartments.length > 0) {
        result = result.filter((task) => {
          if (task.assignment_type === "individual" && task.assigned_to === userProfile.id) return true
          return filterByDepartments([task], scopedDepartments).length > 0
        })
      }
      setTasks(result)
    } catch (error: unknown) {
      log.error("Error loading data:", error)
      toast.error("Failed to reload tasks")
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenTaskDialog = (task?: Task) => {
    if (task) {
      setSelectedTask(task)
      setTaskForm({
        title: task.title,
        description: task.description || "",
        priority: task.priority,
        status: task.status,
        assigned_to: task.assigned_to || "",
        department: task.department || "",
        due_date: task.due_date ? task.due_date.split("T")[0] : "",
        assignment_type: task.assignment_type || "individual",
        assigned_users: [],
        project_id: "",
        goal_id: task.goal_id || "",
        task_start_date: task.task_start_date ? task.task_start_date.split("T")[0] : "",
        task_end_date: task.task_end_date ? task.task_end_date.split("T")[0] : "",
      })
    } else {
      setSelectedTask(null)
      setTaskForm(INITIAL_TASK_FORM)
    }
    setIsTaskDialogOpen(true)
  }

  const handleOpenReviewDialog = (task: Task) => {
    setReviewTask(task)
    setIsReviewDialogOpen(true)
  }

  const handleSaveTask = async (nextTaskForm?: TaskFormState) => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const currentUserRes = await apiFetch("/api/admin/current-user", { cache: "no-store" })
      if (!currentUserRes.ok) {
        setIsSaving(false)
        return
      }
      const { userId } = (await currentUserRes.json()) as { userId: string }

      const activeTaskForm = nextTaskForm ?? taskForm
      const validationError = validateTaskForm(activeTaskForm)
      if (validationError) {
        toast.error(validationError)
        setIsSaving(false)
        return
      }

      const taskData = {
        title: activeTaskForm.title,
        description: activeTaskForm.description || null,
        priority: activeTaskForm.priority,
        status: activeTaskForm.status,
        due_date: activeTaskForm.due_date || null,
        department: activeTaskForm.department || null,
        assignment_type: activeTaskForm.assignment_type,
        assigned_to: activeTaskForm.assigned_to || null,
        assigned_users: activeTaskForm.assigned_users || [],
        assigned_by: userId,
        goal_id: activeTaskForm.goal_id || null,
        task_start_date: activeTaskForm.task_start_date || null,
        task_end_date: activeTaskForm.task_end_date || null,
        source_type: "manual",
      }

      if (selectedTask) {
        const response = await apiFetch(`/api/tasks/${selectedTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(taskData),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) throw new Error(payload?.error || "Failed to update task")
        await sendUpdateNotifications(activeTaskForm, selectedTask, userId)
        toast.success(`${selectedTask.work_item_number || "Task"} updated`)
      } else {
        const response = await apiFetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(taskData),
        })
        const payload = (await response.json().catch(() => null)) as {
          error?: string
          data?: Task
          createdCount?: number
        } | null
        if (!response.ok || !payload?.data) throw new Error(payload?.error || "Failed to create task")
        const newTask = payload.data
        await sendCreateNotifications(activeTaskForm, newTask, userId)
        const count = payload.createdCount || 1
        toast.success(
          count > 1 ? `${count} tasks created and assigned` : `${newTask.work_item_number || "Task"} created`
        )
      }

      setIsTaskDialogOpen(false)
      loadData()
    } catch (error: unknown) {
      log.error("Error saving task:", error)
      toast.error(error instanceof Error ? error.message : "Failed to save task")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteTask = async () => {
    if (!taskToDelete || isDeleting) return
    setIsDeleting(true)
    try {
      const response = await apiFetch(`/api/tasks/${taskToDelete.id}`, { method: "DELETE" })
      if (!response.ok) throw new Error("Failed to archive task")
      toast.success(`${taskToDelete.work_item_number || "Task"} archived`)
      setIsDeleteDialogOpen(false)
      setTaskToDelete(null)
      loadData()
    } catch (error: unknown) {
      log.error("Error archiving task:", error)
      toast.error("Failed to archive task")
    } finally {
      setIsDeleting(false)
    }
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

  const departmentLeadMap = buildDepartmentLeadMap(activeEmployees)

  const workflowOwnerLabel = useCallback(
    (task: Task) => {
      if (task.assigned_to_user) {
        return `${formatName(task.assigned_to_user.first_name)} ${formatName(task.assigned_to_user.last_name)}`
      }
      if (task.assignment_type === "department") {
        const dept = task.department || ""
        if (!dept) return "Department"
        const leads = departmentLeadMap.get(dept) || []
        return leads.length === 0
          ? `${dept} (Unassigned)`
          : leads.map((l) => `${formatName(l.first_name)} ${formatName(l.last_name)}`).join(", ")
      }
      return "Unassigned"
    },
    [departmentLeadMap]
  )

  const columns: DataTableColumn<Task>[] = useMemo(
    () => [
      {
        key: "work_item_number",
        label: "Task ID",
        sortable: true,
        hideOnMobile: true,
        accessor: (r) => r.work_item_number || "",
        render: (r) => <span className="text-muted-foreground font-mono text-xs">{r.work_item_number || "—"}</span>,
      },
      {
        key: "title",
        label: "Task Title & Department",
        sortable: true,
        resizable: true,
        initialWidth: 260,
        accessor: (r) => r.title,
        render: (r) => (
          <div className="flex flex-col">
            <span className="text-foreground font-medium">{r.title}</span>
            <span className="text-muted-foreground text-[10px] uppercase">{r.department || "General"}</span>
          </div>
        ),
      },
      {
        key: "assigned_to",
        label: "Assignee",
        resizable: true,
        initialWidth: 180,
        accessor: (r) => workflowOwnerLabel(r),
        render: (r) => <span className="text-foreground text-xs font-medium">{workflowOwnerLabel(r)}</span>,
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        accessor: (r) => r.priority,
        render: (r) => (
          <Badge
            className={
              r.priority === "urgent" || r.priority === "high"
                ? "border-red-200 bg-red-500/10 text-red-500"
                : r.priority === "medium"
                  ? "border-amber-200 bg-amber-500/10 text-amber-500"
                  : "border-blue-200 bg-blue-500/10 text-blue-500"
            }
          >
            {formatName(r.priority)}
          </Badge>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => {
          const cfg = TASK_STATUS_CONFIG[r.status as TaskStatus] || TASK_STATUS_CONFIG.pending
          return (
            <Badge variant={cfg.badgeVariant} className={`text-[11px] capitalize ${cfg.color}`}>
              {cfg.label}
            </Badge>
          )
        },
      },
      {
        key: "goal_title",
        label: "Strategic Goal",
        resizable: true,
        initialWidth: 200,
        hideOnMobile: true,
        accessor: (r) => r.goal_title || goals.find((goal) => goal.id === r.goal_id)?.title || "",
        render: (r) =>
          r.goal_title ? (
            <span className="line-clamp-1 text-xs font-medium">{r.goal_title}</span>
          ) : (
            <span className="text-muted-foreground text-xs italic">Ad-Hoc / Operational</span>
          ),
      },
      {
        key: "due_date",
        label: "Due Date",
        sortable: true,
        hideOnMobile: true,
        accessor: (r) => r.due_date || "",
        render: (r) => {
          const isOverdue =
            r.due_date &&
            new Date(r.due_date).getTime() < new Date().setHours(0, 0, 0, 0) &&
            !["completed", "reassigned", "cancelled"].includes(r.status)
          return (
            <div className="flex items-center gap-1.5 text-xs">
              <Calendar className="text-muted-foreground h-3.5 w-3.5" />
              <span className={isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"}>
                {r.due_date ? formatWATDate(r.due_date) : "No Date"}
              </span>
              {isOverdue && <AlertTriangle className="text-destructive h-3 w-3" />}
            </div>
          )
        },
      },
    ],
    [goals, workflowOwnerLabel]
  )

  const filters: DataTableFilter<Task>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: STATUS_OPTIONS,
      },
      {
        key: "priority",
        label: "Priority",
        options: PRIORITY_OPTIONS,
      },
      {
        key: "department",
        label: "Department",
        options: departmentOptions.map((d) => ({ value: d, label: d })),
      },
      {
        key: "goal_id",
        label: "Goal",
        options: goals.map((g) => ({ value: g.id, label: g.title })),
        mode: "custom",
        filterFn: (row, vals) => {
          if (vals.length === 0) return true
          return vals.includes(row.goal_id || "")
        },
      },
    ],
    [departmentOptions, goals]
  )

  return (
    <DataTablePage
      title="Task Management"
      description="Operational task tracking, multi-user assignment, and PMS review governance."
      icon={ClipboardList}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsWorkflowOpen(true)} className="h-8 gap-2">
            <ArrowRight className="h-4 w-4" /> Workflow Guide
          </Button>
          <Button onClick={() => handleOpenTaskDialog()} className="h-8 gap-2" size="sm">
            <Plus className="h-4 w-4" /> Create Task
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
            icon={ArrowRight}
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
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        isLoading={isLoading}
        onRetry={loadData}
        searchPlaceholder="Search task title, description, or assigned user..."
        searchFn={(r, q) =>
          `${r.title} ${r.description || ""} ${workflowOwnerLabel(r)} ${r.work_item_number || ""}`
            .toLowerCase()
            .includes(q.toLowerCase())
        }
        filters={filters}
        rowActions={[
          {
            label: "Review / Decision",
            icon: ShieldCheck,
            onClick: handleOpenReviewDialog,
          },
          { label: "Edit Task", icon: Pencil, onClick: handleOpenTaskDialog },
          {
            label: "Archive Task",
            icon: Trash2,
            variant: "destructive",
            onClick: (r) => {
              setTaskToDelete(r)
              setIsDeleteDialogOpen(true)
            },
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="grid grid-cols-1 gap-6 p-5 text-xs md:grid-cols-2">
              <div className="space-y-3">
                <h4 className="text-foreground text-[11px] font-semibold tracking-wider uppercase">
                  Description & Scope
                </h4>
                <div className="bg-muted/40 rounded-lg border p-3 leading-relaxed whitespace-pre-wrap">
                  {r.description || "No description provided."}
                </div>

                {r.unable_to_complete_reason && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-800 dark:text-amber-300">
                    <span className="mb-0.5 block font-semibold">Reported Blocker / Issue:</span>
                    {r.unable_to_complete_reason}
                  </div>
                )}

                {r.failure_reason && (
                  <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-800 dark:text-rose-300">
                    <span className="mb-0.5 block font-semibold">Failure Note:</span>
                    {r.failure_reason}
                  </div>
                )}

                {r.extension_reason && (
                  <div className="rounded border border-blue-500/30 bg-blue-500/10 p-2.5 text-blue-800 dark:text-blue-300">
                    <span className="mb-0.5 block font-semibold">Extension Reason:</span>
                    {r.extension_reason}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h4 className="text-foreground text-[11px] font-semibold tracking-wider uppercase">
                  Attribution & Lifecycle
                </h4>
                <div className="bg-muted/20 grid grid-cols-2 gap-2 rounded-lg border p-3">
                  <div>
                    <span className="text-muted-foreground block text-[10px]">Assigned To:</span>
                    <span className="font-medium">{workflowOwnerLabel(r)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px]">Assigned By:</span>
                    <span className="font-medium">
                      {r.assigned_by_user
                        ? formatFullName(r.assigned_by_user.first_name, r.assigned_by_user.last_name)
                        : "System"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px]">Created At:</span>
                    <span>{formatWATDateTime(r.created_at)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px]">Due Date:</span>
                    <span className="font-medium">{r.due_date ? formatWATDate(r.due_date) : "No deadline"}</span>
                  </div>
                  {r.reviewed_by_user && (
                    <div className="col-span-2 border-t pt-1">
                      <span className="text-muted-foreground block text-[10px]">Reviewed By:</span>
                      <span className="font-medium">
                        {formatFullName(r.reviewed_by_user.first_name, r.reviewed_by_user.last_name)}
                        {r.reviewed_at && ` on ${formatWATDateTime(r.reviewed_at)}`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={() => handleOpenReviewDialog(r)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Review & Take Action
                  </Button>
                </div>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(r) => (
          <div className="bg-card group relative space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <span className="text-muted-foreground font-mono text-[10px]">{r.work_item_number}</span>
              <Badge
                className={
                  r.priority === "urgent" || r.priority === "high"
                    ? "bg-red-500/10 text-red-500"
                    : "bg-blue-500/10 text-blue-500"
                }
              >
                {formatName(r.priority)}
              </Badge>
            </div>
            <div>
              <h4 className="line-clamp-1 text-sm font-semibold">{r.title}</h4>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.description}</p>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <div className="flex items-center gap-1.5">
                <span className="max-w-[120px] truncate font-medium">{workflowOwnerLabel(r)}</span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {formatName(r.status)}
              </Badge>
            </div>
          </div>
        )}
      />

      <TaskFormDialog
        isOpen={isTaskDialogOpen}
        onOpenChange={setIsTaskDialogOpen}
        selectedTask={selectedTask}
        taskForm={taskForm}
        setTaskForm={setTaskForm}
        onSave={handleSaveTask}
        isSaving={isSaving}
        scopedAssignableEmployees={assignableEmployees}
        scopedAssignableDepartments={scopedAssignableDepartments}
        initialGoals={goals}
      />

      <TaskReviewDecisionDialog
        open={isReviewDialogOpen}
        onOpenChange={setIsReviewDialogOpen}
        task={reviewTask}
        assignableEmployees={assignableEmployees}
        onSuccess={loadData}
      />

      <TaskDeleteDialog
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDeleteTask}
        isDeleting={isDeleting}
        taskToDelete={taskToDelete}
      />

      <ResponsiveModal
        open={isWorkflowOpen}
        onOpenChange={setIsWorkflowOpen}
        title="Tasks & PMS Governance Guide"
        description="Understanding task lifecycles, review governance, and KPI scoring impact."
        desktopClassName="max-w-lg"
      >
        <div className="space-y-3 pt-2 text-xs">
          <div className="bg-muted/20 space-y-1 rounded-lg border p-3">
            <p className="text-foreground font-semibold">1. Multi-Assignment & Individual Tasks</p>
            <p className="text-muted-foreground">
              When assigning a task to multiple team members or a whole department, individual task instances are
              generated. Each employee has direct, separate accountability.
            </p>
          </div>
          <div className="bg-muted/20 space-y-1 rounded-lg border p-3">
            <p className="text-foreground font-semibold">2. Strategic Goal Linking (Optional)</p>
            <p className="text-muted-foreground">
              Tasks can be created with or without linking to strategic goals. Goal-linked tasks feed into the goal
              achievement formula for performance reviews.
            </p>
          </div>
          <div className="bg-muted/20 space-y-1 rounded-lg border p-3">
            <p className="text-foreground font-semibold">3. Lead Review & Status Progression</p>
            <p className="text-muted-foreground">
              Submitted tasks require lead/admin approval to reach Completed status and award KPI points. Blocked tasks
              can be reassigned (neutral for KPI), granted extensions, or marked failed.
            </p>
          </div>
        </div>
      </ResponsiveModal>
    </DataTablePage>
  )
}
