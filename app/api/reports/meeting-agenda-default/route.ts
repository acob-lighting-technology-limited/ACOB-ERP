import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { DEFAULT_AGENDA } from "@/app/admin/communications/_components/composer-utils"

const SETTING_KEY = "meeting_reminder_default_agenda"

type SupabaseError = { message: string }
type SystemSettingRow = {
  value: unknown
}
type ReminderScheduleRow = {
  id: string
  meeting_config: unknown
}
type PersistenceClient = {
  from: {
    (table: "system_settings"): {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string
        ) => {
          maybeSingle: () => Promise<{ data: SystemSettingRow | null; error: SupabaseError | null }>
        }
      }
      upsert: (
        payload: {
          key: string
          value: { agenda: string[] }
          description: string
          updated_by: string
        },
        options: { onConflict: string }
      ) => Promise<{ error: SupabaseError | null }>
    }
    (table: "reminder_schedules"): {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string | boolean
        ) => {
          eq: (
            column: string,
            value: string | boolean
          ) => Promise<{
            data: ReminderScheduleRow[] | null
            error: SupabaseError | null
          }>
        }
      }
      update: (payload: { meeting_config: Record<string, unknown>; updated_at: string }) => {
        eq: (column: string, value: string) => Promise<{ error: SupabaseError | null }>
      }
    }
  }
}

const SaveAgendaSchema = z.object({
  agenda: z.array(z.string().trim().min(1)).min(1, "Agenda is required"),
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

function parseAgendaSetting(value: unknown): string[] {
  if (!value || typeof value !== "object") return DEFAULT_AGENDA
  const agenda = (value as { agenda?: unknown }).agenda
  if (!Array.isArray(agenda)) return DEFAULT_AGENDA

  const normalized = agenda.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
  return normalized.length > 0 ? normalized : DEFAULT_AGENDA
}

function asConfigObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function updateActiveMeetingSchedules(client: PersistenceClient, agenda: string[]) {
  const { data, error } = await client
    .from("reminder_schedules")
    .select("id, meeting_config")
    .eq("is_active", true)
    .eq("reminder_type", "meeting")

  if (error) throw new Error(error.message)

  await Promise.all(
    (data || []).map(async (schedule) => {
      const meetingConfig = {
        ...asConfigObject(schedule.meeting_config),
        agenda,
      }
      const { error: updateError } = await client
        .from("reminder_schedules")
        .update({ meeting_config: meetingConfig, updated_at: new Date().toISOString() })
        .eq("id", schedule.id)

      if (updateError) throw new Error(updateError.message)
    })
  )
}

export async function GET() {
  const supabase = await createClient()
  const persistenceClient = supabase as unknown as PersistenceClient
  const { data, error } = await persistenceClient
    .from("system_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: { agenda: parseAgendaSetting(data?.value) } })
}

export async function POST(request: Request) {
  const rl = await rateLimit(`reports-meeting-agenda-default:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = SaveAgendaSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
  }

  const persistenceClient = supabase as unknown as PersistenceClient
  const { error } = await persistenceClient.from("system_settings").upsert(
    {
      key: SETTING_KEY,
      value: { agenda: parsed.data.agenda },
      description: "Default agenda used by admin meeting reminders.",
      updated_by: user.id,
    },
    { onConflict: "key" }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await updateActiveMeetingSchedules(persistenceClient, parsed.data.agenda)

  return NextResponse.json({ data: { agenda: parsed.data.agenda } })
}
