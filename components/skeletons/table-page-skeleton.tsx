function SkeletonLine({ className }: { className: string }) {
  return <div className={`bg-muted animate-pulse rounded-md ${className}`} />
}

export type TablePageSkeletonProps = {
  filters?: number
  columns?: number
  rows?: number
  showStats?: boolean
  statCards?: number
  /** Number of tab items to render (omit = no tabs row) */
  tabs?: number
  /** Number of action buttons to render on the right of the header */
  actions?: number
  /** Whether to show the back-link row above the title */
  showBackLink?: boolean
}

/**
 * TablePageSkeleton — mirrors the exact layout of DataTablePage + DataTable so
 * the transition from loading.tsx → mounted component is visually seamless.
 *
 * Layout order matches DataTablePage:
 *   PageWrapper  →  PageHeader  →  [Tabs]  →  [Stats]  →  DataTable card
 *
 * DataTable card interior matches the DataTable component's own isLoading state:
 *   Toolbar (search + column toggle)  →  Filters row  →  Row-count bar
 *   →  bg-muted/80 table header  →  shimmer rows
 */
export function TablePageSkeleton({
  filters = 2,
  columns = 5,
  rows = 8,
  showStats = true,
  statCards = 3,
  tabs,
  actions = 1,
  showBackLink = false,
}: TablePageSkeletonProps) {
  return (
    /* PageWrapper: from-background via-background to-muted/20 bg-gradient-to-br, p-4 md:p-6 */
    <div className="from-background via-background to-muted/20 min-h-screen bg-gradient-to-br p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* ── 1. PageHeader ── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            {showBackLink && (
              <SkeletonLine className="mb-2 h-4 w-28" />
            )}
            <div className="flex items-center gap-2">
              <SkeletonLine className="h-7 w-7 shrink-0 rounded-md" /> {/* icon */}
              <SkeletonLine className="h-8 w-48" /> {/* title */}
            </div>
            <SkeletonLine className="h-4 w-72 max-w-full" /> {/* description */}
          </div>
          {actions > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {Array.from({ length: actions }).map((_, i) => (
                <SkeletonLine key={`action-${i}`} className="h-9 w-24 rounded-md" />
              ))}
            </div>
          )}
        </div>

        {/* ── 2. Tabs (optional) ── */}
        {tabs && tabs > 0 ? (
          <div className="flex gap-1">
            {Array.from({ length: tabs }).map((_, i) => (
              <SkeletonLine key={`tab-${i}`} className="h-9 w-20 rounded-md" />
            ))}
          </div>
        ) : null}

        {/* ── 3. Stats cards ── */}
        {showStats ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
            {Array.from({ length: statCards }).map((_, i) => (
              <div key={`stat-${i}`} className="bg-card rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <SkeletonLine className="h-4 w-20" />
                  <SkeletonLine className="h-8 w-8 rounded-lg" />
                </div>
                <SkeletonLine className="mt-3 h-7 w-16" />
                <SkeletonLine className="mt-1 h-3 w-24" />
              </div>
            ))}
          </div>
        ) : null}

        {/* ── 4. DataTable card ── */}
        <div className="bg-card rounded-xl border">
          {/* Toolbar: search input + columns toggle */}
          <div className="space-y-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SkeletonLine className="h-10 max-w-sm flex-1 rounded-md" /> {/* search */}
              <div className="flex shrink-0 items-center gap-2">
                <SkeletonLine className="h-9 w-24 rounded-md" /> {/* columns toggle */}
              </div>
            </div>
            {/* Filter dropdowns row */}
            {filters > 0 && (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: filters }).map((_, i) => (
                  <SkeletonLine key={`filter-${i}`} className="h-9 w-32 rounded-md" />
                ))}
              </div>
            )}
          </div>

          {/* Status bar: row count */}
          <div className="border-t px-4 py-2">
            <SkeletonLine className="h-4 w-20" />
          </div>

          {/* Table — bg-muted/80 header + shimmer rows (matches DataTable exactly) */}
          <div className="overflow-x-auto border-t">
            <table className="w-full caption-bottom text-sm">
              <thead className="bg-muted/80 sticky top-0 z-10 [&_tr]:border-b">
                <tr className="border-b transition-colors">
                  {Array.from({ length: columns }).map((_, i) => (
                    <th key={`head-${i}`} className="h-12 px-4 text-left align-middle font-medium">
                      <SkeletonLine className="h-4 w-24" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {Array.from({ length: rows }).map((_, r) => (
                  <tr key={`row-${r}`} className="border-b transition-colors">
                    {Array.from({ length: columns }).map((__, c) => (
                      <td key={`cell-${r}-${c}`} className="p-4 align-middle">
                        <SkeletonLine
                          className={`h-4 ${c === 0 ? "w-8" : c === 1 ? "w-32" : c === columns - 1 ? "w-16" : "w-24"}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between border-t px-4 py-3">
            <SkeletonLine className="h-4 w-28" />
            <div className="flex gap-2">
              <SkeletonLine className="h-9 w-20 rounded-md" />
              <SkeletonLine className="h-9 w-16 rounded-md" />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
