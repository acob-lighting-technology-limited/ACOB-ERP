import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

/**
 * AuthPageSkeleton — loading skeleton for `/auth/*` pages.
 * Displays a centered card layout to prevent visual shifting.
 */
export function AuthPageSkeleton() {
  return (
    <div className="from-background via-background to-muted/20 flex min-h-screen w-full items-center justify-center bg-gradient-to-br p-4 md:p-6">
      <div className="w-full max-w-lg">
        <Card className="border-2 shadow-xl">
          <CardHeader className="pb-4">
            {/* Logo Skeleton */}
            <div className="mb-4 flex justify-center">
              <Skeleton className="h-14 w-48" />
            </div>
            {/* Title & Description Skeleton */}
            <div className="space-y-2 text-center">
              <div className="flex justify-center">
                <Skeleton className="h-7 w-40" />
              </div>
              <div className="flex justify-center">
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            {/* Form Fields Skeletons */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-11 w-full" />
              </div>
            </div>
            {/* Submit Button Skeleton */}
            <Skeleton className="h-11 w-full" />
            {/* Footer Links Skeleton */}
            <div className="flex justify-center">
              <Skeleton className="h-4 w-32" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
