import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { resolveCanonicalMeetingSetup, upsertCanonicalMeetingDate } from "@/lib/reports/meeting-date"
import { getClientId, rateLimit } from "@/lib/rate-limit"

type ReportsClient = Awaited<ReturnType<typeof createClient>>

const SaveMeetingDateSchema = z.object({
  meetingWeek: z.coerce
    .number()
    .int()
    .min(1, "meetingWeek must be between 1 and 53")
    .max(53, "meetingWeek must be between 1 and 53"),
  meetingYear: z.coerce
    .number()
    .int()
    .min(2000, "meetingYear must be between 2000 and 2100")
    .max(2100, "meetingYear must be between 2000 and 2100"),
  meetingDate: z.string().trim().min(1, "meetingDate is required"),
  meetingTime: z.string().optional().nullable(),
})

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

function parseWeekYear(searchParams: URLSearchParams) {
  const meetingWeek = Number(searchParams.get("week") || "")
  const meetingYear = Number(searchParams.get("year") || "")

  if (!Number.isFinite(meetingWeek) || meetingWeek < 1 || meetingWeek > 53) {
    throw new Error("week must be between 1 and 53")
  }

  if (!Number.isFinite(meetingYear) || meetingYear < 2000 || meetingYear > 2100) {
    throw new Error("year must be between 2000 and 2100")
  }

  return { meetingWeek, meetingYear }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const { meetingWeek, meetingYear } = parseWeekYear(searchParams)
    const setup = await resolveCanonicalMeetingSetup(supabase, meetingWeek, meetingYear)

    return NextResponse.json({
      data: {
        meetingWeek,
        meetingYear,
        meetingDate: setup.meetingDate,
        meetingTime: setup.meetingTime,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve meeting date" },
      { status: 400 }
    )
  }
}

export async function POST(request: Request) {
  const rl = await rateLimit(`reports-meeting-date:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase as ReportsClient, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json()
    const parsed = SaveMeetingDateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const { meetingWeek, meetingYear, meetingDate, meetingTime } = parsed.data

    const saved = await upsertCanonicalMeetingDate(supabase, {
      meetingWeek,
      meetingYear,
      meetingDate,
      meetingTime,
      actorId: user.id,
    })

    return NextResponse.json({
      data: {
        meetingWeek,
        meetingYear,
        meetingDate: saved.meetingDate,
        meetingTime: saved.meetingTime,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save meeting date" },
      { status: 400 }
    )
  }
}
