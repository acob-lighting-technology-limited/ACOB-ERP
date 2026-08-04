"use client"

import { useState } from "react"
import { DataTablePage, DataTable } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileText, Eye, Printer, DollarSign, Calendar } from "lucide-react"
import type { UserPayrollEntry } from "./page"

interface UserPayrollPageProps {
  initialData: {
    profile: {
      id: string
      full_name: string
      employee_number: string
      department: string | null
      designation: string | null
    } | null
    entries: UserPayrollEntry[]
  }
}

export function UserPayrollPage({ initialData }: UserPayrollPageProps) {
  const { profile, entries } = initialData
  const [selectedEntry, setSelectedEntry] = useState<UserPayrollEntry | null>(null)

  const columns = [
    {
      key: "period_name",
      label: "Period Name",
      accessor: (e: UserPayrollEntry) => e.payroll_periods?.name || "—",
      sortable: true,
      render: (e: UserPayrollEntry) => (
        <span className="text-foreground font-semibold">{e.payroll_periods?.name || "—"}</span>
      ),
    },
    {
      key: "pay_date",
      label: "Pay Date",
      accessor: (e: UserPayrollEntry) => e.payroll_periods?.pay_date || "—",
    },
    {
      key: "gross_salary",
      label: "Gross Cash Pay",
      render: (e: UserPayrollEntry) => (
        <span>₦{(Number(e.gross_salary) + Number(e.bonus)).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
      ),
    },
    {
      key: "total_deductions",
      label: "Total Deductions",
      render: (e: UserPayrollEntry) => (
        <span className="text-red-600">
          -₦{Number(e.total_deductions).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "net_salary",
      label: "Net Pay",
      render: (e: UserPayrollEntry) => (
        <span className="font-semibold text-emerald-600">
          ₦{Number(e.net_salary).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (e: UserPayrollEntry) => (
        <Button size="sm" variant="outline" onClick={() => setSelectedEntry(e)}>
          <Eye className="mr-1.5 h-4 w-4" /> View Payslip
        </Button>
      ),
    },
  ]

  // Calculate statistics
  const latestNet = entries[0]?.net_salary || 0
  const ytdNet = entries.reduce((acc, e) => acc + Number(e.net_salary), 0)
  const payslipsCount = entries.length

  const stats = (
    <div className="grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-3">
      <StatCard
        title="Latest Net Pay"
        value={latestNet ? `₦${latestNet.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "₦0.00"}
        icon={DollarSign}
        iconBgColor="bg-emerald-500/10"
        iconColor="text-emerald-500"
      />
      <StatCard
        title="Year-to-Date (YTD) Net"
        value={`₦${ytdNet.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
        icon={DollarSign}
        iconBgColor="bg-blue-500/10"
        iconColor="text-blue-500"
      />
      <StatCard
        title="Available Payslips"
        value={payslipsCount}
        icon={Calendar}
        iconBgColor="bg-amber-500/10"
        iconColor="text-amber-500"
      />
    </div>
  )

  const handlePrint = () => {
    window.print()
  }

  // Render from the immutable breakdown snapshot captured at publish time.
  // Older rows published before the snapshot existed fall back to a best-effort
  // reconstruction from the stored aggregates.
  const vb =
    selectedEntry?.breakdown && selectedEntry.breakdown.monthlyBasic !== undefined ? selectedEntry.breakdown : null
  const base = selectedEntry ? Number(selectedEntry.basic_salary) : 0
  const basic = vb ? vb.monthlyBasic : base * 0.5
  const housing = vb ? vb.monthlyHousing : base * 0.3
  const transport = vb ? vb.monthlyTransport : base * 0.1
  const leave = vb ? vb.monthlyLeave : base * 0.1
  const comms = vb ? vb.monthlyCommunication : 5000
  const bonus = selectedEntry ? Number(selectedEntry.bonus) : 0
  const pensionEE = vb ? vb.monthlyPensionEmployee : base * 0.04
  const tax = selectedEntry ? Number(selectedEntry.tax_amount) : 0
  const lunch = selectedEntry ? Number(selectedEntry.lunch_deduction) : 0
  const loan = selectedEntry ? Number(selectedEntry.loan_repayment) : 0

  const latenessSurcharge = vb
    ? vb.latenessSurcharge + vb.absentSurcharge
    : selectedEntry
      ? Math.max(0, Number(selectedEntry.total_deductions) - pensionEE - tax - lunch - loan)
      : 0

  return (
    <DataTablePage
      title="My Payroll & Payslips"
      description="View and print your monthly payslips, tax assessments, and pension contributions."
      icon={FileText}
    >
      {stats}

      <div className="mt-6">
        <DataTable
          data={entries}
          columns={columns}
          getRowId={(e) => e.id}
          searchPlaceholder="Search by period name..."
          searchFn={(row, q) => (row.payroll_periods?.name || "").toLowerCase().includes(q.toLowerCase())}
          filters={[]}
          isLoading={false}
        />
      </div>

      <Dialog open={selectedEntry !== null} onOpenChange={(o) => !o && setSelectedEntry(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader className="print:hidden">
            <DialogTitle>View Payslip</DialogTitle>
            <DialogDescription>Print or review the details of your monthly salary breakdown.</DialogDescription>
          </DialogHeader>

          {selectedEntry && (
            <div id="payslip-print-area" className="bg-card space-y-6 rounded-lg border p-4 text-sm shadow-sm">
              {/* Header */}
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <h2 className="text-foreground text-base font-bold tracking-wider uppercase">
                    ACOB LIGHTING TECHNOLOGY LIMITED
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    Plot 1205, Off Aminu Kano Crescent, Wuse II, Abuja, Nigeria
                  </p>
                  <p className="text-primary mt-2 font-semibold">
                    PAYSLIP FOR {selectedEntry.payroll_periods?.name.toUpperCase()}
                  </p>
                </div>
                <div className="text-muted-foreground text-right text-xs">
                  <p>Pay Date: {selectedEntry.payroll_periods?.pay_date}</p>
                  <p>
                    Status: <span className="font-semibold text-emerald-600 uppercase">Paid</span>
                  </p>
                </div>
              </div>

              {/* Employee info */}
              <div className="bg-muted/30 grid grid-cols-2 gap-4 rounded p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Employee Name:</p>
                  <p className="font-medium">{profile?.full_name}</p>
                  <p className="text-muted-foreground mt-2">Staff Code:</p>
                  <p className="font-mono">{profile?.employee_number}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Department:</p>
                  <p className="font-medium">{profile?.department || "—"}</p>
                  <p className="text-muted-foreground mt-2">Designation / Position:</p>
                  <p className="font-medium">{profile?.designation || "—"}</p>
                </div>
              </div>

              {/* Breakdown Grid */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Earnings */}
                <div className="space-y-2">
                  <h3 className="text-muted-foreground border-b pb-1 text-xs font-bold uppercase">Earnings</h3>
                  <table className="w-full space-y-1 text-xs">
                    <tbody>
                      <tr className="flex justify-between py-1">
                        <td>Basic Salary</td>
                        <td className="font-medium">₦{basic.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      </tr>
                      <tr className="flex justify-between py-1">
                        <td>Housing Allowance</td>
                        <td className="font-medium">
                          ₦{housing.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                      <tr className="flex justify-between py-1">
                        <td>Transport Allowance</td>
                        <td className="font-medium">
                          ₦{transport.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                      <tr className="flex justify-between py-1">
                        <td>Leave Allowance</td>
                        <td className="font-medium">₦{leave.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      </tr>
                      <tr className="flex justify-between py-1">
                        <td>Communication Allowance</td>
                        <td className="font-medium">₦{comms.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      </tr>
                      {bonus > 0 && (
                        <tr className="flex justify-between py-1 text-emerald-600">
                          <td>Bonus / Refunds</td>
                          <td className="font-medium">
                            ₦{bonus.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      )}
                      <tr className="text-foreground flex justify-between border-t pt-1.5 font-bold">
                        <td>Total Gross Earnings</td>
                        <td>
                          ₦
                          {(Number(selectedEntry.gross_salary) + bonus).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Deductions */}
                <div className="space-y-2">
                  <h3 className="text-muted-foreground border-b pb-1 text-xs font-bold uppercase">Deductions</h3>
                  <table className="w-full space-y-1 text-xs">
                    <tbody>
                      <tr className="flex justify-between py-1">
                        <td>Pension (8% of Basic)</td>
                        <td className="font-medium">
                          ₦{pensionEE.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                      <tr className="flex justify-between py-1">
                        <td>PAYE Tax</td>
                        <td className="font-medium">₦{tax.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                      </tr>
                      {latenessSurcharge > 0 && (
                        <tr className="flex justify-between py-1 text-red-600">
                          <td>Lateness / Absence Surcharge</td>
                          <td className="font-medium">
                            ₦{latenessSurcharge.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      )}
                      {lunch > 0 && (
                        <tr className="flex justify-between py-1 text-red-600">
                          <td>Staff Lunch Deduction</td>
                          <td className="font-medium">
                            ₦{lunch.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      )}
                      {loan > 0 && (
                        <tr className="flex justify-between py-1 text-red-600">
                          <td>Loan Repayment</td>
                          <td className="font-medium">₦{loan.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                        </tr>
                      )}
                      <tr className="text-foreground flex justify-between border-t pt-1.5 font-bold">
                        <td>Total Deductions</td>
                        <td className="text-red-600">
                          -₦
                          {Number(selectedEntry.total_deductions).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Net Pay Box */}
              <div className="bg-muted/10 flex items-center justify-between rounded border-t border-b px-4 py-3">
                <span className="text-xs font-bold tracking-wider uppercase">Net Pay (Take Home)</span>
                <span className="text-lg font-bold text-emerald-600">
                  ₦{Number(selectedEntry.net_salary).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* Signature Line */}
              <div className="text-muted-foreground flex items-end justify-between pt-12 text-xs">
                <div className="w-40 border-t pt-1 text-center">Employee Signature</div>
                <div className="w-40 border-t pt-1 text-center">For: ACOB Lighting Ltd.</div>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2 print:hidden">
            <Button variant="outline" onClick={() => setSelectedEntry(null)}>
              Close
            </Button>
            <Button onClick={handlePrint}>
              <Printer className="mr-1.5 h-4 w-4" /> Print Payslip
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #payslip-print-area,
          #payslip-print-area * {
            visibility: visible;
          }
          #payslip-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            border: none;
            box-shadow: none;
          }
        }
      `}</style>
    </DataTablePage>
  )
}
