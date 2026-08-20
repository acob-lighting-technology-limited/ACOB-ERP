import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, ScrollText } from "lucide-react"
import { EmptyState } from "@/components/ui/patterns"
import type { RecentActivityItem } from "./dashboard-types"
import { formatWATRelative } from "@/lib/utils/date"

const activityRouteMap: Record<string, string> = {
  task: "/admin/tasks",
  tasks: "/admin/tasks",
  feedback: "/admin/feedback",
  profile: "/admin/hr/employees",
  profiles: "/admin/hr/employees",
  pending_user: "/admin/hr/employees",
  pending_users: "/admin/hr/employees",
  department_payments: "/admin/accounts/payments",
  payment_documents: "/admin/accounts/payments",
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
  return formatWATRelative(dateString)
}

interface RecentActivityFeedProps {
  activity: RecentActivityItem[]
  showViewAll?: boolean
}

export function RecentActivityFeed({ activity, showViewAll = true }: RecentActivityFeedProps) {
  return (
    <Card>
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="text-muted-foreground h-4 w-4" />
            Recent Activity
          </CardTitle>
          {showViewAll && (
            <Link
              href="/admin/audit-logs"
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              View all →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {activity.length > 0 ? (
          <ul className="max-h-72 divide-y overflow-y-auto">
            {activity.map((item) => (
              <li key={item.id}>
                <Link
                  href={resolveActivityRoute(item.moduleKey)}
                  className="hover:bg-muted/50 flex items-center gap-3 px-4 py-2.5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">
                      <span className="font-medium">{item.actorName}</span>{" "}
                      <span className="text-muted-foreground">{item.actionLabel}</span>
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {item.moduleLabel}
                      </Badge>
                      <span className="text-muted-foreground text-[10px]">{formatDate(item.createdAt)}</span>
                    </div>
                  </div>
                  <ArrowRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No recent system activity found"
            description="Recent audit activity will appear here as users interact with modules."
            icon={ScrollText}
            className="border-0 py-8"
          />
        )}
      </CardContent>
    </Card>
  )
}
