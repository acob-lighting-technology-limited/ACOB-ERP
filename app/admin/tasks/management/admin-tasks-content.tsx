"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { formatName } from "@/lib/utils"
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
} from "lucide-react"
import { isAssignableProfile } from "@/lib/workforce/assignment-policy"
import { logger } from "@/lib/logger"
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog"
import type { TaskFormState } from "@/components/tasks/TaskFormDialog"
import { TaskDeleteDialog } from "@/components/tasks/TaskDeleteDialog"
import { TaskWorkflowTabs } from "@/components/tasks/TaskWorkflowTabs"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import type { Task } from "@/types/task"
import {
  enrichTaskWithUsers,
  filterByDepartments,
  buildDepartmentLeadMap,
  validateTaskForm,
  sendUpdateNotifications,
  sendCreateNotifications,
} from "./tasks-content-utils"
import {
  filterAssignableTaskDepartments,
  filterAssignableTaskUsers,
  hasGlobalTaskAssignmentAuthority,
} from "@/lib/tasks/assignment-scope"

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
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
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
    department: userProfile.department || null,
    is_department_lead: userProfile.is_department_lead ?? false,
    lead_departments: userProfile.lead_departments ?? [],
  }
  const activeEmployees = employee.filter((member) => isAssignableProfile(member, { allowLegacyNullStatus: true }))
  const scopedAssignableEmployees = filterAssignableTaskUsers(assignerProfile, activeEmployees)
  const assignableEmployees = scopedAssignableEmployees.length > 0 ? scopedAssignableEmployees : activeEmployees
  const [departments] = useState<string[]>(initialDepartments)
  const goals = useMemo(() => (Array.isArray(initialGoals) ? initialGoals : []), [initialGoals])
  const departmentOptions = useMemo(() => (Array.isArray(departments) ? departments : []), [departments])
  const scopedAssignableDepartments = filterAssignableTaskDepartments(assignerProfile, departments)
  const assignableDepartments = scopedAssignableDepartments.length > 0 ? scopedAssignableDepartments : departments
  const [isLoading, setIsLoading] = useState(false)

  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false)

  const [taskForm, setTaskForm] = useState<TaskFormState>(INITIAL_TASK_FORM)
  const consumedInitialGoalIdRef = useRef("")

  const supabase = createClient()
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
      const tasksQuery = supabase
        .from("tasks")
        .select("*")
        .neq("category", "weekly_action")
        .order("created_at", { ascending: false })
      const { data: tasksData, error: tasksError } = await tasksQuery
      if (tasksError) throw tasksError
      let result = await Promise.all(
        (tasksData || [])
          .filter((task) => String(task.source_type || "") !== "action_item")
          .map((task) => enrichTaskWithUsers(supabase, task))
      )
      const goalIds = Array.from(new Set(result.map((task) => task.goal_id).filter(Boolean))) as string[]
      if (goalIds.length > 0) {
        const { data: goals } = await supabase.from("goals_objectives").select("id, title").in("id", goalIds)
        const goalMap = new Map(
          ((goals as Array<{ id: string; title: string }> | null) || []).map((g) => [g.id, g.title])
        )
        result = result.map((task) => ({
          ...task,
          goal_title: task.goal_id ? goalMap.get(task.goal_id) || null : null,
        }))
      }
      if (userProfile?.is_department_lead && !userProfile.is_global_task_assigner && scopedDepartments.length > 0) {
        result = result.filter((task) => {
          if (task.assignment_type === "individual" && task.assigned_to === userProfile.id) return true
          return filterByDepartments([task], scopedDepartments).length > 0
        })
      }
      setTasks(result as Task[])
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
        task_start_date: task.task_start_date || "",
        task_end_date: task.task_end_date || "",
      })
    } else {
      setSelectedTask(null)
      setTaskForm(INITIAL_TASK_FORM)
    }
    setIsTaskDialogOpen(true)
  }

  const handleSaveTask = async (nextTaskForm?: TaskFormState) => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setIsSaving(false)
        return
      }

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
        department:
          activeTaskForm.assignment_type === "department"
            ? activeTaskForm.department
            : activeTaskForm.department || null,
        assignment_type: activeTaskForm.assignment_type,
        assigned_to: activeTaskForm.assignment_type === "individual" ? activeTaskForm.assigned_to : null,
        assigned_by: user.id,
        goal_id: activeTaskForm.goal_id,
        task_start_date: null,
        task_end_date: null,
        source_type: "manual",
      }

      if (selectedTask) {
        const response = await fetch(`/api/tasks/${selectedTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(taskData),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) throw new Error(payload?.error || "Failed to update task")
        await sendUpdateNotifications(activeTaskForm, selectedTask, user.id)
        toast.success(`${selectedTask.work_item_number || "Task"} updated`)
      } else {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(taskData),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string; data?: Task } | null
        if (!response.ok || !payload?.data) throw new Error(payload?.error || "Failed to create task")
        const newTask = payload.data
        await sendCreateNotifications(activeTaskForm, newTask, user.id)
        toast.success(`${newTask.work_item_number || "Task"} created`)
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
      const response = await fetch(`/api/tasks/${taskToDelete.id}`, { method: "DELETE" })
      if (!response.ok) throw new Error("Failed to delete task")
      toast.success(`${taskToDelete.work_item_number || "Task"} deleted`)
      setIsDeleteDialogOpen(false)
      setTaskToDelete(null)
      loadData()
    } catch (error: unknown) {
      log.error("Error deleting task:", error)
      toast.error("Failed to delete task")
    } finally {
      setIsDeleting(false)
    }
  }

  const stats = useMemo(
    () => ({
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      completed: tasks.filter((t) => t.status === "completed").length,
    }),
    [tasks]
  )

  const finalTaskStatuses = new Set(["completed", "cancelled", "archived", "closed"])
  const allPendingWorkflowTasks = tasks.filter(
    (task) => !finalTaskStatuses.has(String(task.status || "").toLowerCase())
  )
  const taskHistory = tasks.filter((task) => finalTaskStatuses.has(String(task.status || "").toLowerCase()))
  const departmentLeadMap = buildDepartmentLeadMap(activeEmployees)

  const myTaskActionQueue = allPendingWorkflowTasks.filter((task) => {
    if (task.assignment_type === "department") {
      if (!task.department) return false
      if (scopedDepartments.length > 0) return scopedDepartments.includes(task.department)
      return Boolean(userProfile.department && task.department === userProfile.department)
    }
    return task.assigned_to === userProfile.id
  })

  const workflowOwnerLabel = useCallback(
    (task: Task) => {
      if (task.assignment_type === "department") {
        const dept = task.department || ""
        if (!dept) return "Department"
        const leads = departmentLeadMap.get(dept) || []
        return leads.length === 0
          ? `${dept} Lead (Unassigned)`
          : leads.map((l) => `${formatName(l.first_name)} ${formatName(l.last_name)}`).join(", ")
      }
      return task.assigned_to_user
        ? `${formatName(task.assigned_to_user.first_name)} ${formatName(task.assigned_to_user.last_name)}`
        : "Unassigned"
    },
    [departmentLeadMap]
  )

  const columns: DataTableColumn<Task>[] = useMemo(
    () => [
      {
        key: "work_item_number",
        label: "S/N",
        sortable: true,
        accessor: (r) => r.work_item_number || "",
        render: (r) => <span className="text-muted-foreground font-mono text-xs">{r.work_item_number || "—"}</span>,
      },
      {
        key: "title",
        label: "Task Title",
        sortable: true,
        resizable: true,
        initialWidth: 300,
        accessor: (r) => r.title,
        render: (r) => <span className="font-medium">{r.title}</span>,
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        accessor: (r) => r.priority,
        render: (r) => (
          <Badge
            className={
              r.priority === "high"
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
        render: (r) => (
          <Badge variant={r.status === "completed" ? "default" : "secondary"}>{formatName(r.status)}</Badge>
        ),
      },
      {
        key: "assigned_to",
        label: "Assigned To",
        resizable: true,
        initialWidth: 200,
        accessor: (r) => workflowOwnerLabel(r),
        render: (r) => (
          <div className="flex flex-col">
            <span className="text-sm">{workflowOwnerLabel(r)}</span>
            {r.department && (
              <span className="text-muted-foreground text-[10px] tracking-wider uppercase">{r.department}</span>
            )}
          </div>
        ),
      },
      {
        key: "goal_title",
        label: "Goal",
        resizable: true,
        initialWidth: 220,
        accessor: (r) => r.goal_title || goals.find((goal) => goal.id === r.goal_id)?.title || "",
        render: (r) => <span className="line-clamp-1">{r.goal_title || "—"}</span>,
      },
      {
        key: "due_date",
        label: "Due Date",
        sortable: true,
        accessor: (r) => r.due_date || "",
        render: (r) => (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Calendar className="h-3.5 w-3.5" />
            <span>{r.due_date ? new Date(r.due_date).toLocaleDateString() : "No Date"}</span>
          </div>
        ),
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
      description="Centralized task tracking and workflow coordination across departments."
      icon={ClipboardList}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsWorkflowOpen(true)} className="h-8 gap-2">
            <ArrowRight className="h-4 w-4" /> Workflow Guide
          </Button>
          <Button onClick={() => handleOpenTaskDialog()} className="h-8 gap-2" size="sm">
            <Plus className="h-4 w-4" /> Create Task
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
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
        isLoading={isLoading}
        onRetry={loadData}
        searchPlaceholder="Search task title, description, or assigned user..."
        searchFn={(r, q) =>
          `${r.title} ${r.description} ${workflowOwnerLabel(r)} ${r.work_item_number}`.toLowerCase().includes(q)
        }
        filters={filters}
        rowActions={[
          { label: "Edit Task", icon: Pencil, onClick: handleOpenTaskDialog },
          {
            label: "Delete",
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
            <div className="animate-in fade-in slide-in-from-top-2 grid grid-cols-1 gap-8 p-6 md:grid-cols-2">
              <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-xs font-bold tracking-widest text-blue-600 uppercase">
                  Task Description
                </h4>
                <div className="bg-muted/30 rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {r.description || "No description provided."}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <h4 className="text-muted-foreground flex items-center gap-2 text-[10px] font-black tracking-widest uppercase">
                    <User className="h-3.5 w-3.5" /> Ownership
                  </h4>
                  <div className="space-y-1.5 text-sm">
                    <p className="font-medium">{workflowOwnerLabel(r)}</p>
                    {r.department && <p className="text-muted-foreground text-xs">{r.department}</p>}
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-muted-foreground flex items-center gap-2 text-[10px] font-black tracking-widest uppercase">
                    <Target className="h-3.5 w-3.5" /> Context
                  </h4>
                  <div className="space-y-1.5 text-sm">
                    {r.goal_id ? (
                      <p className="line-clamp-2">{goals.find((g) => g.id === r.goal_id)?.title || "Goal Linked"}</p>
                    ) : (
                      <p className="text-muted-foreground italic">No linked goal</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(r) => (
          <div className="bg-card group relative space-y-4 rounded-xl border p-4 transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <span className="text-muted-foreground font-mono text-[10px]">{r.work_item_number}</span>
              <Badge className={r.priority === "high" ? "bg-red-500/10 text-red-500" : "bg-blue-500/10 text-blue-500"}>
                {formatName(r.priority)}
              </Badge>
            </div>
            <div>
              <h4 className="line-clamp-1 font-semibold">{r.title}</h4>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.description}</p>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <div className="flex items-center gap-2">
                <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold">
                  {workflowOwnerLabel(r).charAt(0)}
                </div>
                <span className="max-w-[100px] truncate text-xs font-medium">{workflowOwnerLabel(r)}</span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {formatName(r.status)}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => handleOpenTaskDialog(r)}
            >
              <Pencil className="text-muted-foreground h-4 w-4" />
            </Button>
          </div>
        )}
        urlSync
      />

      <ResponsiveModal
        open={isWorkflowOpen}
        onOpenChange={setIsWorkflowOpen}
        title="Task Workflow Guide"
        description="Detailed queue ownership and workflow history inspection."
        desktopClassName="max-w-6xl"
      >
        <div className="space-y-4">
          <div className="bg-muted/40 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
            <ArrowRight className="h-4 w-4" />
            Pending queue shows all live work, My Action Queue shows what needs your attention, and History shows
            finished or closed items.
          </div>
          <TaskWorkflowTabs
            allPendingWorkflowTasks={allPendingWorkflowTasks}
            myTaskActionQueue={myTaskActionQueue}
            taskHistory={taskHistory}
            workflowOwnerLabel={workflowOwnerLabel}
          />
        </div>
      </ResponsiveModal>

      <TaskFormDialog
        isOpen={isTaskDialogOpen}
        onOpenChange={setIsTaskDialogOpen}
        selectedTask={selectedTask}
        taskForm={taskForm}
        setTaskForm={setTaskForm}
        onSave={handleSaveTask}
        isSaving={isSaving}
        scopedAssignableEmployees={assignableEmployees}
        scopedAssignableDepartments={assignableDepartments}
        initialGoals={initialGoals}
        assignmentAuthorityLabel={
          hasGlobalTaskAssignmentAuthority(assignerProfile) || scopedAssignableEmployees.length === 0
            ? "You can assign tasks across available departments."
            : "You can assign tasks only within your department."
        }
      />

      <TaskDeleteDialog
        isOpen={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open)
          if (!open) setTaskToDelete(null)
        }}
        taskToDelete={taskToDelete}
        onConfirm={handleDeleteTask}
        isDeleting={isDeleting}
      />
    </DataTablePage>
  )
}
