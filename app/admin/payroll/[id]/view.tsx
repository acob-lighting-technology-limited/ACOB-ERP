"use client"

import { useEffect, useState } from "react"
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
import { FileText, Save, Lock, Download, DollarSign, Clock, Eye, Printer } from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

export interface PayrollRow {
  user_id: string
  full_name: string
  employee_number: string
  company_email: string
  breakdown: PayrollBreakdown
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

  // Recalculates inline modifications locally on the client for instant updates
  const handleValChange = (userId: string, field: "bonus" | "loanRepayment", valStr: string) => {
    if (status === "completed") return // Locked

    const num = parseFloat(valStr) || 0
    setRows(
      rows.map((row) => {
        if (row.user_id !== userId) return row

        const currentBreakdown = row.breakdown
        const nextBreakdown = calculatePayroll({
          monthlyBase: currentBreakdown.monthlyBase,
          workdays: currentBreakdown.workdays,
          missedHours: currentBreakdown.missedHours,
          absentDays: currentBreakdown.absentDays,
          unpaidLeaveDays: currentBreakdown.unpaidLeaveDays,
          bonus: field === "bonus" ? num : currentBreakdown.bonus,
          loanRepayment: field === "loanRepayment" ? num : currentBreakdown.loanRepayment,
          lunchDeduction: currentBreakdown.lunchDeduction,
        })

        return {
          ...row,
          breakdown: nextBreakdown,
        }
      })
    )
  }

  // Save the payroll (draft or final lock). Only bonus/loan overrides are sent —
  // the server recomputes everything else from attendance and salary records.
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
  const totalNet = rows.reduce((acc, r) => acc + r.breakdown.netPay, 0)
  const totalTax = rows.reduce((acc, r) => acc + r.breakdown.monthlyTax, 0)
  const totalDeductions = rows.reduce((acc, r) => acc + r.breakdown.totalDeductions, 0)

  const stats = (
    <div className="grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-3">
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
  const money = (value: number) => `₦${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`

  const columns: DataTableColumn<PayrollRow>[] = [
    {
      key: "full_name",
      label: "Employee Name",
      sortable: true,
      accessor: (r) => r.full_name,
      render: (r) => <span className="text-xs font-medium sm:text-sm">{r.full_name}</span>,
    },
    {
      key: "employee_number",
      label: "Code",
      accessor: (r) => r.employee_number,
      render: (r) => <span className="font-mono text-xs">{r.employee_number || "—"}</span>,
      hideOnMobile: true,
    },
    {
      key: "monthlyBase",
      label: "Base Salary",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.monthlyBase,
      render: (r) => <span className="text-xs">{money(r.breakdown.monthlyBase)}</span>,
    },
    {
      key: "missedHours",
      label: "Late (h)",
      align: "center",
      sortable: true,
      accessor: (r) => r.breakdown.missedHours,
      render: (r) => <span className="font-mono text-xs">{r.breakdown.missedHours}</span>,
    },
    {
      key: "latenessSurcharge",
      label: "Late Surcharge",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.latenessSurcharge,
      render: (r) => <span className="text-xs text-red-600">{money(r.breakdown.latenessSurcharge)}</span>,
    },
    {
      key: "absentDays",
      label: "Absent (d)",
      align: "center",
      sortable: true,
      accessor: (r) => r.breakdown.absentDays,
      render: (r) => <span className="font-mono text-xs">{r.breakdown.absentDays}</span>,
    },
    {
      key: "absentSurcharge",
      label: "Absent Surcharge",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.absentSurcharge,
      render: (r) => <span className="text-xs text-red-600">{money(r.breakdown.absentSurcharge)}</span>,
    },
    {
      key: "unpaidLeaveDays",
      label: "Unpaid (d)",
      align: "center",
      sortable: true,
      accessor: (r) => r.breakdown.unpaidLeaveDays,
      render: (r) => <span className="font-mono text-xs">{r.breakdown.unpaidLeaveDays}</span>,
    },
    {
      key: "unpaidLeaveDeduction",
      label: "Unpaid Leave",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.unpaidLeaveDeduction,
      render: (r) => <span className="text-xs text-red-600">{money(r.breakdown.unpaidLeaveDeduction)}</span>,
    },
    {
      key: "lunchDeduction",
      label: "Lunch Deduction",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.lunchDeduction,
      render: (r) => <span className="text-muted-foreground text-xs">{money(r.breakdown.lunchDeduction)}</span>,
    },
    {
      key: "loanRepayment",
      label: "Loan Repay",
      align: "right",
      accessor: (r) => r.breakdown.loanRepayment,
      render: (r) => (
        <Input
          type="number"
          className="bg-muted/20 border-muted h-8 w-full min-w-[90px] text-right text-xs"
          disabled={isLocked}
          value={r.breakdown.loanRepayment || ""}
          placeholder="0.00"
          onChange={(e) => handleValChange(r.user_id, "loanRepayment", e.target.value)}
        />
      ),
    },
    {
      key: "bonus",
      label: "Bonus / Allow",
      align: "right",
      accessor: (r) => r.breakdown.bonus,
      render: (r) => (
        <Input
          type="number"
          className="h-8 w-full min-w-[90px] border-emerald-500/20 bg-emerald-500/5 text-right text-xs font-medium text-emerald-600"
          disabled={isLocked}
          value={r.breakdown.bonus || ""}
          placeholder="0.00"
          onChange={(e) => handleValChange(r.user_id, "bonus", e.target.value)}
        />
      ),
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
      key: "grossCashPay",
      label: "Gross Cash Pay",
      align: "right",
      sortable: true,
      accessor: (r) => r.breakdown.monthlyGross + r.breakdown.bonus,
      render: (r) => <span className="text-xs font-medium">{money(r.breakdown.monthlyGross + r.breakdown.bonus)}</span>,
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
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewRow(r)}>
          <Eye className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ]

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

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleExport} disabled={isLoading}>
        <Download className="mr-1.5 h-4 w-4" /> Export CSV
      </Button>
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
        searchFn={(row, q) => `${row.full_name} ${row.employee_number || ""}`.toLowerCase().includes(q)}
        filters={worksheetFilters}
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
            <div id="payslip-print-area" className="bg-card space-y-6 rounded-xl border p-5 text-sm shadow-sm">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <h2 className="text-foreground text-base font-bold tracking-wider uppercase">
                    ACOB LIGHTING TECHNOLOGY LIMITED
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    Plot 1205, Off Aminu Kano Crescent, Wuse II, Abuja, Nigeria
                  </p>
                  <p className="text-primary mt-2 font-semibold">PAYSLIP FOR {period.name.toUpperCase()}</p>
                </div>
                <div className="text-muted-foreground text-right text-xs">
                  <p>Pay Date: {period.pay_date}</p>
                  <p>
                    Status:{" "}
                    <span className="font-semibold text-emerald-600 uppercase">
                      {status === "completed" ? "Paid" : "Draft"}
                    </span>
                  </p>
                </div>
              </div>

