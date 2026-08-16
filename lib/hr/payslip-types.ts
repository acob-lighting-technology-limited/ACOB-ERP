/**
 * The payslip document model — one shape shared by the browser print view
 * (lib/hr/payslip-print.ts) and the server-side PDF used for email
 * (lib/hr/payslip-pdf.ts), so the two can never drift apart.
 */

export interface PayslipLine {
  label: string
  amount: number
}

export interface PayslipPrintData {
  fullName: string
  employeeNumber: string
  department?: string | null
  designation?: string | null
  periodName: string
  payDate: string
  /** e.g. "Paid" / "Draft" */
  statusLabel: string
  statusPaid: boolean
  earnings: PayslipLine[]
  grossLabel: string
  gross: number
  deductions: PayslipLine[]
  totalDeductions: number
  netPay: number
}

export const PAYSLIP_COMPANY_ADDRESS =
  "Plot 2. Block 14 Extension, Federal Ministry of Works And Housing Sites and Services Scheme, Setraco Gate, Gwarinpa, FCT, Nigeria."

export const PAYSLIP_CONTACT_LINE = "Email: info@acoblighting.com  |  Web: www.acoblighting.com"

/** The breakdown fields a payslip needs. Structurally satisfied by PayrollBreakdown. */
export interface PayslipBreakdown {
  monthlyBasic: number
  monthlyHousing: number
  monthlyTransport: number
  monthlyLeave: number
  monthlyCommunication: number
  monthlyGross: number
  monthlyPensionEmployee: number
  monthlyTax: number
  bonus: number
  unpaidLeaveDays: number
  unpaidLeaveDeduction: number
  lunchDeduction: number
  loanRepayment: number
  latenessSurcharge: number
  absentSurcharge: number
  totalDeductions: number
  netPay: number
}

export interface PayslipEmployeeMeta {
  fullName: string
  employeeNumber: string
  department?: string | null
  designation?: string | null
  periodName: string
  payDate: string
  statusPaid: boolean
}

/**
 * Single place where a payroll breakdown becomes payslip line items — used by the
 * print view and the emailed PDF alike, so a deduction can never appear on one
 * and be missing from the other.
 */
export function payslipFromBreakdown(breakdown: PayslipBreakdown, meta: PayslipEmployeeMeta): PayslipPrintData {
  const deductions: PayslipLine[] = [
    { label: "Pension (Employee)", amount: breakdown.monthlyPensionEmployee },
    { label: "PAYE Tax", amount: breakdown.monthlyTax },
  ]
  if (breakdown.unpaidLeaveDeduction > 0)
    deductions.push({
      label: `Unpaid Leave (${breakdown.unpaidLeaveDays}d)`,
      amount: breakdown.unpaidLeaveDeduction,
    })
  if (breakdown.lunchDeduction > 0) deductions.push({ label: "Lunch Deduction", amount: breakdown.lunchDeduction })
  if (breakdown.loanRepayment > 0) deductions.push({ label: "Loan Repayment", amount: breakdown.loanRepayment })
  if (breakdown.latenessSurcharge + breakdown.absentSurcharge > 0)
    deductions.push({
      label: "Lateness/Absence Surcharge",
      amount: breakdown.latenessSurcharge + breakdown.absentSurcharge,
    })

  return {
    fullName: meta.fullName,
    employeeNumber: meta.employeeNumber,
    department: meta.department,
    designation: meta.designation,
    periodName: meta.periodName,
    payDate: meta.payDate,
    statusLabel: meta.statusPaid ? "Paid" : "Draft",
    statusPaid: meta.statusPaid,
    earnings: [
      { label: "Basic Salary", amount: breakdown.monthlyBasic },
      { label: "Housing Allowance", amount: breakdown.monthlyHousing },
      { label: "Transport Allowance", amount: breakdown.monthlyTransport },
      { label: "Leave Allowance", amount: breakdown.monthlyLeave },
      { label: "Communication Allowance", amount: breakdown.monthlyCommunication },
      ...(breakdown.bonus > 0 ? [{ label: "Bonus / Refund", amount: breakdown.bonus }] : []),
    ],
    grossLabel: "Gross Cash Pay",
    gross: breakdown.monthlyGross + breakdown.bonus,
    deductions,
    totalDeductions: breakdown.totalDeductions,
    netPay: breakdown.netPay,
  }
}

/** Amount with exactly two decimals and thousands separators, no currency mark. */
export function formatPayslipAmount(value: number): string {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
