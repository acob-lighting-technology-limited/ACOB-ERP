import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function NotificationLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-80" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-3 gap-2 md:grid-cols-3 md:gap-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2.5 pb-1 sm:p-4 sm:pb-2">
              <Skeleton className="h-3 w-14 sm:h-4 sm:w-24" />
              <Skeleton className="h-3.5 w-3.5 rounded sm:h-4 sm:w-4" />
            </CardHeader>
            <CardContent className="p-2.5 pt-0 sm:p-4 sm:pt-0">
              <Skeleton className="h-5 w-8 sm:h-8 sm:w-12" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>

      {/* Notification List */}
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <Skeleton className="h-5 w-64" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-16" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
