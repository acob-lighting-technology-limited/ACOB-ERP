"use client"

import { useEffect, useState, useMemo } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Target, Users, User, Calendar, CheckSquare, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import type { Task } from "@/types/task"
import type { employee } from "@/app/admin/tasks/management/admin-tasks-content"
import { formatFullName } from "@/lib/utils"

interface GoalOption {
  id: string
  title: string
}

const taskFormSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  priority: z.string().default("medium"),
  status: z.string().default("pending"),
  assigned_to: z.string().optional(),
  department: z.string().optional(),
  due_date: z.string().optional(),
  assignment_type: z.enum(["individual", "multiple", "department"]).default("individual"),
  goal_id: z.string().optional().nullable(),
  task_start_date: z.string().optional(),
  task_end_date: z.string().optional(),
})

type TaskFormValues = z.infer<typeof taskFormSchema>

export interface TaskFormState {
  title: string
  description: string
  priority: string
  status: string
  assigned_to: string
  department: string
  due_date: string
  assignment_type: "individual" | "multiple" | "department"
  assigned_users: string[]
  project_id: string
  goal_id: string
  task_start_date: string
  task_end_date: string
}

interface TaskFormDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedTask: Task | null
  taskForm: TaskFormState
  setTaskForm: (form: TaskFormState) => void
  onSave: (form: TaskFormState) => void
  isSaving: boolean
  scopedAssignableEmployees: employee[]
  scopedAssignableDepartments: string[]
  initialGoals?: GoalOption[]
  assignmentAuthorityLabel?: string
}

