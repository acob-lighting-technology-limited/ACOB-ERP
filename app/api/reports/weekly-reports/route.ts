import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { normalizeDepartmentName } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { canMutateV2, type AccessContextV2 } from "@/lib/admin/policy-v2"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("api-reports-weekly-reports")

type ReportsClient = Awaited<ReturnType<typeof createClient>>

type WeeklyReportPayload = {
  id?: string
  user_id?: string
  department?: string
  week_number?: number
  year?: number
  work_done?: string
  tasks_new_week?: string
  challenges?: string
  status?: string
}

type ActionItemSyncRow = {
  id: string
  status: string | null
}

const SaveWeeklyReportSchema = z.object({
  id: z.string().optional(),
  department: z.string().trim().min(1, "Required: Department and Work Done"),
  week_number: z.coerce.number().int().min(1, "Week must be between 1 and 53").max(53, "Week must be between 1 and 53"),
  year: z.coerce
    .number()
    .int()
    .min(2000, "Year must be between 2000 and 2100")
    .max(2100, "Year must be between 2000 and 2100"),
  work_done: z.string().trim().min(1, "Required: Department and Work Done"),
  tasks_new_week: z.string().optional().default(""),
  challenges: z.string().optional().default(""),
  status: z.string().trim().optional().default("submitted"),
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

async function canMutateWeek(supabase: ReportsClient, week: number, year: number) {
  const { data, error } = await supabase.rpc("weekly_report_can_mutate", {
    p_week: week,
    p_year: year,
  })

  if (error) throw new Error(error.message)
  return Boolean(data)
}

function parseTasksNewWeekLines(tasksNewWeek: string): string[] {
  return tasksNewWeek
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]\s*|[-*]\s*)/, "").trim())
    .filter(Boolean)
}

