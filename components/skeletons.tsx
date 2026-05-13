type FormPageSkeletonProps = {
  sections?: number
  fieldsPerSection?: number
  showSidebar?: boolean
}

function SkeletonLine({ className }: { className: string }) {
  return <div className={`bg-muted animate-pulse rounded-md ${className}`} />
}

export function FormPageSkeleton({ sections = 2, fieldsPerSection = 4, showSidebar = false }: FormPageSkeletonProps) {
  return (
    <div className="from-background via-background to-muted/20 flex min-h-screen w-full items-center justify-center bg-gradient-to-br p-4 md:p-6">
      <div className="w-full max-w-6xl">
        <div className={`grid items-stretch gap-6 ${showSidebar ? "lg:grid-cols-[minmax(0,1fr)_420px]" : ""} xl:gap-8`}>
          <div className="border-border bg-card rounded-2xl border shadow-xl">
            <div className="space-y-5 p-6 md:p-8">
              <div className="flex justify-center lg:hidden">
                <SkeletonLine className="h-10 w-40" />
              </div>
              <SkeletonLine className="h-10 w-64" />
              <SkeletonLine className="h-5 w-72 max-w-full" />
              {Array.from({ length: sections }).map((_, sectionIndex) => (
                <div key={sectionIndex} className="space-y-4">
                  <SkeletonLine className="h-6 w-52 max-w-full" />
                  {Array.from({ length: fieldsPerSection }).map((__, fieldIndex) => (
                    <div key={`${sectionIndex}-${fieldIndex}`} className="space-y-2">
                      <SkeletonLine className="h-4 w-28" />
                      <SkeletonLine className="h-11 w-full" />
                    </div>
                  ))}
                </div>
              ))}
              <SkeletonLine className="h-11 w-full" />
            </div>
          </div>

          {showSidebar ? (
            <aside className="bg-card hidden rounded-2xl border p-8 shadow-xl lg:flex lg:flex-col lg:justify-between">
              <div className="space-y-6">
                <SkeletonLine className="h-12 w-52" />
                <SkeletonLine className="h-8 w-60" />
                <SkeletonLine className="h-5 w-full" />
                <SkeletonLine className="h-5 w-full" />
                <SkeletonLine className="h-5 w-11/12" />
              </div>
              <SkeletonLine className="h-4 w-48" />
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}

type TablePageSkeletonProps = {
  filters?: number
  columns?: number
  rows?: number
  showStats?: boolean
  statCards?: number
}

type DetailPageSkeletonProps = {
  showSidebar?: boolean
  sections?: number
}

type DashboardSkeletonProps = {
  statCards?: number
  showActivity?: boolean
}

type CardGridPageSkeletonProps = {
  cards?: number
  columns?: number
}

export function TablePageSkeleton(_props: TablePageSkeletonProps) {
  return <FormPageSkeleton sections={2} fieldsPerSection={4} showSidebar={false} />
}

export function DetailPageSkeleton(_props: DetailPageSkeletonProps) {
  return <FormPageSkeleton sections={2} fieldsPerSection={3} showSidebar={false} />
}

export function DashboardSkeleton(_props: DashboardSkeletonProps) {
  return <FormPageSkeleton sections={3} fieldsPerSection={2} showSidebar={false} />
}

export function CardGridPageSkeleton(_props: CardGridPageSkeletonProps) {
  return <FormPageSkeleton sections={2} fieldsPerSection={3} showSidebar={false} />
}
