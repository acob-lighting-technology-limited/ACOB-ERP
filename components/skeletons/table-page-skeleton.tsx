import { cn } from "@/lib/utils"

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
  /**
   * Number of compact metric pills under the header. Only for pages that still
   * pass `statBadges` to DataTablePage — mirror it here or the page visibly
   * reflows on mount.
   */
  statBadges?: number
  /**
   * Which StatCard anatomy the page renders. `compact` is the denser card the
   * redesigned table pages use, which scales down again below `sm`.
   */
  statCardVariant?: "default" | "compact"
  /** `tight` matches DataTablePage's `spacing="tight"` (space-y-3). */
  spacing?: "standard" | "tight"
  /** Matches `actionsPlacement="inline-always"`: actions beside the title at every width. */
  inlineActions?: boolean
  /**
   * Which rendering the page opens in.
   * - `table`      the data table
   * - `contacts`   the row list at every width (a page whose `defaultViewMode`
   *                is a plain "contacts")
   * - `responsive` the row list below `md` and the table from `md` up, mirroring
   *                `defaultViewMode={{ mobile: "contacts", desktop: "list" }}`
   */
  list?: "table" | "contacts" | "responsive"
  /** Section headings in the contacts list (ignored for `list="table"`). */
  groups?: number
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
  statBadges,
  statCardVariant = "default",
  spacing = "standard",
  inlineActions = true,
  list = "table",
  groups = 3,
}: TablePageSkeletonProps) {
  const rowsPerGroup = Math.max(1, Math.ceil(rows / Math.max(1, groups)))
  return (
    /* PageWrapper: from-background via-background to-muted/20 bg-gradient-to-br, p-4 md:p-6 */
    <div className="from-background via-background to-muted/20 min-h-screen bg-gradient-to-br p-4 md:p-6">
      <div className={`mx-auto max-w-7xl ${spacing === "tight" ? "space-y-3" : "space-y-6"}`}>
        {/* ── 1. PageHeader ── */}
        <div
          className={
            inlineActions
              ? "flex flex-row items-start justify-between gap-3 sm:gap-4"
              : "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
          }
        >
          <div className="space-y-1">
            {showBackLink && <SkeletonLine className="mb-2 h-4 w-28" />}
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

        {/* ── 3a. Stat badge line (mobile counterpart of the cards) ── */}
        {statBadges && statBadges > 0 ? (
          <div className={`flex items-center gap-3 overflow-hidden ${showStats ? "md:hidden" : ""}`}>
            {Array.from({ length: statBadges }).map((_, i) => (
              <SkeletonLine key={`badge-${i}`} className="h-6 w-24 shrink-0 rounded-md" />
            ))}
          </div>
        ) : null}

        {/* ── 3b. Stats cards ── */}
        {showStats ? (
          <div
            className={`grid grid-cols-3 gap-2 sm:gap-3 ${
              statCards >= 5 ? "sm:grid-cols-3 lg:grid-cols-6" : statCards >= 4 ? "sm:grid-cols-4" : "lg:grid-cols-3"
            } ${statBadges && statBadges > 0 ? "hidden md:grid" : ""}`}
          >
            {Array.from({ length: statCards }).map((_, i) => {
              const hideOnMobile = statCards > 3 && i >= 3
              return statCardVariant === "compact" ? (
                <div
                  key={`stat-${i}`}
                  className={cn("bg-card rounded-xl border p-2.5 sm:p-3.5", hideOnMobile && "hidden sm:block")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <SkeletonLine className="h-2.5 w-16 sm:h-3" />
                      <SkeletonLine className="h-4 w-12 sm:h-5 sm:w-16" />
                    </div>
                    <SkeletonLine className="h-6 w-6 shrink-0 rounded-md sm:h-8 sm:w-8 sm:rounded-lg" />
                  </div>
                </div>
              ) : (
                <div
                  key={`stat-${i}`}
                  className={cn("bg-card rounded-xl border p-2.5 sm:p-4", hideOnMobile && "hidden sm:block")}
                >
                  <div className="flex items-center justify-between">
                    <SkeletonLine className="h-3 w-14 sm:h-4 sm:w-20" />
                    <SkeletonLine className="h-6 w-6 rounded-md sm:h-8 sm:w-8 sm:rounded-lg" />
                  </div>
                  <SkeletonLine className="mt-2 h-5 w-12 sm:mt-3 sm:h-7 sm:w-16" />
                  <SkeletonLine className="mt-1 h-2.5 w-16 sm:h-3 sm:w-24" />
                </div>
              )
            })}
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

          {/* Contacts list — grouped rows, matching DataTable's mobileRow anatomy */}
          {list !== "table" && (
            <div className={list === "responsive" ? "border-t md:hidden" : "border-t"}>
              {Array.from({ length: groups }).map((_, g) => (
                <div key={`group-${g}`}>
                  {groups > 1 && (
                    <div className="bg-muted border-b px-3 py-1">
                      <SkeletonLine className="h-3 w-4" />
                    </div>
                  )}
                  <div className="divide-y">
                    {Array.from({ length: rowsPerGroup }).map((__, r) => (
                      <div key={`crow-${g}-${r}`} className="flex items-center gap-3 py-2.5 pr-3.5 pl-3">
                        <SkeletonLine className="h-9 w-9 shrink-0 rounded-full" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <SkeletonLine className="h-4 w-40 max-w-full" />
                          <SkeletonLine className="h-3 w-56 max-w-full" />
                        </div>
                        <SkeletonLine className="h-5 w-12 shrink-0 rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {list !== "contacts" && (
            /* Table — bg-muted/80 header + shimmer rows (matches DataTable exactly) */
            <div
              className={
                list === "responsive" ? "hidden overflow-x-auto border-t md:block" : "overflow-x-auto border-t"
              }
            >
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
          )}

          {/* Pagination footer — only a *grouped* contacts list renders whole and
              therefore has no pager; every other shape keeps one. */}
          {list === "contacts" && groups > 1 ? null : (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <SkeletonLine className="h-4 w-28" />
              <div className="flex gap-2">
                <SkeletonLine className="h-9 w-20 rounded-md" />
                <SkeletonLine className="h-9 w-16 rounded-md" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
