"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Loader2, Trash2, FolderTree, Scale, Star } from "lucide-react"
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
  status: string
  weight: number | null
  rating: number | null
  plan_id: string | null
  due_date: string | null
  task_end_date: string | null
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
      setTaskDialogPlan(null)
      void queryClient.invalidateQueries({ queryKey: tasksKey })
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task")
    } finally {
      setIsSavingTask(false)
    }
  }

  function openTaskDialog(plan: Plan | null) {
    setTaskForm({ ...EMPTY_TASK_FORM, project_id: project.id, plan_id: plan?.id ?? "" })
    setTaskDialogPlan(plan ?? { id: "", project_id: project.id, name: "", description: null, sort_order: 0 })
  }

  function renderTaskRow(task: ProjectTask) {
    const config = TASK_STATUS_CONFIG[task.status as TaskStatus]
    return (
      <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{task.title}</p>
          <p className="text-muted-foreground text-xs">
            {task.assigned_user
              ? formatFullName(task.assigned_user.first_name, task.assigned_user.last_name)
              : "Unassigned"}
            {task.task_end_date || task.due_date ? ` · due ${formatWATDate(task.task_end_date || task.due_date!)}` : ""}
          </p>
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
          groupTasks.map(renderTaskRow)
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
        isOpen={taskDialogPlan !== null}
        onOpenChange={(open) => !open && setTaskDialogPlan(null)}
        selectedTask={null}
        taskForm={taskForm}
        setTaskForm={setTaskForm}
        onSave={handleSaveTask}
        isSaving={isSavingTask}
        scopedAssignableEmployees={profiles}
        scopedAssignableDepartments={Array.from(new Set(profiles.map((p) => p.department).filter(Boolean) as string[]))}
        lockedProjectId={project.id}
        lockedProjectName={project.project_name}
        lockedPlanId={taskDialogPlan?.id || null}
        lockedPlanName={taskDialogPlan?.name || null}
      />
    </div>
  )
}
