import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveAdminScope, getDepartmentScope, normalizeDepartmentName } from "@/lib/admin/rbac"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { resolveEffectiveMeetingDateIso } from "@/lib/reports/meeting-date"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getPaginationRange, paginatedResponse, PaginationSchema } from "@/lib/pagination"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("api-reports-kss-roster")

type ReportsClient = Awaited<ReturnType<typeof createClient>>

const CreateKssRosterSchema = z.object({
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
  department: z.string().trim().min(1, "department is required"),
  presenterId: z.string().optional().nullable(),
  presenterName: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const UpdateKssRosterSchema = z.object({
  id: z.string().trim().min(1, "id is required"),
  department: z.string().trim().optional(),
  presenterId: z.string().optional().nullable(),
  presenterName: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
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
          // Ignore write attempts from server component contexts.
        }
      },
    },
  })
}

function normalizeDepartment(value: string): string {
  return normalizeDepartmentName(String(value || "").trim())
}

function hasGlobalReportsWriteAccess(scope: NonNullable<Awaited<ReturnType<typeof resolveAdminScope>>>): boolean {
  return getDepartmentScope(scope, "general") === null
}

function resolvePresenterInput(input: { presenterId?: string | null; presenterName?: string | null }): {
  presenterId: string | null
  presenterName: string | null
} {
  const presenterId = input.presenterId ? String(input.presenterId).trim() : null
  const presenterName = input.presenterName ? String(input.presenterName).trim() : null

  if (!presenterId && !presenterName) {
    throw new Error("Please select an employee presenter or enter a visitor name")
  }

  if (presenterId) {
    return {
      presenterId,
      presenterName: null,
    }
  }

  return {
    presenterId: null,
    presenterName,
  }
}

