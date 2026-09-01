"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  FileQuestion,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ATTENDANCE_STATUS_COLORS, ATTENDANCE_STATUS_LABELS } from "@/lib/hr/attendance-status"
import type { UnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { formatWATDate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"
import { AppealReviewDialog, type AppealRow } from "@/app/admin/hr/attendance/_components/appeal-review-dialog"

const log = logger("hr-attendance2-appeals")

type StatusScope = "pending" | "approved" | "rejected" | "all"
type SortKey = "user_name" | "appeal_date" | "created_at" | "status"

const SORT_ACCESSORS: Record<SortKey, (r: AppealRow) => string> = {
  user_name: (r) => r.user_name.toLowerCase(),
  appeal_date: (r) => r.appeal_date,
  created_at: (r) => r.created_at,
  status: (r) => r.status,
}

function statusTone(status: AppealRow["status"]): string {
  if (status === "approved") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (status === "rejected") return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
  return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
}

function StatusPill({ status }: { status: AppealRow["status"] }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] capitalize", statusTone(status))}>
      {status}
    </Badge>
  )
}

/** current → requested, which is the whole point of an appeal row. */
function StatusTransition({ appeal, size = "sm" }: { appeal: AppealRow; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "text-[10px]" : "text-xs"
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge
        className={cn(
          cls,
          ATTENDANCE_STATUS_COLORS[appeal.current_status as UnifiedAttendanceStatus] ?? "bg-gray-100 text-gray-800"
        )}
      >
        {ATTENDANCE_STATUS_LABELS[appeal.current_status as UnifiedAttendanceStatus] ?? appeal.current_status}
      </Badge>
      <ArrowRight className="text-muted-foreground h-3 w-3 shrink-0" />
      <Badge
        className={cn(
          cls,
          ATTENDANCE_STATUS_COLORS[appeal.requested_status as UnifiedAttendanceStatus] ?? "bg-blue-100 text-blue-800"
        )}
      >
        {ATTENDANCE_STATUS_LABELS[appeal.requested_status as UnifiedAttendanceStatus] ?? appeal.requested_status}
      </Badge>
    </div>
  )
}

