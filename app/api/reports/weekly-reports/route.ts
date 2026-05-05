import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { normalizeDepartmentName } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { canMutateV2 } from "@/lib/admin/policy-v2"

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

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) {
      return contextResult.response
    }
    const routeAccess = enforceRouteAccessV2(contextResult.context, "reports.weekly")
    if (!routeAccess.ok) {
      return routeAccess.response
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

    const canWriteDepartment = canMutateV2(contextResult.context, "reports.weekly", normalizedDepartment)
    if (!canWriteDepartment) {
      log.warn(
        {
          department,
          normalizedDepartment,
          managedDepartments: contextResult.context.managedDepartments,
          userId: user.id,
          role: contextResult.context.baseRole,
          actingContext: contextResult.context.actingContext,
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
        role: contextResult.context.baseRole,
        department,
        normalizedDepartment,
        weekNumber,
        yearNumber,
        reportId,
        existingId: targetExisting?.id || null,
        existingUserId: targetExisting?.user_id || null,
        isWeekMutable,
        actingContext: contextResult.context.actingContext,
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

    const isGlobalReportsEditor =
      contextResult.context.actingContext === "global_admin" &&
      ["developer", "super_admin", "admin"].includes(contextResult.context.baseRole)

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
  return PATCH(request)
}
