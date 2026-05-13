import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, ScrollText } from "lucide-react"
import { EmptyState } from "@/components/ui/patterns"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export interface PersonalRecentActivityItem {
  id: string
  actorName: string
  actionLabel: string
  moduleLabel: string
  moduleKey: string
  createdAt: string
}

const activityRouteMap: Record<string, string> = {
  task: "/tasks",
  tasks: "/tasks",
  feedback: "/feedback",
  profile: "/profile",
  profiles: "/profile",
  user_documentation: "/documentation/internal",
  documentation: "/documentation/internal",
  help_desk_ticket: "/help-desk",
  help_desk_tickets: "/help-desk",
  correspondence_record: "/correspondence",
  correspondence_records: "/correspondence",
  asset: "/assets",
  assets: "/assets",
  asset_assignment: "/assets",
  asset_assignments: "/assets",
  attendance: "/attendance",
  leave_request: "/leave",
  leave_requests: "/leave",
  payment: "/payments",
  payments: "/payments",
}

function resolveActivityRoute(moduleKey: string): string {
  return activityRouteMap[moduleKey] || "/profile"
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface PersonalRecentActivityFeedProps {
  activity: PersonalRecentActivityItem[]
}

export function PersonalRecentActivityFeed({ activity }: PersonalRecentActivityFeedProps) {
  return (
    <Card className="border">
      <CardHeader className="bg-muted/30 border-b px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <ScrollText className="h-4 w-4" />
          Recent Activity
        </CardTitle>
        <p className="text-muted-foreground text-xs sm:text-sm">Latest cross-module changes recorded in the system.</p>
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
            title="No recent activity yet"
            description="Your latest actions across modules will appear here."
            icon={ScrollText}
            className="border-0 p-4"
          />
        )}
      </CardContent>
    </Card>
  )
}
