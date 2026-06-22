"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowRight } from "lucide-react"
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
import { formatWATDate } from "@/lib/utils/date"
import { cn } from "@/lib/utils"

function statusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case "completed":
    case "resolved":
    case "approved":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
    case "under_review":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "pending":
    case "open":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "assigned":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
    case "rejected":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function priorityColor(priority: string): string {
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

function shortDate(dateString: string): string {
  return formatWATDate(dateString, { month: "short", day: "numeric", year: "2-digit" })
}

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
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
  className?: string
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
  className,
}: ActivityTabsProps) {
  const [activeTab, setActiveTab] = useState("assets")

  const viewAllMeta = useMemo(() => {
    const map: Record<string, { href: string; label: string }> = {
      tasks: { href: "/tasks", label: "View all tasks" },
      documentation: { href: "/documentation/internal", label: "View all docs" },
      feedback: { href: "/feedback", label: "View all feedback" },
      correspondence: { href: "/correspondence", label: "View all correspondence" },
      helpdesk: { href: "/help-desk", label: "View all tickets" },
      payments: { href: "/payments", label: "View all payments" },
      leave: { href: "/leave", label: "View all leave" },
      attendance: { href: "/attendance", label: "View all attendance" },
      assets: { href: "/assets", label: "View all assets" },
    }
    return map[activeTab] ?? map.assets
  }, [activeTab])

  const listClass = "flex-1 divide-y overflow-y-auto"

  return (
    <Card className={cn("flex h-[480px] flex-col", className)}>
      <CardHeader className="shrink-0 px-4 py-3">
        <CardTitle className="text-sm">Activity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
        <Tabs
          defaultValue="assets"
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 border-b px-2">
            <TabsList className="scrollbar-none h-auto w-full justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0">
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

          {/* Assets */}
          <TabsContent value="assets" className="m-0 flex flex-1 flex-col overflow-hidden">
            {assets.length > 0 ? (
              <ul className={listClass}>
                {assets.map((a) => (
                  <ItemRow key={a.id} href="/assets">
                    <p className="truncate text-sm font-medium">
                      {a.asset_type}
                      {a.asset_model ? ` — ${a.asset_model}` : ""}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono text-[10px]">{a.unique_code || "—"}</span>
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
          <TabsContent value="tasks" className="m-0 flex flex-1 flex-col overflow-hidden">
            {tasks.length > 0 ? (
              <ul className={listClass}>
                {tasks.map((t) => (
                  <ItemRow key={t.id} href={`/tasks?taskId=${t.id}`}>
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(t.status)}`}>{t.status}</Badge>
                      <Badge className={`px-1.5 py-0 text-[10px] ${priorityColor(t.priority)}`}>{t.priority}</Badge>
                      {t.due_date && <span className="text-muted-foreground text-[10px]">{shortDate(t.due_date)}</span>}
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="tasks" />
            )}
          </TabsContent>

          {/* Documentation */}
          <TabsContent value="documentation" className="m-0 flex flex-1 flex-col overflow-hidden">
            {documentation.length > 0 ? (
              <ul className={listClass}>
                {documentation.map((d) => (
                  <ItemRow key={d.id} href={`/documentation/internal?docId=${d.id}`}>
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
          <TabsContent value="feedback" className="m-0 flex flex-1 flex-col overflow-hidden">
            {feedback.length > 0 ? (
              <ul className={listClass}>
                {feedback.map((f) => (
                  <ItemRow key={f.id} href={`/feedback?feedbackId=${f.id}`}>
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
          <TabsContent value="correspondence" className="m-0 flex flex-1 flex-col overflow-hidden">
            {correspondence.length > 0 ? (
              <ul className={listClass}>
                {correspondence.map((c) => (
                  <ItemRow key={c.id} href="/correspondence">
                    <p className="truncate text-sm font-medium">{c.subject}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {c.reference_number && (
                        <span className="text-muted-foreground font-mono text-[10px]">{c.reference_number}</span>
                      )}
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(c.status)}`}>{c.status}</Badge>
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="correspondence" />
            )}
          </TabsContent>

          {/* Help Desk */}
          <TabsContent value="helpdesk" className="m-0 flex flex-1 flex-col overflow-hidden">
            {helpDesk.length > 0 ? (
              <ul className={listClass}>
                {helpDesk.map((h) => (
                  <ItemRow key={h.id} href="/help-desk">
                    <p className="truncate text-sm font-medium">{h.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {h.ticket_number && (
                        <span className="text-muted-foreground font-mono text-[10px]">{h.ticket_number}</span>
                      )}
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
          <TabsContent value="payments" className="m-0 flex flex-1 flex-col overflow-hidden">
            {payments.length > 0 ? (
              <ul className={listClass}>
                {payments.map((p) => (
                  <ItemRow key={p.id} href="/payments">
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
          <TabsContent value="leave" className="m-0 flex flex-1 flex-col overflow-hidden">
            {leave.length > 0 ? (
              <ul className={listClass}>
                {leave.map((l) => (
                  <ItemRow key={l.id} href="/leave">
                    <p className="truncate text-sm font-medium">{l.leave_type}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge className={`px-1.5 py-0 text-[10px] ${statusColor(l.status)}`}>{l.status}</Badge>
                      <span className="text-muted-foreground text-[10px]">
                        {shortDate(l.start_date)} – {shortDate(l.end_date)}
                      </span>
                      <span className="text-muted-foreground text-[10px]">{l.days_requested}d</span>
                    </div>
                  </ItemRow>
                ))}
              </ul>
            ) : (
              <EmptyTab label="leave records" />
            )}
          </TabsContent>

          {/* Attendance */}
          <TabsContent value="attendance" className="m-0 flex flex-1 flex-col overflow-hidden">
            {attendance.length > 0 ? (
              <ul className={listClass}>
                {attendance.map((a) => (
                  <ItemRow key={a.id} href="/attendance">
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

        <div className="shrink-0 border-t px-4 py-2.5">
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
