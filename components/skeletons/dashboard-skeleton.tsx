import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface DashboardSkeletonProps {
  /** Number of stat cards to show */
  statCards?: number
  /** Whether to show recent activity sections */
  showActivity?: boolean
}

/**
 * Dashboard page skeleton for loading states.
 * Shows stat cards, optional actions, and activity sections.
 */
export function DashboardSkeleton({ statCards = 5, showActivity = true }: DashboardSkeletonProps) {
  return (
    <div className="from-background via-background to-muted/20 min-h-screen bg-gradient-to-br p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-8 w-48" />
          </div>
          <Skeleton className="h-5 w-80" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-5">
          {[...Array(statCards)].map((_, i) => (
            <Card key={i} className={cn("border", statCards > 3 && i >= 3 && "hidden lg:block")}>
              <CardContent className="p-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="mt-1 h-6 w-10" />
                  </div>
                  <Skeleton className="h-7 w-7 rounded-lg" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <div>
          <Skeleton className="mb-3 h-6 w-32" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="border">
                <CardContent className="flex items-center gap-2 p-2.5">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-1 h-3 w-32" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Activity Sections */}
        {showActivity && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[...Array(2)].map((_, i) => (
              <Card key={i} className="border">
                <CardHeader className="bg-muted/30 border-b px-4 py-3">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="space-y-3">
                    {[...Array(4)].map((_, j) => (
                      <div key={j} className="flex items-center justify-between border-b pb-2 last:border-0">
                        <Skeleton className="h-4 w-40" />
                        <div className="flex gap-2">
                          <Skeleton className="h-5 w-16" />
                          <Skeleton className="h-4 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