              <div className="bg-muted/40 grid grid-cols-2 gap-4 rounded-lg border p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Employee Name:</p>
                  <p className="text-sm font-semibold">{viewRow.full_name}</p>
                  <p className="text-muted-foreground mt-2">Staff Code:</p>
                  <p className="font-mono">{viewRow.employee_number}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 text-xs md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="border-b pb-1 text-[10px] font-bold tracking-wider text-emerald-600 uppercase">
                    Earnings
                  </h3>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span>Basic Salary:</span>
                      <span>₦{vb.monthlyBasic.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Housing Allowance:</span>
                      <span>₦{vb.monthlyHousing.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Transport Allowance:</span>
                      <span>₦{vb.monthlyTransport.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Leave Allowance:</span>
                      <span>₦{vb.monthlyLeave.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Communication Allowance:</span>
                      <span>₦{vb.monthlyCommunication.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    {vb.bonus > 0 && (
                      <div className="flex justify-between font-medium text-emerald-600">
                        <span>Bonus / Refund:</span>
                        <span>₦{vb.bonus.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1.5 font-bold">
                      <span>Gross Cash Pay:</span>
                      <span>₦{(vb.monthlyGross + vb.bonus).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="border-b pb-1 text-[10px] font-bold tracking-wider text-red-600 uppercase">
                    Deductions
                  </h3>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span>Pension (Employee):</span>
                      <span>₦{vb.monthlyPensionEmployee.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>PAYE Tax:</span>
                      <span>₦{vb.monthlyTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                    {vb.unpaidLeaveDeduction > 0 && (
                      <div className="flex justify-between">
                        <span>
                          Unpaid Leave ({vb.unpaidLeaveDays} day{vb.unpaidLeaveDays === 1 ? "" : "s"}):
                        </span>
                        <span>₦{vb.unpaidLeaveDeduction.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {vb.lunchDeduction > 0 && (
                      <div className="flex justify-between">
                        <span>Lunch Deduction:</span>
                        <span>₦{vb.lunchDeduction.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {vb.loanRepayment > 0 && (
                      <div className="flex justify-between">
                        <span>Loan Repayment:</span>
                        <span>₦{vb.loanRepayment.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {(vb.latenessSurcharge > 0 || vb.absentSurcharge > 0) && (
                      <div className="flex justify-between font-medium text-red-600">
                        <span>Lateness/Absence Surcharge:</span>
                        <span>
                          ₦
                          {(vb.latenessSurcharge + vb.absentSurcharge).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1.5 font-bold">
                      <span>Total Deductions:</span>
                      <span>₦{vb.totalDeductions.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t-2 border-dashed pt-4">
                <span className="text-sm font-bold tracking-wide uppercase">Net Take Home Pay:</span>
                <span className="text-base font-extrabold text-emerald-600">
                  ₦{vb.netPay.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setViewRow(null)}>
              Close
            </Button>
            <Button className="bg-primary text-primary-foreground" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print Payslip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