async function assertWeekIsMutable(supabase: ReportsClient, meetingWeek: number, meetingYear: number) {
  const { data, error } = await supabase.rpc("weekly_report_can_mutate", {
    p_week: meetingWeek,
    p_year: meetingYear,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error(`Week ${meetingWeek}, ${meetingYear} is locked and can no longer be changed`)
  }
}

async function assertWeekAllowsRosterCreate(supabase: ReportsClient, meetingWeek: number, meetingYear: number) {
  const { data, error } = await supabase.rpc("weekly_report_can_mutate", {
    p_week: meetingWeek,
    p_year: meetingYear,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (data) return

  const { data: existingRow, error: existingError } = await supabase
    .from("kss_weekly_roster")
    .select("id")
    .eq("meeting_week", meetingWeek)
    .eq("meeting_year", meetingYear)
    .maybeSingle()

  if (existingError) {
    throw new Error(existingError.message)
  }

  if (existingRow) {
    throw new Error(`Week ${meetingWeek}, ${meetingYear} is locked and can no longer be changed`)
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase as ReportsClient, user.id)
    if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const dataClient = getServiceRoleClientOrFallback(supabase as ReportsClient)

    const { searchParams } = new URL(request.url)
    const paginationParsed = PaginationSchema.safeParse(Object.fromEntries(searchParams))
    if (!paginationParsed.success) {
      return NextResponse.json(
        { error: paginationParsed.error.issues[0]?.message ?? "Invalid pagination params" },
        { status: 400 }
      )
    }
    const pagination = paginationParsed.data
    const { from, to } = getPaginationRange(pagination)
    const week = Number(searchParams.get("week") || "")
    const year = Number(searchParams.get("year") || "")

    let query = dataClient
      .from("kss_weekly_roster")
      .select(
        "id, meeting_week, meeting_year, department, presenter_id, presenter_name, notes, is_active, created_by, created_at, updated_at",
        { count: "exact" }
      )
      .order("meeting_year", { ascending: false })
      .order("meeting_week", { ascending: false })

    if (Number.isFinite(week) && week > 0) query = query.eq("meeting_week", week)
    if (Number.isFinite(year) && year > 0) query = query.eq("meeting_year", year)

    const { data, error, count } = await query.range(from, to)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = data || []
    const now = new Date()
    const withLockState = await Promise.all(
      rows.map(async (row) => {
        const meetingDate = await resolveEffectiveMeetingDateIso(
          dataClient as ReportsClient,
          row.meeting_week,
          row.meeting_year
        )
        const { data: canMutate } = await supabase.rpc("weekly_report_can_mutate", {
          p_week: row.meeting_week,
          p_year: row.meeting_year,
        })
        const { data: lockState } = await supabase.rpc("weekly_report_lock_state", {
          p_week: row.meeting_week,
          p_year: row.meeting_year,
        })
        const lockRow = Array.isArray(lockState) && lockState[0] ? lockState[0] : null
        const lockDeadline = typeof lockRow?.lock_deadline === "string" ? lockRow.lock_deadline : null
        const isOutsideGraceWindow = lockDeadline ? now >= new Date(lockDeadline) : false

        return {
          ...row,
          meeting_date: meetingDate,
          is_locked: !Boolean(canMutate),
          is_outside_grace_window: isOutsideGraceWindow,
        }
      })
    )

    return NextResponse.json(paginatedResponse(withLockState, count || 0, pagination))
  } catch (error) {
    log.error({ err: String(error) }, "GET /api/reports/kss-roster failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const rl = await rateLimit(`reports-kss-roster:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can create KSS roster entries" }, { status: 403 })
    }
    const dataClient = getServiceRoleClientOrFallback(supabase as ReportsClient)

    const body = await request.json()
    const parsed = CreateKssRosterSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const meetingWeek = parsed.data.meetingWeek
    const meetingYear = parsed.data.meetingYear
    const department = normalizeDepartment(parsed.data.department)
    const presenter = resolvePresenterInput({
      presenterId: parsed.data.presenterId,
      presenterName: parsed.data.presenterName,
    })
    const notes = parsed.data.notes ? String(parsed.data.notes) : null

    await assertWeekAllowsRosterCreate(supabase as ReportsClient, meetingWeek, meetingYear)

    const { data: saved, error } = await dataClient
      .from("kss_weekly_roster")
      .insert({
        meeting_week: meetingWeek,
        meeting_year: meetingYear,
        department,
        presenter_id: presenter.presenterId,
        presenter_name: presenter.presenterName,
        notes,
        is_active: true,
        created_by: user.id,
      })
      .select(
        "id, meeting_week, meeting_year, department, presenter_id, presenter_name, notes, is_active, created_by, created_at, updated_at"
      )
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase as ReportsClient,
      {
        action: "update",
        entityType: "communications_mail",
        entityId: saved.id,
        metadata: {
          event: "kss_roster_created",
          meeting_week: meetingWeek,
          meeting_year: meetingYear,
          department,
          presenter_id: presenter.presenterId,
          presenter_name: presenter.presenterName,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/reports/kss-roster",
          department,
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: saved }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    log.error({ err: String(error) }, "POST /api/reports/kss-roster failed")
    if (message.includes("Please select an employee presenter or enter a visitor name")) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    if (message.includes("locked and can no longer be changed")) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const rl = await rateLimit(`reports-kss-roster:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can update KSS roster entries" }, { status: 403 })
    }
    const dataClient = getServiceRoleClientOrFallback(supabase as ReportsClient)

    const body = await request.json()
    const parsed = UpdateKssRosterSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const id = parsed.data.id

    const { data: existing, error: fetchError } = await dataClient
      .from("kss_weekly_roster")
      .select("id, department, presenter_id, presenter_name, meeting_week, meeting_year")
      .eq("id", id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Roster entry not found" }, { status: 404 })
    }

    await assertWeekIsMutable(supabase as ReportsClient, existing.meeting_week, existing.meeting_year)

    const patch: Record<string, unknown> = {}
    if (typeof parsed.data.department === "string" && parsed.data.department.trim()) {
      patch.department = normalizeDepartment(parsed.data.department)
    }
    if (parsed.data.presenterId !== undefined || parsed.data.presenterName !== undefined) {
      const presenter = resolvePresenterInput({
        presenterId: parsed.data.presenterId ?? existing.presenter_id,
        presenterName: parsed.data.presenterName ?? existing.presenter_name,
      })
      patch.presenter_id = presenter.presenterId
      patch.presenter_name = presenter.presenterName
    }
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes ? String(parsed.data.notes) : null
    if (parsed.data.isActive !== undefined) patch.is_active = Boolean(parsed.data.isActive)

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No patch fields provided" }, { status: 400 })
    }

    const { data: updated, error } = await dataClient
      .from("kss_weekly_roster")
      .update(patch)
      .eq("id", id)
      .select(
        "id, meeting_week, meeting_year, department, presenter_id, presenter_name, notes, is_active, created_by, created_at, updated_at"
      )
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase as ReportsClient,
      {
        action: "update",
        entityType: "communications_mail",
        entityId: updated.id,
        metadata: {
          event: "kss_roster_updated",
          patch,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/reports/kss-roster",
          department: updated.department,
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ data: updated })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    log.error({ err: String(error) }, "PATCH /api/reports/kss-roster failed")
    if (message.includes("Please select an employee presenter or enter a visitor name")) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const rl = await rateLimit(`reports-kss-roster:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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
    if (!hasGlobalReportsWriteAccess(scope)) {
      return NextResponse.json({ error: "Only reports admins can delete KSS roster entries" }, { status: 403 })
    }
    const dataClient = getServiceRoleClientOrFallback(supabase as ReportsClient)

    const { searchParams } = new URL(request.url)
    const id = String(searchParams.get("id") || "")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const { data: existing, error: fetchError } = await dataClient
      .from("kss_weekly_roster")
      .select("id, department, meeting_week, meeting_year")
      .eq("id", id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Roster entry not found" }, { status: 404 })
    }

    await assertWeekIsMutable(supabase as ReportsClient, existing.meeting_week, existing.meeting_year)
    const { error } = await dataClient.from("kss_weekly_roster").delete().eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog(
      supabase as ReportsClient,
      {
        action: "delete",
        entityType: "communications_mail",
        entityId: id,
        metadata: {
          event: "kss_roster_deleted",
          department: existing.department,
        },
        context: {
          actorId: user.id,
          source: "api",
          route: "/api/reports/kss-roster",
          department: existing.department,
        },
      },
      { failOpen: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    log.error({ err: String(error) }, "DELETE /api/reports/kss-roster failed")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
