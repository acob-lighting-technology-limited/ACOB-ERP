import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const HolidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
})

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
  return { supabase }
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
    query = query.gte("holiday_date", `${month}-01`).lte("holiday_date", `${month}-31`)
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
  const holiday_date = parsed.data.holiday_date
  const location = (parsed.data.location || "all").trim() || "all"
  const name = (parsed.data.name || "Holiday").trim() || "Holiday"

  const { error: insertError } = await dataClient.from("holiday_calendar").insert({ holiday_date, location, name })
  if (insertError) return NextResponse.json({ error: insertError.message || "Failed to add holiday" }, { status: 500 })

  return NextResponse.json({ message: "Holiday added" })
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
  return NextResponse.json({ message: "Holiday removed" })
}
