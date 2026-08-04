"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Trash2, Plus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { Project } from "./project-admin-content"
import { apiFetch } from "@/lib/api-client"

// Define task interface
export interface Task {
  id: string
  title: string
  description?: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  assigned_to?: string | null
  project_id?: string
  created_at: string
  assigned_user?: {
    id: string
    full_name: string | null
    first_name: string | null
    last_name: string | null
  } | null
}

interface ProjectTaskManagerProps {
  project: Project
  profiles: Array<{
    id: string
    first_name: string | null
    last_name: string | null
    full_name: string | null
    department: string | null
  }>
}

export function ProjectTaskManager({ project, profiles }: ProjectTaskManagerProps) {
  const queryClient = useQueryClient()
  const [newTitle, setNewTitle] = useState("")
  const [newSupervisor, setNewSupervisor] = useState("")

  const queryKey = ["project-tasks", project.id]

  // Fetch tasks
  const {
    data: tasks = [],
    isLoading,
    error,
  } = useQuery<Task[]>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${project.id}/tasks`, { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to fetch tasks")
      return payload.data
    },
  })

  // Add task mutation
  const addTaskMutation = useMutation({
    mutationFn: async (vars: { title: string; assigned_to: string }) => {
      const res = await apiFetch(`/api/projects/${project.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: vars.title,
          assigned_to: vars.assigned_to || null,
          status: "pending",
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to add task")
      return payload.data
    },
    onSuccess: () => {
      toast.success("Task added successfully")
      setNewTitle("")
      setNewSupervisor("")
      void queryClient.invalidateQueries({ queryKey })
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to add task")
    },
  })

  // Update task mutation
  const updateTaskMutation = useMutation({
    mutationFn: async (vars: { task_id: string; status?: string; assigned_to?: string }) => {
      const res = await apiFetch(`/api/projects/${project.id}/tasks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to update task")
      return payload.data
    },
    onSuccess: () => {
      toast.success("Task updated successfully")
      void queryClient.invalidateQueries({ queryKey })
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update task")
    },
  })

  // Delete task mutation
  const deleteTaskMutation = useMutation({
    mutationFn: async (task_id: string) => {
      const res = await apiFetch(`/api/projects/${project.id}/tasks?task_id=${task_id}`, {
        method: "DELETE",
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to delete task")
      return payload
    },
    onSuccess: () => {
      toast.success("Task deleted successfully")
      void queryClient.invalidateQueries({ queryKey })
      void queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete task")
    },
  })

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    addTaskMutation.mutate({ title: newTitle.trim(), assigned_to: newSupervisor })
  }

  const handleStatusChange = (taskId: string, newStatus: string) => {
    updateTaskMutation.mutate({ task_id: taskId, status: newStatus })
  }

  const handleSupervisorChange = (taskId: string, newAssignedTo: string) => {
    updateTaskMutation.mutate({ task_id: taskId, assigned_to: newAssignedTo })
  }

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
        <Loader2 className="text-primary h-4 w-4 animate-spin" />
        <span>Loading project tasks...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/10 bg-red-500/5 p-4 text-sm text-red-500">
        Failed to load tasks: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    )
  }

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between border-b pb-2">
        <h4 className="text-foreground text-sm font-bold">Project Tasks &amp; Milestones ({tasks.length})</h4>
        <span className="text-muted-foreground text-xs">
          Parent project: <b className="font-semibold">{project.project_name}</b>
        </span>
      </div>

      {/* TASK LIST TABLE */}
      {tasks.length === 0 ? (
        <p className="text-muted-foreground bg-muted/10 rounded-md py-4 text-center text-sm italic">
          No tasks defined for this project yet. Add one below.
        </p>
      ) : (
        <div className="bg-card overflow-x-auto rounded-md border">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-muted/80 text-muted-foreground font-semibold">
              <tr>
                <th className="w-12 px-4 py-2.5 text-left text-xs">S/N</th>
                <th className="px-4 py-2.5 text-left text-xs">Task Activity / Description</th>
                <th className="w-48 px-4 py-2.5 text-left text-xs">Supervisor</th>
                <th className="w-36 px-4 py-2.5 text-left text-xs">Status</th>
                <th className="w-16 px-4 py-2.5 text-center text-xs">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {tasks.map((task, idx) => (
                <tr key={task.id} className="hover:bg-muted/30 transition-colors">
                  <td className="text-muted-foreground px-4 py-2.5 font-medium">{idx + 1}</td>
                  <td className="text-foreground px-4 py-2.5 font-medium">{task.title}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={task.assigned_to || ""}
                      onChange={(e) => handleSupervisorChange(task.id, e.target.value)}
                      className="border-input focus:ring-ring h-8 w-full rounded border bg-transparent px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                    >
                      <option value="">Unassigned</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name || `${p.first_name} ${p.last_name}`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={task.status}
                      onChange={(e) => handleStatusChange(task.id, e.target.value)}
                      className="border-input focus:ring-ring h-8 w-full rounded border bg-transparent px-2 py-1 text-xs font-semibold focus:ring-1 focus:outline-none"
                    >
                      <option value="pending" className="text-muted-foreground">
                        Pending
                      </option>
                      <option value="in_progress" className="text-amber-500">
                        Ongoing
                      </option>
                      <option value="completed" className="text-blue-500">
                        Completed
                      </option>
                      <option value="cancelled" className="text-slate-500">
                        Cancelled
                      </option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this task?")) {
                          deleteTaskMutation.mutate(task.id)
                        }
                      }}
                      className="h-8 w-8 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ADD NEW TASK FORM */}
      <form
        onSubmit={handleAddTask}
        className="bg-muted/10 flex flex-col gap-3 rounded-lg border border-dashed p-3 pt-2 sm:flex-row"
      >
        <div className="flex-1 space-y-1">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New task description (e.g. Generation Asset Procurement)"
            required
            className="h-9 text-sm"
          />
        </div>
        <div className="w-full sm:w-48">
          <select
            value={newSupervisor}
            onChange={(e) => setNewSupervisor(e.target.value)}
            className="border-input bg-background focus:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus:ring-1 focus:outline-none"
          >
            <option value="">Supervisor (Optional)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || `${p.first_name} ${p.last_name}`}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" className="h-9 shrink-0 self-stretch px-4" disabled={addTaskMutation.isPending}>
          {addTaskMutation.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1 h-4 w-4" />
          )}
          Add Task
        </Button>
      </form>
    </div>
  )
}
