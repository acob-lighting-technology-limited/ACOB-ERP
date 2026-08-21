"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Star,
  Users,
  Utensils,
  Wallet,
} from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/patterns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn, getInitials } from "@/lib/utils"
import { apiFetch } from "@/lib/api-client"
import { formatWATDate, formatWATTime, toLocalISODate, toLocalYearMonth } from "@/lib/utils/date"
import { LunchReviewDialog } from "./_components/lunch-review-dialog"
import {
  groupHeading,
  menuHeading,
  notEatingTally,
  tallyVotes,
  NOT_EATING_OPTION_ID,
  type LunchMenu,
  type LunchOptionTally,
  type LunchVoteRecord,
  type LunchVoter,
} from "@/lib/hr/lunch-voting"
import { logger } from "@/lib/logger"

const log = logger("lunch-content")

interface LunchDay {
  date: string
  menu_id: string
  votingOpen: boolean
  deadline: string
}

export interface LunchPollData {
  today: string
  selectedDate: string
  days: LunchDay[]
  menu: LunchMenu | null
  votes: LunchVoteRecord[]
  votingOpen: boolean
  deadline: string | null
  pricing: { cost: number; company_subsidy: number; employee_deduction: number }
  eatingDays: string[]
}

interface HistoryRow {
  date: string
  cost: number
  company_subsidy: number
  employee_deduction: number
  picks: string[]
  menu_id?: string | null
  user_review?: { id: string; rating: number; comment: string | null } | null
}

interface LunchContentProps {
  initialData: LunchPollData
  currentUserId: string
}

const TABS: DataTableTab[] = [
  { key: "poll", label: "Menu & Voting" },
  { key: "history", label: "My Lunch History" },
]

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** How many voter photos the collapsed row shows before the count. */
const AVATAR_STACK_SIZE = 4

function naira(value: number) {
  return `₦${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
}

/** "2h 14m left" / "12m left" — shown next to the deadline while voting is open. */
function formatTimeLeft(deadline: string, now: number): string | null {
  const remaining = new Date(deadline).getTime() - now
  if (remaining <= 0) return null
  const minutes = Math.floor(remaining / 60000)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m left`
  return `${Math.max(minutes, 1)}m left`
}

