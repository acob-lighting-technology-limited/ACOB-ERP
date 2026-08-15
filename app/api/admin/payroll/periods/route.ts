import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"

const log = logger("api-admin-hr-payroll-periods")
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: periods, error } = await supabase
      .from("payroll_periods")
      .select("*")
      .order("start_date", { ascending: false })

    if (error) {
      log.error({ err: error.message }, "Error fetching payroll periods")
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: periods || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in GET /api/admin/payroll/periods")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || !body.name || !body.start_date || !body.end_date || !body.pay_date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { name, start_date, end_date, pay_date } = body

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { data: period, error } = await dataClient
      .from("payroll_periods")
      .insert({
        name,
        start_date,
        end_date,
        pay_date,
        status: "draft",
        total_amount: 0,
      })
      .select("*")
      .single()

    if (error) {
      log.error({ err: error.message }, "Error creating payroll period")
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: period })
  } catch (error) {
    log.error({ err: String(error) }, "Unhandled error in POST /api/admin/payroll/periods")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
