/**
 * Sends one employee's payslip PDF by email. Shared by the single-send route
 * (admin testing one payslip) and the bulk-send route (mailing a whole locked
 * period), so both build the identical PDF and identical cover note.
 */

import { generatePayslipPdf, payslipFileName } from "@/lib/hr/payslip-pdf"
import { payslipFromBreakdown } from "@/lib/hr/payslip-types"
import type { PayrollComputedRow } from "@/lib/hr/payroll-compute"
import { renderPayslipEmail } from "@/lib/email-templates/payslip"
import { sendNotificationEmailWithRetry } from "@/lib/notifications/email-gateway"
import { withSubjectPrefix } from "@/lib/notifications/subject-policy"
import { ORG_MAIL_ROUTING } from "@/lib/org-config"

export interface SendPayslipParams {
  period: { name: string; pay_date: string; status: string }
  row: PayrollComputedRow
  /** Password-protect the PDF with the employee's staff ID. Default true. */
  protect?: boolean
}

export type SendPayslipResult = { sent: true; recipient: string } | { sent: false; reason: string }

export async function sendPayslipEmail({ period, row, protect = true }: SendPayslipParams): Promise<SendPayslipResult> {
  if (!row.breakdown) return { sent: false, reason: "No payroll figures for this employee" }

  const recipient = (row.company_email || "").trim()
  if (!recipient || !recipient.includes("@")) {
    return { sent: false, reason: `${row.full_name} has no company email on file` }
  }

  const payslip = payslipFromBreakdown(row.breakdown, {
    fullName: row.full_name,
    employeeNumber: row.employee_number,
    department: row.department,
    designation: row.designation,
    periodName: period.name,
    payDate: period.pay_date,
    statusPaid: period.status === "completed",
  })

  // The PDF is encrypted in-process by jsPDF, so protection needs no external
  // service. The open password is the employee's own staff ID — never printed
  // in the email body, only its format, so the body isn't a second place the
  // password can leak from.
  let password: string | null = null
  if (protect) {
    password = (row.employee_number || "").trim() || null
    if (!password) return { sent: false, reason: `${row.full_name} has no staff ID, so the password cannot be set` }
  }

  const pdfBytes = await generatePayslipPdf(payslip, { password })

  const routing = ORG_MAIL_ROUTING.Payroll
  const result = await sendNotificationEmailWithRetry({
    to: [recipient],
    subject: withSubjectPrefix("Payroll", `Payslip - ${period.name}`),
    html: renderPayslipEmail({
      fullName: row.full_name,
      periodName: period.name,
      payDate: period.pay_date,
      protected: Boolean(password),
    }),
    replyTo: routing.replyTo,
    listId: routing.listId,
    attachments: [{ filename: payslipFileName(payslip), content: pdfBytes }],
  })

  if (!result.sent) {
    const reason =
      result.reason === "missing_resend_key"
        ? "RESEND_API_KEY is not configured in this environment"
        : result.error || result.reason
    return { sent: false, reason }
  }

  return { sent: true, recipient }
}
