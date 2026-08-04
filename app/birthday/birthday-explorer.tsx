"use client"

/* eslint-disable @next/next/no-img-element -- signed URLs / static asset, not optimizable by next/image */

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Loader2, Sparkles, Stars } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiFetch } from "@/lib/api-client"
import { toLocalISODate } from "@/lib/utils/date"
import { getCurrentOfficeWeek, getOfficeWeekMonday } from "@/lib/meeting-week"

type Mode = "day" | "week" | "month" | "range"

interface Celebrant {
  firstName: string
  lastName: string
  department: string
  birthday: string
  avatarUrl: string | null
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const WEEK_OPTIONS = Array.from({ length: 53 }, (_, i) => i + 1)

function toMMDD(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatMMDDLabel(mmdd: string): string {
  const [month, day] = mmdd.split("-").map(Number)
  return `${MONTHS[month - 1]?.slice(0, 3) ?? "?"} ${day}`
}

function displayName(firstName: string): string {
  const lower = firstName.trim().toLowerCase()
  return lower === "eliah" ? "Elijah" : firstName
}

/** Roughly-square column count so N cards form a balanced grid instead of one stretched row. */
function columnsForCount(count: number): number {
  if (count <= 1) return 1
  return Math.min(4, Math.ceil(Math.sqrt(count)))
}

export function BirthdayExplorer() {
  const today = toLocalISODate()
  const currentOfficeWeek = getCurrentOfficeWeek()

  const [mode, setMode] = useState<Mode>("week")
  const [dayValue, setDayValue] = useState(today)
  const [weekNumber, setWeekNumber] = useState(currentOfficeWeek.week)
  const [weekYear, setWeekYear] = useState(currentOfficeWeek.year)
  const [monthValue, setMonthValue] = useState(String(new Date().getMonth() + 1))
  const [rangeStart, setRangeStart] = useState(today)
  const [rangeEnd, setRangeEnd] = useState(today)

  const [celebrants, setCelebrants] = useState<Celebrant[]>([])
  const [rangeLabel, setRangeLabel] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isGenerated, setIsGenerated] = useState(false)

  const yearOptions = useMemo(
    () => [currentOfficeWeek.year - 1, currentOfficeWeek.year, currentOfficeWeek.year + 1],
    [currentOfficeWeek.year]
  )

  function computeRange(): { start: string; end: string; label: string } {
    if (mode === "day") {
      const d = new Date(`${dayValue}T00:00:00`)
      const mmdd = toMMDD(d)
      return { start: mmdd, end: mmdd, label: formatMMDDLabel(mmdd) }
    }
    if (mode === "week") {
      // Uses the same office-week numbering as /admin/reports/general-meeting
      const monday = getOfficeWeekMonday(weekNumber, weekYear)
      const sunday = addDays(monday, 6)
      return {
        start: toMMDD(monday),
        end: toMMDD(sunday),
        label: `Week ${weekNumber} · ${formatMMDDLabel(toMMDD(monday))} – ${formatMMDDLabel(toMMDD(sunday))}`,
      }
    }
    if (mode === "month") {
      const m = Number(monthValue)
      const lastDay = new Date(2001, m, 0).getDate()
      const start = `${String(m).padStart(2, "0")}-01`
      const end = `${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
      return { start, end, label: `${formatMMDDLabel(start)} – ${formatMMDDLabel(end)}` }
    }
    // custom range
    const start = toMMDD(new Date(`${rangeStart}T00:00:00`))
    const end = toMMDD(new Date(`${rangeEnd}T00:00:00`))
    return { start, end, label: `${formatMMDDLabel(start)} – ${formatMMDDLabel(end)}` }
  }

  async function generate() {
    const { start, end, label } = computeRange()
    setIsLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/admin/hr/birthdays?start=${start}&end=${end}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || "Failed to load birthdays")
      setCelebrants(payload?.data || [])
      setRangeLabel(label)
      setIsGenerated(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load birthdays")
      setCelebrants([])
    } finally {
      setIsLoading(false)
    }
  }

  const formatNamesList = (names: string[]) => {
    if (names.length === 0) return ""
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} & ${names[1]}`
    return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`
  }

  const celebrantsTitle = formatNamesList(celebrants.map((c) => displayName(c.firstName)))
  const gridColumns = columnsForCount(celebrants.length)

  if (!isGenerated) {
    return (
      <div className="birthday-setup-container">
        <div className="birthday-logo-container flex justify-center">
          <img
            src="/images/acob-logo-dark.webp"
            alt="ACOB Lighting Logo"
            className="birthday-logo"
            style={{ height: "48px", width: "auto", marginBottom: "1rem" }}
          />
        </div>

        <div className="birthday-setup-stack mx-auto mb-2 max-w-md text-center">
          <h2 className="text-xl font-bold tracking-tight">Birthday Spotlight Generator</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Choose a date range to generate birthday spotlights for our colleagues.
          </p>
        </div>

        <div className="birthday-picker mx-auto w-full max-w-md">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-4">
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="range">Range</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="birthday-picker__controls mt-4">
            {mode === "day" && (
              <Input type="date" value={dayValue} onChange={(e) => setDayValue(e.target.value)} className="w-full" />
            )}
            {mode === "week" && (
              <div className="flex w-full gap-2">
                <Select value={String(weekNumber)} onValueChange={(v) => setWeekNumber(Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEK_OPTIONS.map((week) => (
                      <SelectItem key={week} value={String(week)}>
                        Week {week}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(weekYear)} onValueChange={(v) => setWeekYear(Number(v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {mode === "month" && (
              <Select value={monthValue} onValueChange={setMonthValue}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((name, i) => (
                    <SelectItem key={name} value={String(i + 1)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {mode === "range" && (
              <div className="flex w-full items-center gap-2">
                <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
                <span className="text-muted-foreground text-xs">to</span>
                <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
              </div>
            )}

            <Button onClick={generate} disabled={isLoading} className="mt-2 w-full gap-1.5">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate
            </Button>
          </div>
        </div>
        {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
      </div>
    )
  }

  return (
    <>
      <div className="birthday-hero__copy">
        <div className="birthday-logo-container">
          <img
            src="/images/acob-logo-dark.webp"
            alt="ACOB Lighting Logo"
            className="birthday-logo"
            style={{ height: "38px", width: "auto", marginBottom: "0.5rem" }}
          />
        </div>
        <div className="birthday-kicker">
          <Sparkles className="h-4 w-4" />
          Birthday Spotlight
        </div>

        <div className="birthday-copy-stack">
          <p className="birthday-overline">Celebrating our colleagues&apos; birthdays</p>
          <h1 className="birthday-title">{celebrantsTitle || "Choose a range"}</h1>
          <p className="birthday-subtitle">
            ACOB Family celebrates all of you and appreciates your contributions to the growth of the organisation.
          </p>
        </div>

        <div className="birthday-meta-grid">
          <div className="birthday-meta-card">
            <span className="birthday-meta-label">Selected Range</span>
            <strong className="birthday-week-range">
              <span>{rangeLabel || "—"}</span>
            </strong>
          </div>
          <div className="birthday-meta-card">
            <span className="birthday-meta-label">Message</span>
            <strong>Wishing you joy, grace, peace, and a beautiful year ahead</strong>
          </div>
        </div>
      </div>

      <div className="birthday-hero__visual">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : celebrants.length > 0 ? (
          <div className="birthday-grid" style={{ "--birthday-cols": gridColumns } as React.CSSProperties}>
            {celebrants.map((celebrant, index) => (
              <article key={`${celebrant.firstName}-${index}`} className="birthday-card-item">
                <div className="birthday-card-photo-wrapper">
                  {celebrant.avatarUrl ? (
                    <img
                      src={celebrant.avatarUrl}
                      alt={displayName(celebrant.firstName)}
                      className="birthday-photo"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                    />
                  ) : (
                    <div className="birthday-photo-placeholder">
                      <span>{displayName(celebrant.firstName).charAt(0)}</span>
                    </div>
                  )}
                  <div className="birthday-photo__veil" aria-hidden="true" />
                </div>
                <div className="birthday-photo__content">
                  <div className="birthday-photo__badge">
                    <Stars className="h-3.5 w-3.5" />
                    {celebrant.birthday.split("-").reverse().join("/")}
                  </div>
                  <div className="birthday-card-details">
                    <h3 className="birthday-card-name">{displayName(celebrant.firstName)}</h3>
                    <p className="birthday-card-dept">{celebrant.department}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">{isLoading ? "Loading…" : "No birthdays in this period"}</p>
        )}
      </div>

      <div className="fixed bottom-6 left-6 z-50">
        <Button
          onClick={() => setIsGenerated(false)}
          variant="outline"
          size="sm"
          className="bg-card/80 border-border hover:bg-accent h-8 gap-1.5 rounded-full border px-3.5 text-xs font-medium shadow-lg backdrop-blur-md"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back</span>
        </Button>
      </div>
    </>
  )
}
