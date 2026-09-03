"use client"

import { useState } from "react"
import Image from "next/image"
import { DataTablePage, DataTable } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileText, Eye, Printer, DollarSign, Calendar, Receipt } from "lucide-react"
import { printPayslip, type PayslipLine } from "@/lib/hr/payslip-print"
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
        <span>
          ₦
          {(Number(e.gross_salary) + Number(e.bonus)).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      ),
    },
    {
      key: "total_deductions",
      label: "Total Deductions",
      render: (e: UserPayrollEntry) => (
        <span className="text-red-600">
          -₦{Number(e.total_deductions).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "net_salary",
      label: "Net Pay",
      render: (e: UserPayrollEntry) => (
        <span className="font-semibold text-emerald-600">
          ₦{Number(e.net_salary).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

  const fmt = (v: number) => `₦${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtEntry = (v: number | string) => fmt(Number(v))

  const stats = (
    <div className="grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-3">
      <StatCard
        variant="compact"
        title="Latest Net Pay"
        value={latestNet ? fmt(latestNet) : "₦0.00"}
        icon={DollarSign}
        iconBgColor="bg-emerald-500/10"
        iconColor="text-emerald-500"
      />
      <StatCard
        variant="compact"
        title="Year-to-Date (YTD) Net"
        value={fmt(ytdNet)}
        icon={DollarSign}
        iconBgColor="bg-blue-500/10"
        iconColor="text-blue-500"
      />
      <StatCard
        variant="compact"
        title="Available Payslips"
        value={payslipsCount}
        icon={Calendar}
        iconBgColor="bg-amber-500/10"
        iconColor="text-amber-500"
      />
    </div>
  )

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

  const handlePrint = () => {
    if (!selectedEntry) return
    const deductions: PayslipLine[] = [
      { label: "Pension (8% of Basic)", amount: pensionEE },
      { label: "PAYE Tax", amount: tax },
      ...(lunch > 0 ? [{ label: "Staff Lunch Deduction", amount: lunch }] : []),
      ...(loan > 0 ? [{ label: "Loan Repayment", amount: loan }] : []),
      ...(latenessSurcharge > 0 ? [{ label: "Lateness / Absence Surcharge", amount: latenessSurcharge }] : []),
    ]

    printPayslip({
      fullName: profile?.full_name ?? "",
      employeeNumber: profile?.employee_number ?? "",
      department: profile?.department,
      designation: profile?.designation,
      periodName: selectedEntry.payroll_periods?.name ?? "—",
      payDate: selectedEntry.payroll_periods?.pay_date ?? "—",
      statusLabel: "Paid",
      statusPaid: true,
      earnings: [
        { label: "Basic Salary", amount: basic },
        { label: "Housing Allowance", amount: housing },
        { label: "Transport Allowance", amount: transport },
        { label: "Leave Allowance", amount: leave },
        { label: "Communication Allowance", amount: comms },
        ...(bonus > 0 ? [{ label: "Bonus / Refunds", amount: bonus }] : []),
      ],
      grossLabel: "Total Gross",
      gross: Number(selectedEntry.gross_salary) + bonus,
      deductions,
      totalDeductions: Number(selectedEntry.total_deductions),
      netPay: Number(selectedEntry.net_salary),
    })
  }

  return (
    <DataTablePage
      title="My Payroll & Payslips"
      description="View and print your monthly payslips, tax assessments, and pension contributions."
      icon={FileText}
      spacing="tight"
      stats={stats}
    >
      <DataTable
        data={entries}
        columns={columns}
        getRowId={(e) => e.id}
        searchPlaceholder="Search by period name..."
        searchFn={(row, q) => (row.payroll_periods?.name || "").toLowerCase().includes(q.toLowerCase())}
        filters={[]}
        isLoading={false}
        viewToggle
        stickyToolbar
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          title: (e) => e.payroll_periods?.name || "—",
          subtitle: (e) => (e.payroll_periods?.pay_date ? `Paid ${e.payroll_periods.pay_date}` : "—"),
          trailing: (e) => (
            <span className="font-mono text-sm font-semibold text-emerald-600">{fmt(Number(e.net_salary))}</span>
          ),
          detail: {
            title: (e) => e.payroll_periods?.name || "Payslip",
            subtitle: (e) => (
              <span className="text-muted-foreground text-xs">
                {e.payroll_periods?.pay_date ? `Paid ${e.payroll_periods.pay_date}` : ""}
              </span>
            ),
            fields: (e) => [
              {
                icon: DollarSign,
                label: "Gross cash pay",
                value: fmt(Number(e.gross_salary) + Number(e.bonus)),
              },
              { icon: DollarSign, label: "Total deductions", value: fmtEntry(e.total_deductions) },
              { icon: DollarSign, label: "Net pay", value: fmtEntry(e.net_salary) },
            ],
            actions: (e) => [
              {
                label: "View Payslip",
                icon: Eye,
                variant: "default" as const,
                onClick: () => setSelectedEntry(e),
              },
            ],
          },
        }}
        cardRenderer={(e) => (
          <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold">{e.payroll_periods?.name || "—"}</h4>
              <span className="font-mono text-sm font-bold text-emerald-600">{fmt(Number(e.net_salary))}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div>
                <p className="text-muted-foreground text-[10px] font-medium uppercase">Gross</p>
                <p className="font-medium">{fmt(Number(e.gross_salary) + Number(e.bonus))}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[10px] font-medium uppercase">Deductions</p>
                <p className="font-medium">{fmtEntry(e.total_deductions)}</p>
              </div>
            </div>
            <div className="border-border/40 text-muted-foreground flex items-center justify-between border-t pt-2 text-xs">
              <span>Pay date</span>
              <span>{e.payroll_periods?.pay_date || "—"}</span>
            </div>
          </div>
        )}
      />

      <Dialog open={selectedEntry !== null} onOpenChange={(o) => !o && setSelectedEntry(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader className="print:hidden">
            <DialogTitle>View Payslip</DialogTitle>
            <DialogDescription>Print or review the details of your monthly salary breakdown.</DialogDescription>
          </DialogHeader>

          {selectedEntry && (
            <div
              id="payslip-print-area"
              className="space-y-4 rounded-lg border bg-white p-5 text-sm text-gray-800 shadow-sm dark:bg-white dark:text-gray-800"
            >
              {/* Header: Logo + Company Info + Payslip Label */}
              <div className="flex items-start justify-between border-b border-gray-200 pb-3">
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
                    Period:{" "}
                    <span className="font-semibold whitespace-nowrap text-gray-700">
                      {selectedEntry.payroll_periods?.name}
                    </span>
                  </p>
                  <p className="text-[10px] text-gray-500">
                    Pay Date:{" "}
                    <span className="font-semibold whitespace-nowrap text-gray-700">
                      {selectedEntry.payroll_periods?.pay_date}
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] font-bold text-emerald-600 uppercase">● Paid</p>
                </div>
              </div>

              {/* Employee Info */}
              <div className="grid grid-cols-2 gap-3 rounded border border-gray-100 bg-gray-50 px-4 py-2.5 text-[11px]">
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Employee Name</p>
                  <p className="font-semibold text-gray-800">{profile?.full_name}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Staff ID</p>
                  <p className="font-mono font-semibold text-gray-800">{profile?.employee_number}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Department</p>
                  <p className="font-semibold text-gray-800">{profile?.department || "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] tracking-wide text-gray-400 uppercase">Designation</p>
                  <p className="font-semibold text-gray-800">{profile?.designation || "—"}</p>
                </div>
              </div>

              {/* Earnings & Deductions */}
              <div className="grid grid-cols-2 gap-4 text-[11px]">
                {/* Earnings */}
                <div>
                  <h3 className="mb-1.5 border-b border-emerald-200 pb-1 text-[9px] font-bold tracking-widest text-emerald-700 uppercase">
                    Earnings
                  </h3>
                  <table className="w-full">
                    <tbody>
                      {[
                        ["Basic Salary", basic],
                        ["Housing Allowance", housing],
                        ["Transport Allowance", transport],
                        ["Leave Allowance", leave],
                        ["Communication Allowance", comms],
                        ...(bonus > 0 ? [["Bonus / Refunds", bonus]] : []),
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
                        <td className="pt-1.5 font-bold text-gray-900">Total Gross</td>
                        <td className="pt-1.5 text-right font-bold text-gray-900">
                          ₦
                          {(Number(selectedEntry.gross_salary) + bonus).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Deductions */}
                <div>
                  <h3 className="mb-1.5 border-b border-red-200 pb-1 text-[9px] font-bold tracking-widest text-red-600 uppercase">
                    Deductions
                  </h3>
                  <table className="w-full">
                    <tbody>
                      {[
                        ["Pension (8% of Basic)", pensionEE],
                        ["PAYE Tax", tax],
                        ...(lunch > 0 ? [["Staff Lunch Deduction", lunch]] : []),
                        ...(loan > 0 ? [["Loan Repayment", loan]] : []),
                        ...(latenessSurcharge > 0 ? [["Lateness / Absence Surcharge", latenessSurcharge]] : []),
                      ].map(([label, val]) => (
                        <tr key={String(label)} className="border-b border-gray-50">
                          <td className="py-1 text-gray-600">{label}</td>
                          <td className="py-1 text-right font-medium text-red-600">
                            ₦
                            {Number(val).toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200">
                        <td className="pt-1.5 font-bold text-gray-900">Total Deductions</td>
                        <td className="pt-1.5 text-right font-bold text-red-600">
                          -₦
                          {Number(selectedEntry.total_deductions).toLocaleString("en-US", {
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
                  ₦
                  {Number(selectedEntry.net_salary).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
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
    </DataTablePage>
  )
}
