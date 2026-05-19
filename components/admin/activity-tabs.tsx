"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Calendar,
  CheckSquare,
  Clock,
  CreditCard,
  FileText,
  LifeBuoy,
  Mail,
  MessageSquare,
  Package,
} from "lucide-react"

export interface AdminAssetActivityRow {
  id: string
  asset_type: string | null
  asset_model: string | null
  unique_code: string | null
  status: string | null
  assignment_type: string | null
  department: string | null
  office_location: string | null
  created_at: string | null
}

export interface AdminTaskActivityRow {
  id: string
  title: string
  status: string | null
  priority: string | null
  department: string | null
  due_date: string | null
  created_at: string
}

export interface AdminDocumentationActivityRow {
  id: string
  title: string
  category: string | null
  user_id: string | null
  created_at: string
}

export interface AdminFeedbackActivityRow {
  id: string
  feedback_type: string
  title: string
  status: string | null
  user_id: string | null
  created_at: string
}

export interface AdminCorrespondenceActivityRow {
  id: string
  reference_number: string
  subject: string
  status: string | null
  department_name: string | null
  assigned_department_name: string | null
  created_at: string
}

export interface AdminHelpDeskActivityRow {
  id: string
  ticket_number: string
  title: string
  status: string | null
  priority: string | null
  service_department: string | null
  requester_id: string | null
  created_at: string
}

export interface AdminPaymentActivityRow {
  id: string
  title: string
  payment_type: string
  status: string | null
  amount: number | null
  currency: string | null
  payment_date: string | null
  created_at: string
}

export interface AdminLeaveActivityRow {
  id: string
  user_id: string
  request_kind: string | null
  status: string | null
  start_date: string
  end_date: string
  days_count: number | null
  created_at: string
}

export interface AdminAttendanceActivityRow {
  id: string
  user_id: string
  date: string
  status: string | null
  clock_in: string | null
  clock_out: string | null
  created_at: string
}

interface AdminActivityTabsProps {
  assets: AdminAssetActivityRow[]
  tasks: AdminTaskActivityRow[]
  documentation: AdminDocumentationActivityRow[]
  feedback: AdminFeedbackActivityRow[]
  correspondence: AdminCorrespondenceActivityRow[]
  helpDesk: AdminHelpDeskActivityRow[]
  payments: AdminPaymentActivityRow[]
  leave: AdminLeaveActivityRow[]
  attendance: AdminAttendanceActivityRow[]
}

function getStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case "completed":
    case "resolved":
    case "approved":
    case "paid":
    case "present":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
    case "under_review":
    case "assigned":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "pending":
    case "open":
    case "new":
    case "due":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "urgent":
    case "overdue":
    case "rejected":
    case "absent":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function getPriorityColor(priority: string | null): string {
  switch (priority?.toLowerCase()) {
    case "urgent":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
    case "medium":
    case "normal":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "low":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "-"
  return new Date(dateString).toLocaleDateString()
}

function formatTime(timeString: string | null): string {
  if (!timeString) return "-"
  return timeString.slice(0, 5)
}

function EmptyTab({ icon: Icon, message }: { icon: typeof Package; message: string }) {
  return (
    <div className="bg-muted/30 rounded-lg border py-12 text-center">
      <Icon className="text-muted-foreground/50 mx-auto mb-3 h-10 w-10" />
      <p className="text-muted-foreground">{message}</p>
    </div>
  )
}

export function AdminActivityTabs({
  assets,
  tasks,
  documentation,
  feedback,
  correspondence,
  helpDesk,
  payments,
  leave,
  attendance,
}: AdminActivityTabsProps) {
  const [activeTab, setActiveTab] = useState("assets")
  const tableContainerClass = "max-h-[20rem] overflow-y-auto overflow-x-auto rounded-lg border"

  const viewAllMeta = useMemo(() => {
    switch (activeTab) {
      case "tasks":
        return { href: "/admin/tasks", label: "View all tasks" }
      case "documentation":
        return { href: "/admin/documentation", label: "View all docs" }
      case "feedback":
        return { href: "/admin/feedback", label: "View all feedback" }
      case "correspondence":
        return { href: "/admin/correspondence", label: "View all correspondence" }
      case "helpdesk":
        return { href: "/admin/help-desk", label: "View all help desk tickets" }
      case "payments":
        return { href: "/admin/finance/payments", label: "View all payments" }
      case "leave":
        return { href: "/admin/hr/leave", label: "View all leave records" }
      case "attendance":
        return { href: "/admin/hr/attendance", label: "View all attendance records" }
      case "assets":
      default:
        return { href: "/admin/assets", label: "View all assets" }
    }
  }, [activeTab])

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

          <TabsContent value="assets">
            {assets.length > 0 ? (
              <div className={tableContainerClass}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">S/N</TableHead>
                      <TableHead>Asset Type</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Assignment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset, index) => (
                      <TableRow key={asset.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-medium">
                          {asset.asset_type || asset.asset_model || "Asset"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {asset.unique_code || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {asset.department || asset.office_location || asset.assignment_type || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(asset.status)}>{asset.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href="/admin/assets" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyTab icon={Package} message="No assets found" />
            )}
          </TabsContent>

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
                          <Badge className={getStatusColor(task.status)}>{task.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getPriorityColor(task.priority)}>{task.priority || "normal"}</Badge>
                        </TableCell>
                        <TableCell>{formatDate(task.due_date)}</TableCell>
                        <TableCell className="text-right">
                          <Link href="/admin/tasks" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyTab icon={CheckSquare} message="No tasks found" />
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
                        <TableCell>{formatDate(doc.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href="/admin/documentation"
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
              <EmptyTab icon={FileText} message="No documentation found" />
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
                          <Badge className={getStatusColor(item.status)}>{item.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell>{formatDate(item.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Link href="/admin/feedback" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyTab icon={MessageSquare} message="No feedback found" />
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
                          <Badge className={getStatusColor(item.status)}>{item.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell>{formatDate(item.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href="/admin/correspondence"
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
              <EmptyTab icon={Mail} message="No correspondence records yet" />
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
                          <Badge className={getStatusColor(item.status)}>{item.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getPriorityColor(item.priority)}>{item.priority || "normal"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href="/admin/help-desk" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyTab icon={LifeBuoy} message="No help desk tickets found" />
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
                          <Badge className={getStatusColor(item.status)}>{item.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell>
                          {item.amount != null
                            ? `${item.currency || "NGN"} ${Number(item.amount).toLocaleString()}`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href="/admin/finance/payments"
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
              <EmptyTab icon={CreditCard} message="No payment records found" />
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
                        <TableCell className="font-medium">{item.request_kind || "standard"}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell>{formatDate(item.start_date)}</TableCell>
                        <TableCell>{formatDate(item.end_date)}</TableCell>
                        <TableCell>{item.days_count ?? "-"}</TableCell>
                        <TableCell className="text-right">
                          <Link href="/admin/hr/leave" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyTab icon={Calendar} message="No leave records found" />
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
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status || "unknown"}</Badge>
                        </TableCell>
                        <TableCell>{formatTime(item.clock_in)}</TableCell>
                        <TableCell>{formatTime(item.clock_out)}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href="/admin/hr/attendance"
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
              <EmptyTab icon={Clock} message="No attendance records found" />
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
