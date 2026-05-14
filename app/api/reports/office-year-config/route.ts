import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { getClientId, rateLimit } from "@/lib/rate-limit"

async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Ignore writes outside mutable response contexts.
        }
      },
    },
  })
}

export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("office_year_config")
    .select("year, anchor_day, is_locked")
    .order("year", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

const UpsertSchema = z.object({
  year: z.coerce.number().int().min(2025).max(2100),
  anchor_day: z.coerce.number().int().min(1).max(31),
})

export async function POST(request: Request) {
  const rl = await rateLimit(`reports-office-year-config:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const parsed = UpsertSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { year, anchor_day } = parsed.data

  // Check if this year is locked
  const { data: existing } = await supabase
    .from("office_year_config")
    .select("is_locked")
    .eq("year", year)
    .maybeSingle()

  if (existing?.is_locked) {
    return NextResponse.json({ error: `Year ${year} is locked and cannot be modified.` }, { status: 403 })
  }

  const { error } = await supabase
    .from("office_year_config")
    .upsert({ year, anchor_day, updated_at: new Date().toISOString() }, { onConflict: "year" })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: { year, anchor_day } })
}
