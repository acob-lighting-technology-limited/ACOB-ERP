import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const ClosureSchema = z.object({
  closure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closure_date_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  close_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:MM"),
  name: z.string().trim().max(120).optional(),
})

/** Every YYYY-MM-DD from start to end inclusive, capped to guard against huge ranges. */
function expandDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  let guard = 0
  while (cursor.getTime() <= last.getTime() && guard < 366) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    guard++
  }
  return dates
}

async function ensureAdmin(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-early-closures:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { data, error } = await dataClient
    .from("attendance_early_closures")
    .select("closure_date, close_time, name")
    .order("closure_date", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data || [] })
}

export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const parsed = ClosureSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const startDate = parsed.data.closure_date
  const endDate = parsed.data.closure_date_end
  if (endDate && endDate < startDate) {
    return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 })
  }

  const closeTime = `${parsed.data.close_time}:00`
  const name = (parsed.data.name || "Early closure").trim() || "Early closure"
  const dates = endDate ? expandDateRange(startDate, endDate) : [startDate]
  const rows = dates.map((closure_date) => ({ closure_date, close_time: closeTime, name, created_by: auth.userId }))

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { error } = await dataClient.from("attendance_early_closures").upsert(rows, { onConflict: "closure_date" })
  if (error) return NextResponse.json({ error: error.message || "Failed to add early closure" }, { status: 500 })

  return NextResponse.json({
    message: dates.length > 1 ? `${dates.length} early-closure days added` : "Early closure added",
  })
}

export async function DELETE(request: NextRequest) {
  const auth = await ensureAdmin(request)
  if ("error" in auth) return auth.error

  const closureDate = String(request.nextUrl.searchParams.get("closure_date") || "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closureDate)) {
    return NextResponse.json({ error: "closure_date is required" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(auth.supabase)
  const { error } = await dataClient.from("attendance_early_closures").delete().eq("closure_date", closureDate)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: "Early closure removed" })
}
