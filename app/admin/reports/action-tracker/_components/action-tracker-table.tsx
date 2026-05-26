"use client"

import { Fragment } from "react"
import { formatWATDateTime } from "@/lib/utils/date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  FileText,
  File as FileIcon,
  Presentation,
  Edit2,
  Trash2,
  MoreVertical,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { TableSkeleton } from "@/components/ui/query-states"
import { exportActionPointToPPTX, exportActionPointToXLSX, type ActionItem } from "@/lib/export-utils"
import { exportActionPointsDocx, exportActionPointsPdf } from "@/lib/action-points-export"
import { getOfficeWeekMonday } from "@/lib/meeting-week"

interface ActionTask {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  department: string
  due_date?: string
  week_number: number
  year: number
  original_week?: number
  work_item_number?: string
}

interface ActionTrackerTableProps {
  tasks: ActionTask[]
  loading: boolean
  expandedDepts: Set<string>
  onToggleDept: (dept: string) => void
  weekFilter: number
  yearFilter: number
  meetingDate?: string
  canMutateTask: (task: ActionTask) => boolean
  onStatusChange: (taskId: string, newStatus: string) => void
  onEdit: (task: ActionTask) => void
  onDeleteRequest: (taskId: string) => void
  getDeptStatus: (dept: string) => { label: string; color: string }
  statusColor: (status: string) => string
}

