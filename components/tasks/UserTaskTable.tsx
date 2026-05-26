"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  ClipboardList,
  Calendar,
  User,
  Building2,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  HeadphonesIcon,
} from "lucide-react"
import { formatName } from "@/lib/utils"
import type { Task } from "@/types/task"
import { formatWATDateTime } from "@/lib/utils/date"

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

function formatDueDate(dateString: string) {
  return formatWATDateTime(dateString, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function getDueDateClassName(task: Task) {
  if (!task.due_date) return "text-muted-foreground"

  const status = String(task.status || "").toLowerCase()
  if (["completed", "cancelled", "closed", "archived"].includes(status)) {
    return "font-medium text-green-600 dark:text-green-400"
  }

  const dueDate = new Date(task.due_date)
  if (Number.isNaN(dueDate.getTime())) {
    return "text-muted-foreground"
  }

  if (dueDate.getTime() < Date.now()) {
    return "font-semibold text-red-600 dark:text-red-400"
  }

  return "font-semibold text-yellow-600 dark:text-yellow-400"
}

function buildTaskInfo(task: Task) {
  const sourceLabel =
    task.source_type === "help_desk"
      ? "help desk request"
      : task.source_type === "action_item"
        ? "meeting action point"
        : "task"

  const assignmentLabel = task.assignment_type === "department" ? "Dept" : "Individual"

  return {
    title: task.work_item_number ? `${task.work_item_number} task guide` : "Task guide",
    summary: "This explains what the task means and what should happen next.",
    details: [
      {
        label: "What this item is",
        value: `${task.title} is tracked as a ${sourceLabel}.`,
      },
      {
        label: "Assignment type",
        value: `This is a ${assignmentLabel.toLowerCase()} task and is currently in ${task.status.replace("_", " ")} status.`,
      },
      {
        label: "What to do next",
        value:
          task.status === "completed"
            ? "This task is already complete. Reopen it only if more work is needed."
            : "Open the task, review the description, carry out the work, and update the status with a clear note when progress changes.",
      },
    ],
  }
}

interface UserTaskTableProps {
  filteredTasks: Task[]
  filterStatus: string
  assignmentFilter: "individual" | "department"
  onViewTask: (task: Task) => void
}

export function UserTaskTable({ filteredTasks, filterStatus, assignmentFilter, onViewTask }: UserTaskTableProps) {
  if (filteredTasks.length === 0) {
    const assignmentLabel = assignmentFilter === "department" ? "Dept" : "Individual"
    return (
      <Card className="border-2">
        <CardContent className="p-12 text-center">
          <ClipboardList className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
          <h3 className="text-foreground mb-2 text-xl font-semibold">
            {filterStatus === "all"
              ? `No ${assignmentLabel} Tasks`
              : `No ${assignmentLabel} ${filterStatus.replace("_", " ")} Tasks`}
          </h3>
          <p className="text-muted-foreground">
            {filterStatus === "all"
              ? `You don't have any ${assignmentLabel.toLowerCase()} tasks at the moment.`
              : "Try selecting a different status to view other tasks."}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">S/N</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Assigned By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTasks.map((task, index) => (
              <TableRow key={task.id} className="hover:bg-muted/50 cursor-pointer" onClick={() => onViewTask(task)}>
                <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="bg-primary/10 rounded-lg p-2">
                      <ClipboardList className="text-primary h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium">{task.title}</span>
                        <ItemInfoButton {...buildTaskInfo(task)} />
                        {task.source_type === "help_desk" && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <HeadphonesIcon className="h-2.5 w-2.5" />
                            Help Desk
                          </Badge>
                        )}
                        {task.source_type === "action_item" && (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            Action Point
                          </Badge>
                        )}
                      </div>
                      {task.work_item_number && (
                        <div className="text-muted-foreground text-xs">{task.work_item_number}</div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={getStatusColor(task.status)}>
                    <span className="flex items-center gap-1">
                      {getStatusIcon(task.status)}
                      {task.status.replace("_", " ")}
                    </span>
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                </TableCell>
                <TableCell>
                  {task.assignment_type === "department" ? (
                    <Badge variant="outline" className="flex w-fit items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      Dept
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="flex w-fit items-center gap-1">
                      <User className="h-3 w-3" />
                      Individual
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {task.due_date ? (
                    <div className={`flex items-center gap-1 text-sm ${getDueDateClassName(task)}`}>
                      <Calendar className="text-muted-foreground h-3 w-3" />
                      <span>{formatDueDate(task.due_date)}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {task.assigned_by_user ? (
                    <div className="flex items-center gap-1 text-sm">
                      <User className="text-muted-foreground h-3 w-3" />
                      <span>
                        {formatName(task.assigned_by_user.first_name)} {formatName(task.assigned_by_user.last_name)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onViewTask(task)
                    }}
                    className="h-8 w-8 p-0 sm:h-auto sm:w-auto sm:p-2"
                    title="View task details"
                  >
                    <Eye className="h-3 w-3 sm:mr-1 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">View</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
