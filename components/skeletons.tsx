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
  const { filters = 3, columns = 6, rows = 8, showStats = true, statCards = 4 } = _props

  return (
    <div className="container mx-auto max-w-full space-y-6 p-4 md:p-6 lg:p-8">
      <div className="space-y-2">
        <SkeletonLine className="h-9 w-56" />
        <SkeletonLine className="h-5 w-80 max-w-full" />
      </div>

      {showStats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: statCards }).map((_, i) => (
            <div key={`stat-${i}`} className="bg-card rounded-lg border p-4">
              <SkeletonLine className="mb-3 h-4 w-24" />
              <SkeletonLine className="h-8 w-20" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="bg-card rounded-lg border p-4">
        <div className="mb-4 flex flex-wrap gap-3">
          <SkeletonLine className="h-10 w-72 max-w-full" />
          {Array.from({ length: filters }).map((_, i) => (
            <SkeletonLine key={`filter-${i}`} className="h-10 w-40" />
          ))}
        </div>

        <div className="space-y-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}>
            {Array.from({ length: columns }).map((_, i) => (
              <SkeletonLine key={`head-${i}`} className="h-5 w-full" />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, r) => (
            <div
              key={`row-${r}`}
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}
            >
              {Array.from({ length: columns }).map((__, c) => (
                <SkeletonLine key={`cell-${r}-${c}`} className="h-6 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DetailPageSkeleton(_props: DetailPageSkeletonProps) {
  const { showSidebar = true, sections = 3 } = _props
  return <FormPageSkeleton sections={sections} fieldsPerSection={3} showSidebar={showSidebar} />
}

export function DashboardSkeleton(_props: DashboardSkeletonProps) {
  const { statCards = 4, showActivity = true } = _props

  return (
    <div className="container mx-auto max-w-full space-y-6 p-4 md:p-6 lg:p-8">
      <div className="space-y-2">
        <SkeletonLine className="h-9 w-64" />
        <SkeletonLine className="h-5 w-96 max-w-full" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: statCards }).map((_, i) => (
          <div key={`dash-stat-${i}`} className="bg-card rounded-lg border p-4">
            <SkeletonLine className="mb-3 h-4 w-24" />
            <SkeletonLine className="h-8 w-20" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bg-card rounded-lg border p-4 lg:col-span-2">
          <SkeletonLine className="mb-4 h-6 w-40" />
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonLine key={`dash-main-${i}`} className="mb-3 h-8 w-full" />
          ))}
        </div>
        <div className="bg-card rounded-lg border p-4">
          <SkeletonLine className="mb-4 h-6 w-32" />
          {Array.from({ length: showActivity ? 7 : 3 }).map((_, i) => (
            <SkeletonLine key={`dash-side-${i}`} className="mb-3 h-6 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function CardGridPageSkeleton(_props: CardGridPageSkeletonProps) {
  const { cards = 8, columns = 4 } = _props

  return (
    <div className="container mx-auto max-w-full space-y-6 p-4 md:p-6 lg:p-8">
      <div className="space-y-2">
        <SkeletonLine className="h-9 w-56" />
        <SkeletonLine className="h-5 w-80 max-w-full" />
      </div>

      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: cards }).map((_, i) => (
          <div key={`card-${i}`} className="bg-card rounded-lg border p-4">
            <SkeletonLine className="mb-4 h-36 w-full" />
            <SkeletonLine className="mb-2 h-5 w-2/3" />
            <SkeletonLine className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}
