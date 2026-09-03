import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { PageWrapper } from "@/components/layout"
import { cn } from "@/lib/utils"

export default function NotificationLoading() {
  return (
    <PageWrapper maxWidth="full" background="gradient">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-80" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className={cn(i >= 3 && "hidden sm:block")}>
            <CardContent className="p-2.5 sm:p-4">
              <Skeleton className="h-5 w-8 sm:h-7 sm:w-12" />
              <Skeleton className="mt-1.5 h-2.5 w-12 sm:mt-2 sm:h-3 sm:w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-20" />
            ))}
          </div>
        </CardHeader>
      </Card>

      {/* Notification List */}
      <Card>
        <CardContent className="space-y-3 p-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-start gap-4 border-b pb-3 last:border-0">
              <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-5 w-64" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-6 w-20" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </PageWrapper>
  )
}
