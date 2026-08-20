import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Brain } from "lucide-react"

export default function Loading() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-muted/60 rounded-2xl border p-3">
              <Brain className="text-muted-foreground h-6 w-6 animate-pulse" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-4">
            {/* Cycle Select Field */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
            {/* Email Select Field */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
            {/* Password Field */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          {/* Submit Button */}
          <Skeleton className="mt-6 h-11 w-full" />
        </CardContent>
      </Card>
    </main>
  )
}
