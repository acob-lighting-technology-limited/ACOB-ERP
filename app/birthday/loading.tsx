import { Skeleton } from "@/components/ui/skeleton"
import { Sparkles } from "lucide-react"

export default function Loading() {
  return (
    <main className="birthday-page">
      <div className="birthday-page__ambient" aria-hidden="true" />
      <div className="birthday-page__ambient birthday-page__ambient--secondary" aria-hidden="true" />

      <section className="birthday-hero">
        <div className="birthday-hero__copy">
          <div className="birthday-logo-container">
            <div className="h-[38px] w-[180px] animate-pulse rounded-md bg-white/5" />
          </div>
          <div className="birthday-kicker opacity-50">
            <Sparkles className="h-4 w-4 text-white/40" />
            <Skeleton className="h-4 w-28 bg-white/5" />
          </div>

          <div className="birthday-copy-stack space-y-3">
            <Skeleton className="h-4 w-48 bg-white/5" />
            <Skeleton className="h-12 w-96 bg-white/5" />
            <Skeleton className="h-4 w-80 bg-white/5" />
          </div>

          <div className="birthday-meta-grid">
            <div className="birthday-meta-card opacity-50">
              <Skeleton className="mb-2 h-4 w-24 bg-white/5" />
              <Skeleton className="h-6 w-48 bg-white/5" />
            </div>
            <div className="birthday-meta-card opacity-50">
              <Skeleton className="mb-2 h-4 w-16 bg-white/5" />
              <Skeleton className="h-6 w-full bg-white/5" />
            </div>
          </div>
        </div>

        <div className="birthday-hero__visual">
          <div className="birthday-grid">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="birthday-card-item overflow-hidden">
                <div className="birthday-card-photo-wrapper relative">
                  <div className="absolute inset-0 h-full w-full animate-pulse bg-white/5" />
                </div>
                <div className="birthday-photo__content">
                  <div className="birthday-photo__badge opacity-50">
                    <Skeleton className="h-3.5 w-16 bg-white/5" />
                  </div>
                  <div className="birthday-card-details mt-4 space-y-2">
                    <Skeleton className="h-5 w-28 bg-white/5" />
                    <Skeleton className="h-3.5 w-36 bg-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
