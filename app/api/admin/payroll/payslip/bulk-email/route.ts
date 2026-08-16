import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { computePayrollBatch } from "@/lib/hr/payroll-compute"
import { sendPayslipEmail } from "@/lib/hr/payslip-mailer"
import { logger } from "@/lib/logger"

const log = logger("api-admin-payroll-payslip-bulk-email")
export const dynamic = "force-dynamic"
export const maxDuration = 300

const DEFAULT_BATCH_SIZE = 8
const MAX_BATCH_SIZE = 25

/**
 * Mails payslips for one locked payroll period, one batch at a time.
 *
 * Idempotent by design: a row is only ever sent while its
 * payroll_entries.payslip_emailed_at is NULL, and it's stamped immediately
 * after that individual send succeeds — not batched at the end — so a crash
 * mid-run, a duplicate click, or the client simply calling again all resume
 * from wherever the run actually got to, without re-mailing anyone.
 *
 * The client is expected to call this repeatedly (small `limit` per call)
 * until `remaining` reaches 0, so no single request risks a serverless
 * timeout regardless of how large the period is.
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
    const protect = body?.protect !== false
    const limit = Math.min(MAX_BATCH_SIZE, Math.max(1, Number(body?.limit) || DEFAULT_BATCH_SIZE))

    if (!payrollPeriodId) {
      return NextResponse.json({ error: "payroll_period_id is required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const batch = await computePayrollBatch(dataClient, payrollPeriodId)
    if ("error" in batch) {
      return NextResponse.json({ error: batch.error }, { status: 404 })
    }

    const { period, rows } = batch
    if (period.status !== "completed") {
      return NextResponse.json(
        { error: "Lock and approve this payroll period before emailing payslips in bulk." },
        { status: 409 }
      )
    }

    const eligible = rows.filter((r) => r.entry_id && !r.payslip_emailed_at)
    const slice = eligible.slice(0, limit)

    const sent: Array<{ user_id: string; full_name: string }> = []
    const failed: Array<{ user_id: string; full_name: string; reason: string }> = []

    for (const row of slice) {
      const result = await sendPayslipEmail({ period, row, protect })
      if (result.sent) {
        sent.push({ user_id: row.user_id, full_name: row.full_name })
        // Stamped immediately per row, not batched at the end of the loop —
        // that's what makes a crash or timeout mid-run safe to resume.
        await dataClient
          .from("payroll_entries")
          .update({ payslip_emailed_at: new Date().toISOString() })
          .eq("id", row.entry_id!)
      } else {
        failed.push({ user_id: row.user_id, full_name: row.full_name, reason: result.reason })
        log.error({ userId: row.user_id, reason: result.reason }, "Bulk payslip send failed for one employee")
      }
    }

    const remaining = eligible.length - slice.length

    log.info(
      { periodId: payrollPeriodId, sent: sent.length, failed: failed.length, remaining },
      "Bulk payslip batch processed"
    )

    return NextResponse.json({
      processed: slice.length,
      sent,
      failed,
      remaining,
      totalEligible: eligible.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send payslip batch"
    log.error({ err: message }, "Bulk payslip email error")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
