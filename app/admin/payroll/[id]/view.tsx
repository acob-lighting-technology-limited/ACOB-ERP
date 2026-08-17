"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { calculatePayroll, type PayrollBreakdown } from "@/lib/hr/payroll-utils"
import { printPayslip } from "@/lib/hr/payslip-print"
import { payslipFromBreakdown, type PayslipEmployeeMeta } from "@/lib/hr/payslip-types"
import { formatEmployeeName } from "@/lib/hr/employee-name"
import { Checkbox } from "@/components/ui/checkbox"
import { ManageGrossSalaryDialog } from "@/components/hr/manage-gross-salary-dialog"
import {
  FileText,
  Save,
  Lock,
  Download,
  DollarSign,
  Clock,
  Eye,
  Printer,
  Mail,
  Loader2,
  MailCheck,
  Send,
} from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

export interface PayrollRow {
  user_id: string
  full_name: string
  first_name: string
  last_name: string
  employee_number: string
  company_email: string
  department?: string | null
  designation?: string | null
  breakdown: PayrollBreakdown
  /** Only present once a period is locked and published. */
  entry_id?: string
  payslip_emailed_at?: string | null
}

export interface PayrollPeriodDetail {
  id: string
  name: string
  start_date: string
  end_date: string
  pay_date: string
  status: string
  total_amount: number
}

interface WorksheetPageProps {
  initialData: {
    period: PayrollPeriodDetail
    periodOptions?: { id: string; name: string; start_date: string }[]
    isAdmin: boolean
  }
}

