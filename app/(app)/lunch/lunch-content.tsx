"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { CalendarDays, Check, Clock, Loader2, Trash2, Users, Utensils, Wallet } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/patterns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn, getInitials } from "@/lib/utils"
import { apiFetch } from "@/lib/api-client"
import { formatWATDate, formatWATTime, toLocalISODate, toLocalYearMonth } from "@/lib/utils/date"
import { groupHeading, menuHeading, tallyVotes, type LunchMenu, type LunchVoteRecord } from "@/lib/hr/lunch-voting"
import { logger } from "@/lib/logger"
import { LunchReviewDialog } from "./_components/lunch-review-dialog"

const log = logger("lunch-content")

export interface LunchPollData {
  date: string
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
  /** Null when that day predates the menu feature — nothing to review. */
  menu_id: string | null
}

interface LunchContentProps {
  initialData: LunchPollData
  currentUserId: string
}

const TABS: DataTableTab[] = [
  { key: "today", label: "Today's Menu" },
  { key: "history", label: "My Lunch History" },
]

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

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

export function LunchContent({ initialData, currentUserId }: LunchContentProps) {
  const [activeTab, setActiveTab] = useState<string>("today")
  const [data, setData] = useState<LunchPollData>(initialData)
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const menu = data.menu
  const myVote = useMemo(() => data.votes.find((v) => v.user_id === currentUserId) || null, [data.votes, currentUserId])

  // Draft holds the in-progress picks; it starts from whatever the user
  // already voted for so re-opening the page shows their current choice.
  const [draft, setDraft] = useState<Record<string, string>>(() => myVote?.selections || {})
  useEffect(() => {
    setDraft(myVote?.selections || {})
  }, [myVote])

  // The deadline can pass while the page sits open — tick so the countdown
  // and the disabled state stay honest without a refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const deadlinePassed = data.deadline ? new Date(data.deadline).getTime() <= now : false
  const votingOpen = data.votingOpen && !deadlinePassed
  const timeLeft = data.deadline && votingOpen ? formatTimeLeft(data.deadline, now) : null

  const tallies = useMemo(() => (menu ? tallyVotes(menu.groups, data.votes) : []), [menu, data.votes])
  const totalVoters = data.votes.length

  // ── History tab ───────────────────────────────────────────────────────────
  const [historyMonth, setHistoryMonth] = useState<string>(() => toLocalYearMonth())
  const [reviewTarget, setReviewTarget] = useState<{ menuId: string; date: string } | null>(null)
  const todayIso = toLocalISODate()
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

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

  const monthDeduction = historyRows.reduce((sum, row) => sum + Number(row.employee_deduction), 0)

  // ── Voting ────────────────────────────────────────────────────────────────
  // A vote must answer every required category — picking a soup without
  // picking what you eat it with is not a submittable vote. Categories the
  // admin marked optional can be left blank.
  const missingGroups = useMemo(
    () => (menu ? menu.groups.filter((g) => g.is_required && !draft[g.id]) : []),
    [menu, draft]
  )
  const missingGroup = missingGroups[0]
  const draftMatchesVote =
    myVote != null &&
    Object.keys(draft).length === Object.keys(myVote.selections).length &&
    Object.entries(draft).every(([groupId, optionId]) => myVote.selections[groupId] === optionId)

  async function castVote() {
    if (!menu || missingGroup) return
    setSubmitting(true)
    try {
      const res = await apiFetch("/api/hr/lunch/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuId: menu.id, selections: draft }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save your vote")

      setData((prev) => ({ ...prev, votes: (payload.votes || []) as LunchVoteRecord[] }))
      toast.success(myVote ? "Your lunch choice was updated." : "Your lunch choice is in.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save your vote")
    } finally {
      setSubmitting(false)
    }
  }

  async function withdrawVote() {
    if (!menu) return
    setSubmitting(true)
    try {
      const res = await apiFetch(`/api/hr/lunch/vote?menuId=${menu.id}`, { method: "DELETE" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to withdraw your vote")

      setData((prev) => ({ ...prev, votes: (payload.votes || []) as LunchVoteRecord[] }))
      setDraft({})
      toast.success("You're off the list for today.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to withdraw your vote")
    } finally {
      setSubmitting(false)
    }
  }

  // ── History table ─────────────────────────────────────────────────────────
  const historyColumns: DataTableColumn<HistoryRow>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      accessor: (row) => row.date,
      render: (row) => (
        <div>
          <span className="text-foreground font-semibold">
            {formatWATDate(row.date, { day: "numeric", month: "short" })}
          </span>
          <div className="text-muted-foreground text-xs">{formatWATDate(row.date, { weekday: "long" })}</div>
        </div>
      ),
    },
    {
      key: "weekday",
      label: "Day",
      accessor: (row) => WEEKDAYS[new Date(`${row.date}T12:00:00+01:00`).getDay()],
      hideOnMobile: true,
    },
    {
      key: "picks",
      label: "What You Picked",
      accessor: (row) => row.picks.join(" + "),
      render: (row) =>
        row.picks.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.picks.map((pick) => (
              <Badge key={pick} variant="outline" className="text-xs font-medium">
                {pick}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">Logged by admin</span>
        ),
    },
    {
      key: "cost",
      label: "Meal Cost",
      sortable: true,
      accessor: (row) => row.cost,
      render: (row) => <span className="text-muted-foreground font-mono text-xs">{naira(row.cost)}</span>,
      hideOnMobile: true,
    },
    {
      key: "company_subsidy",
      label: "Company Paid",
      accessor: (row) => row.company_subsidy,
      render: (row) => (
        <span className="font-mono text-xs font-medium text-emerald-600">{naira(row.company_subsidy)}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: "employee_deduction",
      label: "Your Deduction",
      sortable: true,
      accessor: (row) => row.employee_deduction,
      render: (row) => (
        <span className="font-mono text-xs font-bold text-red-600">{naira(row.employee_deduction)}</span>
      ),
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
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Your Choice Today"
            value={
              myVote && menu
                ? menu.groups
                    .map((g) => g.options.find((o) => o.id === myVote.selections[g.id])?.name)
                    .filter(Boolean)
                    .join(" + ") || "Voted"
                : "Not voted"
            }
            icon={Check}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Voted Today"
            value={totalVoters}
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
            title="Your Deduction / Meal"
            value={naira(data.pricing.employee_deduction)}
            icon={Wallet}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      {activeTab === "today" && (
        <div className="space-y-4">
          {!menu ? (
            <EmptyState
              icon={Utensils}
              title="No lunch menu today"
              description={`Nothing has been published for ${formatWATDate(data.date, { weekday: "long", day: "numeric", month: "long" })}. Lunch normally runs on ${data.eatingDays.join(", ")} — check back when Admin & HR puts the menu up.`}
            />
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Utensils className="text-primary h-4 w-4" />
                        {menuHeading(menu.date, data.date)}
                      </CardTitle>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {formatWATDate(menu.date, { weekday: "long", day: "numeric", month: "long" })}
                        {data.deadline && (
                          <>
                            {" · "}
                            {votingOpen
                              ? `Voting closes ${formatWATTime(data.deadline)}${timeLeft ? ` (${timeLeft})` : ""}`
                              : `Voting closed at ${formatWATTime(data.deadline)}`}
                          </>
                        )}
                      </p>
                    </div>
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
                </CardHeader>

                <CardContent className="space-y-5">
                  {menu.groups.map((group, index) => (
                    <div key={group.id} className="space-y-2">
                      {/* One list needs no heading — the dishes speak for
                          themselves. Headings appear only to tell several
                          lists apart (Soup vs Swallow). */}
                      {menu.groups.length > 1 && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-foreground text-sm font-semibold">{groupHeading(group, index)}</span>
                          <span className="text-muted-foreground text-[11px] tracking-wider uppercase">
                            Step {index + 1} of {menu.groups.length} · pick one
                          </span>
                          {!group.is_required && (
                            <span className="text-muted-foreground text-[11px] italic">
                              optional — you can skip this
                            </span>
                          )}
                          {draft[group.id] && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                        </div>
                      )}

                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.options.map((option) => {
                          const tally = tallies.find((t) => t.option_id === option.id)
                          const count = tally?.count || 0
                          const percent = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0
                          const selected = draft[group.id] === option.id
                          const disabled = !votingOpen || !option.is_available || submitting

                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => setDraft((prev) => ({ ...prev, [group.id]: option.id }))}
                              className={cn(
                                "rounded-lg border-2 p-3 text-left transition-colors",
                                selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                                disabled && "cursor-not-allowed opacity-60"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    {selected && <Check className="text-primary h-3.5 w-3.5 shrink-0" />}
                                    <span className="text-foreground truncate text-sm font-semibold">
                                      {option.name}
                                    </span>
                                  </div>
                                  {option.description && (
                                    <p className="text-muted-foreground mt-0.5 text-xs">{option.description}</p>
                                  )}
                                  {!option.is_available && (
                                    <p className="mt-0.5 text-xs font-medium text-red-500">Finished</p>
                                  )}
                                </div>
                                <span className="text-muted-foreground shrink-0 text-xs font-semibold">
                                  {count} {count === 1 ? "vote" : "votes"}
                                </span>
                              </div>
                              <Progress value={percent} className="mt-2 h-1.5" />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  {menu.groups.length > 1 && (
                    <div className="bg-muted/40 rounded-lg border p-3 text-xs">
                      Pick one from each —{" "}
                      <span className="font-semibold">
                        {menu.groups.map((g, i) => groupHeading(g, i)).join(" and ")}
                      </span>
                      . Your vote only counts once{" "}
                      {menu.groups
                        .map((g, i) => ({ label: groupHeading(g, i), required: g.is_required }))
                        .filter((g) => g.required)
                        .map((g) => g.label)
                        .join(" and ")}{" "}
                      are chosen.
                    </div>
                  )}

                  <div className="bg-muted/40 rounded-lg border p-3 text-xs">
                    Voting confirms your meal for the day —{" "}
                    <span className="font-semibold text-red-600">{naira(data.pricing.employee_deduction)}</span> will be
                    deducted from your salary and the company covers{" "}
                    <span className="font-semibold text-emerald-600">{naira(data.pricing.company_subsidy)}</span>. You
                    can change or withdraw your choice until the deadline.
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => void castVote()}
                      disabled={!votingOpen || !!missingGroup || submitting || draftMatchesVote}
                    >
                      {submitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      {myVote ? "Update my choice" : "Cast my vote"}
                    </Button>
                    {myVote && (
                      <Button
                        variant="outline"
                        onClick={() => void withdrawVote()}
                        disabled={!votingOpen || submitting}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        I&apos;m not eating
                      </Button>
                    )}
                    {missingGroups.length > 0 && votingOpen && (
                      <span className="text-muted-foreground text-xs">
                        Still to pick:{" "}
                        <span className="font-semibold">
                          {missingGroups.map((g) => groupHeading(g, menu.groups.indexOf(g))).join(", ")}
                        </span>
                      </span>
                    )}
                    {!votingOpen && (
                      <span className="text-muted-foreground text-xs">
                        Voting has closed for today. Speak to Admin &amp; HR if you need a change.
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <VoteResults menu={menu} votes={data.votes} currentUserId={currentUserId} />
            </>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
            <StatCard
              title="Meals This Period"
              value={historyRows.length}
              icon={Utensils}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              title="Total Deduction"
              value={naira(monthDeduction)}
              icon={Wallet}
              iconBgColor="bg-red-500/10"
              iconColor="text-red-500"
            />
            <StatCard
              title="Company Covered"
              value={naira(historyRows.reduce((sum, r) => sum + Number(r.company_subsidy), 0))}
              icon={CalendarDays}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
          </div>

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
            rowActions={[
              {
                label: "Review meal",
                onClick: (row) => setReviewTarget({ menuId: row.menu_id!, date: row.date }),
                // Only days that had a menu, and only once they are in the past.
                hidden: (row) => !row.menu_id || row.date >= todayIso,
              },
            ]}
          />
        </div>
      )}

      <LunchReviewDialog
        open={reviewTarget !== null}
        onOpenChange={(open) => !open && setReviewTarget(null)}
        menuId={reviewTarget?.menuId ?? null}
        date={reviewTarget?.date ?? null}
      />
    </DataTablePage>
  )
}

/**
 * WhatsApp-poll style results: every option with its share of the vote and the
 * colleagues behind it, plus the full list of who is eating what.
 */
function VoteResults({
  menu,
  votes,
  currentUserId,
}: {
  menu: LunchMenu
  votes: LunchVoteRecord[]
  currentUserId: string
}) {
  const tallies = useMemo(() => tallyVotes(menu.groups, votes), [menu, votes])
  const total = votes.length

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-blue-500" />
            Results
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            {total === 0 ? "Nobody has voted yet." : `${total} ${total === 1 ? "person has" : "people have"} voted`}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {menu.groups.map((group, index) => {
            const groupTallies = tallies
              .filter((t) => t.group_id === group.id)
              .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

            return (
              <div key={group.id} className="space-y-2">
                {menu.groups.length > 1 && (
                  <p className="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
                    {groupHeading(group, index)}
                  </p>
                )}
                {groupTallies.map((tally) => {
                  const percent = total > 0 ? Math.round((tally.count / total) * 100) : 0
                  return (
                    <div key={tally.option_id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-foreground truncate font-medium">{tally.name}</span>
                        <span className="text-muted-foreground shrink-0 font-semibold">
                          {tally.count} · {percent}%
                        </span>
                      </div>
                      <Progress value={percent} className="h-1.5" />
                      {tally.voters.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {tally.voters.map((voter) => (
                            <Badge
                              key={voter.user_id}
                              variant="outline"
                              className={cn(
                                "px-1.5 py-0 text-[10px] font-medium",
                                voter.user_id === currentUserId && "border-primary text-primary"
                              )}
                            >
                              {voter.user_id === currentUserId ? "You" : voter.full_name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Utensils className="h-4 w-4 text-emerald-500" />
            Who&apos;s Eating
          </CardTitle>
          <p className="text-muted-foreground text-xs">Everyone on today&apos;s list and what they chose</p>
        </CardHeader>
        <CardContent className="pt-0">
          {votes.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">No votes yet — be the first.</p>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {votes.map((vote) => {
                const picks = menu.groups
                  .map((g) => g.options.find((o) => o.id === vote.selections[g.id])?.name)
                  .filter(Boolean)
                  .join(" + ")

                return (
                  <div
                    key={vote.user_id}
                    className="hover:bg-muted/30 flex items-center justify-between gap-2 rounded px-1.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="bg-primary/10 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
                        {getInitials(undefined, vote.full_name.split(" ")[0], vote.full_name.split(" ")[1])}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">
                          {vote.user_id === currentUserId ? "You" : vote.full_name}
                        </div>
                        <div className="text-muted-foreground truncate text-[10px]">{vote.department || "General"}</div>
                      </div>
                    </div>
                    <span className="text-muted-foreground shrink-0 truncate text-xs">{picks || "—"}</span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