/** Steps a YYYY-MM-DD date by whole days, staying in WAT. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+01:00`)
  d.setDate(d.getDate() + days)
  return toLocalISODate(d)
}

export function LunchContent({ initialData, currentUserId }: LunchContentProps) {
  const [activeTab, setActiveTab] = useState<string>("poll")
  const [data, setData] = useState<LunchPollData>(initialData)
  const [submitting, setSubmitting] = useState(false)
  const [loadingDay, setLoadingDay] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const menu = data.menu
  const myVote = useMemo(() => data.votes.find((v) => v.user_id === currentUserId) || null, [data.votes, currentUserId])

  // Draft holds the in-progress answer: which dish per category, or the NO
  // answer, seeded from whatever this person already voted.
  const [draft, setDraft] = useState<Record<string, string>>(() => myVote?.selections || {})
  const [draftEating, setDraftEating] = useState<boolean>(() => myVote?.is_eating ?? true)

  useEffect(() => {
    setDraft(myVote?.selections || {})
    setDraftEating(myVote?.is_eating ?? true)
  }, [myVote])

  // Which option rows have their voter list expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // The deadline can pass while the page sits open — tick so the countdown
  // and the disabled state stay honest without a refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // Record that the user viewed this published menu
  useEffect(() => {
    if (!menu?.id) return
    void apiFetch("/api/hr/lunch/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menuId: menu.id }),
    }).catch(() => {
      // Best-effort view tracking
    })
  }, [menu?.id])

  const deadlinePassed = data.deadline ? new Date(data.deadline).getTime() <= now : false
  const votingOpen = data.votingOpen && !deadlinePassed
  const timeLeft = data.deadline && votingOpen ? formatTimeLeft(data.deadline, now) : null

  const tallies = useMemo(
    () => (menu ? [...tallyVotes(menu.groups, data.votes), notEatingTally(data.votes)] : []),
    [menu, data.votes]
  )
  const totalVotes = data.votes.length
  // Days that still have a menu worth jumping to, for the empty-day shortcut.
  const upcomingDays = useMemo(
    () => data.days.filter((d) => d.date >= data.today && d.date !== data.selectedDate).slice(0, 5),
    [data.days, data.today, data.selectedDate]
  )

  /** Switches the poll to another published day. */
  const selectDay = useCallback(async (date: string) => {
    setLoadingDay(true)
    try {
      const res = await fetch(`/api/hr/lunch?date=${date}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load that day's menu")
      setData(payload as LunchPollData)
      setExpanded(new Set())
    } catch (err) {
      log.error({ err: String(err) }, "lunch day load failed")
      toast.error(err instanceof Error ? err.message : "Failed to load that day's menu")
    } finally {
      setLoadingDay(false)
    }
  }, [])

  // ── History tab ───────────────────────────────────────────────────────────
  const [historyMonth, setHistoryMonth] = useState<string>(() => toLocalYearMonth())
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [selectedReviewMenuId, setSelectedReviewMenuId] = useState<string | null>(null)
  const [selectedReviewDate, setSelectedReviewDate] = useState<string | null>(null)

  const loadHistory = useCallback(async (yearMonth: string) => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await fetch(`/api/hr/lunch/history?year_month=${yearMonth}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load your lunch history")
      setHistoryRows((payload.rows || []) as HistoryRow[])
    } catch (err) {
      log.error({ err: String(err) }, "lunch history load failed")
      setHistoryError(err instanceof Error ? err.message : "Failed to load your lunch history")
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab !== "history") return
    void loadHistory(historyMonth)
  }, [activeTab, historyMonth, loadHistory])

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    const today = new Date()
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      opts.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      })
    }
    return opts
  }, [])

  const monthDeduction = useMemo(
    () => historyRows.reduce((sum, row) => sum + Number(row.employee_deduction || 0), 0),
    [historyRows]
  )

  // ── Voting ────────────────────────────────────────────────────────────────
  // Answering YES means one dish from every required category; NO answers none
  // of them and costs nothing.
  const missingGroups = useMemo(
    () => (menu && draftEating ? menu.groups.filter((g) => g.is_required && !draft[g.id]) : []),
    [menu, draft, draftEating]
  )
  const draftMatchesVote =
    myVote != null &&
    myVote.is_eating === draftEating &&
    Object.keys(draft).length === Object.keys(myVote.selections).length &&
    Object.entries(draft).every(([groupId, optionId]) => myVote.selections[groupId] === optionId)

  /**
   * Saves the answer as soon as it is complete — there is no submit step.
   * On a multi-category menu the first pick has nothing to save yet, so it is
   * held in the draft until every required category has an answer.
   */
  const saveVote = useCallback(
    async (eating: boolean, selections: Record<string, string>) => {
      if (!menu) return
      setSubmitting(true)
      try {
        const res = await apiFetch("/api/hr/lunch/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ menuId: menu.id, eating, selections }),
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error || "Failed to save your vote")

        setData((prev) => ({ ...prev, votes: (payload.votes || []) as LunchVoteRecord[] }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save your vote")
      } finally {
        setSubmitting(false)
      }
    },
    [menu]
  )

  const withdrawVote = useCallback(async () => {
    if (!menu) return
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/hr/lunch/vote?menuId=${menu.id}`, {
        method: "DELETE",
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to withdraw your vote")

      setData((prev) => ({ ...prev, votes: (payload.votes || []) as LunchVoteRecord[] }))
      setDraft({})
      setDraftEating(true)
      toast.success("Vote withdrawn")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to withdraw your vote")
    } finally {
      setSubmitting(false)
    }
  }, [menu])

  function pickOption(groupId: string, optionId: string) {
    if (!menu) return

    // If this option is already selected in draft and eating is active, uncheck it.
    if (draftEating && draft[groupId] === optionId) {
      const next = { ...draft }
      delete next[groupId]
      setDraft(next)

      if (myVote) {
        void withdrawVote()
      }
      return
    }

    const next = { ...draft, [groupId]: optionId }
    setDraftEating(true)
    setDraft(next)

    const stillMissing = menu.groups.filter((g) => g.is_required && !next[g.id])
    if (stillMissing.length === 0) void saveVote(true, next)
  }

  function pickNotEating() {
    // If "NO" is already selected, clicking it again unchecks it (withdraws the vote).
    if (!draftEating) {
      setDraftEating(true)
      setDraft({})
      if (myVote) {
        void withdrawVote()
      }
      return
    }

    setDraftEating(false)
    setDraft({})
    void saveVote(false, {})
  }

  // ── History table ─────────────────────────────────────────────────────────
  const historyColumns: DataTableColumn<HistoryRow>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      accessor: (row) => row.date,
      render: (row) => (
        <span className="text-foreground text-xs font-semibold sm:text-sm">
          {formatWATDate(row.date, { weekday: "short", day: "numeric", month: "short" })}
        </span>
      ),
    },
    {
      key: "picks",
      label: "What You Ate",
      accessor: (row) => row.picks.join(" + "),
      render: (row) =>
        row.picks.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.picks.map((pick) => (
              <Badge key={pick} variant="outline" className="text-xs leading-normal font-medium break-words">
                {pick}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">Logged by admin</span>
        ),
    },
    {
      key: "employee_deduction",
      label: "Deduction",
      sortable: true,
      accessor: (row) => row.employee_deduction,
      render: (row) => (
        <span className="font-mono text-xs font-bold whitespace-nowrap text-red-600">
          {naira(row.employee_deduction)}
        </span>
      ),
    },
    {
      key: "feedback",
      label: "Feedback",
      render: (row) => {
        if (!row.menu_id) {
          return <span className="text-muted-foreground text-xs">—</span>
        }
        if (row.user_review) {
          return (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-600 hover:bg-amber-500/20"
              onClick={() => {
                setSelectedReviewMenuId(row.menu_id || null)
                setSelectedReviewDate(row.date)
                setReviewDialogOpen(true)
              }}
              title="Click to edit or delete your review"
            >
              <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
              {row.user_review.rating} / 5
            </Button>
          )
        }
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2.5 text-xs font-medium"
            onClick={() => {
              setSelectedReviewMenuId(row.menu_id || null)
              setSelectedReviewDate(row.date)
              setReviewDialogOpen(true)
            }}
          >
            <Star className="h-3.5 w-3.5 fill-amber-500/20 text-amber-500" />
            Feedback
          </Button>
        )
      },
    },
  ]

  const historyFilters = [
    {
      key: "month",
      label: "Month",
      options: monthOptions,
      placeholder: "Select month",
      multi: false,
      defaultValues: [historyMonth],
      mode: "custom" as const,
      filterFn: () => true,
    },
    {
      key: "weekday",
      label: "Day",
      options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => ({ value: d, label: d })),
    },
  ]

  const myPickLabel =
    myVote && menu
      ? myVote.is_eating
        ? menu.groups
            .map((g) => g.options.find((o) => o.id === myVote.selections[g.id])?.name)
            .filter(Boolean)
            .join(" + ") || "Voted"
        : "Not eating"
      : "Not voted"

  return (
    <DataTablePage
      title="Lunch"
      description="Vote for what you want to eat and see what everyone else picked."
      icon={Utensils}
      backLink={{ href: "/profile", label: "Back to Home" }}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      stats={
        activeTab === "poll" ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <StatCard
              title="Your Choice"
              value={myPickLabel}
              icon={Check}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
            <StatCard
              title="Voted"
              value={totalVotes}
              icon={Users}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title={votingOpen ? "Voting Closes" : "Voting"}
              value={data.deadline ? (votingOpen ? formatWATTime(data.deadline) : "Closed") : "—"}
              icon={Clock}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
            <StatCard
              title="Deduction / Meal"
              value={naira(data.pricing.employee_deduction)}
              icon={Wallet}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
          </div>
        ) : (
          <div className="grid max-w-xl grid-cols-2 gap-2 sm:gap-3">
            <StatCard
              title="Total Deduction"
              value={naira(monthDeduction)}
              icon={Wallet}
              iconBgColor="bg-red-500/10"
              iconColor="text-red-500"
            />
            <StatCard
              title="Meals This Period"
              value={historyRows.length}
              icon={Utensils}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
          </div>
        )
      }
    >
      {activeTab === "poll" && (
        <div className="space-y-4">
          {/* Any date, forwards or back. Voting is still gated by each day's
              own deadline, so past days open read-only. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={loadingDay}
              onClick={() => void selectDay(shiftDate(data.selectedDate, -1))}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="date"
              value={data.selectedDate}
              disabled={loadingDay}
              onChange={(e) => e.target.value && void selectDay(e.target.value)}
              className="border-input bg-background h-9 rounded-md border px-3 py-1.5 text-sm"
              aria-label="Pick a date"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={loadingDay}
              onClick={() => void selectDay(shiftDate(data.selectedDate, 1))}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {data.selectedDate !== data.today && (
              <Button variant="ghost" size="sm" disabled={loadingDay} onClick={() => void selectDay(data.today)}>
                Today
              </Button>
            )}
          </div>

          {loadingDay ? (
            <div className="text-muted-foreground flex items-center justify-center gap-3 p-12">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading menu…</span>
            </div>
          ) : !menu ? (
            <EmptyState
              icon={Utensils}
              title={`No menu for ${formatWATDate(data.selectedDate, { weekday: "long", day: "numeric", month: "long" })}`}
              description={
                upcomingDays.length > 0
                  ? `Nothing published for this day. Menus are up for ${upcomingDays.map((d) => formatWATDate(d.date, { weekday: "short", day: "numeric", month: "short" })).join(", ")}.`
                  : `Nothing published for this day. Lunch normally runs on ${data.eatingDays.join(", ")} — Admin and HR usually put the menu up a day or two ahead, and you'll get a notification when they do.`
              }
              action={
                upcomingDays.length > 0 ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {upcomingDays.map((day) => (
                      <Button key={day.date} size="sm" variant="outline" onClick={() => void selectDay(day.date)}>
                        {formatWATDate(day.date, { weekday: "short", day: "numeric", month: "short" })}
                      </Button>
                    ))}
                  </div>
                ) : undefined
              }
            />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Utensils className="text-primary h-4 w-4" />
                      {menuHeading(menu.date, data.today)}
                    </CardTitle>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatWATDate(menu.date, { weekday: "long", day: "numeric", month: "long" })}
                      {data.deadline && (
                        <>
                          {" · "}
                          {votingOpen
                            ? `Closes ${formatWATTime(data.deadline)}${timeLeft ? ` (${timeLeft})` : ""}`
                            : `Closed at ${formatWATTime(data.deadline)}`}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {votingOpen && (myVote || Object.keys(draft).length > 0 || !draftEating) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={submitting}
                        onClick={() => {
                          setDraft({})
                          setDraftEating(true)
                          if (myVote) void withdrawVote()
                        }}
                        className="text-muted-foreground hover:text-foreground h-7 px-2 text-xs"
                      >
                        Clear choice
                      </Button>
                    )}
                    <Badge
                      className={cn(
                        "border-0",
                        votingOpen
                          ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                          : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      )}
                    >
                      {votingOpen ? "Open for voting" : "Closed"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {menu.groups.map((group, index) => (
                  <div key={group.id} className="space-y-1">
                    {/* One list needs no heading — headings only tell several
                        lists apart (Soup vs Swallow). */}
                    {menu.groups.length > 1 && (
                      <div className="flex items-baseline gap-2 pb-1">
                        <span className="text-foreground text-sm font-semibold">{groupHeading(group, index)}</span>
                        <span className="text-muted-foreground text-[11px] tracking-wider uppercase">
                          Step {index + 1} of {menu.groups.length} · pick one
                        </span>
                        {!group.is_required && (
                          <span className="text-muted-foreground text-[11px] italic">optional</span>
                        )}
                      </div>
                    )}

                    {group.options.map((option) => (
                      <PollRow
                        key={option.id}
                        label={option.name}
                        description={option.description}
                        tally={tallies.find((t) => t.option_id === option.id)}
                        totalVotes={totalVotes}
                        selected={draftEating && draft[group.id] === option.id}
                        disabled={!votingOpen || !option.is_available || submitting}
                        unavailable={!option.is_available}
                        currentUserId={currentUserId}
                        expanded={expanded.has(option.id)}
                        onToggleExpanded={() => toggleExpanded(option.id)}
                        onSelect={() => pickOption(group.id, option.id)}
                      />
                    ))}
                  </div>
                ))}

                {/* The system's own answer. Opting out costs nothing, but
                    saying so out loud is visible to everyone. */}
                <div className="border-t pt-3">
                  <PollRow
                    label="NO — I'm not eating"
                    description={null}
                    tally={tallies.find((t) => t.option_id === NOT_EATING_OPTION_ID)}
                    totalVotes={totalVotes}
                    selected={!draftEating}
                    disabled={!votingOpen || submitting}
                    unavailable={false}
                    currentUserId={currentUserId}
                    expanded={expanded.has(NOT_EATING_OPTION_ID)}
                    onToggleExpanded={() => toggleExpanded(NOT_EATING_OPTION_ID)}
                    onSelect={pickNotEating}
                  />
                </div>

                {(missingGroups.length > 0 || !votingOpen || submitting) && (
                  <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {submitting ? (
                      <span>Saving…</span>
                    ) : missingGroups.length > 0 && votingOpen ? (
                      <span>
                        Still to pick:{" "}
                        <span className="text-foreground font-semibold">
                          {missingGroups.map((g) => groupHeading(g, menu.groups.indexOf(g))).join(", ")}
                        </span>
                      </span>
                    ) : !votingOpen ? (
                      <span>Voting has closed for this day. Speak to Admin &amp; HR if you need a change.</span>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-4">
          <DataTable<HistoryRow>
            data={historyRows}
            columns={historyColumns}
            getRowId={(row) => row.date}
            searchPlaceholder="Search what you ate…"
            searchFn={(row, q) => row.picks.join(" ").toLowerCase().includes(q.toLowerCase())}
            filters={historyFilters}
            onFilterChange={(filters) => {
              const nextMonth = filters.month?.[0]
              if (nextMonth && nextMonth !== historyMonth) setHistoryMonth(nextMonth)
            }}
            isLoading={historyLoading}
            error={historyError}
            onRetry={() => void loadHistory(historyMonth)}
            pagination={{ pageSize: 31 }}
            viewToggle
            cardRenderer={(row) => (
              <div className="space-y-2.5 p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2 border-b pb-2">
                  <div>
                    <span className="text-foreground block text-sm font-semibold">
                      {formatWATDate(row.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block font-mono text-sm font-bold text-red-500">
                      {naira(row.employee_deduction)}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 text-[11px] font-medium">What You Ate:</p>
                  {row.picks.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {row.picks.map((pick) => (
                        <Badge key={pick} variant="outline" className="bg-muted/30 text-xs font-medium">
                          {pick}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs italic">Logged by admin</span>
                  )}
                </div>
                {row.menu_id && (
                  <div className="pt-1">
                    {row.user_review ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-full gap-1.5 border-amber-500/30 bg-amber-500/10 text-xs font-semibold text-amber-600 hover:bg-amber-500/20"
                        onClick={() => {
                          setSelectedReviewMenuId(row.menu_id || null)
                          setSelectedReviewDate(row.date)
                          setReviewDialogOpen(true)
                        }}
                      >
                        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                        Reviewed: {row.user_review.rating} / 5 (Edit)
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-full gap-1.5 text-xs font-medium"
                        onClick={() => {
                          setSelectedReviewMenuId(row.menu_id || null)
                          setSelectedReviewDate(row.date)
                          setReviewDialogOpen(true)
                        }}
                      >
                        <Star className="h-3.5 w-3.5 fill-amber-500/20 text-amber-500" />
                        Give Feedback
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          />
        </div>
      )}

      <LunchReviewDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        menuId={selectedReviewMenuId}
        date={selectedReviewDate}
        onSaved={() => void loadHistory(historyMonth)}
      />
    </DataTablePage>
  )
}

/**
 * One answer in the poll, laid out like a WhatsApp poll row: radio, label,
 * a stack of the most recent voters' photos with the count, and a bar. Tapping
 * the count expands the full list of who picked it.
 */
function PollRow({
  label,
  description,
  tally,
  totalVotes,
  selected,
  disabled,
  unavailable,
  currentUserId,
  expanded,
  onToggleExpanded,
  onSelect,
}: {
  label: string
  description: string | null
  tally: LunchOptionTally | undefined
  totalVotes: number
  selected: boolean
  disabled: boolean
  unavailable: boolean
  currentUserId: string
  expanded: boolean
  onToggleExpanded: () => void
  onSelect: () => void
}) {
  const count = tally?.count ?? 0
  const voters = tally?.voters ?? []
  const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0

  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2 sm:gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onSelect}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-1 py-1 text-left transition-colors",
            !disabled && "hover:bg-muted/40",
            disabled && "cursor-not-allowed opacity-60"
          )}
          aria-pressed={selected}
        >
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
              selected ? "border-primary bg-primary" : "border-muted-foreground/40"
            )}
          >
            {selected && <Check className="text-primary-foreground h-3 w-3" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground block text-sm leading-snug font-medium break-words">{label}</span>
            {description && (
              <span className="text-muted-foreground mt-0.5 block text-xs leading-normal break-words">
                {description}
              </span>
            )}
            {unavailable && <span className="mt-0.5 block text-xs font-medium text-red-500">Finished</span>}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleExpanded}
          disabled={count === 0}
          className={cn(
            "mt-0.5 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1",
            count > 0 ? "hover:bg-muted/40" : "cursor-default"
          )}
          aria-expanded={expanded}
          aria-label={count > 0 ? `${count} voted — show who` : "No votes"}
        >
          <AvatarStack voters={voters} currentUserId={currentUserId} />
          <span className="text-foreground text-sm font-semibold tabular-nums">{count}</span>
          {count > 0 && (
            <ChevronDown
              className={cn("text-muted-foreground h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            />
          )}
        </button>
      </div>

      <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {expanded && voters.length > 0 && (
        <div className="mt-2 space-y-1 pl-8 sm:pl-9">
          {voters.map((voter) => (
            <div key={voter.user_id} className="flex items-center gap-2">
              <VoterAvatar voter={voter} className="h-6 w-6 text-[10px]" />
              <span className="text-muted-foreground truncate text-xs">
                {voter.user_id === currentUserId ? "You" : voter.full_name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Overlapping photos of the most recent voters, newest first. */
function AvatarStack({ voters, currentUserId }: { voters: LunchVoter[]; currentUserId: string }) {
  if (voters.length === 0) return null

  // Show up to 3 avatars on mobile, 4 on desktop
  const shownDesktop = voters.slice(0, 4)
  const extraMobile = voters.length - 3
  const extraDesktop = voters.length - 4

  return (
    <div className="flex items-center -space-x-2">
      {shownDesktop.map((voter, idx) => (
        <VoterAvatar
          key={voter.user_id}
          voter={voter}
          className={cn(
            "ring-background h-6 w-6 text-[9px] ring-2",
            voter.user_id === currentUserId && "ring-primary",
            idx === 3 && "hidden sm:inline-flex"
          )}
        />
      ))}
      {extraMobile > 0 && (
        <span className="bg-muted text-muted-foreground ring-background flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold ring-2 sm:hidden">
          +{extraMobile}
        </span>
      )}
      {extraDesktop > 0 && (
        <span className="bg-muted text-muted-foreground ring-background hidden h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold ring-2 sm:flex">
          +{extraDesktop}
        </span>
      )}
    </div>
  )
}

function VoterAvatar({ voter, className }: { voter: LunchVoter; className?: string }) {
  const [first, last] = voter.full_name.split(" ")

  if (voter.avatar_url) {
    return (
      // Signed Supabase URLs are not on the configured next/image domains, so
      // a plain img keeps this from failing at runtime.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={voter.avatar_url}
        alt={voter.full_name}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    )
  }

  return (
    <span
      className={cn(
        "bg-primary/10 text-primary flex shrink-0 items-center justify-center rounded-full font-semibold",
        className
      )}
      title={voter.full_name}
    >
      {getInitials(undefined, first, last)}
    </span>
  )
}
