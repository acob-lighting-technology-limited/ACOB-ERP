import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { toLocalISODate } from "@/lib/utils/date"
import { computeDailyTotals } from "@/lib/hr/daily-report"

const log = logger("hr-daily-activity")
export const dynamic = "force-dynamic"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const TaskSchema = z.object({
  description: z.string().trim().min(1).max(500),
  status: z.enum(["not_started", "in_progress", "completed"]),
  task_type: z.enum(["planned", "unforeseen"]).nullable().optional(),
  comments: z.string().trim().max(1000).nullable().optional(),
})

const SaveSchema = z.object({
  report_date: z.string().regex(ISO_DATE),
  status: z.enum(["draft", "submitted"]),
  tasks: z.array(TaskSchema).max(100),
})

type TaskRow = {
  id?: string
  description: string
  status: string
  task_type: string | null
  comments: string | null
  position: number
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { searchParams } = request.nextUrl
  const date = searchParams.get("date")
  const start = searchParams.get("start")
  const end = searchParams.get("end")

  // ── Range summary: one row per report (the sheet's rolling summary table) ──
  if (start || end) {
    if ((start && !ISO_DATE.test(start)) || (end && !ISO_DATE.test(end))) {
      return NextResponse.json({ error: "start/end must be YYYY-MM-DD" }, { status: 400 })
    }
    let query = dataClient
      .from("daily_reports")
      .select(
        "id, report_date, status, acknowledged_at, daily_report_tasks(id, description, status, task_type, comments, position)"
      )
      .eq("user_id", user.id)
      .order("report_date", { ascending: false })
    if (start) query = query.gte("report_date", start)
    if (end) query = query.lte("report_date", end)

    const { data, error } = await query
    if (error) {
      log.error("Failed to load daily report summary", error)
      return NextResponse.json({ error: "Failed to load reports" }, { status: 500 })
    }

    const summary = (data ?? []).map((r) => {
      const tasks = ((r.daily_report_tasks ?? []) as TaskRow[]).slice().sort((a, b) => a.position - b.position)
      const totals = computeDailyTotals(tasks)
      return {
        id: r.id,
        report_date: r.report_date,
        status: r.status,
        acknowledged: Boolean(r.acknowledged_at),
        task_count: tasks.length,
        tasks: tasks.map((task) => ({
          id: task.id || `${r.id}:${task.position}`,
          description: task.description,
          status: task.status,
          task_type: task.task_type,
          comments: task.comments,
          position: task.position,
        })),
        ...totals,
      }
    })
    return NextResponse.json({ summary })
  }

  // ── Single day: report header + its task rows for the editor ──
  const day = date && ISO_DATE.test(date) ? date : toLocalISODate()
  const { data: report, error } = await dataClient
    .from("daily_reports")
    .select("id, report_date, status, acknowledged_at, daily_report_tasks(id, description, status, task_type, comments, position)")
    .eq("user_id", user.id)
    .eq("report_date", day)
    .maybeSingle()

  if (error) {
    log.error("Failed to load daily report", error)
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 })
  }

  const tasks = ((report?.daily_report_tasks ?? []) as (TaskRow & { id: string })[])
    .slice()
    .sort((a, b) => a.position - b.position)

  return NextResponse.json({
    report: report
      ? {
          id: report.id,
          report_date: report.report_date,
          status: report.status,
          acknowledged: Boolean(report.acknowledged_at),
        }
      : null,
    tasks,
  })
}

export async function PUT(request: NextRequest) {
  const rl = await rateLimit(`hr-daily-activity-save:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = SaveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }
  const { report_date, status, tasks } = parsed.data

  const dataClient = getServiceRoleClientOrFallback(supabase)

  // Find or create the report for this user + date
  const { data: existing } = await dataClient
    .from("daily_reports")
    .select("id, acknowledged_at")
    .eq("user_id", user.id)
    .eq("report_date", report_date)
    .maybeSingle()

  if (existing?.acknowledged_at) {
    return NextResponse.json({ error: "This report has been acknowledged and can no longer be edited" }, { status: 409 })
  }

  let reportId = existing?.id ?? null
  const reportPatch = {
    status,
    submitted_at: status === "submitted" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }

  if (reportId) {
    const { error: updErr } = await dataClient.from("daily_reports").update(reportPatch).eq("id", reportId)
    if (updErr) {
      log.error("Failed to update daily report", updErr)
      return NextResponse.json({ error: "Failed to save report" }, { status: 500 })
    }
  } else {
    const { data: created, error: insErr } = await dataClient
      .from("daily_reports")
      .insert({ user_id: user.id, report_date, ...reportPatch })
      .select("id")
      .single()
    if (insErr || !created) {
      log.error("Failed to create daily report", insErr)
      return NextResponse.json({ error: "Failed to save report" }, { status: 500 })
    }
    reportId = created.id
  }

  // Replace task rows (simplest reliable approach: delete + insert)
  const { error: delErr } = await dataClient.from("daily_report_tasks").delete().eq("report_id", reportId)
  if (delErr) {
    log.error("Failed to clear daily report tasks", delErr)
    return NextResponse.json({ error: "Failed to save tasks" }, { status: 500 })
  }

  const rows: (TaskRow & { report_id: string })[] = tasks.map((t, i) => ({
    report_id: reportId as string,
    description: t.description,
    status: t.status,
    task_type: t.task_type ?? null,
    comments: t.comments ?? null,
    position: i,
  }))

  if (rows.length > 0) {
    const { error: taskErr } = await dataClient.from("daily_report_tasks").insert(rows)
    if (taskErr) {
      log.error("Failed to insert daily report tasks", taskErr)
      return NextResponse.json({ error: "Failed to save tasks" }, { status: 500 })
    }
  }

  return NextResponse.json({
    id: reportId,
    report_date,
    status,
    ...computeDailyTotals(tasks.map((t) => ({ status: t.status, task_type: t.task_type ?? null }))),
    message: status === "submitted" ? "Report submitted" : "Draft saved",
  })
}
