"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { DataTablePage } from "@/components/ui/data-table"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { calculatePayroll, type PayrollBreakdown } from "@/lib/hr/payroll-utils"
import { FileText, Save, Lock, Download, DollarSign, Clock, Eye, Printer } from "lucide-react"
import { toast } from "sonner"

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
        const res = await fetch(`/api/admin/hr/payroll/run?payroll_period_id=${period.id}`)
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

      const res = await fetch("/api/admin/hr/payroll/run", {
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
      backLink={{ href: "/admin/hr/payroll", label: "Back to Payroll List" }}
      stats={stats}
      actions={actions}
    >
      <div className="bg-background rounded-md border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/80">
              <TableRow>
                <TableHead className="w-[50px] text-center">S/N</TableHead>
                <TableHead className="min-w-[150px]">Employee Name</TableHead>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead className="w-[120px] text-right">Base Salary</TableHead>
                <TableHead className="w-[80px] text-center">Late (h)</TableHead>
                <TableHead className="w-[120px] text-right">Late Surcharge</TableHead>
                <TableHead className="w-[80px] text-center">Absent (d)</TableHead>
                <TableHead className="w-[120px] text-right">Absent Surcharge</TableHead>
                <TableHead className="w-[120px] text-right">Lunch Deduction</TableHead>
                <TableHead className="w-[120px] text-right">Loan Repay</TableHead>
                <TableHead className="w-[120px] text-right">Bonus / Allow</TableHead>
                <TableHead className="w-[110px] text-right">EE Pension</TableHead>
                <TableHead className="w-[110px] text-right">PAYE Tax</TableHead>
                <TableHead className="w-[130px] text-right">Gross Cash Pay</TableHead>
                <TableHead className="w-[130px] text-right font-semibold">Net Pay</TableHead>
                <TableHead className="w-[60px] text-center">Payslip</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                // Shimmer Skeleton
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 16 }).map((_, j) => (
                      <TableCell key={j} className="h-12 text-center">
                        <div className="bg-muted/80 mx-auto h-4 w-12 animate-pulse rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="text-muted-foreground py-8 text-center">
                    No active employees found to calculate payroll.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => {
                  const b = row.breakdown
                  const isLocked = status === "completed"
                  return (
                    <TableRow key={row.user_id} className="hover:bg-muted/10">
                      <TableCell className="text-muted-foreground text-center text-xs">{idx + 1}</TableCell>
                      <TableCell className="text-xs font-medium sm:text-sm">{row.full_name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.employee_number || "—"}</TableCell>
                      <TableCell className="text-right text-xs">
                        ₦{b.monthlyBase.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">{b.missedHours}</TableCell>
                      <TableCell className="text-right text-xs text-red-600">
                        ₦{b.latenessSurcharge.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">{b.absentDays}</TableCell>
                      <TableCell className="text-right text-xs text-red-600">
                        ₦{b.absentSurcharge.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>

                      {/* Lunch Deduction — auto from the daily lunch register, not editable here */}
                      <TableCell className="text-muted-foreground text-right text-xs">
                        ₦{b.lunchDeduction.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>

                      {/* Loan Repayment (Editable inline) */}
                      <TableCell className="p-1">
                        <Input
                          type="number"
                          className="bg-muted/20 border-muted h-8 w-full text-right text-xs"
                          disabled={isLocked}
                          value={b.loanRepayment || ""}
                          placeholder="0.00"
                          onChange={(e) => handleValChange(row.user_id, "loanRepayment", e.target.value)}
                        />
                      </TableCell>

                      {/* Bonus (Editable inline) */}
                      <TableCell className="p-1">
                        <Input
                          type="number"
                          className="h-8 w-full border-emerald-500/20 bg-emerald-500/5 text-right text-xs font-medium text-emerald-600"
                          disabled={isLocked}
                          value={b.bonus || ""}
                          placeholder="0.00"
                          onChange={(e) => handleValChange(row.user_id, "bonus", e.target.value)}
                        />
                      </TableCell>

                      <TableCell className="text-muted-foreground text-right text-xs">
                        ₦{b.monthlyPensionEmployee.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs">
                        ₦{b.monthlyTax.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">
                        ₦{(b.monthlyGross + b.bonus).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold text-emerald-600">
                        ₦{b.netPay.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewRow(row)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

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