export function ActionTrackerTable({
  tasks,
  loading,
  expandedDepts,
  onToggleDept,
  weekFilter,
  yearFilter,
  meetingDate,
  canMutateTask,
  onStatusChange,
  onEdit,
  onDeleteRequest,
  getDeptStatus,
  statusColor,
}: ActionTrackerTableProps) {
  const deptsPresent = Array.from(new Set(tasks.map((t) => t.department))).sort()

  const resolveDueDate = (task: ActionTask) => {
    if (task.due_date) {
      const explicitDueDate = new Date(task.due_date)
      if (!Number.isNaN(explicitDueDate.getTime())) {
        return explicitDueDate
      }
    }

    const sunday = getOfficeWeekMonday(task.week_number, task.year)
    sunday.setDate(sunday.getDate() + 6)
    sunday.setHours(23, 59, 0, 0)
    return sunday
  }

  const formatDueDate = (task: ActionTask) => {
    return formatWATDateTime(resolveDueDate(task), { day: "2-digit", month: "short", year: "numeric" })
  }

  const getDueDateClassName = (task: ActionTask) => {
    const status = task.status.toLowerCase()
    if (status === "completed") {
      return "font-medium text-green-600 dark:text-green-400"
    }

    const dueDate = resolveDueDate(task)
    if (dueDate.getTime() < Date.now()) {
      return "font-semibold text-red-600 dark:text-red-400"
    }

    return "font-semibold text-yellow-600 dark:text-yellow-400"
  }

  return (
    <div className="bg-background dark:bg-card overflow-hidden rounded-lg border shadow-sm">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-[40px]"></TableHead>
            <TableHead className="font-bold">Department</TableHead>
            <TableHead className="font-bold">Tasks Count</TableHead>
            <TableHead className="text-center font-bold">Summary Status</TableHead>
            <TableHead className="w-[100px] text-right font-bold"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="p-4">
                <TableSkeleton rows={4} cols={4} />
              </TableCell>
            </TableRow>
          ) : deptsPresent.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground h-32 text-center font-medium">
                No actions found for this week.
              </TableCell>
            </TableRow>
          ) : (
            deptsPresent.map((dept) => {
              const deptActions = tasks.filter((t) => t.department === dept)
              const completedCount = deptActions.filter((a) => a.status === "completed").length
              const totalCount = deptActions.length
              const status = getDeptStatus(dept)
              const deptActionItemsForExport: ActionItem[] = deptActions.map((item) => ({
                id: item.id,
                title: item.title,
                description: item.description,
                department: item.department,
                status: item.status,
                week_number: item.week_number,
                year: item.year,
                original_week: item.original_week,
              }))

              return (
                <Fragment key={dept}>
                  <TableRow
                    className={cn(
                      "hover:bg-muted/30 cursor-pointer transition-colors",
                      expandedDepts.has(dept) && "bg-muted/50"
                    )}
                    onClick={() => onToggleDept(dept)}
                  >
                    <TableCell>
                      {expandedDepts.has(dept) ? (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      )}
                    </TableCell>
                    <TableCell className="text-foreground font-bold">{dept}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {completedCount} of {totalCount} items completed
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={cn("px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase", status.color)}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-8 text-xs font-medium">
                          {expandedDepts.has(dept) ? "Hide" : "View"}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                exportActionPointsPdf(
                                  deptActionItemsForExport,
                                  weekFilter,
                                  yearFilter,
                                  meetingDate,
                                  dept
                                )
                              }
                            >
                              <FileText className="mr-2 h-4 w-4" /> Export PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                exportActionPointsDocx(
                                  deptActionItemsForExport,
                                  weekFilter,
                                  yearFilter,
                                  meetingDate,
                                  dept
                                )
                              }
                            >
                              <FileIcon className="mr-2 h-4 w-4" /> Export Word
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                exportActionPointToPPTX(
                                  deptActionItemsForExport,
                                  weekFilter,
                                  yearFilter,
                                  meetingDate,
                                  dept
                                )
                              }
                            >
                              <Presentation className="mr-2 h-4 w-4" /> Export PPTX
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                exportActionPointToXLSX(
                                  deptActionItemsForExport,
                                  weekFilter,
                                  yearFilter,
                                  dept,
                                  meetingDate
                                )
                              }
                            >
                              <FileSpreadsheet className="mr-2 h-4 w-4" /> Export XLSX
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedDepts.has(dept) && (
                    <TableRow className="bg-muted/10 hover:bg-muted/10 border-t-0">
                      <TableCell colSpan={5} className="p-0">
                        <div className="animate-in slide-in-from-top-2 p-6 pt-2 duration-200">
                          <div className="bg-background overflow-hidden rounded-lg border shadow-sm">
                            <Table>
                              <TableHeader className="bg-muted/30">
                                <TableRow>
                                  <TableHead className="text-foreground w-[70px] text-[10px] font-black tracking-widest uppercase">
                                    #
                                  </TableHead>
                                  <TableHead className="text-foreground text-[10px] font-black tracking-widest uppercase">
                                    Action Item (Task)
                                  </TableHead>
                                  <TableHead className="text-foreground w-[150px] text-[10px] font-black tracking-widest uppercase">
                                    Status
                                  </TableHead>
                                  <TableHead className="text-foreground w-[170px] text-[10px] font-black tracking-widest uppercase">
                                    Due Date
                                  </TableHead>
                                  <TableHead className="w-[80px] text-right"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {deptActions.map((task, taskIndex) => (
                                  <TableRow key={task.id} className="hover:bg-muted/5">
                                    <TableCell className="text-muted-foreground text-xs font-semibold">
                                      {taskIndex + 1}
                                    </TableCell>
                                    <TableCell>
                                      <div className="text-sm font-semibold">{task.title}</div>
                                      {task.description && (
                                        <div className="text-muted-foreground mt-0.5 text-xs">{task.description}</div>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <Select
                                        value={task.status}
                                        disabled={!canMutateTask(task)}
                                        onValueChange={(val) => onStatusChange(task.id, val)}
                                      >
                                        <SelectTrigger
                                          className={cn(
                                            "h-8 w-full justify-between text-[11px] font-bold uppercase",
                                            statusColor(task.status)
                                          )}
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="pending" className="text-xs">
                                            Pending
                                          </SelectItem>
                                          <SelectItem value="not_started" className="text-xs">
                                            Not Started
                                          </SelectItem>
                                          <SelectItem value="in_progress" className="text-xs">
                                            In Progress
                                          </SelectItem>
                                          <SelectItem value="completed" className="text-xs">
                                            Completed
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className={cn("text-xs", getDueDateClassName(task))}>
                                      {formatDueDate(task)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-8 w-8">
                                            <MoreVertical className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem
                                            disabled={!canMutateTask(task)}
                                            onClick={() => onEdit(task)}
                                            className="gap-2"
                                          >
                                            <Edit2 className="h-4 w-4" /> Edit
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            disabled={!canMutateTask(task)}
                                            onClick={() => onDeleteRequest(task.id)}
                                            className="text-destructive gap-2"
                                          >
                                            <Trash2 className="h-4 w-4" /> Delete
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
