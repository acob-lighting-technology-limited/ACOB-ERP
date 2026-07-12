"use client"

import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Loader2, User } from "lucide-react"

export interface TaskRow {
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

interface ProjectTaskViewerProps {
  projectId: string
  projectName: string
}

export function ProjectTaskViewer({ projectId, projectName }: ProjectTaskViewerProps) {
  // Query tasks for the project
  const {
    data: tasks = [],
    isLoading,
    error,
  } = useQuery<TaskRow[]>({
    queryKey: ["user-project-tasks", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/tasks`, { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to fetch project tasks")
      return payload.data
    },
  })

  // Format task status badges
  const renderTaskStatus = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-500">Completed</Badge>
      case "in_progress":
        return <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-500">Ongoing</Badge>
      case "pending":
        return <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-500">Pending</Badge>
      case "cancelled":
        return <Badge className="border-slate-500/20 bg-slate-500/10 text-slate-500">Cancelled</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-sm">
        <Loader2 className="text-primary h-4 w-4 animate-spin" />
        <span>Loading project task tracking list...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/10 bg-red-500/5 p-4 text-sm text-red-500">
        Failed to load task tracking details: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3">
      <div className="mb-2 flex items-center justify-between border-b pb-2">
        <h4 className="text-foreground text-sm font-bold">Project Deployment Task List</h4>
        <span className="text-muted-foreground text-xs">
          Scope: <b className="font-semibold">{projectName}</b>
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground bg-muted/10 rounded-md py-4 text-center text-sm italic">
          No tasks defined for this project.
        </p>
      ) : (
        <div className="bg-card overflow-x-auto rounded-md border">
          <table className="divide-border min-w-full divide-y text-sm">
            <thead className="bg-muted/80 text-muted-foreground font-semibold">
              <tr>
                <th className="w-12 px-4 py-2 text-left text-xs">S/N</th>
                <th className="px-4 py-2 text-left text-xs">Task Activity / Description</th>
                <th className="w-56 px-4 py-2 text-left text-xs">Supervisor</th>
                <th className="w-36 px-4 py-2 text-left text-xs">Status</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {tasks.map((task, idx) => (
                <tr key={task.id} className="hover:bg-muted/30 transition-colors">
                  <td className="text-muted-foreground px-4 py-2 font-medium">{idx + 1}</td>
                  <td className="text-foreground px-4 py-2 font-medium">{task.title}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      <User className="text-muted-foreground h-3 w-3" />
                      <span>
                        {task.assigned_user?.full_name ||
                          [task.assigned_user?.first_name, task.assigned_user?.last_name].filter(Boolean).join(" ") ||
                          "Unassigned"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2">{renderTaskStatus(task.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
