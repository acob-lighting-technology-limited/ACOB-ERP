import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Brain } from "lucide-react"

export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <Card className="w-full max-w-2xl border-white/10 bg-neutral-950 text-white shadow-2xl">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-neutral-900 p-3">
              <Brain className="h-6 w-6 animate-pulse text-white/40" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-8 w-48 bg-white/10" />
              <Skeleton className="h-4 w-80 max-w-full bg-white/10" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-4">
            {/* Cycle Select Field */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 bg-white/10" />
              <Skeleton className="h-10 w-full bg-white/10" />
            </div>
            {/* Email Select Field */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-32 bg-white/10" />
              <Skeleton className="h-10 w-full bg-white/10" />
            </div>
            {/* Last Name Field */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-24 bg-white/10" />
              <Skeleton className="h-10 w-full bg-white/10" />
            </div>
            {/* Date of Birth Grid */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 bg-white/10" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-10 w-full bg-white/10" />
                <Skeleton className="h-10 w-full bg-white/10" />
                <Skeleton className="h-10 w-full bg-white/10" />
              </div>
            </div>
          </div>
          {/* Submit Button */}
          <Skeleton className="mt-6 h-11 w-full bg-white/10" />
        </CardContent>
      </Card>
    </main>
  )
}
