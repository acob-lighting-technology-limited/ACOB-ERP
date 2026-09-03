"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Loader2, Trash2, FolderTree, Scale, Star, Pencil } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { apiFetch } from "@/lib/api-client"
import { formatFullName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import { TASK_STATUS_CONFIG, type TaskStatus } from "@/lib/tasks/constants"
import { TASK_WEIGHT_DEFAULT, computeProjectProgress } from "@/lib/tasks/scoring"
import { TaskFormDialog, type TaskFormState } from "@/components/tasks/TaskFormDialog"
import type { employee } from "@/app/admin/tasks/management/admin-tasks-content"
import type { Task } from "@/types/task"
import type { Project } from "./project-admin-content"

type Plan = {
  id: string
  project_id: string
  name: string
  description: string | null
  sort_order: number
}

type ProjectTask = {
  id: string
  title: string
  description?: string | null
  priority?: string | null
  status: string
  weight: number | null
  rating: number | null
  plan_id: string | null
  due_date: string | null
  task_start_date?: string | null
  task_end_date?: string | null
  work_item_number?: string | null
  assigned_to?: string | null
  department?: string | null
  goal_id?: string | null
  kpi_id?: string | null
  assignment_type?: "individual" | "multiple" | "department" | null
  is_archived: boolean | null
  assigned_user?: { first_name: string | null; last_name: string | null } | null
}

const EMPTY_TASK_FORM: TaskFormState = {
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
  plan_id: "",
  goal_id: "",
  kpi_id: "",
  weight: TASK_WEIGHT_DEFAULT,
  task_start_date: "",
  task_end_date: "",
}

/**
 * Implementation plans and their tasks for one project.
 *
 * Tasks are created through the same dialog department leads use, with the
 * project and plan locked — there is no separate project-task form, because
 * there is no separate project-task table. One row, counted once.
 */
export function ProjectPlanBoard({ project, profiles }: { project: Project; profiles: employee[] }) {
  const queryClient = useQueryClient()
  const [newPlanName, setNewPlanName] = useState("")
  const [taskDialogPlan, setTaskDialogPlan] = useState<Plan | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false)
  const [taskForm, setTaskForm] = useState<TaskFormState>(EMPTY_TASK_FORM)
  const [isSavingTask, setIsSavingTask] = useState(false)

  const plansKey = ["project-plans", project.id]
  const tasksKey = ["project-tasks", project.id]

  const { data: plans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: plansKey,
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${project.id}/plans`, { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load plans")
      return payload.data
    },
  })

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<ProjectTask[]>({
    queryKey: tasksKey,
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${project.id}/tasks`, { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load tasks")
      return payload.data
    },
  })

  const addPlan = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiFetch(`/api/projects/${project.id}/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sort_order: plans.length }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to add plan")
      return payload.data
    },
    onSuccess: () => {
      toast.success("Implementation plan added")
      setNewPlanName("")
      void queryClient.invalidateQueries({ queryKey: plansKey })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deletePlan = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiFetch(`/api/projects/${project.id}/plans?plan_id=${planId}`, { method: "DELETE" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to delete plan")
      return payload.data
    },
    onSuccess: () => {
      toast.success("Plan removed. Its tasks were kept and are now ungrouped.")
      void queryClient.invalidateQueries({ queryKey: plansKey })
      void queryClient.invalidateQueries({ queryKey: tasksKey })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const tasksByPlan = useMemo(() => {
    const map = new Map<string, ProjectTask[]>()
    for (const task of tasks) {
      if (task.is_archived) continue
      const key = task.plan_id || ""
      const bucket = map.get(key) || []
      bucket.push(task)
      map.set(key, bucket)
    }
    return map
  }, [tasks])

  async function handleSaveTask(form: TaskFormState) {
    if (isSavingTask) return
    setIsSavingTask(true)
    try {
      if (editingTask) {
        const res = await apiFetch(`/api/tasks/${editingTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            description: form.description || null,
            priority: form.priority,
            due_date: form.due_date || null,
            department: form.department || null,
            assignment_type: form.assignment_type,
            assigned_to: form.assigned_to || null,
            goal_id: form.goal_id || null,
            kpi_id: form.kpi_id || null,
            project_id: project.id,
            plan_id: form.plan_id || null,
            weight: form.weight,
            task_start_date: form.task_start_date || null,
            task_end_date: form.task_end_date || null,
          }),
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error || "Failed to update task")
        toast.success("Task updated")
      } else {
        const res = await apiFetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            description: form.description || null,
            priority: form.priority,
            status: "pending",
            due_date: form.due_date || null,
            department: form.department || null,
            assignment_type: form.assignment_type,
            assigned_to: form.assigned_to || null,
            assigned_users: form.assigned_users || [],
            goal_id: form.goal_id || null,
            kpi_id: form.kpi_id || null,
            project_id: project.id,
            plan_id: form.plan_id || null,
            weight: form.weight,
            task_start_date: form.task_start_date || null,
            task_end_date: form.task_end_date || null,
            source_type: "manual",
          }),
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error || "Failed to create task")
        toast.success("Task added to the plan")
      }
      setIsTaskDialogOpen(false)
      setEditingTask(null)
      setTaskDialogPlan(null)
      void queryClient.invalidateQueries({ queryKey: tasksKey })
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save task")
    } finally {
      setIsSavingTask(false)
    }
  }

  function openTaskDialog(plan: Plan | null) {
    setEditingTask(null)
    setTaskForm({ ...EMPTY_TASK_FORM, project_id: project.id, plan_id: plan?.id ?? "" })
    setTaskDialogPlan(plan)
    setIsTaskDialogOpen(true)
  }

  function openEditTaskDialog(task: ProjectTask) {
    const plan = plans.find((p) => p.id === task.plan_id) || null
    setEditingTask(task as unknown as Task)
    setTaskDialogPlan(plan)
    setTaskForm({
      title: task.title,
      description: task.description || "",
      priority: task.priority || "medium",
      status: task.status || "pending",
      assigned_to: task.assigned_to || "",
      department: task.department || "",
      due_date: task.due_date || "",
      assignment_type: (task.assignment_type as "individual" | "multiple" | "department") || "individual",
      assigned_users: task.assigned_to ? [task.assigned_to] : [],
      project_id: project.id,
      plan_id: task.plan_id || "",
      goal_id: task.goal_id || "",
      kpi_id: task.kpi_id || "",
      weight: task.weight ?? TASK_WEIGHT_DEFAULT,
      task_start_date: task.task_start_date || "",
      task_end_date: task.task_end_date || "",
    })
    setIsTaskDialogOpen(true)
  }

  function renderTaskRow(task: ProjectTask, index: number) {
    const config = TASK_STATUS_CONFIG[task.status as TaskStatus]
    return (
      <div
        key={task.id}
        onClick={() => openEditTaskDialog(task)}
        className="group hover:bg-muted/40 flex cursor-pointer flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm transition-colors"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openEditTaskDialog(task)
          }
        }}
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="text-muted-foreground w-6 shrink-0 pt-0.5 font-mono text-xs font-semibold">
            {index + 1}.
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="group-hover:text-primary truncate font-medium transition-colors">{task.title}</p>
              {task.work_item_number && (
                <Badge variant="outline" className="text-muted-foreground shrink-0 px-1.5 py-0 font-mono text-[10px]">
                  {task.work_item_number}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {task.assigned_user
                ? formatFullName(task.assigned_user.first_name, task.assigned_user.last_name)
                : "Unassigned"}
              {task.task_end_date || task.due_date
                ? ` · due ${formatWATDate(task.task_end_date || task.due_date!)}`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Scale className="h-3 w-3" />
            {task.weight ?? TASK_WEIGHT_DEFAULT}
          </Badge>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Star className="h-3 w-3" />
            {task.rating ? `${task.rating}/5` : "unrated"}
          </Badge>
          <Badge variant={config?.badgeVariant ?? "outline"} className="text-[10px] capitalize">
            {config?.label ?? task.status.replaceAll("_", " ")}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              openEditTaskDialog(task)
            }}
          >
            <Pencil className="h-3 w-3" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        </div>
      </div>
    )
  }

  function renderGroup(key: string, title: string, description: string | null, plan: Plan | null) {
    const groupTasks = tasksByPlan.get(key) || []
    const progress = computeProjectProgress(groupTasks)

    return (
      <div key={key || "ungrouped"} className="bg-background rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold">
              <FolderTree className="text-muted-foreground h-4 w-4" />
              {title}
            </p>
            {description && <p className="text-muted-foreground text-xs">{description}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div className="w-28">
              <Progress value={progress.deliveryPct ?? 0} className="h-1.5" />
              <p className="text-muted-foreground mt-1 text-[10px]">
                {progress.deliveryPct ?? 0}% delivered · {progress.qualityPct ?? 0}% quality
              </p>
            </div>
            {plan && (
              <>
                <Button size="sm" variant="outline" onClick={() => openTaskDialog(plan)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Task
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deletePlan.mutate(plan.id)}
                  disabled={deletePlan.isPending}
                  aria-label={`Delete ${plan.name}`}
                >
                  <Trash2 className="text-destructive h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {groupTasks.length === 0 ? (
          <p className="text-muted-foreground border-t px-3 py-3 text-xs">No tasks in this plan yet.</p>
        ) : (
          groupTasks.map((task, idx) => renderTaskRow(task, idx))
        )}
      </div>
    )
  }

  const ungroupedCount = (tasksByPlan.get("") || []).length

  return (
    <div className="space-y-3 p-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={newPlanName}
          onChange={(e) => setNewPlanName(e.target.value)}
          placeholder="New implementation plan (e.g. Civil Works)"
          className="h-9 max-w-xs text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newPlanName.trim()) addPlan.mutate(newPlanName.trim())
          }}
        />
        <Button
          size="sm"
          onClick={() => newPlanName.trim() && addPlan.mutate(newPlanName.trim())}
          disabled={addPlan.isPending || !newPlanName.trim()}
        >
          {addPlan.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3.5 w-3.5" />
          )}
          Add Plan
        </Button>
        <Button size="sm" variant="outline" onClick={() => openTaskDialog(null)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Task (no plan)
        </Button>
      </div>

      {plansLoading || tasksLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading implementation plans...
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => renderGroup(plan.id, plan.name, plan.description, plan))}
          {ungroupedCount > 0 && renderGroup("", "Ungrouped tasks", "Project work not filed under a plan.", null)}
          {plans.length === 0 && ungroupedCount === 0 && (
            <p className="text-muted-foreground rounded-lg border border-dashed py-6 text-center text-sm">
              No implementation plans yet. Add one to start breaking this project into tasks.
            </p>
          )}
        </div>
      )}

      <TaskFormDialog
        isOpen={isTaskDialogOpen}
        onOpenChange={(open) => {
          setIsTaskDialogOpen(open)
          if (!open) {
            setEditingTask(null)
            setTaskDialogPlan(null)
          }
        }}
        selectedTask={editingTask}
        taskForm={taskForm}
        setTaskForm={setTaskForm}
        onSave={handleSaveTask}
        isSaving={isSavingTask}
        scopedAssignableEmployees={profiles}
        scopedAssignableDepartments={Array.from(new Set(profiles.map((p) => p.department).filter(Boolean) as string[]))}
        lockedProjectId={project.id}
        lockedProjectName={project.project_name}
        lockedPlanId={editingTask ? null : taskDialogPlan?.id || null}
        lockedPlanName={editingTask ? null : taskDialogPlan?.name || null}
      />
    </div>
  )
}
