import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { monthBounds } from "@/lib/hr/attendance-utils"
import { repriceLeaveForHolidayChange } from "@/lib/hr/leave-holiday-recalc"

const HolidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  holiday_date_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  name: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
})

/** Returns every YYYY-MM-DD from start to end inclusive (capped to guard against huge ranges). */
function expandDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  let guard = 0
  while (cursor.getTime() <= last.getTime() && guard < 366) {
    const year = cursor.getUTCFullYear()
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0")
    const day = String(cursor.getUTCDate()).padStart(2, "0")
    dates.push(`${year}-${month}-${day}`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    guard++
  }
  return dates
}

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-holidays:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return { error: NextResponse.json({ error: "Too many requests" }, { status: 429 }) }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
  const role = String(profile?.role || "")
  if (!["developer", "admin", "super_admin"].includes(role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { supabase, userId: user.id }
}

export async function GET(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const month = String(request.nextUrl.searchParams.get("month") || "")
  const location = String(request.nextUrl.searchParams.get("location") || "all").trim() || "all"
  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  let query = dataClient.from("holiday_calendar").select("*").order("holiday_date", { ascending: true })
  query = query.eq("location", location)
  if (/^\d{4}-\d{2}$/.test(month)) {
    const { start, end } = monthBounds(month)
    query = query.gte("holiday_date", start).lte("holiday_date", end)
  }
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data || [] })
}

export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const parsed = HolidaySchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const startDate = parsed.data.holiday_date
  const endDate = parsed.data.holiday_date_end
  const location = (parsed.data.location || "all").trim() || "all"
  const name = (parsed.data.name || "Holiday").trim() || "Holiday"

  if (endDate && endDate < startDate) {
    return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 })
  }

  const dates = endDate ? expandDateRange(startDate, endDate) : [startDate]
  const rows = dates.map((holiday_date) => ({ holiday_date, location, name, created_by: auth.userId }))

  // Ignore days already marked as holidays so re-adding an overlapping range is safe.
  let { error: insertError } = await dataClient
    .from("holiday_calendar")
    .upsert(rows, { onConflict: "holiday_date,location", ignoreDuplicates: true })
  // Back-compat for environments missing the created_by column.
  if (insertError && insertError.code === "42703") {
    const fallbackRows = dates.map((holiday_date) => ({ holiday_date, location, name }))
    insertError = (
      await dataClient
        .from("holiday_calendar")
        .upsert(fallbackRows, { onConflict: "holiday_date,location", ignoreDuplicates: true })
    ).error
  }
  if (insertError) return NextResponse.json({ error: insertError.message || "Failed to add holiday" }, { status: 500 })

  // Leave booked before this holiday existed was priced without it. Hand the
  // day back on any request that has not started yet.
  const reprice = await repriceLeaveForHolidayChange(dataClient, {
    fromDate: startDate,
    toDate: endDate || startDate,
    actorId: auth.userId,
    reason: `Holiday added: ${name}`,
  })

  const baseMessage = dates.length > 1 ? `${dates.length} holidays added` : "Holiday added"
  const repriceMessage = reprice.updated.length
    ? ` ${reprice.updated.length} upcoming leave request(s) recalculated.`
    : ""
  const reviewMessage = reprice.needsReview.length
    ? ` ${reprice.needsReview.length} request(s) now fall entirely on holidays and need manual review.`
    : ""

  return NextResponse.json({
    message: `${baseMessage}.${repriceMessage}${reviewMessage}`.trim(),
    leave_recalculated: reprice.updated,
    leave_needs_review: reprice.needsReview,
  })
}

export async function DELETE(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const holidayDate = String(request.nextUrl.searchParams.get("holiday_date") || "")
  const location = String(request.nextUrl.searchParams.get("location") || "all").trim() || "all"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate)) {
    return NextResponse.json({ error: "holiday_date is required" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { error } = await dataClient
    .from("holiday_calendar")
    .delete()
    .eq("holiday_date", holidayDate)
    .eq("location", location)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Removing a holiday puts the day back on the clock for future leave.
  const reprice = await repriceLeaveForHolidayChange(dataClient, {
    fromDate: holidayDate,
    toDate: holidayDate,
    actorId: auth.userId,
    reason: "Holiday removed",
  })

  return NextResponse.json({
    message: reprice.updated.length
      ? `Holiday removed. ${reprice.updated.length} upcoming leave request(s) recalculated.`
      : "Holiday removed",
    leave_recalculated: reprice.updated,
  })
}
