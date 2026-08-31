import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getHolidaySet } from "@/lib/hr/leave-workflow"

const log = logger("hr-leave-calendar")
const BLACKOUT_MONTHS = [12, 1]
const LOOKAHEAD_DAYS = 548 // ~18 months

type PeerProfileRow = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
}

type HolidayRow = {
  holiday_date: string
  name?: string | null
}

type LeaveRangeRow = {
  user_id: string
  start_date: string
  end_date: string
  status: string
}

function toIsoLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`)
}

/**
 * Public holidays in the booking window, so the request dialog can grey them
 * out and explain why a Mon-Fri selection only costs four days. Named rows are
 * returned so the UI can say *which* holiday it was.
 */
async function loadHolidayWindow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  startIso: string,
  endIso: string
): Promise<{ date: string; name: string }[]> {
  const holidaySet = await getHolidaySet(supabase, null, startIso, endIso)
  if (holidaySet.size === 0) return []

  const { data } = await supabase
    .from("holiday_calendar")
    .select("holiday_date, name")
    .gte("holiday_date", startIso)
    .lte("holiday_date", endIso)

  const nameByDate = new Map((((data || []) as HolidayRow[]).map((row) => [row.holiday_date, row.name || "Public holiday"] as const)))

  return Array.from(holidaySet)
    .sort()
    .map((date) => ({ date, name: nameByDate.get(date) || "Public holiday" }))
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const today = new Date()
    const startIso = toIsoLocalDate(today)
    const endLimit = new Date(today)
    endLimit.setDate(endLimit.getDate() + LOOKAHEAD_DAYS)
    const endIso = toIsoLocalDate(endLimit)

    const holidays = await loadHolidayWindow(supabase, startIso, endIso)

    const { data: requesterProfile } = await supabase
      .from("profiles")
      .select("department_id")
      .eq("id", user.id)
      .maybeSingle<{ department_id?: string | null }>()

    const departmentId = requesterProfile?.department_id || null
    if (!departmentId) {
      return NextResponse.json({
        data: {
          blackout_months: BLACKOUT_MONTHS,
          department_booked_dates: [],
          holidays,
        },
      })
    }

    const { data: peers, error: peersError } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name")
      .eq("department_id", departmentId)
      .neq("id", user.id)

    if (peersError) {
      return NextResponse.json({ error: "Failed to load department peers" }, { status: 500 })
    }

    const peerRows = (peers || []) as PeerProfileRow[]
    const peerIds = peerRows.map((row) => row.id).filter(Boolean)
    if (peerIds.length === 0) {
      return NextResponse.json({
        data: {
          blackout_months: BLACKOUT_MONTHS,
          department_booked_dates: [],
          holidays,
        },
      })
    }

    const { data: leaveRows, error: leaveError } = await supabase
      .from("leave_requests")
      .select("user_id, start_date, end_date, status")
      .in("user_id", peerIds)
      .in("status", ["pending", "pending_evidence", "approved"])
      .gte("end_date", startIso)
      .lte("start_date", endIso)

    if (leaveError) {
      return NextResponse.json({ error: "Failed to load department leave calendar" }, { status: 500 })
    }

    const nameByUserId = new Map(
      peerRows.map((row) => {
        const label = row.full_name?.trim() || `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.id
        return [row.id, label] as const
      })
    )

    type BookedDetail = {
      approvedEmployees: Set<string>
      pendingEmployees: Set<string>
    }
    const bookedByDate = new Map<string, BookedDetail>()
    for (const row of (leaveRows || []) as LeaveRangeRow[]) {
      const fromDate = parseIsoDate(row.start_date)
      const toDate = parseIsoDate(row.end_date)
      const isApproved = row.status === "approved"
      for (let cursor = new Date(fromDate); cursor <= toDate; cursor.setDate(cursor.getDate() + 1)) {
        const iso = toIsoLocalDate(cursor)
        if (iso < startIso || iso > endIso) continue
        const current = bookedByDate.get(iso) || {
          approvedEmployees: new Set<string>(),
          pendingEmployees: new Set<string>(),
        }
        const name = nameByUserId.get(row.user_id) || row.user_id
        if (isApproved) {
          current.approvedEmployees.add(name)
        } else {
          current.pendingEmployees.add(name)
        }
        bookedByDate.set(iso, current)
      }
    }

    const departmentBookedDates = Array.from(bookedByDate.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([date, detail]) => {
        const approved = Array.from(detail.approvedEmployees).sort((a, b) => a.localeCompare(b))
        const pending = Array.from(detail.pendingEmployees).sort((a, b) => a.localeCompare(b))
        const allEmployees = Array.from(new Set([...approved, ...pending])).sort((a, b) => a.localeCompare(b))
        const status: "approved" | "pending" | "both" =
          approved.length > 0 && pending.length > 0 ? "both" : approved.length > 0 ? "approved" : "pending"

        return {
          date,
          status,
          count: allEmployees.length,
          employees: allEmployees,
          approved_employees: approved,
          pending_employees: pending,
        }
      })

    return NextResponse.json({
      data: {
        blackout_months: BLACKOUT_MONTHS,
        department_booked_dates: departmentBookedDates,
        holidays,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled leave calendar route error")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
