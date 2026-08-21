import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { loadMenuForDate, loadVotesForMenu } from "@/lib/hr/lunch-menu-server"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-lunch")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = request.nextUrl
    const date = searchParams.get("date")
    const month = searchParams.get("month") // e.g. "2026-07"
    const startDateParam = searchParams.get("start_date")
    const endDateParam = searchParams.get("end_date")

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const allTime = searchParams.get("all_time") === "true"
    const yearParam = searchParams.get("year") // e.g. "2026"

    if (month || yearParam || allTime || (startDateParam && endDateParam)) {
      let query = dataClient.from("attendance_lunch_log").select("user_id, date, employee_deduction")
      if (month) {
        const year = parseInt(month.substring(0, 4))
        const m = parseInt(month.substring(5, 7))
        const startDate = `${month}-01`
        const nextMonthDate = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`
        query = query.gte("date", startDate).lt("date", nextMonthDate)
      } else if (yearParam) {
        query = query.gte("date", `${yearParam}-01-01`).lt("date", `${parseInt(yearParam) + 1}-01-01`)
      } else if (startDateParam && endDateParam) {
        query = query.gte("date", startDateParam).lte("date", endDateParam)
      }

      // Fetch lunch settings, logs, and all employees (active and exited)
      const [settingsRes, logsRes, employeesRes] = await Promise.all([
        dataClient.from("system_settings").select("value").eq("key", "lunch_settings").maybeSingle(),
        query,
        dataClient
          .from("profiles")
          .select("id, full_name, employee_number, department, employment_status")
          .order("full_name"),
      ])

      const settings = settingsRes.data?.value || { cost: 2200, subsidy_percent: 50 }
      const logs = logsRes.data || []
      const employees = employeesRes.data || []

      // Map employee lunch stats
      const summary = employees
        .map((emp) => {
          const empLogs = logs.filter((log) => log.user_id === emp.id)
          const count = empLogs.length
          const totalDeduction = empLogs.reduce((sum, log) => sum + Number(log.employee_deduction), 0)
          return {
            user_id: emp.id,
            full_name: emp.full_name,
            employee_number: emp.employee_number,
            department: emp.department,
            lunch_count: count,
            total_deduction: totalDeduction,
            active: emp.employment_status === "active",
          }
        })
        .filter((row) => row.active || row.lunch_count > 0)

      return NextResponse.json({
        settings,
        summary,
        logs,
      })
    }

    if (!date) {
      return NextResponse.json({ error: "Missing date or month parameter" }, { status: 400 })
    }

    // Fetch lunch settings, logs for the date, active employees, and menu with votes
    const [settingsRes, logsRes, employeesRes, menu] = await Promise.all([
      dataClient.from("system_settings").select("value").eq("key", "lunch_settings").maybeSingle(),
      dataClient.from("attendance_lunch_log").select("user_id").eq("date", date),
      dataClient
        .from("profiles")
        .select("id, full_name, employee_number, department")
        .eq("employment_status", "active")
        .order("full_name"),
      loadMenuForDate(dataClient, date, { includeDrafts: true }),
    ])

    const settings = settingsRes.data?.value || { cost: 2200, subsidy_percent: 50 }
    const ateUserIds = logsRes.data?.map((log) => log.user_id) || []
    const employees = employeesRes.data || []
    const votes = menu ? await loadVotesForMenu(dataClient, menu.id) : []

    return NextResponse.json({
      settings,
      ateUserIds,
      employees,
      menu,
      votes,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/lunch")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const { date, userIds } = body as { date: string; userIds: string[] }

    if (!date || !Array.isArray(userIds)) {
      return NextResponse.json({ error: "Invalid date or userIds list" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Load lunch settings
    const settingsRes = await dataClient
      .from("system_settings")
      .select("value")
      .eq("key", "lunch_settings")
      .maybeSingle()
    const settings = settingsRes.data?.value || { cost: 2200, subsidy_percent: 50 }
    const cost = Number(settings.cost)
    const subsidyPercent = Number(settings.subsidy_percent)
    const companySubsidy = cost * (subsidyPercent / 100)
    const employeeDeduction = cost - companySubsidy

    // Delete existing logs for the date
    const { error: deleteErr } = await dataClient.from("attendance_lunch_log").delete().eq("date", date)

    if (deleteErr) {
      throw new Error(`Failed to clear existing logs: ${deleteErr.message}`)
    }

    // Insert new logs if any users are selected
    if (userIds.length > 0) {
      const recordsToInsert = userIds.map((uid) => ({
        user_id: uid,
        date,
        cost,
        company_subsidy: companySubsidy,
        employee_deduction: employeeDeduction,
        created_by: scope.userId,
      }))

      const { error: insertErr } = await dataClient.from("attendance_lunch_log").insert(recordsToInsert)

      if (insertErr) {
        throw new Error(`Failed to insert lunch logs: ${insertErr.message}`)
      }
    }

    return NextResponse.json({ success: true, count: userIds.length })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/lunch")
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
