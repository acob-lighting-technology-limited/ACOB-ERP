"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, ScrollText } from "lucide-react"
import { EmptyState } from "@/components/ui/patterns"
import { formatWATDate } from "@/lib/utils/date"

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
  const d = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatWATDate(d, { month: "short", day: "numeric" })
}

interface PersonalRecentActivityFeedProps {
  activity: PersonalRecentActivityItem[]
}

export function PersonalRecentActivityFeed({ activity }: PersonalRecentActivityFeedProps) {
  return (
    <Card>
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="text-muted-foreground h-4 w-4" />
            Recent Activity
          </CardTitle>
          {activity.length > 0 && <span className="text-muted-foreground text-xs">{activity.length} entries</span>}
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
            title="No recent activity yet"
            description="Your latest actions across modules will appear here."
            icon={ScrollText}
            className="border-0 py-8"
          />
        )}
      </CardContent>
    </Card>
  )
}
