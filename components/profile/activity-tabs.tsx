"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Package,
  CheckSquare,
  FileText,
  MessageSquare,
  Mail,
  LifeBuoy,
  CreditCard,
  Calendar,
  Clock,
} from "lucide-react"
import type {
  Task,
  Asset,
  Documentation,
  Feedback,
  CorrespondenceItem,
  HelpDeskItem,
  PaymentItem,
  LeaveItem,
  AttendanceItem,
} from "@/app/(app)/profile/page"

function getStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case "completed":
    case "resolved":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "pending":
    case "open":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "assigned":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function getPriorityColor(priority: string): string {
  switch (priority?.toLowerCase()) {
    case "high":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "low":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

interface ActivityTabsProps {
  tasks: Task[]
  assets: Asset[]
  documentation: Documentation[]
  feedback: Feedback[]
  correspondence: CorrespondenceItem[]
  helpDesk: HelpDeskItem[]
  payments: PaymentItem[]
  leave: LeaveItem[]
  attendance: AttendanceItem[]
}

export function ActivityTabs({
  tasks,
  assets,
  documentation,
  feedback,
  correspondence,
  helpDesk,
  payments,
  leave,
  attendance,
}: ActivityTabsProps) {
  const [activeTab, setActiveTab] = useState("assets")
  const tableContainerClass = "max-h-[20rem] overflow-y-auto overflow-x-auto rounded-lg border"

  const viewAllMeta = useMemo(() => {
    switch (activeTab) {
      case "tasks":
        return { count: tasks.length, href: "/tasks", label: "View all tasks" }
      case "documentation":
        return { count: documentation.length, href: "/documentation/internal", label: "View all docs" }
      case "feedback":
        return { count: feedback.length, href: "/feedback", label: "View all feedback" }
      case "correspondence":
        return { count: correspondence.length, href: "/correspondence", label: "View all correspondence" }
      case "helpdesk":
        return { count: helpDesk.length, href: "/help-desk", label: "View all help desk tickets" }
      case "payments":
        return { count: payments.length, href: "/payments", label: "View all payments" }
      case "leave":
        return { count: leave.length, href: "/leave", label: "View all leave records" }
      case "attendance":
        return { count: attendance.length, href: "/attendance", label: "View all attendance records" }
      case "assets":
      default:
        return { count: assets.length, href: "/assets", label: "View all assets" }
    }
  }, [
    activeTab,
    assets.length,
    attendance.length,
    correspondence.length,
    documentation.length,
    feedback.length,
    helpDesk.length,
    leave.length,
    payments.length,
    tasks.length,
  ])

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Activity Tab</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="assets" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 inline-flex h-auto w-full max-w-full justify-start overflow-x-auto p-1 whitespace-nowrap">
            <TabsTrigger value="assets" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Assets</span>
              <span>({assets.length})</span>
            </TabsTrigger>
            <TabsTrigger value="tasks" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <CheckSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Tasks</span>
              <span>({tasks.length})</span>
            </TabsTrigger>
            <TabsTrigger value="documentation" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Documentation</span>
              <span>({documentation.length})</span>
            </TabsTrigger>
            <TabsTrigger value="feedback" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Feedback</span>
              <span>({feedback.length})</span>
            </TabsTrigger>
            <TabsTrigger value="correspondence" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <Mail className="h-4 w-4" />
              <span>Correspondence ({correspondence.length})</span>
            </TabsTrigger>
            <TabsTrigger value="helpdesk" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <LifeBuoy className="h-4 w-4" />
              <span>Help Desk ({helpDesk.length})</span>
            </TabsTrigger>
            <TabsTrigger value="payments" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <CreditCard className="h-4 w-4" />
              <span>Payments ({payments.length})</span>
            </TabsTrigger>
            <TabsTrigger value="leave" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <Calendar className="h-4 w-4" />
              <span>Leave ({leave.length})</span>
            </TabsTrigger>
            <TabsTrigger value="attendance" className="shrink-0 gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm">
              <Clock className="h-4 w-4" />
              <span>Attendance ({attendance.length})</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks">
            {tasks.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task, index) => (
                      <TableRow key={task.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{task.title}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(task.status)}>{task.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                        </TableCell>
                        <TableCell>{task.due_date ? new Date(task.due_date).toLocaleDateString() : "-"}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/tasks?taskId=${task.id}`}
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                          >
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <CheckSquare className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No tasks assigned</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="assets">
            {assets.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Asset Type</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Assignment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset, index) => (
                      <TableRow key={asset.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{asset.asset_type}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {asset.unique_code || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell>{asset.asset_model || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {asset.assignment_type === "department" && "Dept"}
                            {asset.assignment_type === "office" && "Office"}
                            {asset.assignment_type === "individual" && "Personal"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(asset.status)}>{asset.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href="/assets" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <Package className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No assets assigned</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="documentation">
            {documentation.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documentation.map((doc, index) => (
                      <TableRow key={doc.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{doc.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{doc.category || "N/A"}</Badge>
                        </TableCell>
                        <TableCell>{new Date(doc.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/documentation/internal?docId=${doc.id}`}
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                          >
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <FileText className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No documentation created</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="feedback">
            {feedback.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedback.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.feedback_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>{new Date(item.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/feedback?feedbackId=${item.id}`}
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                          >
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <MessageSquare className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No feedback submitted</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="correspondence">
            {correspondence.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {correspondence.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{item.reference_number}</TableCell>
                        <TableCell>{item.subject}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>{new Date(item.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <Link href="/correspondence" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <Mail className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No correspondence records yet</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="helpdesk">
            {helpDesk.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Ticket</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {helpDesk.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{item.ticket_number}</TableCell>
                        <TableCell>{item.title}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getPriorityColor(item.priority)}>{item.priority}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href="/help-desk" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <LifeBuoy className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No help desk tickets found</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="payments">
            {payments.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.payment_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {item.amount != null
                            ? `${item.currency || "NGN"} ${Number(item.amount).toLocaleString()}`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href="/payments" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <CreditCard className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No payment records found</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="leave">
            {leave.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leave.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">{item.leave_type}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>{new Date(item.start_date).toLocaleDateString()}</TableCell>
                        <TableCell>{new Date(item.end_date).toLocaleDateString()}</TableCell>
                        <TableCell>{item.days_requested}</TableCell>
                        <TableCell className="text-right">
                          <Link href="/leave" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <Calendar className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No leave records found</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="attendance">
            {attendance.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Clock In</TableHead>
                      <TableHead>Clock Out</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell>{new Date(item.date).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>{item.clock_in ? new Date(item.clock_in).toLocaleTimeString() : "-"}</TableCell>
                        <TableCell>{item.clock_out ? new Date(item.clock_out).toLocaleTimeString() : "-"}</TableCell>
                        <TableCell className="text-right">
                          <Link href="/attendance" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg border py-12 text-center">
                <Clock className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
                <p className="text-muted-foreground">No attendance records found</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <div className="mt-4 flex justify-start">
          <Link href={viewAllMeta.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {viewAllMeta.label}
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