export function TaskFormDialog({
  isOpen,
  onOpenChange,
  selectedTask,
  taskForm,
  setTaskForm,
  onSave,
  isSaving,
  scopedAssignableEmployees,
  scopedAssignableDepartments,
  initialGoals = [],
  assignmentAuthorityLabel,
}: TaskFormDialogProps) {
  const [goalOptions, setGoalOptions] = useState<GoalOption[]>(initialGoals)
  const [isMultiAssign, setIsMultiAssign] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: taskForm.title,
      description: taskForm.description,
      priority: taskForm.priority,
      status: taskForm.status,
      assigned_to: taskForm.assigned_to,
      department: taskForm.department,
      due_date: taskForm.due_date,
      assignment_type: taskForm.assignment_type,
      goal_id: taskForm.goal_id,
      task_start_date: taskForm.task_start_date,
      task_end_date: taskForm.task_end_date,
    },
  })

  const {
    register,
    setValue,
    watch,
    getValues,
    reset,
    formState: { errors },
  } = form

  useEffect(() => {
    if (!isOpen) return

    reset({
      title: taskForm.title,
      description: taskForm.description,
      priority: taskForm.priority || "medium",
      status: taskForm.status || "pending",
      assigned_to: taskForm.assigned_to || "",
      department: taskForm.department || "",
      due_date: taskForm.due_date || "",
      assignment_type: taskForm.assignment_type || "individual",
      goal_id: taskForm.goal_id || "",
      task_start_date: taskForm.task_start_date || "",
      task_end_date: taskForm.task_end_date || "",
    })

    if (taskForm.assigned_users && taskForm.assigned_users.length > 1) {
      setIsMultiAssign(true)
      setSelectedUserIds(taskForm.assigned_users)
    } else if (taskForm.assigned_to) {
      setIsMultiAssign(false)
      setSelectedUserIds([taskForm.assigned_to])
    } else {
      setIsMultiAssign(false)
      setSelectedUserIds([])
    }
  }, [isOpen, reset, selectedTask?.id, taskForm])

  const assignedTo = watch("assigned_to")
  const departmentValue = watch("department")
  const goalId = watch("goal_id")
  const titleValue = watch("title")
  const priorityValue = watch("priority")
  const statusValue = watch("status")

  // Fetch available goals based on target department
  useEffect(() => {
    const targetDepartment =
      departmentValue ||
      scopedAssignableEmployees.find((e) => e.id === assignedTo)?.department ||
      scopedAssignableDepartments[0] ||
      ""

    const query = targetDepartment ? `?department=${encodeURIComponent(targetDepartment)}` : ""

    fetch(`/api/hr/performance/goals${query}`)
      .then((res) => res.json())
      .then((payload) => {
        const activeGoals = (payload.data ?? []).map((g: { id: string; title: string }) => ({
          id: g.id,
          title: g.title,
        }))
        setGoalOptions(activeGoals)
      })
      .catch(() => setGoalOptions(initialGoals))
  }, [assignedTo, departmentValue, scopedAssignableDepartments, scopedAssignableEmployees, initialGoals])

  const employeeSelectOptions = useMemo(() => {
    return scopedAssignableEmployees.map((member) => ({
      value: member.id,
      label: `${formatFullName(member.first_name, member.last_name)} (${member.department})`,
    }))
  }, [scopedAssignableEmployees])

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
      if (next.length === 1) {
        setValue("assigned_to", next[0])
      }
      return next
    })
  }

  const handleSelectAllDepartment = (deptName?: string) => {
    const targetDept = deptName || departmentValue || scopedAssignableDepartments[0]
    const deptMembers = scopedAssignableEmployees
      .filter((e) => !targetDept || e.department === targetDept)
      .map((e) => e.id)

    setSelectedUserIds(deptMembers)
    setIsMultiAssign(true)
  }

  const handleClearAllAssignees = () => {
    setSelectedUserIds([])
    setValue("assigned_to", "")
  }

  function buildTaskFormState(): TaskFormState {
    const values = getValues()
    const targetUsers = isMultiAssign ? selectedUserIds : values.assigned_to ? [values.assigned_to] : []

    return {
      title: values.title ?? "",
      description: values.description ?? "",
      priority: values.priority ?? "medium",
      status: values.status ?? "pending",
      assigned_to: targetUsers.length === 1 ? targetUsers[0] : "",
      department: values.department ?? "",
      due_date: values.due_date ?? "",
      assignment_type: targetUsers.length > 1 ? "multiple" : "individual",
      assigned_users: targetUsers,
      project_id: "",
      goal_id: values.goal_id === "__none__" ? "" : (values.goal_id ?? ""),
      task_start_date: values.task_start_date ?? "",
      task_end_date: values.task_end_date ?? "",
    }
  }

  function handleSaveClick() {
    const nextTaskForm = buildTaskFormState()
    setTaskForm(nextTaskForm)
    onSave(nextTaskForm)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{selectedTask ? "Edit Task" : "Create New Task"}</DialogTitle>
            <ItemInfoButton
              title="Task & KPI Guide"
              summary="Direct individual accountability with optional strategic goal linking."
              details={[
                {
                  label: "Direct Assignment",
                  value:
                    "Assign tasks to a single person or multiple team members. When assigning to multiple people, individual task copies are created so each person is tracked independently.",
                },
                {
                  label: "Goal Alignment",
                  value:
                    "Linking to a strategic goal is optional. Linked tasks drive that goal's KPI progress, while unlinked tasks track operational execution.",
                },
                {
                  label: "Review Workflow",
                  value:
                    "Employees submit completed tasks for review. Department leads and admins review and approve tasks to finalize KPI credit.",
                },
              ]}
            />
          </div>
          <DialogDescription>
            {selectedTask
              ? "Update task details, due dates, or linked goal."
              : "Assign an operational or goal-linked task to team members."}
          </DialogDescription>
          {assignmentAuthorityLabel ? (
            <p className="text-muted-foreground text-xs">{assignmentAuthorityLabel}</p>
          ) : null}
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div>
            <Label htmlFor="title" className="text-xs font-semibold">
              Task Title *
            </Label>
            <Input
              id="title"
              {...register("title")}
              placeholder="e.g. Prepare monthly revenue reconciliation report"
              className="mt-1"
            />
            {errors.title && <p className="text-destructive mt-1 text-xs">{errors.title.message}</p>}
          </div>

          <div>
            <Label htmlFor="description" className="text-xs font-semibold">
              Description
            </Label>
            <Textarea
              id="description"
              {...register("description")}
              placeholder="Describe expected scope, deliverables, and instructions..."
              rows={3}
              className="mt-1"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold">Priority</Label>
              <Select value={priorityValue} onValueChange={(val) => setValue("priority", val)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-semibold">Initial Status</Label>
              <Select value={statusValue} onValueChange={(val) => setValue("status", val)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  {selectedTask && <SelectItem value="submitted_for_review">Submitted for Review</SelectItem>}
                  {selectedTask && <SelectItem value="completed">Completed</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignment Section */}
          <div className="bg-muted/20 space-y-3 rounded-lg border p-3.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs font-semibold">
                <Users className="h-3.5 w-3.5" />
                Assignee Selection
              </Label>
              {!selectedTask && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleSelectAllDepartment()}
                  >
                    Select All in Dept
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-6 px-2 text-xs"
                    onClick={handleClearAllAssignees}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant={isMultiAssign ? "secondary" : "outline"}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setIsMultiAssign(!isMultiAssign)}
                  >
                    {isMultiAssign ? "Multi-Assign Active" : "Enable Multi-Assign"}
                  </Button>
                </div>
              )}
            </div>

            {!isMultiAssign ? (
              <div>
                <SearchableSelect
                  value={assignedTo || ""}
                  onValueChange={(val) => {
                    const member = scopedAssignableEmployees.find((e) => e.id === val)
                    setValue("assigned_to", val)
                    if (member?.department) {
                      setValue("department", member.department)
                    }
                    setSelectedUserIds(val ? [val] : [])
                  }}
                  placeholder="Select a team member..."
                  searchPlaceholder="Search staff name or department..."
                  icon={<User className="h-3.5 w-3.5" />}
                  options={employeeSelectOptions}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  Select team members. Individual tasks will be created for each chosen person:
                </p>
                <div className="bg-background max-h-36 space-y-1 overflow-y-auto rounded border p-2">
                  {scopedAssignableEmployees.map((emp) => {
                    const isChecked = selectedUserIds.includes(emp.id)
                    return (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => handleToggleUser(emp.id)}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          isChecked ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {isChecked ? (
                            <CheckSquare className="text-primary h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <Square className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{formatFullName(emp.first_name, emp.last_name)}</span>
                        </span>
                        <Badge variant="outline" className="py-0 text-[10px]">
                          {emp.department}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
                <div className="text-muted-foreground text-xs">
                  Selected: <span className="text-foreground font-medium">{selectedUserIds.length}</span> staff
                  member(s)
                </div>
              </div>
            )}
          </div>

          {/* Goal Linking Section */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="goal_id" className="flex items-center gap-1.5 text-xs font-semibold">
                <Target className="text-primary h-3.5 w-3.5" />
                Strategic Goal / KPI Link (Optional)
              </Label>
              <Badge variant="secondary" className="text-[10px]">
                Optional
              </Badge>
            </div>
            <Select
              value={goalId || "__none__"}
              onValueChange={(val) => setValue("goal_id", val === "__none__" ? "" : val)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a goal (Optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground italic">None (Ad-Hoc / Operational Task)</span>
                </SelectItem>
                {goalOptions.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-[11px]">
              Linking to an active goal feeds this task directly into the strategic KPI score for performance
              appraisals.
            </p>
          </div>

          {/* Timeline Section */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="task_start_date" className="flex items-center gap-1 text-xs font-semibold">
                <Calendar className="h-3 w-3" />
                Start Date
              </Label>
              <Input id="task_start_date" type="date" {...register("task_start_date")} className="mt-1 text-xs" />
            </div>

            <div>
              <Label htmlFor="due_date" className="flex items-center gap-1 text-xs font-semibold">
                <Calendar className="h-3 w-3" />
                Due Date / Deadline
              </Label>
              <Input id="due_date" type="date" {...register("due_date")} className="mt-1 text-xs" />
            </div>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveClick}
            disabled={isSaving || !titleValue || (!isMultiAssign && !assignedTo && selectedUserIds.length === 0)}
          >
            {isSaving ? "Saving..." : selectedTask ? "Update Task" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
