"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/patterns"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { ClipboardList, Edit, Trash2, Calendar, User, Building2, Ticket, HeadphonesIcon } from "lucide-react"
import { formatName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import type { Task } from "@/types/task"

type TaskAssignee = NonNullable<Task["assigned_to_user"]>

interface TaskListViewProps {
  filteredTasks: Task[]
  viewMode: "list" | "card"
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  searchQuery: string
  statusFilter: string
  priorityFilter: string
  showSerialNumber?: boolean
}

function getStatusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "pending":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function getPriorityColor(priority: string) {
  switch (priority) {
    case "urgent":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
    case "medium":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "low":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function formatDate(dateString: string) {
  return formatWATDate(dateString, { month: "short", day: "numeric", year: "numeric" })
}

function getSourceBadge(sourceType?: string) {
  switch (sourceType) {
    case "help_desk":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-purple-200 text-[10px] text-purple-600 dark:border-purple-800 dark:text-purple-400"
        >
          <HeadphonesIcon className="h-2.5 w-2.5" /> Help Desk
        </Badge>
      )
    case "action_item":
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-200 text-[10px] text-amber-600 dark:border-amber-800 dark:text-amber-400"
        >
          <Ticket className="h-2.5 w-2.5" /> Action
        </Badge>
      )
    default:
      return null
  }
}

function buildTaskInfo(task: Task) {
  const sourceLabel =
    task.source_type === "help_desk"
      ? "Help Desk request"
      : task.source_type === "action_item"
        ? "Meeting action point"
        : "Manual task"

  const ownerLabel =
    task.assignment_type === "department" && task.department
      ? `${task.department} department is responsible for moving this item forward.`
      : task.assigned_to_user
        ? `${formatName((task.assigned_to_user as TaskAssignee)?.first_name)} ${formatName((task.assigned_to_user as TaskAssignee)?.last_name)} is currently responsible.`
        : "This item has not been assigned yet."

  return {
    title: task.work_item_number ? `${task.work_item_number} task guide` : "Task guide",
    summary: "This explains what the task is, where it came from, and what the next handler is expected to do.",
    details: [
      { label: "What this item is", value: `${task.title} is tracked as a ${sourceLabel.toLowerCase()}.` },
      {
        label: "Current responsibility",
        value: ownerLabel,
      },
      {
        label: "What to do next",
        value:
          task.status === "completed"
            ? "This item is already finished. Reopen it only if there is more work to do or the completion needs correction."
            : task.status === "cancelled"
              ? "This item has been stopped. Review the timeline or notes before restarting it."
              : "Review the description, carry out the work or requested change, then update the status and leave a note if the next person needs context.",
      },
    ],
  }
}

function copyWorkItemNumber(value: string | null | undefined) {
  if (!value) return
  void navigator.clipboard.writeText(value)
}

export function TaskListView({
  filteredTasks,
  viewMode,
  onEdit,
  onDelete,
  searchQuery,
  statusFilter,
  priorityFilter,
  showSerialNumber = false,
}: TaskListViewProps) {
  if (filteredTasks.length === 0) {
    return (
      <Card className="border-2">
        <CardContent className="p-12 text-center">
          <EmptyState
            icon={ClipboardList}
            title="No Tasks Found"
            description={
              searchQuery || statusFilter !== "all" || priorityFilter !== "all"
                ? "No tasks match your filters."
                : "Get started by creating your first task."
            }
          />
        </CardContent>
      </Card>
    )
  }

  if (viewMode === "list") {
    return (
      <Card className="border-2">
        <div className="table-responsive">
          <Table>
            <TableHeader>
              <TableRow>
                {showSerialNumber ? <TableHead className="w-12">S/N</TableHead> : null}
                <TableHead className="w-12">#</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task, index) => (
                <TableRow key={task.id}>
                  {showSerialNumber ? (
                    <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                  ) : null}
                  <TableCell className="text-muted-foreground font-medium">
                    {task.work_item_number || index + 1}
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="flex items-center gap-2">
                        {task.work_item_number && (
                          <button
                            type="button"
                            onClick={() => copyWorkItemNumber(task.work_item_number)}
                            className="font-mono text-xs font-semibold text-slate-600 hover:underline"
                          >
                            {task.work_item_number}
                          </button>
                        )}
                        <span className="text-foreground font-medium">{task.title}</span>
                        {getSourceBadge(task.source_type)}
                        <ItemInfoButton {...buildTaskInfo(task)} />
                      </div>
                      {task.description && (
                        <div className="text-muted-foreground mt-1 line-clamp-1 text-sm">{task.description}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {task.assignment_type === "department" && task.department ? (
                      <div className="text-sm">
                        <div className="text-foreground flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          <span>{task.department}</span>
                        </div>
                        <div className="text-muted-foreground text-xs">Department</div>
                      </div>
                    ) : task.assigned_to_user ? (
                      <div className="text-sm">
                        <div className="text-foreground">
                          {formatName((task.assigned_to_user as TaskAssignee)?.first_name)}{" "}
                          {formatName((task.assigned_to_user as TaskAssignee)?.last_name)}
                        </div>
                        {task.department && <div className="text-muted-foreground text-xs">{task.department}</div>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(task.status)}>{task.status.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    {task.due_date ? (
                      <span className="text-foreground text-sm">{formatDate(task.due_date)}</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">No due date</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1 sm:gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(task)}
                        className="h-8 w-8 p-0"
                        title="Edit task"
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onDelete(task)}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                        title="Delete task"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {filteredTasks.map((task) => (
        <Card key={task.id} className="border-2 transition-shadow hover:shadow-lg">
          <CardHeader className="from-primary/5 to-background border-b bg-gradient-to-r">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-start gap-2">
                  <div className="space-y-1">
                    {task.work_item_number && (
                      <button
                        type="button"
                        onClick={() => copyWorkItemNumber(task.work_item_number)}
                        className="font-mono text-xs font-semibold text-slate-600 hover:underline"
                      >
                        {task.work_item_number}
                      </button>
                    )}
                    <CardTitle className="text-lg">{task.title}</CardTitle>
                  </div>
                  <ItemInfoButton {...buildTaskInfo(task)} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge className={getStatusColor(task.status)}>{task.status.replace("_", " ")}</Badge>
                  <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {task.description && <p className="text-muted-foreground line-clamp-2 text-sm">{task.description}</p>}

            {task.assignment_type === "department" && task.department ? (
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground">Department:</span>
                <span className="text-foreground font-medium">{task.department}</span>
              </div>
            ) : (
              task.assigned_to_user && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="text-muted-foreground h-4 w-4" />
                  <span className="text-muted-foreground">Assigned to:</span>
                  <span className="text-foreground font-medium">
                    {formatName((task.assigned_to_user as TaskAssignee)?.first_name)}{" "}
                    {formatName((task.assigned_to_user as TaskAssignee)?.last_name)}
                  </span>
                </div>
              )
            )}

            {task.due_date && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground">Due:</span>
                <span className="text-foreground">{formatDate(task.due_date)}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => onEdit(task)} className="flex-1 gap-2">
                <Edit className="h-3 w-3" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(task)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
