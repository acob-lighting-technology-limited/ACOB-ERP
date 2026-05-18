import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, ScrollText } from "lucide-react"
import { EmptyState } from "@/components/ui/patterns"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { RecentActivityItem } from "./dashboard-types"

const activityRouteMap: Record<string, string> = {
  task: "/admin/tasks",
  tasks: "/admin/tasks",
  feedback: "/admin/feedback",
  profile: "/admin/hr/employees",
  profiles: "/admin/hr/employees",
  pending_user: "/admin/hr/employees",
  pending_users: "/admin/hr/employees",
  department_payments: "/admin/finance/payments",
  payment_documents: "/admin/finance/payments",
  help_desk_ticket: "/admin/help-desk",
  help_desk_tickets: "/admin/help-desk",
  correspondence_record: "/admin/correspondence",
  correspondence_records: "/admin/correspondence",
  asset: "/admin/assets",
  assets: "/admin/assets",
  asset_assignment: "/admin/assets",
  asset_assignments: "/admin/assets",
  audit_log: "/admin/audit-logs",
  audit_logs: "/admin/audit-logs",
}

function resolveActivityRoute(moduleKey: string): string {
  return activityRouteMap[moduleKey] || "/admin/audit-logs"
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface RecentActivityFeedProps {
  activity: RecentActivityItem[]
  showViewAll?: boolean
}

export function RecentActivityFeed({ activity, showViewAll = true }: RecentActivityFeedProps) {
  return (
    <Card className="border">
      <CardHeader className="bg-muted/30 border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm md:text-base">
            <ScrollText className="h-4 w-4" />
            Recent Activity
          </CardTitle>
          {showViewAll && (
            <Link href="/admin/audit-logs">
              <Badge variant="outline" className="hover:bg-accent cursor-pointer text-xs">
                View All
              </Badge>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {activity.length > 0 ? (
          <div className="max-h-[22rem] overflow-x-auto overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">S/N</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-medium">
                      <span className="font-semibold">{item.actorName}</span> {item.actionLabel}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {item.moduleLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs sm:text-sm">
                      {formatDate(item.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={resolveActivityRoute(item.moduleKey)}
                        className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs font-medium"
                      >
                        Open
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title="No recent system activity found"
            description="Recent audit activity will appear here as users interact with modules."
            icon={ScrollText}
            className="border-0 p-4"
          />
        )}
      </CardContent>
    </Card>
  )
}