export function PayrollWorksheetPage({ initialData }: WorksheetPageProps) {
  const router = useRouter()
  const period = initialData.period
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(period.status)
  const [viewRow, setViewRow] = useState<PayrollRow | null>(null)
  // Email confirmation is a separate, deliberate step — the payslip dialog itself
  // must never send mail as a side effect of being opened.
  const [emailTarget, setEmailTarget] = useState<PayrollRow | null>(null)
  const [emailSending, setEmailSending] = useState(false)
  const [protectPdf, setProtectPdf] = useState(true)
  // Bulk send: a separate confirmation from the single-employee one, and a
  // separate in-flight flag — the two must never be triggerable at once.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ sent: 0, failed: 0, total: 0 })

  const payslipMeta = (row: PayrollRow): PayslipEmployeeMeta => ({
    fullName: row.full_name,
    employeeNumber: row.employee_number,
    department: row.department,
    designation: row.designation,
    periodName: period.name,
    payDate: period.pay_date,
    statusPaid: status === "completed",
  })

  const handleEmailPayslip = async () => {
    if (!emailTarget || emailSending) return
    setEmailSending(true)
    try {
      const res = await apiFetch("/api/admin/payroll/payslip/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payroll_period_id: period.id,
          user_id: emailTarget.user_id,
          protect: protectPdf,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to email payslip")

      toast.success(`Payslip sent to ${payload.recipient}`)
      const sentUserId = emailTarget.user_id
      setRows((prev) =>
        prev.map((r) => (r.user_id === sentUserId ? { ...r, payslip_emailed_at: new Date().toISOString() } : r))
      )
      setEmailTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to email payslip")
    } finally {
      setEmailSending(false)
    }
  }

  // Calls the batch endpoint repeatedly (small batches) until nothing is left
  // to send. Each batch is stamped server-side as it succeeds, so this loop can
  // be safely re-run — closing the dialog mid-run and reopening it just resumes.
  const handleBulkSend = async () => {
    if (bulkSending) return
    setBulkSending(true)

    const unsentAtStart = rows.filter((r) => !r.payslip_emailed_at).length
    setBulkProgress({ sent: 0, failed: 0, total: unsentAtStart })

    let sentCount = 0
    const failures: Array<{ full_name: string; reason: string }> = []

    try {
      // Safety cap on iterations, not on employees — batches of ~8 mean this
      // comfortably covers periods far larger than the current headcount.
      for (let i = 0; i < 50; i++) {
        const res = await apiFetch("/api/admin/payroll/payslip/bulk-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payroll_period_id: period.id, protect: protectPdf, limit: 8 }),
        })
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error || "Failed to send payslips")

        sentCount += payload.sent.length
        failures.push(...payload.failed)

        const sentIds = new Set(payload.sent.map((s: { user_id: string }) => s.user_id))
        setRows((prev) =>
          prev.map((r) => (sentIds.has(r.user_id) ? { ...r, payslip_emailed_at: new Date().toISOString() } : r))
        )
        setBulkProgress({ sent: sentCount, failed: failures.length, total: unsentAtStart })

        if (payload.processed === 0 || payload.remaining === 0) break
      }

      if (failures.length === 0) {
        toast.success(`Sent ${sentCount} payslip${sentCount === 1 ? "" : "s"}`)
      } else {
        const names = failures
          .slice(0, 3)
          .map((f) => f.full_name)
          .join(", ")
        toast.error(
          `Sent ${sentCount}, ${failures.length} failed (${names}${failures.length > 3 ? ", …" : ""}). Retry to resend just the failures.`
        )
      }
      setBulkConfirmOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send payslips")
    } finally {
      setBulkSending(false)
    }
  }

  // Fetch compiled payroll calculations
  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch(`/api/admin/payroll/run?payroll_period_id=${period.id}`)
        const payload = await res.json()
        if (!res.ok) throw new Error(payload.error || "Failed to load worksheet")
        setRows(payload.data || [])
        setStatus(payload.status || period.status)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load calculations")
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [period.id, period.status])

  // Recalculates inline modifications locally on the client for instant updates.
  //
  // Gross and Communication Allowance are the two independent inputs; Base
  // Salary is always their difference (monthlyGross = monthlyBase + monthlyComms
  // is exact — see lib/hr/payroll-utils.ts), so editing either one recomputes
  // Base rather than Base being separately editable.
  const handleValChange = (
    userId: string,
    field: "bonus" | "loanRepayment" | "monthlyGross" | "communication",
    valStr: string
  ) => {
    if (status === "completed") return // Locked

    const num = parseFloat(valStr) || 0
    setRows(
      rows.map((row) => {
        if (row.user_id !== userId) return row

        const currentBreakdown = row.breakdown
        const nextGross = field === "monthlyGross" ? num : currentBreakdown.monthlyGross
        const nextMonthlyComms = field === "communication" ? num : currentBreakdown.monthlyCommunication
        const nextBase = nextGross - nextMonthlyComms

        const nextBreakdown = calculatePayroll({
          monthlyBase: nextBase,
          workdays: currentBreakdown.workdays,
          missedHours: currentBreakdown.missedHours,
          absentDays: currentBreakdown.absentDays,
          unpaidLeaveDays: currentBreakdown.unpaidLeaveDays,
          bonus: field === "bonus" ? num : currentBreakdown.bonus,
          loanRepayment: field === "loanRepayment" ? num : currentBreakdown.loanRepayment,
          lunchDeduction: currentBreakdown.lunchDeduction,
          communicationConfig: nextMonthlyComms * 12,
        })

        return {
          ...row,
          breakdown: nextBreakdown,
        }
      })
    )
  }

  // Save the payroll (draft or final lock). Only the fields the worksheet lets
  // an admin edit are sent — the server recomputes everything else (attendance
  // surcharges, tax, pension) from source data rather than trusting the client.
  const handleSave = async (lockPeriod = false) => {
    if (saving) return
    setSaving(true)

    try {
      const payload = {
        payroll_period_id: period.id,
        lockPeriod,
        overrides: rows.map((r) => ({
          user_id: r.user_id,
          bonus: r.breakdown.bonus,
          loanRepayment: r.breakdown.loanRepayment,
          monthlyBase: r.breakdown.monthlyBase,
          communicationConfig: r.breakdown.communication,
        })),
      }

      const res = await apiFetch("/api/admin/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save payroll run")

      toast.success(lockPeriod ? "Payroll period locked successfully!" : "Payroll draft saved successfully")
      if (lockPeriod) {
        setStatus("completed")
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save payroll")
    } finally {
      setSaving(false)
    }
  }

  // Export to CSV spreadsheet
  const handleExport = () => {
    const headers = [
      "S/N",
      "Employee Name",
      "Employee Number",
      "Monthly Base Salary (₦)",
      "Daily Rate (₦)",
      "Lateness Hours",
      "Lateness Surcharge (₦)",
      "Absent Days",
      "Absent Surcharge (₦)",
      "Unpaid Leave Days",
      "Unpaid Leave Deduction (₦)",
      "Lunch Deductions (₦)",
      "Loan Repayments (₦)",
      "Bonuses / Allowances (₦)",
      "Employee Pension (₦)",
      "PAYE Tax (₦)",
      "Gross Cash Pay (₦)",
      "Total Deductions (₦)",
      "Net Pay (₦)",
    ]

    const csvRows = [headers.join(",")]
    rows.forEach((r, idx) => {
      const b = r.breakdown
      const line = [
        idx + 1,
        `"${r.full_name}"`,
        r.employee_number,
        b.monthlyBase.toFixed(2),
        b.dailyPay.toFixed(2),
        b.missedHours,
        b.latenessSurcharge.toFixed(2),
        b.absentDays,
        b.absentSurcharge.toFixed(2),
        b.unpaidLeaveDays,
        b.unpaidLeaveDeduction.toFixed(2),
        b.lunchDeduction.toFixed(2),
        b.loanRepayment.toFixed(2),
        b.bonus.toFixed(2),
        b.monthlyPensionEmployee.toFixed(2),
        b.monthlyTax.toFixed(2),
        b.monthlyGross.toFixed(2),
        b.totalDeductions.toFixed(2),
        b.netPay.toFixed(2),
      ]
      csvRows.push(line.join(","))
    })

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `payroll_${period.name.replace(/\s+/g, "_")}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Compute stats totals
  const totalGross = rows.reduce((acc, r) => acc + r.breakdown.monthlyGross + r.breakdown.bonus, 0)
  const totalNet = rows.reduce((acc, r) => acc + r.breakdown.netPay, 0)
  const totalTax = rows.reduce((acc, r) => acc + r.breakdown.monthlyTax, 0)
  const totalDeductions = rows.reduce((acc, r) => acc + r.breakdown.totalDeductions, 0)

  const stats = (
    <div className="grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-4">
      <StatCard
        title="Cumulative Gross Pay"
        value={`₦${totalGross.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        icon={DollarSign}
        iconBgColor="bg-purple-500/10"
        iconColor="text-purple-500"
      />
      <StatCard
        title="Cumulative Net Disbursement"
        value={`₦${totalNet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        icon={DollarSign}
        iconBgColor="bg-emerald-500/10"
        iconColor="text-emerald-500"
      />
      <StatCard
        title="Total PAYE Tax Collected"
        value={`₦${totalTax.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        icon={FileText}
        iconBgColor="bg-blue-500/10"
        iconColor="text-blue-500"
      />
      <StatCard
        title="Total Deductions Applied"
        value={`₦${totalDeductions.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        icon={Clock}
        iconBgColor="bg-red-500/10"
        iconColor="text-red-500"
      />
    </div>
  )

  const periodOptions = initialData.periodOptions ?? []
  const isLocked = status === "completed"
  const money = (value: number) =>
    `₦${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const columns: DataTableColumn<PayrollRow>[] = [
    {
      key: "full_name",
      label: "Employee Name",
      sortable: true,
      accessor: (r) => formatEmployeeName(r),
      render: (r) => <span className="text-xs font-medium sm:text-sm">{formatEmployeeName(r)}</span>,
    },
    {
      key: "employee_number",
      label: "Code",
      accessor: (r) => r.employee_number,
      render: (r) => <span className="font-mono text-xs">{r.employee_number || "—"}</span>,
      hideOnMobile: true,
    },
    {
      key: "monthlyGross",
      label: "Gross Salary",
      align: "right",
      accessor: (r) => r.breakdown.monthlyGross,
      render: (r) => (
        <Input
          type="number"
          className="h-8 w-full min-w-[100px] text-right text-xs font-medium"
          disabled={isLocked}
          value={r.breakdown.monthlyGross.toFixed(2)}
          onChange={(e) => handleValChange(r.user_id, "monthlyGross", e.target.value)}
        />
      ),
    },
    {
      key: "monthlyCommunication",
      label: "Comm. Allowance",
      align: "right",
      accessor: (r) => r.breakdown.monthlyCommunication,
      render: (r) => (
        <Input
          type="number"
          className="bg-muted/20 border-muted h-8 w-full min-w-[90px] text-right text-xs"
          disabled={isLocked}
          value={r.breakdown.monthlyCommunication.toFixed(2)}
          onChange={(e) => handleValChange(r.user_id, "communication", e.target.value)}
        />
      ),
    },
    {
      key: "monthlyBase",
      label: "Base Salary",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.monthlyBase,
      render: (r) => <span className="text-muted-foreground text-xs">{money(r.breakdown.monthlyBase)}</span>,
    },
    {
      key: "lunchDeduction",
      label: "Lunch Deduction",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.lunchDeduction,
      render: (r) => <span className="text-muted-foreground text-xs">{money(r.breakdown.lunchDeduction)}</span>,
      hideOnMobile: true,
    },
    {
      key: "monthlyPensionEmployee",
      label: "EE Pension",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.monthlyPensionEmployee,
      render: (r) => <span className="text-muted-foreground text-xs">{money(r.breakdown.monthlyPensionEmployee)}</span>,
      hideOnMobile: true,
    },
    {
      key: "monthlyTax",
      label: "PAYE Tax",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.monthlyTax,
      render: (r) => <span className="text-muted-foreground text-xs">{money(r.breakdown.monthlyTax)}</span>,
      hideOnMobile: true,
    },
    {
      key: "netPay",
      label: "Net Pay",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.netPay,
      render: (r) => <span className="text-xs font-semibold text-emerald-600">{money(r.breakdown.netPay)}</span>,
    },
    {
      key: "payslip",
      label: "Payslip",
      align: "center",
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewRow(r)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {status === "completed" &&
            (r.payslip_emailed_at ? (
              <MailCheck className="h-3.5 w-3.5 text-emerald-500" aria-label="Payslip emailed" />
            ) : (
              <Mail className="text-muted-foreground/30 h-3.5 w-3.5" aria-label="Payslip not yet emailed" />
            ))}
        </div>
      ),
    },
  ]

  // Attendance-derived charges and the two per-run cash overrides — detail an
  // admin checks occasionally, not every row every time, so they live behind
  // the row's expand chevron instead of crowding the main worksheet.
  const renderExpandedRow = (r: PayrollRow) => {
    const b = r.breakdown
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-muted-foreground mb-1">Lateness</div>
          <div className="font-mono">
            {b.missedHours}h · <span className="text-red-600">{money(b.latenessSurcharge)}</span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">Absences</div>
          <div className="font-mono">
            {b.absentDays}d · <span className="text-red-600">{money(b.absentSurcharge)}</span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">Unpaid Leave</div>
          <div className="font-mono">
            {b.unpaidLeaveDays}d · <span className="text-red-600">{money(b.unpaidLeaveDeduction)}</span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-1">Gross incl. Bonus</div>
          <div className="font-mono font-medium">{money(b.monthlyGross + b.bonus)}</div>
        </div>
        <div>
          <label className="text-muted-foreground mb-1 block">Loan Repayment</label>
          <Input
            type="number"
            className="bg-muted/20 border-muted h-8 w-full max-w-[150px] text-xs"
            disabled={isLocked}
            value={b.loanRepayment || ""}
            placeholder="0.00"
            onChange={(e) => handleValChange(r.user_id, "loanRepayment", e.target.value)}
          />
        </div>
        <div>
          <label className="text-muted-foreground mb-1 block">Bonus / Allowance</label>
          <Input
            type="number"
            className="h-8 w-full max-w-[150px] border-emerald-500/20 bg-emerald-500/5 text-xs font-medium text-emerald-600"
            disabled={isLocked}
            value={b.bonus || ""}
            placeholder="0.00"
            onChange={(e) => handleValChange(r.user_id, "bonus", e.target.value)}
          />
        </div>
      </div>
    )
  }

  const worksheetFilters: DataTableFilter<PayrollRow>[] = [
    {
      key: "period",
      label: "Month",
      placeholder: "Select Month",
      options: periodOptions.map((p) => ({ value: p.id, label: p.name })),
      multi: false,
      defaultValues: [period.id],
      mode: "custom",
      filterFn: () => true, // navigation-only — see onFilterChange below
    },
    {
      key: "deduction_state",
      label: "Flags",
      placeholder: "All Employees",
      mode: "custom",
      options: [
        { value: "absent", label: "Has absences" },
        { value: "late", label: "Has lateness" },
        { value: "unpaid", label: "Has unpaid leave" },
        { value: "clean", label: "No deductions" },
      ],
      filterFn: (r, values) => {
        if (values.length === 0) return true
        const b = r.breakdown
        return values.some((v) => {
          if (v === "absent") return b.absentDays > 0
          if (v === "late") return b.missedHours > 0
          if (v === "unpaid") return b.unpaidLeaveDays > 0
          if (v === "clean") return b.absentDays === 0 && b.missedHours === 0 && b.unpaidLeaveDays === 0
          return false
        })
      },
    },
  ]

  const unsentCount = rows.filter((r) => !r.payslip_emailed_at).length

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleExport} disabled={isLoading}>
        <Download className="mr-1.5 h-4 w-4" /> Export CSV
      </Button>
      {initialData.isAdmin && <ManageGrossSalaryDialog />}
      {status === "draft" && initialData.isAdmin && (
        <>
          <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving || isLoading}>
            <Save className="mr-1.5 h-4 w-4" /> Save Draft
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => handleSave(true)}
            disabled={saving || isLoading}
          >
            <Lock className="mr-1.5 h-4 w-4" /> Lock & Approve
          </Button>
        </>
      )}
      {status === "completed" && initialData.isAdmin && (
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={() => setBulkConfirmOpen(true)}
          disabled={isLoading || unsentCount === 0}
        >
          <Send className="mr-1.5 h-4 w-4" />
          {unsentCount === 0 ? "All Payslips Emailed" : `Email Payslips (${unsentCount})`}
        </Button>
      )}
    </div>
  )

  // Payslip print fields for the currently viewed row
  const vb = viewRow?.breakdown

  return (
    <DataTablePage
      title={`Worksheet: ${period.name}`}
      description={`Disbursement schedule for payroll cycle from ${period.start_date} to ${period.end_date}.`}
      icon={FileText}
      backLink={{ href: "/admin/payroll", label: "Back to Payroll List" }}
      stats={stats}
      actions={actions}
    >
      <DataTable<PayrollRow>
        data={rows}
        columns={columns}
        getRowId={(row) => row.user_id}
        isLoading={isLoading}
        skeletonRows={6}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search by employee name or staff number..."
        searchFn={(row, q) => `${formatEmployeeName(row)} ${row.employee_number || ""}`.toLowerCase().includes(q)}
        filters={worksheetFilters}
        expandable={{ render: renderExpandedRow }}
        onFilterChange={(selected) => {
          // The period filter navigates rather than filtering — each period is its own
          // worksheet route. Mirrors the attendance report's month filter.
          const nextPeriod = selected.period?.[0]
          if (nextPeriod && nextPeriod !== period.id) router.push(`/admin/payroll/${nextPeriod}`)
        }}
        emptyIcon={FileText}
        emptyTitle="No employees to calculate"
        emptyDescription="No active employees were found for this payroll period."
      />

      {/* Printable Payslip Viewer */}
      <Dialog open={viewRow !== null} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader className="print:hidden">
            <DialogTitle>View Payslip</DialogTitle>
            <DialogDescription>
              Print or review the details of the employee&apos;s monthly salary breakdown.
            </DialogDescription>
          </DialogHeader>

          {viewRow && vb && (
            <div
              id="payslip-print-area"
              className="space-y-4 rounded-lg border bg-white p-5 text-sm text-gray-800 shadow-sm dark:bg-white dark:text-gray-800"
            >
              {/* Header: Logo + Company Info + Payslip Label */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-3">
                <div>
                  <Image
                    src="/images/exports/acob-lighting-full.png"
                    alt="ACOB Lighting Technology Limited"
                    width={200}
                    height={56}
                    className="object-contain"
                    unoptimized
                  />
                  <p className="mt-1.5 text-[10px] text-gray-500">
                    Plot 2. Block 14 Extension, Federal Ministry of Works And Housing Sites and Services Scheme, Setraco
                    Gate, Gwarinpa, FCT, Nigeria.
                  </p>
                  <p className="text-[10px] text-gray-500">
                    Email: info@acoblighting.com &nbsp;|&nbsp; Web: www.acoblighting.com
                  </p>
                </div>
                <div className="min-w-[130px] text-right">
                  <p className="text-xs font-bold text-emerald-700 uppercase">Payslip</p>
                  <p className="text-[10px] text-gray-500">
                    Period: <span className="font-semibold whitespace-nowrap text-gray-700">{period.name}</span>
                  </p>
                  <p className="text-[10px] text-gray-500">
                    Pay Date: <span className="font-semibold whitespace-nowrap text-gray-700">{period.pay_date}</span>
                  </p>
                  <p
                    className="mt-1 text-[10px] font-bold uppercase"
                    style={{ color: status === "completed" ? "#059669" : "#d97706" }}
                  >
                    ● {status === "completed" ? "Paid" : "Draft"}
                  </p>
                </div>
              </div>

              {/* Employee Info */}
              <div className="grid grid-cols-2 gap-3 rounded border border-gray-100 bg-gray-50 px-4 py-2.5 text-[11px]">
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Employee Name</p>
                  <p className="font-semibold text-gray-800">{viewRow.full_name}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Staff ID</p>
                  <p className="font-mono font-semibold text-gray-800">{viewRow.employee_number}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Department</p>
                  <p className="font-semibold text-gray-800">{viewRow.department || "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Designation</p>
                  <p className="font-semibold text-gray-800">{viewRow.designation || "—"}</p>
                </div>
              </div>

              {/* Earnings & Deductions */}
              <div className="grid grid-cols-1 gap-4 text-[11px] sm:grid-cols-2">
                <div>
                  <h3 className="mb-1.5 border-b border-emerald-200 pb-1 text-[9px] font-bold tracking-widest text-emerald-700 uppercase">
                    Earnings
                  </h3>
                  <table className="w-full">
                    <tbody>
                      {[
                        ["Basic Salary", vb.monthlyBasic],
                        ["Housing Allowance", vb.monthlyHousing],
                        ["Transport Allowance", vb.monthlyTransport],
                        ["Leave Allowance", vb.monthlyLeave],
                        ["Communication Allowance", vb.monthlyCommunication],
                        ...(vb.bonus > 0 ? [["Bonus / Refund", vb.bonus]] : []),
                      ].map(([label, val]) => (
                        <tr key={String(label)} className="border-b border-gray-50">
                          <td className="py-1 text-gray-600">{label}</td>
                          <td className="py-1 text-right font-medium text-gray-800">
                            ₦
                            {Number(val).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200">
                        <td className="pt-1.5 font-bold text-gray-900">Gross Cash Pay</td>
                        <td className="pt-1.5 text-right font-bold text-gray-900">
                          ₦
                          {(vb.monthlyGross + vb.bonus).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3 className="mb-1.5 border-b border-red-200 pb-1 text-[9px] font-bold tracking-widest text-red-600 uppercase">
                    Deductions
                  </h3>
                  <table className="w-full">
                    <tbody>
                      {(() => {
                        const rows: [string, number][] = [
                          ["Pension (Employee)", vb.monthlyPensionEmployee],
                          ["PAYE Tax", vb.monthlyTax],
                        ]
                        if (vb.unpaidLeaveDeduction > 0)
                          rows.push([`Unpaid Leave (${vb.unpaidLeaveDays}d)`, vb.unpaidLeaveDeduction])
                        if (vb.lunchDeduction > 0) rows.push(["Lunch Deduction", vb.lunchDeduction])
                        if (vb.loanRepayment > 0) rows.push(["Loan Repayment", vb.loanRepayment])
                        if (vb.latenessSurcharge + vb.absentSurcharge > 0)
                          rows.push(["Lateness/Absence Surcharge", vb.latenessSurcharge + vb.absentSurcharge])
                        return rows.map(([label, val]) => (
                          <tr key={label} className="border-b border-gray-50">
                            <td className="py-1 text-gray-600">{label}</td>
                            <td className="py-1 text-right font-medium text-red-600">
                              ₦
                              {Number(val).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        ))
                      })()}
                      <tr className="border-t border-gray-200">
                        <td className="pt-1.5 font-bold text-gray-900">Total Deductions</td>
                        <td className="pt-1.5 text-right font-bold text-red-600">
                          ₦
                          {vb.totalDeductions.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Net Pay Banner */}
              <div className="flex items-center justify-between rounded-lg bg-emerald-600 px-5 py-3 text-white">
                <span className="text-xs font-bold tracking-widest uppercase">Net Pay (Take Home)</span>
                <span className="text-lg font-extrabold">
                  ₦{vb.netPay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* Signature Lines */}
              <div className="flex items-end justify-between pt-6 text-[10px] text-gray-400">
                <div className="w-36 border-t border-gray-300 pt-1 text-center">Employee Signature</div>
                <div className="text-center text-[9px] text-gray-300">
                  This payslip is computer-generated and valid without a signature.
                </div>
                <div className="w-36 border-t border-gray-300 pt-1 text-center">Authorised Signatory</div>
              </div>
            </div>
          )}

          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setViewRow(null)}>
              Close
            </Button>
            <Button variant="outline" onClick={() => setEmailTarget(viewRow)} disabled={!viewRow || !vb}>
              <Mail className="mr-1.5 h-4 w-4" /> Email Payslip
            </Button>
            <Button
              className="bg-primary text-primary-foreground"
              onClick={() => {
                if (!viewRow || !vb) return
                printPayslip(payslipFromBreakdown(vb, payslipMeta(viewRow)))
              }}
            >
              <Printer className="mr-1.5 h-4 w-4" /> Print Payslip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email confirmation — states the exact recipient before anything is sent */}
      <Dialog open={emailTarget !== null} onOpenChange={(o) => !o && !emailSending && setEmailTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email this payslip?</DialogTitle>
            <DialogDescription>
              The payslip is attached as a PDF. The email body carries no salary figures.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="bg-muted/50 space-y-1.5 rounded-md border p-3">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Recipient</span>
                <span className="font-medium break-all">{emailTarget?.company_email || "—"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Employee</span>
                <span className="font-medium">{emailTarget?.full_name}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">{period.name}</span>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={protectPdf}
                onCheckedChange={(checked) => setProtectPdf(checked === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Password-protect the PDF</span>
                <span className="text-muted-foreground block text-xs">
                  The attachment opens with the employee&apos;s staff ID ({emailTarget?.employee_number || "—"}).
                </span>
              </span>
            </label>

            {status !== "completed" && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This period is still a draft, so the payslip will be marked <strong>DRAFT</strong>. Figures are
                recomputed at send time; unsaved bonus or loan edits in the table are not included.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTarget(null)} disabled={emailSending}>
              Cancel
            </Button>
            <Button onClick={handleEmailPayslip} disabled={emailSending}>
              {emailSending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Mail className="mr-1.5 h-4 w-4" /> Send Payslip
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk email confirmation — states the exact headcount before any mail goes out */}
      <Dialog open={bulkConfirmOpen} onOpenChange={(o) => !o && !bulkSending && setBulkConfirmOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email all payslips for {period.name}?</DialogTitle>
            <DialogDescription>
              Sends one email per employee, each with their own password-protectable PDF. Anyone already emailed is
              skipped automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="bg-muted/50 space-y-1.5 rounded-md border p-3">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Already emailed</span>
                <span className="font-medium">{rows.length - unsentCount}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Will be emailed now</span>
                <span className="font-medium">{unsentCount}</span>
              </div>
            </div>

            {!bulkSending && (
              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={protectPdf}
                  onCheckedChange={(checked) => setProtectPdf(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Password-protect each PDF</span>
                  <span className="text-muted-foreground block text-xs">
                    Each attachment opens with that employee&apos;s own staff ID.
                  </span>
                </span>
              </label>
            )}

            {bulkSending && (
              <div className="space-y-1.5">
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{
                      width: `${bulkProgress.total > 0 ? ((bulkProgress.sent + bulkProgress.failed) / bulkProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  Sent {bulkProgress.sent} of {bulkProgress.total}
                  {bulkProgress.failed > 0 ? ` — ${bulkProgress.failed} failed` : ""}. Keep this open until it finishes.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkConfirmOpen(false)} disabled={bulkSending}>
              Cancel
            </Button>
            <Button onClick={handleBulkSend} disabled={bulkSending} className="bg-emerald-600 hover:bg-emerald-700">
              {bulkSending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-4 w-4" /> Send {unsentCount} Payslip{unsentCount === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
