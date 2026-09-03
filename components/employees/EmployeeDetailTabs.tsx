"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/patterns"
import { cn } from "@/lib/utils"
import { CheckSquare, Laptop, Package, FileText, MessageSquare, ScrollText } from "lucide-react"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import Link from "next/link"
import type {
  EmployeeTask,
  EmployeeDevice,
  EmployeeAsset,
  EmployeeDocumentation,
  EmployeeAuditLog,
  EmployeeFeedback,
} from "./employee-detail-types"

function getStatusColor(status: string) {
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

function getPriorityColor(priority: string) {
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

interface EmployeeDetailTabsProps {
  tasks: EmployeeTask[]
  devices: EmployeeDevice[]
  assets: EmployeeAsset[]
  documentation: EmployeeDocumentation[]
  auditLogs: EmployeeAuditLog[]
  feedback: EmployeeFeedback[]
  taskLinkBase?: string
  deviceLinkBase?: string
  assetLinkBase?: string
  docLinkBase?: string
  feedbackLinkBase?: string
  auditLinkBase?: string
}

export function EmployeeDetailTabs({
  tasks,
  devices,
  assets,
  documentation,
  auditLogs,
  feedback,
  taskLinkBase = "/admin/tasks",
  deviceLinkBase = "/admin/devices",
  assetLinkBase = "/admin/assets",
  docLinkBase = "/admin/documentation/internal",
  feedbackLinkBase = "/admin/feedback",
  auditLinkBase = "/admin/audit-logs",
}: EmployeeDetailTabsProps) {
  const [activeTab, setActiveTab] = useState("tasks")

  const tabOptions = [
    { value: "tasks", label: `Tasks (${tasks.length})`, icon: CheckSquare },
    { value: "devices", label: `Devices (${devices.length})`, icon: Laptop },
    { value: "assets", label: `Assets (${assets.length})`, icon: Package },
    { value: "documentation", label: `Documentation (${documentation.length})`, icon: FileText },
    { value: "feedback", label: `Feedback (${feedback.length})`, icon: MessageSquare },
    { value: "logs", label: `Audit Logs (${auditLogs.length})`, icon: ScrollText },
  ]

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <div className="sm:hidden">
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="bg-muted/60 w-full font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tabOptions.map((tab) => (
              <SelectItem key={tab.value} value={tab.value}>
                <div className="flex items-center gap-2">
                  <tab.icon className="text-muted-foreground h-4 w-4 shrink-0" />
                  <span>{tab.label}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden sm:block">
        <TabsList>
          {tabOptions.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              <tab.icon className="mr-2 h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Tasks Tab */}
      <TabsContent value="tasks">
        <Card>
          <CardHeader>
            <CardTitle>Assigned Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{task.title}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(task.status)}>{task.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                      </TableCell>
                      <TableCell>{task.department || "N/A"}</TableCell>
                      <TableCell>{task.due_date ? formatWATDate(task.due_date) : "N/A"}</TableCell>
                      <TableCell>
                        <Link
                          href={`${taskLinkBase}?taskId=${task.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground py-8 text-center">No tasks assigned to this user</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Devices Tab */}
      <TabsContent value="devices">
        <Card>
          <CardHeader>
            <CardTitle>Assigned Devices</CardTitle>
          </CardHeader>
          <CardContent>
            {devices.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell className="font-medium">{device.device_name}</TableCell>
                      <TableCell>{device.device_type}</TableCell>
                      <TableCell>{device.device_model || "N/A"}</TableCell>
                      <TableCell>{device.serial_number || "N/A"}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(device.status)}>{device.status}</Badge>
                      </TableCell>
                      <TableCell>{formatWATDate(device.assigned_at)}</TableCell>
                      <TableCell>
                        <Link
                          href={`${deviceLinkBase}?deviceId=${device.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground py-8 text-center">No devices assigned to this user</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Assets Tab */}
      <TabsContent value="assets">
        <Card>
          <CardHeader>
            <CardTitle>Assigned Assets</CardTitle>
          </CardHeader>
          <CardContent>
            {assets.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium">{asset.asset_name}</TableCell>
                      <TableCell>{asset.asset_type}</TableCell>
                      <TableCell>{asset.asset_model || "N/A"}</TableCell>
                      <TableCell>{asset.serial_number || "N/A"}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(asset.status)}>{asset.status}</Badge>
                      </TableCell>
                      <TableCell>{formatWATDate(asset.assigned_at)}</TableCell>
                      <TableCell>
                        <Link
                          href={`${assetLinkBase}?assetId=${asset.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground py-8 text-center">No assets assigned to this user</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Documentation Tab */}
      <TabsContent value="documentation">
        <Card>
          <CardHeader>
            <CardTitle>Documentation Created</CardTitle>
          </CardHeader>
          <CardContent>
            {documentation.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Created Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documentation.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{doc.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{doc.category || "N/A"}</Badge>
                      </TableCell>
                      <TableCell>{formatWATDate(doc.created_at)}</TableCell>
                      <TableCell>
                        <Link
                          href={`${docLinkBase}?docId=${doc.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground py-8 text-center">No documentation created by this user</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Feedback Tab */}
      <TabsContent value="feedback">
        <Card>
          <CardHeader>
            <CardTitle>Feedback Submitted</CardTitle>
          </CardHeader>
          <CardContent>
            {feedback.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feedback.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.feedback_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                      </TableCell>
                      <TableCell>{formatWATDate(item.created_at)}</TableCell>
                      <TableCell>
                        <Link
                          href={`${feedbackLinkBase}?feedbackId=${item.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground py-8 text-center">No feedback submitted by this user</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Audit Logs Tab */}
      <TabsContent value="logs">
        <Card>
          <CardHeader>
            <CardTitle>Audit Logs</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge variant="outline">{entry.action}</Badge>
                      </TableCell>
                      <TableCell>{entry.entity_type}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.entity_id?.substring(0, 8) || "N/A"}</TableCell>
                      <TableCell>{formatWATDateTime(entry.created_at)}</TableCell>
                      <TableCell>
                        <Link
                          href={`${auditLinkBase}?logId=${entry.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No audit logs found for this user"
                description="Audit activity entries for this employee will appear here."
                icon={ScrollText}
                className="border-0"
              />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
