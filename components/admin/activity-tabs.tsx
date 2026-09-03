"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowRight } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"

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

function statusColor(status: string | null): string {
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

function priorityColor(priority: string | null): string {
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

function shortDate(dateString: string | null): string {
  if (!dateString) return "—"
  return formatWATDate(dateString, { month: "short", day: "numeric", year: "2-digit" })
}

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-muted-foreground text-sm">No {label} found</p>
    </div>
  )
}

function ItemRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li className="hover:bg-muted/40 transition-colors">
      <Link href={href} className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">{children}</div>
        <ArrowRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      </Link>
    </li>
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

  const viewAllMeta = useMemo(() => {
    const map: Record<string, { href: string; label: string }> = {
      tasks: { href: "/admin/tasks", label: "View all tasks" },
      documentation: { href: "/admin/documentation", label: "View all docs" },
      feedback: { href: "/admin/feedback", label: "View all feedback" },
      correspondence: { href: "/admin/correspondence", label: "View all correspondence" },
      helpdesk: { href: "/admin/help-desk", label: "View all tickets" },
      payments: { href: "/admin/accounts/payments", label: "View all payments" },
      leave: { href: "/admin/hr/leave", label: "View all leave" },
      attendance: { href: "/admin/hr/attendance", label: "View all attendance" },
      assets: { href: "/admin/assets", label: "View all assets" },
    }
    return map[activeTab] ?? map.assets
  }, [activeTab])

  const listClass = "max-h-72 divide-y overflow-y-auto"

  return (
    <Card>
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm">Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs defaultValue="assets" value={activeTab} onValueChange={setActiveTab}>
          <div className="border-b px-2 py-2 sm:py-0">
            <div className="sm:hidden">
              <Select value={activeTab} onValueChange={setActiveTab}>
                <SelectTrigger className="bg-muted/60 w-full font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { value: "assets", label: "Assets", count: assets.length },
                    { value: "tasks", label: "Tasks", count: tasks.length },
                    { value: "documentation", label: "Docs", count: documentation.length },
                    { value: "feedback", label: "Feedback", count: feedback.length },
                    { value: "correspondence", label: "Mail", count: correspondence.length },
                    { value: "helpdesk", label: "Tickets", count: helpDesk.length },
                    { value: "payments", label: "Payments", count: payments.length },
                    { value: "leave", label: "Leave", count: leave.length },
                    { value: "attendance", label: "Attendance", count: attendance.length },
                  ].map(({ value, label, count }) => (
                    <SelectItem key={value} value={value}>
                      {label} ({count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="hidden sm:block">
              <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0">
                {[
                  { value: "assets", label: "Assets", count: assets.length },
                  { value: "tasks", label: "Tasks", count: tasks.length },
                  { value: "documentation", label: "Docs", count: documentation.length },
                  { value: "feedback", label: "Feedback", count: feedback.length },
                  { value: "correspondence", label: "Mail", count: correspondence.length },
                  { value: "helpdesk", label: "Tickets", count: helpDesk.length },
                  { value: "payments", label: "Payments", count: payments.length },
                  { value: "leave", label: "Leave", count: leave.length },
                  { value: "attendance", label: "Attendance", count: attendance.length },
                ].map(({ value, label, count }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="data-[state=active]:border-primary data-[state=active]:text-foreground text-muted-foreground relative flex shrink-0 items-center gap-1 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-xs font-medium transition-none data-[state=active]:shadow-none"
                  >
                    {label}
                    <span className="text-muted-foreground text-[10px] tabular-nums">({count})</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>

          {/* Assets */}
          <TabsContent value="assets" className="m-0">
            {assets.length > 0 ? (
              <ul className={listClass}>
                {assets.map((a) => (
                  <ItemRow key={a.id} href="/admin/assets">
                    <p className="truncate text-sm font-medium">
                      {a.asset_type}
                      {a.asset_model ? ` — ${a.asset_model}` : ""}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono text-[10px]">{a.unique_code || "—"}</span>
                      {a.department && <span className="text-muted-foreground text-[10px]">{a.department}</span>}
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(a.status)}`}>{a.status}</Badge>
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="assets" />
            )}
          </TabsContent>

          {/* Tasks */}
          <TabsContent value="tasks" className="m-0">
            {tasks.length > 0 ? (
              <ul className={listClass}>
                {tasks.map((t) => (
                  <ItemRow key={t.id} href="/admin/tasks">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(t.status)}`}>{t.status}</Badge>
                      <Badge className={`px-1.5 py-0 text-[10px] ${priorityColor(t.priority)}`}>{t.priority}</Badge>
                      {t.due_date && <span className="text-muted-foreground text-[10px]">{shortDate(t.due_date)}</span>}
                      {t.department && <span className="text-muted-foreground text-[10px]">{t.department}</span>}
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="tasks" />
            )}
          </TabsContent>

          {/* Documentation */}
          <TabsContent value="documentation" className="m-0">
            {documentation.length > 0 ? (
              <ul className={listClass}>
                {documentation.map((d) => (
                  <ItemRow key={d.id} href="/admin/documentation">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {d.category && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          {d.category}
                        </Badge>
                      )}
                      <span className="text-muted-foreground text-[10px]">{shortDate(d.created_at)}</span>
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="documentation" />
            )}
          </TabsContent>

          {/* Feedback */}
          <TabsContent value="feedback" className="m-0">
            {feedback.length > 0 ? (
              <ul className={listClass}>
                {feedback.map((f) => (
                  <ItemRow key={f.id} href="/admin/feedback">
                    <p className="truncate text-sm font-medium">{f.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {f.feedback_type}
                      </Badge>
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(f.status)}`}>{f.status}</Badge>
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="feedback" />
            )}
          </TabsContent>

          {/* Correspondence */}
          <TabsContent value="correspondence" className="m-0">
            {correspondence.length > 0 ? (
              <ul className={listClass}>
                {correspondence.map((c) => (
                  <ItemRow key={c.id} href="/admin/correspondence">
                    <p className="truncate text-sm font-medium">{c.subject}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono text-[10px]">{c.reference_number}</span>
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(c.status)}`}>{c.status}</Badge>
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="correspondence records" />
            )}
          </TabsContent>

          {/* Help Desk */}
          <TabsContent value="helpdesk" className="m-0">
            {helpDesk.length > 0 ? (
              <ul className={listClass}>
                {helpDesk.map((h) => (
                  <ItemRow key={h.id} href="/admin/help-desk">
                    <p className="truncate text-sm font-medium">{h.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono text-[10px]">{h.ticket_number}</span>
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(h.status)}`}>{h.status}</Badge>
                      <Badge className={`px-1.5 py-0 text-[10px] ${priorityColor(h.priority)}`}>{h.priority}</Badge>
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="help desk tickets" />
            )}
          </TabsContent>

          {/* Payments */}
          <TabsContent value="payments" className="m-0">
            {payments.length > 0 ? (
              <ul className={listClass}>
                {payments.map((p) => (
                  <ItemRow key={p.id} href="/admin/accounts/payments">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {p.payment_type}
                      </Badge>
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(p.status)}`}>{p.status}</Badge>
                      {p.amount != null && (
                        <span className="text-muted-foreground text-[10px]">
                          {p.currency || "NGN"} {Number(p.amount).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="payments" />
            )}
          </TabsContent>

          {/* Leave */}
          <TabsContent value="leave" className="m-0">
            {leave.length > 0 ? (
              <ul className={listClass}>
                {leave.map((l) => (
                  <ItemRow key={l.id} href="/admin/hr/leave">
                    <p className="truncate text-sm font-medium">{l.request_kind || "Standard leave"}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(l.status)}`}>{l.status}</Badge>
                      <span className="text-muted-foreground text-[10px]">
                        {shortDate(l.start_date)} – {shortDate(l.end_date)}
                      </span>
                      {l.days_count != null && (
                        <span className="text-muted-foreground text-[10px]">{l.days_count}d</span>
                      )}
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="leave records" />
            )}
          </TabsContent>

          {/* Attendance */}
          <TabsContent value="attendance" className="m-0">
            {attendance.length > 0 ? (
              <ul className={listClass}>
                {attendance.map((a) => (
                  <ItemRow key={a.id} href="/admin/hr/attendance">
                    <p className="text-sm font-medium">{shortDate(a.date)}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(a.status)}`}>{a.status}</Badge>
                      {a.clock_in && (
                        <span className="text-muted-foreground text-[10px]">
                          In {(a.clock_in as string).substring(0, 5)}
                        </span>
                      )}
                      {a.clock_out && (
                        <span className="text-muted-foreground text-[10px]">
                          Out {(a.clock_out as string).substring(0, 5)}
                        </span>
                      )}
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="attendance records" />
            )}
          </TabsContent>
        </Tabs>

        <div className="border-t px-4 py-2.5">
          <Link
            href={viewAllMeta.href}
            className={buttonVariants({ variant: "ghost", size: "sm" }) + " h-7 px-2 text-xs"}
          >
            {viewAllMeta.label} →
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