export async function PATCH(request: Request) {
  const rl = await rateLimit(`reports-weekly-reports:${getClientId(request)}`, { limit: 20, windowSec: 60 })
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

    // Department leads and admins get full RBAC-scoped access. Plain employees
    // (not leads, not admin-like) aren't covered by the admin-scope machinery
    // at all, but they may still submit their own department's weekly report —
    // resolve that narrowly here rather than widening the shared admin scope.
    const contextResult = await requireAccessContextV2()
    let accessContext: AccessContextV2 | null = null
    let employeeOwnDepartment: string | null = null

    if (contextResult.ok) {
      const routeAccess = enforceRouteAccessV2(contextResult.context, "reports.weekly")
      if (!routeAccess.ok) {
        return routeAccess.response
      }
      accessContext = contextResult.context
    } else {
      const { data: profile } = await supabase.from("profiles").select("department").eq("id", user.id).maybeSingle()
      employeeOwnDepartment = profile?.department ? normalizeDepartmentName(profile.department) : null
      if (!employeeOwnDepartment) {
        return contextResult.response
      }
    }

    const dataClient = getServiceRoleClientOrFallback(supabase as ReportsClient)
    const body = (await request.json()) as WeeklyReportPayload
    const parsed = SaveWeeklyReportSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    log.info({ body }, "Weekly report save request received")

    const department = parsed.data.department.trim()
    const normalizedDepartment = normalizeDepartmentName(department)
    const weekNumber = parsed.data.week_number
    const yearNumber = parsed.data.year
    const workDone = parsed.data.work_done
    const tasksNewWeek = parsed.data.tasks_new_week.trim()
    const challenges = parsed.data.challenges.trim()
    const status = parsed.data.status || "submitted"
    const reportId = String(parsed.data.id || "").trim()

    const canWriteDepartment = accessContext
      ? canMutateV2(accessContext, "reports.weekly", normalizedDepartment)
      : normalizedDepartment === employeeOwnDepartment
    if (!canWriteDepartment) {
      log.warn(
        {
          department,
          normalizedDepartment,
          managedDepartments:
            accessContext?.managedDepartments ?? (employeeOwnDepartment ? [employeeOwnDepartment] : []),
          userId: user.id,
          role: accessContext?.baseRole ?? "employee",
          actingContext: accessContext?.actingContext ?? "employee_self",
        },
        "Weekly report save forbidden by department scope"
      )
      return NextResponse.json({ error: "You cannot manage reports for this department" }, { status: 403 })
    }

    const { data: deptRow } = await dataClient
      .from("departments")
      .select("id")
      .eq("name", normalizedDepartment)
      .single()

    const weeklyReportQuery = dataClient
      .from("weekly_reports")
      .select("id, user_id, department, week_number, year")
      .eq("week_number", weekNumber)
      .eq("year", yearNumber)

    const [existingByIdResult, existingByKeyResult] = await Promise.all([
      reportId
        ? dataClient
            .from("weekly_reports")
            .select("id, user_id, department, week_number, year")
            .eq("id", reportId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      (deptRow?.id
        ? weeklyReportQuery.eq("department_id", deptRow.id)
        : weeklyReportQuery.eq("department", department)
      ).maybeSingle(),
    ])

    const existingById = existingByIdResult.data
    const existingByIdError = existingByIdResult.error
    const existingByKey = existingByKeyResult.data
    const existingByKeyError = existingByKeyResult.error

    if (existingByIdError) {
      log.error({ err: existingByIdError, reportId }, "Failed to look up existing report by id")
      return NextResponse.json({ error: existingByIdError.message }, { status: 500 })
    }

    if (existingByKeyError) {
      log.error(
        { err: existingByKeyError, department, normalizedDepartment, weekNumber, yearNumber },
        "Failed to look up existing report"
      )
      return NextResponse.json({ error: existingByKeyError.message }, { status: 500 })
    }

    if (reportId && !existingById) {
      return NextResponse.json({ error: "Weekly report not found" }, { status: 404 })
    }

    const conflictingReport =
      existingByKey && (!existingById || existingByKey.id !== existingById.id) ? existingByKey : null
    const targetExisting = existingById || existingByKey
    const isWeekMutable = await canMutateWeek(dataClient as ReportsClient, weekNumber, yearNumber)
    log.info(
      {
        userId: user.id,
        role: accessContext?.baseRole ?? "employee",
        department,
        normalizedDepartment,
        weekNumber,
        yearNumber,
        reportId,
        existingId: targetExisting?.id || null,
        existingUserId: targetExisting?.user_id || null,
        isWeekMutable,
        actingContext: accessContext?.actingContext ?? "employee_self",
      },
      "Weekly report save pre-write state"
    )

    if (conflictingReport?.id) {
      log.warn(
        {
          reportId,
          conflictingId: conflictingReport.id,
          userId: user.id,
          department,
          normalizedDepartment,
          weekNumber,
          yearNumber,
        },
        "Weekly report save blocked by unique week/department conflict"
      )
      return NextResponse.json(
        {
          error: "A weekly report already exists for this department, week, and year. Please edit the existing report.",
        },
        { status: 409 }
      )
    }

    if (!isWeekMutable && targetExisting?.id) {
      log.warn(
        { department, normalizedDepartment, weekNumber, yearNumber, existingId: targetExisting.id },
        "Weekly report save blocked because locked week already has report"
      )
      return NextResponse.json(
        {
          error:
            "This report already exists and the grace window has closed. Only missing reports can still be created.",
        },
        { status: 409 }
      )
    }

    const isGlobalReportsEditor = Boolean(
      accessContext?.actingContext === "global_admin" &&
        ["developer", "super_admin", "admin"].includes(accessContext.baseRole)
    )

    if (!isGlobalReportsEditor && targetExisting?.user_id && targetExisting.user_id !== user.id) {
      log.warn(
        {
          userId: user.id,
          existingUserId: targetExisting.user_id,
          department,
          normalizedDepartment,
          weekNumber,
          yearNumber,
        },
        "Weekly report save blocked because user does not own existing report"
      )
      return NextResponse.json({ error: "You can only edit reports you created" }, { status: 403 })
    }

    const payload = {
      user_id: targetExisting?.user_id || user.id,
      department,
      week_number: weekNumber,
      year: yearNumber,
      work_done: workDone,
      tasks_new_week: tasksNewWeek,
      challenges,
      status,
    }
    log.info({ payload, writeMode: targetExisting?.id ? "update" : "insert" }, "Weekly report write payload prepared")

    const writeQuery = targetExisting?.id
      ? dataClient.from("weekly_reports").update(payload).eq("id", targetExisting.id)
      : dataClient.from("weekly_reports").insert(payload)

    const { data: saved, error: saveError } = await writeQuery.select("id").single()
    if (saveError) {
      if (saveError.code === "23505") {
        return NextResponse.json(
          {
            error:
              "A weekly report already exists for this department, week, and year. Please edit the existing report.",
          },
          { status: 409 }
        )
      }
      log.error(
        {
          err: saveError,
          payload,
          writeMode: targetExisting?.id ? "update" : "insert",
          existingId: targetExisting?.id || null,
        },
        "Weekly report database write failed"
      )
      return NextResponse.json({ error: saveError.message }, { status: 500 })
    }

    // Keep action_items aligned with weekly_reports.tasks_new_week.
    // Do not overwrite items already being worked on/completed.
    try {
      const reportId = String(saved?.id || "")
      if (reportId) {
        const { data: existingRows, error: existingError } = await dataClient
          .from("action_items")
          .select("id, status")
          .eq("report_id", reportId)
          .returns<ActionItemSyncRow[]>()

        if (existingError) {
          throw existingError
        }

        const hasActiveItems = (existingRows || []).some(
          (row) => row.status !== "pending" && row.status !== "not_started"
        )

        if (!hasActiveItems) {
          await dataClient.from("action_items").delete().eq("report_id", reportId)

          const parsedTitles = parseTasksNewWeekLines(tasksNewWeek)
          if (parsedTitles.length > 0 && status === "submitted") {
            const actionItemPayload = parsedTitles.map((title, index) => ({
              title,
              department,
              status: "pending",
              week_number: weekNumber,
              year: yearNumber,
              assigned_by: user.id,
              report_id: reportId,
              position: index,
            }))
            const { error: insertActionItemsError } = await dataClient.from("action_items").insert(actionItemPayload)
            if (insertActionItemsError) {
              throw insertActionItemsError
            }
          }
        }
      }
    } catch (syncError) {
      log.error({ err: String(syncError), reportId: saved?.id }, "Weekly report action item sync failed")
    }

    log.info({ savedId: saved?.id, payload }, "Weekly report saved successfully")
    return NextResponse.json({ data: saved }, { status: targetExisting?.id ? 200 : 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    log.error({ err: String(error) }, "POST /api/reports/weekly-reports failed")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: Request) {
  const rl = await rateLimit(`reports-weekly-reports:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(request)
}
