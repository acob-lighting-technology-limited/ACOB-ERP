"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/patterns"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { Building2, MessageSquare, TrendingUp, AlertCircle, CheckCircle2, Clock, HeadphonesIcon } from "lucide-react"
import type { Task } from "@/types/task"
import { formatWATDateTime } from "@/lib/utils/date"

interface TaskUpdate {
  id: string
  content?: string
  update_type: string
  created_at: string
  user?: {
    first_name: string
    last_name: string
  }
}

function getPriorityColor(priority: string) {
  switch (priority) {
    case "urgent":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "low":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "pending":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "cancelled":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4" />
    case "in_progress":
      return <TrendingUp className="h-4 w-4" />
    case "pending":
      return <Clock className="h-4 w-4" />
    case "cancelled":
      return <AlertCircle className="h-4 w-4" />
    default:
      return <Clock className="h-4 w-4" />
  }
}

function formatDateTime(dateString: string) {
  return formatWATDateTime(dateString)
}

interface UserTaskDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTask: Task | null
  taskUpdates: TaskUpdate[]
  newStatus: string
  isSaving: boolean
  onUpdateStatus: (status: string) => Promise<void>
}

export function UserTaskDetailsDialog({
  open,
  onOpenChange,
  selectedTask,
  taskUpdates,
  newStatus,
  isSaving,
  onUpdateStatus,
}: UserTaskDetailsDialogProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Task Details"
      description="Review and update quickly."
      desktopClassName="max-w-2xl"
    >
      {selectedTask && (
        <div className="space-y-3">
          <Card className="border">
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1">
                {selectedTask.work_item_number && (
                  <div className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
                    {selectedTask.work_item_number}
                  </div>
                )}
                <div className="text-foreground text-base leading-tight font-semibold">{selectedTask.title}</div>
                {selectedTask.description && (
                  <p className="text-muted-foreground text-xs leading-5">{selectedTask.description}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge className={getStatusColor(selectedTask.status)} variant="outline">
                  <span className="flex items-center gap-1 text-xs">
                    {getStatusIcon(selectedTask.status)}
                    {selectedTask.status.replace("_", " ")}
                  </span>
                </Badge>
                <Badge className={getPriorityColor(selectedTask.priority)} variant="outline">
                  {selectedTask.priority} priority
                </Badge>
                {selectedTask.department && (
                  <Badge variant="outline" className="text-xs">
                    {selectedTask.department}
                  </Badge>
                )}
                {selectedTask.source_type === "help_desk" && (
                  <Badge variant="outline" className="gap-1 text-xs">
                    <HeadphonesIcon className="h-3 w-3" />
                    Help Desk
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              {selectedTask.assignment_type === "department" && (
                <Card className="bg-muted/30 border">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Building2 className="h-3.5 w-3.5" />
                      Department Task
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-muted-foreground text-xs leading-5">
                      This task is assigned to the <strong>{selectedTask.department}</strong> department.
                    </p>
                    {!selectedTask.can_change_status && (
                      <p className="mt-2 text-[11px] text-yellow-600 dark:text-yellow-400">
                        Only department leads, admins, and super admins can change the status.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Activity Timeline
                </h3>
                {taskUpdates.length > 0 ? (
                  <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                    {taskUpdates.map((update) => (
                      <div key={update.id} className="border-l-2 pl-3">
                        {update.user && (
                          <p className="text-foreground text-xs font-medium">
                            {update.user.first_name} {update.user.last_name}
                          </p>
                        )}
                        <p className="text-muted-foreground text-xs leading-5">{update.content}</p>
                        <p className="text-muted-foreground mt-1 text-[11px]">{formatDateTime(update.created_at)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No updates yet"
                    description="Task comments and status changes will appear here."
                    icon={MessageSquare}
                    className="border-0 px-0 py-2"
                  />
                )}
              </section>
            </div>

            <div className="space-y-3">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Update Status</h3>
                <Select
                  value={newStatus}
                  onValueChange={onUpdateStatus}
                  disabled={isSaving || selectedTask.assignment_type === "department"}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                {selectedTask.assignment_type === "department" && (
                  <p className="text-[11px] text-yellow-600 dark:text-yellow-400">
                    Department task status can only be updated by leads from Admin Tasks.
                  </p>
                )}
                <p className="text-muted-foreground text-[11px]">
                  If you add a note below before changing status, it will be saved with the status update.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </ResponsiveModal>
  )
}
