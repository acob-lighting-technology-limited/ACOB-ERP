"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Ticket, HeadphonesIcon } from "lucide-react"
import type { Task } from "@/types/task"
import { formatWATDate } from "@/lib/utils/date"

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

interface TaskWorkflowTabsProps {
  allPendingWorkflowTasks: Task[]
  myTaskActionQueue: Task[]
  taskHistory: Task[]
  workflowOwnerLabel: (task: Task) => string
}

export function TaskWorkflowTabs({
  allPendingWorkflowTasks,
  myTaskActionQueue,
  taskHistory,
  workflowOwnerLabel,
}: TaskWorkflowTabsProps) {
  return (
    <Tabs defaultValue="pending" className="space-y-4">
      <TabsList>
        <TabsTrigger value="pending">Pending Queue ({allPendingWorkflowTasks.length})</TabsTrigger>
        <TabsTrigger value="history">History ({taskHistory.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="pending" className="space-y-4">
        <Card className="border-2">
          <CardHeader>
            <CardTitle>All Pending Task Workflow</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">S/N</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Current Owner</TableHead>
                  <TableHead>Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allPendingWorkflowTasks.map((task, index) => (
                  <TableRow key={task.id}>
                    <TableCell>{task.work_item_number || index + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{task.title}</span>
                        {getSourceBadge(task.source_type)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(task.status)}>{task.status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                    </TableCell>
                    <TableCell>{workflowOwnerLabel(task)}</TableCell>
                    <TableCell>{task.due_date ? formatDate(task.due_date) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader>
            <CardTitle>My Action Queue</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">S/N</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myTaskActionQueue.map((task, index) => (
                  <TableRow key={task.id}>
                    <TableCell>{task.work_item_number || index + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{task.title}</span>
                        {getSourceBadge(task.source_type)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(task.status)}>{task.status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                    </TableCell>
                    <TableCell>{task.due_date ? formatDate(task.due_date) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="history">
        <Card className="border-2">
          <CardHeader>
            <CardTitle>Task History</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">S/N</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Current Owner</TableHead>
                  <TableHead>Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taskHistory.map((task, index) => (
                  <TableRow key={task.id}>
                    <TableCell>{task.work_item_number || index + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{task.title}</span>
                        {getSourceBadge(task.source_type)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(task.status)}>{task.status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                    </TableCell>
                    <TableCell>{workflowOwnerLabel(task)}</TableCell>
                    <TableCell>{task.due_date ? formatDate(task.due_date) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
