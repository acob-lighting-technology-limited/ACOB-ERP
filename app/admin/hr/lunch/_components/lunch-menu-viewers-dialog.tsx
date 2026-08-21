"use client"

import { useMemo, useState } from "react"
import { Eye, Search, Clock, CheckCircle2, XCircle, AlertCircle, Utensils, UserX } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatWATDate, formatWATTime } from "@/lib/utils/date"
import { getInitials } from "@/lib/utils"
import type { AdminLunchMenu, LunchEmployee } from "../view"
import type { LunchMenuViewRecord, LunchVoteRecord } from "@/lib/hr/lunch-voting"

interface LunchMenuViewersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  menu: AdminLunchMenu | null
  employees: LunchEmployee[]
  onOverrideVote?: (employeeId: string) => void
}

type FilterType = "all_viewers" | "during_window" | "after_deadline" | "voted" | "said_no" | "no_vote" | "not_viewed"

export function LunchMenuViewersDialog({
  open,
  onOpenChange,
  menu,
  employees,
  onOverrideVote,
}: LunchMenuViewersDialogProps) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<FilterType>("all_viewers")

  const deadlineTime = useMemo(() => {
    if (!menu) return 0
    return new Date(menu.resolvedDeadline).getTime()
  }, [menu])

  // Map votes by user_id
  const voteByUser = useMemo(() => {
    if (!menu) return new Map<string, LunchVoteRecord>()
    const map = new Map<string, LunchVoteRecord>()
    for (const v of menu.votes) {
      map.set(v.user_id, v)
    }
    return map
  }, [menu])

  // Map viewers by user_id
  const viewerByUser = useMemo(() => {
    if (!menu) return new Map<string, LunchMenuViewRecord>()
    const map = new Map<string, LunchMenuViewRecord>()
    for (const v of menu.viewers || []) {
      map.set(v.user_id, v)
    }
    return map
  }, [menu])

  // Build full list of employees with their view and vote metadata
  const rows = useMemo(() => {
    if (!menu) return []

    return employees.map((emp) => {
      const viewer = viewerByUser.get(emp.id)
      const vote = voteByUser.get(emp.id)

      let viewedDuringWindow = false
      if (viewer && deadlineTime > 0) {
        const firstTime = new Date(viewer.first_viewed_at).getTime()
        viewedDuringWindow = firstTime <= deadlineTime
      }

      let mealChoice: string | null = null
      if (vote) {
        if (vote.is_eating) {
          mealChoice =
            menu.groups
              .map((g) => g.options.find((o) => o.id === vote.selections[g.id])?.name)
              .filter(Boolean)
              .join(" + ") || "Opted In"
        } else {
          mealChoice = "NO — Opted out"
        }
      }

      return {
        id: emp.id,
        full_name: emp.full_name,
        department: emp.department || "General",
        employee_number: emp.employee_number,
        avatar_url: viewer?.avatar_url || null,
        hasViewed: Boolean(viewer),
        first_viewed_at: viewer?.first_viewed_at || null,
        last_viewed_at: viewer?.last_viewed_at || null,
        view_count: viewer?.view_count || 0,
        viewedDuringWindow,
        vote,
        mealChoice,
      }
    })
  }, [menu, employees, viewerByUser, voteByUser, deadlineTime])

  // Summary counts
  const totalStaff = employees.length
  const totalViewers = (menu?.viewers || []).length
  const viewedDuringWindowCount = rows.filter((r) => r.hasViewed && r.viewedDuringWindow).length
  const viewedAfterDeadlineCount = rows.filter((r) => r.hasViewed && !r.viewedDuringWindow).length
  const notViewedCount = totalStaff - totalViewers

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // Search match
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchName = row.full_name.toLowerCase().includes(q)
        const matchDept = row.department.toLowerCase().includes(q)
        const matchCode = row.employee_number.toLowerCase().includes(q)
        if (!matchName && !matchDept && !matchCode) return false
      }

      // Filter match
      if (filter === "all_viewers") return row.hasViewed
      if (filter === "during_window") return row.hasViewed && row.viewedDuringWindow
      if (filter === "after_deadline") return row.hasViewed && !row.viewedDuringWindow
      if (filter === "voted") return row.hasViewed && row.vote && row.vote.is_eating
      if (filter === "said_no") return row.hasViewed && row.vote && !row.vote.is_eating
      if (filter === "no_vote") return row.hasViewed && !row.vote
      if (filter === "not_viewed") return !row.hasViewed
      return true
    })
  }, [rows, search, filter])

  if (!menu) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b p-5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Eye className="h-5 w-5 text-blue-500" />
                Menu Viewers: {formatWATDate(menu.date, { weekday: "long", day: "numeric", month: "short" })}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Tracked from publication until 11:59:59 PM WAT on{" "}
                {formatWATDate(menu.date, { day: "numeric", month: "short" })}. Voting closed at{" "}
                {formatWATTime(menu.resolvedDeadline)}.
              </DialogDescription>
            </div>
          </div>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 pt-3 sm:grid-cols-4">
            <div className="bg-muted/40 rounded-lg border p-2.5">
              <span className="text-muted-foreground block text-[11px] font-medium">Total Viewed</span>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-foreground text-base font-bold">{totalViewers}</span>
                <span className="text-muted-foreground text-xs">/ {totalStaff}</span>
                <span className="ml-auto text-[11px] font-semibold text-blue-600">
                  {totalStaff > 0 ? Math.round((totalViewers / totalStaff) * 100) : 0}%
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
              <span className="block text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                During Voting
              </span>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-base font-bold text-emerald-600">{viewedDuringWindowCount}</span>
                <span className="ml-auto text-[11px] font-semibold text-emerald-600">
                  {totalStaff > 0 ? Math.round((viewedDuringWindowCount / totalStaff) * 100) : 0}%
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <span className="block text-[11px] font-medium text-amber-700 dark:text-amber-400">After Deadline</span>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-base font-bold text-amber-600">{viewedAfterDeadlineCount}</span>
                <span className="ml-auto text-[11px] font-semibold text-amber-600">
                  {totalStaff > 0 ? Math.round((viewedAfterDeadlineCount / totalStaff) * 100) : 0}%
                </span>
              </div>
            </div>

            <div className="bg-muted/40 rounded-lg border p-2.5">
              <span className="text-muted-foreground block text-[11px] font-medium">Not Viewed</span>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-muted-foreground text-base font-bold">{notViewedCount}</span>
                <span className="text-muted-foreground ml-auto text-[11px] font-medium">
                  {totalStaff > 0 ? Math.round((notViewedCount / totalStaff) * 100) : 0}%
                </span>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-col items-center gap-2 pt-2 sm:flex-row">
            <div className="relative w-full flex-1">
              <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
              <Input
                placeholder="Search by name, department, staff code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 text-xs"
              />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_viewers">All Viewers ({totalViewers})</SelectItem>
                <SelectItem value="during_window">During Open Voting ({viewedDuringWindowCount})</SelectItem>
                <SelectItem value="after_deadline">After Deadline ({viewedAfterDeadlineCount})</SelectItem>
                <SelectItem value="voted">Viewed & Voted Opted In</SelectItem>
                <SelectItem value="said_no">Viewed & Voted Opted Out</SelectItem>
                <SelectItem value="no_vote">Viewed & Ignored (No Vote)</SelectItem>
                <SelectItem value="not_viewed">Not Viewed Yet ({notViewedCount})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        {/* List of Viewers */}
        <div className="divide-border/60 max-h-[50vh] flex-1 divide-y overflow-y-auto p-4">
          {filteredRows.length === 0 ? (
            <div className="text-muted-foreground space-y-1 py-10 text-center text-xs">
              <Eye className="text-muted-foreground/50 mx-auto mb-2 h-6 w-6" />
              <p className="font-semibold">No records match this filter</p>
              <p>Try clearing your search or switching filter categories.</p>
            </div>
          ) : (
            filteredRows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    {row.avatar_url && <AvatarImage src={row.avatar_url} alt={row.full_name} />}
                    <AvatarFallback className="bg-muted text-[11px] font-semibold">
                      {getInitials(row.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground truncate font-semibold">{row.full_name}</span>
                      <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                        {row.employee_number}
                      </span>
                    </div>
                    <span className="text-muted-foreground block truncate text-[11px]">{row.department}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {/* View Status & Timestamp */}
                  <div className="text-right">
                    {row.hasViewed ? (
                      <div>
                        <Badge
                          variant="outline"
                          className={
                            row.viewedDuringWindow
                              ? "border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-600"
                              : "border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-600"
                          }
                        >
                          {row.viewedDuringWindow ? "During Voting" : "After Cut-off"}
                        </Badge>
                        <span className="text-muted-foreground mt-0.5 block text-[10px]">
                          {row.first_viewed_at ? formatWATTime(row.first_viewed_at) : ""}
                        </span>
                      </div>
                    ) : (
                      <Badge variant="outline" className="border-gray-200 px-1.5 py-0 text-[10px] text-gray-400">
                        Not viewed
                      </Badge>
                    )}
                  </div>

                  {/* Meal / Vote Status */}
                  <div className="min-w-[130px] text-right">
                    {row.vote ? (
                      row.vote.is_eating ? (
                        <div>
                          <Badge className="inline-block max-w-[150px] truncate border-0 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                            {row.mealChoice}
                          </Badge>
                        </div>
                      ) : (
                        <Badge className="border-0 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600">
                          Said No
                        </Badge>
                      )
                    ) : (
                      <span className="text-muted-foreground text-[11px] italic">No vote</span>
                    )}
                  </div>

                  {/* Override Action */}
                  {onOverrideVote && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground h-7 px-2 text-[11px]"
                      onClick={() => onOverrideVote(row.id)}
                      title="Change or set this employee's answer"
                    >
                      Override
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