export function Appeals2View({ lockedDepartment }: { lockedDepartment?: string }) {
  const [appeals, setAppeals] = useState<AppealRow[]>([])
  const [loading, setLoading] = useState(false)
  const [reviewAppeal, setReviewAppeal] = useState<AppealRow | null>(null)
  const [peeked, setPeeked] = useState<AppealRow | null>(null)

  // Status is the primary scope here — "what do I still have to action?" — so it
  // lives in a visible tab row rather than buried inside the filter sheet.
  const [statusScope, setStatusScope] = useState<StatusScope>("pending")
  const [search, setSearch] = useState("")
  const [selectedDept, setSelectedDept] = useState("all")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "created_at",
    direction: "desc",
  })
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  // Counts must survive the status scope, so the row is always fetched unfiltered
  // and narrowed client-side — otherwise every tab would show its own total only.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (lockedDepartment) params.set("department", lockedDepartment)
      const res = await fetch(`/api/admin/hr/attendance/appeals?${params.toString()}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load appeals")
      setAppeals((payload?.data as AppealRow[]) ?? [])
    } catch (err) {
      log.error({ err: String(err) }, "Failed to load appeals")
      toast.error("Failed to load appeals")
    } finally {
      setLoading(false)
    }
  }, [lockedDepartment])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(
    () => ({
      pending: appeals.filter((a) => a.status === "pending").length,
      approved: appeals.filter((a) => a.status === "approved").length,
      rejected: appeals.filter((a) => a.status === "rejected").length,
      all: appeals.length,
    }),
    [appeals]
  )

  const monthStats = useMemo(() => {
    const now = new Date()
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    return {
      approvedThisMonth: appeals.filter((a) => a.status === "approved" && a.created_at.startsWith(currentYM)).length,
      rejectedThisMonth: appeals.filter((a) => a.status === "rejected" && a.created_at.startsWith(currentYM)).length,
    }
  }, [appeals])

  const departmentOptions = useMemo(() => {
    if (lockedDepartment) return [lockedDepartment]
    return Array.from(new Set(appeals.map((a) => a.department).filter(Boolean))).sort()
  }, [appeals, lockedDepartment])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return appeals.filter((a) => {
      if (statusScope !== "all" && a.status !== statusScope) return false
      if (selectedDept !== "all" && a.department !== selectedDept) return false
      if (!q) return true
      return [a.user_name, a.department, a.appeal_reason].join(" ").toLowerCase().includes(q)
    })
  }, [appeals, statusScope, selectedDept, search])

  const sortedRows = useMemo(() => {
    const accessor = SORT_ACCESSORS[sort.key]
    const sorted = [...filteredRows].sort((a, b) => accessor(a).localeCompare(accessor(b)))
    return sort.direction === "asc" ? sorted : sorted.reverse()
  }, [filteredRows, sort])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const pagedRows = useMemo(() => sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sortedRows, page])

  useEffect(() => {
    setPage(0)
  }, [search, selectedDept, statusScope])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    )
  }

  const activeFilterCount = selectedDept !== "all" ? 1 : 0

  const scopeTabs: { key: StatusScope; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "all", label: "All", count: counts.all },
  ]

  return (
    <div className="space-y-4">
      {/* Status scope pills, each carrying its own count */}
      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {scopeTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusScope(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              statusScope === tab.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-bold",
                statusScope === tab.key ? "bg-white/20" : "bg-muted"
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Sticky search + one filter trigger */}
      <div className="bg-background sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b px-4 py-2 shadow-sm sm:static sm:mx-0 sm:border-b-0 sm:px-0 sm:py-0 sm:shadow-none">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search employee, department, reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card h-10 border-2 pr-9 pl-10 shadow-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter appeals</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              {!lockedDepartment && departmentOptions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-medium">Department</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedDept("all")}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        selectedDept === "all"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      All
                    </button>
                    {departmentOptions.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setSelectedDept(d)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs",
                          selectedDept === d
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">Sort by</p>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { key: "created_at", label: "Newest submitted" },
                      { key: "appeal_date", label: "Appeal date" },
                      { key: "user_name", label: "Employee name" },
                    ] as { key: SortKey; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSort({ key: opt.key, direction: opt.key === "user_name" ? "asc" : "desc" })}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        sort.key === opt.key
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setSelectedDept("all")
                  setSort({ key: "created_at", direction: "desc" })
                }}
              >
                Reset
              </Button>
              <SheetClose asChild>
                <Button className="flex-1">Apply</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <div className="-mt-1 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {sortedRows.length} shown
        </Badge>
        {counts.pending > 0 && (
          <Badge variant="outline" className="rounded-full px-2.5 py-1 text-xs font-normal text-amber-600">
            {counts.pending} awaiting review
          </Badge>
        )}
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {monthStats.approvedThisMonth} approved this month
        </Badge>
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {monthStats.rejectedThisMonth} rejected this month
        </Badge>
      </div>

      {/* Mobile: one card per appeal — the transition and the reason are the story */}
      <div className="md:hidden">
        {loading ? (
          <ListSkeleton />
        ) : sortedRows.length === 0 ? (
          <EmptyAppeals />
        ) : (
          <div className="space-y-2.5">
            {sortedRows.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setPeeked(a)}
                className="bg-card hover:bg-muted/30 w-full space-y-2 rounded-xl border p-3.5 text-left transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.user_name}</p>
                    <p className="text-muted-foreground truncate text-xs">{a.department}</p>
                  </div>
                  <StatusPill status={a.status} />
                </div>

                <StatusTransition appeal={a} />

                <p className="text-muted-foreground line-clamp-2 text-xs">{a.appeal_reason}</p>

                <div className="text-muted-foreground flex items-center justify-between gap-2 text-[11px]">
                  <span>For {formatWATDate(a.appeal_date, { day: "2-digit", month: "short", year: "numeric" })}</span>
                  <span className="inline-flex items-center gap-0.5">
                    Details
                    <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: dense sortable table with S/N and pagination */}
      <div className="hidden md:block">
        {loading ? (
          <div className="bg-card space-y-2 rounded-xl border p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-muted h-8 w-full animate-pulse rounded" />
            ))}
          </div>
        ) : sortedRows.length === 0 ? (
          <EmptyAppeals />
        ) : (
          <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-medium tracking-wide uppercase">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center">S/N</th>
                    <SortableHeader label="Employee" sortKey="user_name" current={sort} onSort={toggleSort} />
                    <SortableHeader label="Appeal date" sortKey="appeal_date" current={sort} onSort={toggleSort} />
                    <th className="px-4 py-3">Change requested</th>
                    <SortableHeader label="Submitted" sortKey="created_at" current={sort} onSort={toggleSort} />
                    <SortableHeader label="Status" sortKey="status" current={sort} onSort={toggleSort} />
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagedRows.map((a, index) => (
                    <tr key={a.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => setPeeked(a)}>
                      <td className="text-muted-foreground px-4 py-3 text-center font-mono">
                        {page * PAGE_SIZE + index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{a.user_name}</p>
                        <p className="text-muted-foreground text-[11px]">{a.department}</p>
                      </td>
                      <td className="px-4 py-3">
                        {formatWATDate(a.appeal_date, { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        <StatusTransition appeal={a} />
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {formatWATDate(a.created_at, { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={a.status} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {a.status === "pending" ? (
                          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setReviewAppeal(a)}>
                            Review
                          </Button>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-4 border-t px-4 py-3 text-sm">
                <p className="text-muted-foreground">
                  Showing{" "}
                  <span className="text-foreground font-medium">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedRows.length)}
                  </span>{" "}
                  of <span className="text-foreground font-medium">{sortedRows.length}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail sheet — full reason, resolution note, and the review action */}
      <Sheet open={peeked !== null} onOpenChange={(open) => !open && setPeeked(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {peeked && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {peeked.user_name}
                  <StatusPill status={peeked.status} />
                </SheetTitle>
                <p className="text-muted-foreground text-sm">
                  {peeked.department} ·{" "}
                  {formatWATDate(peeked.appeal_date, { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </SheetHeader>

              <div className="space-y-4 px-4">
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    Change requested
                  </p>
                  <StatusTransition appeal={peeked} size="md" />
                </div>

                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                    Appeal reason
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{peeked.appeal_reason}</p>
                </div>

                {peeked.resolution_note && (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                      Resolution note
                    </p>
                    <p className="text-muted-foreground text-sm whitespace-pre-wrap">{peeked.resolution_note}</p>
                  </div>
                )}

                <p className="text-muted-foreground text-[11px]">
                  Submitted {formatWATDate(peeked.created_at, { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              </div>

              {peeked.status === "pending" && (
                <SheetFooter>
                  <Button
                    className="w-full"
                    onClick={() => {
                      const target = peeked
                      setPeeked(null)
                      setReviewAppeal(target)
                    }}
                  >
                    Review appeal
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <AppealReviewDialog
        appeal={reviewAppeal}
        open={reviewAppeal !== null}
        onClose={() => setReviewAppeal(null)}
        onSuccess={() => {
          setReviewAppeal(null)
          void load()
        }}
      />
    </div>
  )
}

function SortableHeader({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string
  sortKey: SortKey
  current: { key: SortKey; direction: "asc" | "desc" }
  onSort: (key: SortKey) => void
}) {
  const isActive = current.key === sortKey
  return (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        {label}
        {isActive ? (
          current.direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-card animate-pulse space-y-2 rounded-xl border p-3.5">
          <div className="bg-muted h-3.5 w-36 rounded" />
          <div className="bg-muted h-3 w-24 rounded" />
          <div className="bg-muted h-3 w-full rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyAppeals() {
  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center">
      <FileQuestion className="text-muted-foreground/50 h-10 w-10" />
      <h3 className="mt-3 text-sm font-semibold">No appeals found</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-xs">No attendance appeals match your current filters.</p>
    </div>
  )
}
