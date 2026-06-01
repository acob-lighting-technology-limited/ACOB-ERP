"use client"

import { Fragment } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  FileText,
  File as FileIcon,
  Presentation,
  MoreVertical,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { exportActionPointToPPTX, exportActionPointToXLSX, type ActionItem } from "@/lib/export-utils"
import { exportActionPointsDocx, exportActionPointsPdf } from "@/lib/action-points-export"
import type { ActionTask } from "../_lib/queries"

interface DeptStatus {
  label: string
  color: string
}

interface DeptActionRowsProps {
  deptsPresent: string[]
  filteredTasks: ActionTask[]
  expandedDepts: Set<string>
  onToggleDept: (dept: string) => void
  profile: {
    id?: string
    role?: string | null
    department?: string | null
    is_department_lead?: boolean | null
    lead_departments?: string[] | null
    admin_routes?: string[] | null
  } | null
  week: number
  year: number
  meetingDate?: string
  onStatusChange: (taskId: string, newStatus: string) => void
  getDeptStatus: (dept: string) => DeptStatus
  statusColor: (status: string) => string
  allowStatusEdit?: boolean
}

export function DeptActionRows({
  deptsPresent,
  filteredTasks,
  expandedDepts,
  onToggleDept,
  profile,
  week,
  year,
  meetingDate,
  onStatusChange,
  getDeptStatus,
  statusColor,
  allowStatusEdit = true,
}: DeptActionRowsProps) {
  return (
    <>
      {deptsPresent.map((dept) => {
        const deptActions = filteredTasks.filter((t) => t.department === dept)
        const completed = deptActions.filter((a) => a.status === "completed").length
        const total = deptActions.length
        const status = getDeptStatus(dept)
        const isMyDept = allowStatusEdit && profile?.department === dept
        const deptActionItemsForExport: ActionItem[] = deptActions.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          department: item.department,
          status: item.status,
          week_number: item.week_number,
          year: item.year,
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
                  <ChevronDown className="text-primary h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                )}
              </TableCell>
              <TableCell className="font-bold">{dept}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {completed} of {total} completed
              </TableCell>
              <TableCell className="text-center">
                <Badge className={cn("px-2.5 py-1 text-[10px] font-bold uppercase", status.color)}>
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
                        onClick={() => exportActionPointsPdf(deptActionItemsForExport, week, year, meetingDate, dept)}
                      >
                        <FileText className="mr-2 h-4 w-4" /> Export PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => exportActionPointsDocx(deptActionItemsForExport, week, year, meetingDate, dept)}
                      >
                        <FileIcon className="mr-2 h-4 w-4" /> Export Word
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => exportActionPointToPPTX(deptActionItemsForExport, week, year, meetingDate, dept)}
                      >
                        <Presentation className="mr-2 h-4 w-4" /> Export PPTX
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => exportActionPointToXLSX(deptActionItemsForExport, week, year, dept, meetingDate)}
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
                              Action Description
                            </TableHead>
                            <TableHead className="text-foreground w-[180px] text-[10px] font-black tracking-widest uppercase">
                              Status
                            </TableHead>
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
                                {isMyDept ? (
                                  <Select value={task.status} onValueChange={(val) => onStatusChange(task.id, val)}>
                                    <SelectTrigger
                                      className={cn("h-8 text-[11px] font-bold uppercase", statusColor(task.status))}
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
                                ) : (
                                  <Badge
                                    className={cn(
                                      "px-2.5 py-1 text-[10px] font-bold uppercase",
                                      statusColor(task.status)
                                    )}
                                  >
                                    {task.status.replace("_", " ")}
                                  </Badge>
                                )}
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
      })}
    </>
  )
}
