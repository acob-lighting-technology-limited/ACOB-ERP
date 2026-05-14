import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  buildOfficialReportPdf,
  persistOfficialPdf,
  resolveOfficialReportExportMeta,
  tryReadStoredOfficialPdf,
  type OfficialReportExportType,
} from "@/lib/reports/official-pdf"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("api-reports-official-exports")

type WeekKey = {
  week_number: number
  year: number
}

type SelectWeekRow = {
  week_number: number | null
  year: number | null
}

type RpcResponse = {
  data: boolean | null
  error: { message: string } | null
}

type ReportsBackfillClient = {
  from: ReturnType<typeof getServiceRoleClientOrFallback>["from"]
  rpc: SupabaseClient["rpc"]
}

async function isAuthorizedCronRequest() {
  const cronSecret = process.env.CRON_SECRET
  const requestHeaders = await headers()
  const bearerToken = requestHeaders
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim()

  return Boolean(cronSecret && bearerToken && bearerToken === cronSecret)
}

async function getCandidateWeeks(dataClient: ReportsBackfillClient) {
  const [weeklyReportsResult, weeklyTasksResult, actionItemsResult] = await Promise.all([
    dataClient.from("weekly_reports").select("week_number, year").eq("status", "submitted").returns<SelectWeekRow[]>(),
    dataClient.from("tasks").select("week_number, year").eq("category", "weekly_action").returns<SelectWeekRow[]>(),
    dataClient.from("action_items").select("week_number, year").returns<SelectWeekRow[]>(),
  ])

  if (weeklyReportsResult.error) throw new Error(weeklyReportsResult.error.message)
  if (weeklyTasksResult.error) throw new Error(weeklyTasksResult.error.message)
  if (actionItemsResult.error) throw new Error(actionItemsResult.error.message)

  const weeks = new Map<string, WeekKey>()
  ;[...(weeklyReportsResult.data || []), ...(weeklyTasksResult.data || []), ...(actionItemsResult.data || [])].forEach(
    (row: SelectWeekRow) => {
      const weekNumber = Number(row.week_number || 0)
      const year = Number(row.year || 0)
      if (!weekNumber || !year) return
      weeks.set(`${year}-${weekNumber}`, { week_number: weekNumber, year })
    }
  )

  return Array.from(weeks.values()).sort((a, b) => a.year - b.year || a.week_number - b.week_number)
}

async function isLockedWeek(dataClient: ReportsBackfillClient, week: number, year: number) {
  const { data, error } = (await (
    dataClient.rpc as unknown as (fn: string, args: { p_week: number; p_year: number }) => Promise<RpcResponse>
  )("weekly_report_can_mutate", {
    p_week: week,
    p_year: year,
  })) as RpcResponse

  if (error) throw new Error(error.message)
  return !Boolean(data)
}

async function ensureOfficialExportForWeek(
  dataClient: ReportsBackfillClient,
  week: number,
  year: number,
  type: OfficialReportExportType
) {
  const meta = await resolveOfficialReportExportMeta(dataClient, { week, year, type })
  const existing = await tryReadStoredOfficialPdf(meta.storagePath)
  if (existing) {
    return { status: "existing" as const, path: meta.storagePath }
  }

  const { pdfBytes, storagePath } = await buildOfficialReportPdf(dataClient, { week, year, type })
  await persistOfficialPdf(storagePath, pdfBytes)
  return { status: "created" as const, path: storagePath }
}

export async function PATCH() {
  const rl = await rateLimit("reports-official-exports", { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const isAuthorizedCron = await isAuthorizedCronRequest()
    const supabase = await createClient()

    if (!isAuthorizedCron) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

      const exportScope = await getRequestScope()
      if (!exportScope?.isAdminLike || exportScope.scopeMode === "lead") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const dataClient = getServiceRoleClientOrFallback(supabase) as unknown as ReportsBackfillClient
    const weeks = await getCandidateWeeks(dataClient)

    const results: Array<Record<string, unknown>> = []

    for (const entry of weeks) {
      if (!(await isLockedWeek(dataClient, entry.week_number, entry.year))) continue

      for (const type of ["weekly_report", "action_point"] as const) {
        try {
          const outcome = await ensureOfficialExportForWeek(dataClient, entry.week_number, entry.year, type)
          results.push({
            week: entry.week_number,
            year: entry.year,
            type,
            status: outcome.status,
            path: outcome.path,
          })
        } catch (error) {
          results.push({
            week: entry.week_number,
            year: entry.year,
            type,
            status: "skipped",
            error: error instanceof Error ? error.message : "Unknown error",
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Official report export backfill failed")
    return NextResponse.json({ error: "Failed to backfill official report exports" }, { status: 500 })
  }
}

export async function POST() {
  const rl = await rateLimit("reports-official-exports", { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH()
}
