import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { computePayrollBatch } from "@/lib/hr/payroll-compute"
import { sendPayslipEmail } from "@/lib/hr/payslip-mailer"
import { logger } from "@/lib/logger"

const log = logger("api-admin-payroll-payslip-email")
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Emails one employee their payslip as a PDF attachment.
 *
 * Figures are recomputed server-side, never taken from the request body — the
 * client must not be able to dictate what a payslip says.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const payrollPeriodId = body?.payroll_period_id
    const userId = body?.user_id
    const protect = body?.protect !== false // password-protect unless explicitly disabled

    if (!payrollPeriodId || !userId) {
      return NextResponse.json({ error: "payroll_period_id and user_id are required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Same computation the worksheet renders: a locked period replays its
    // immutable published snapshot, a draft is computed live from attendance and
    // salary data. So a draft payslip can be emailed without saving first, and it
    // carries exactly the figures the admin is looking at.
    const batch = await computePayrollBatch(dataClient, payrollPeriodId)
    if ("error" in batch) {
      return NextResponse.json({ error: batch.error }, { status: 404 })
    }

    const { period, rows } = batch
    const row = rows.find((r) => r.user_id === userId)
    if (!row || !row.breakdown) {
      return NextResponse.json(
        {
          error:
            period.status === "completed"
              ? "This employee has no published payslip in this locked period."
              : "This employee is not in the current payroll run.",
        },
        { status: 409 }
      )
    }

    const result = await sendPayslipEmail({ period, row, protect })
    if (!result.sent) {
      log.error({ reason: result.reason, userId }, "Payslip email failed")
      return NextResponse.json({ error: `Failed to send payslip: ${result.reason}` }, { status: 502 })
    }

    // Only a locked/published period has a payroll_entries row to stamp — a
    // draft test-send has nothing to mark, and shouldn't: it isn't the mailing
    // bulk-send is idempotent against.
    if (row.entry_id) {
      await dataClient
        .from("payroll_entries")
        .update({ payslip_emailed_at: new Date().toISOString() })
        .eq("id", row.entry_id)
    }

    log.info({ userId, periodId: payrollPeriodId, protect }, "Payslip emailed")
    return NextResponse.json({ sent: true, recipient: result.recipient, passwordProtected: protect })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to email payslip"
    log.error({ err: message }, "Payslip email error")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
