"use client"

import { useState, useMemo } from "react"
import { DataTablePage } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  calculatePayroll,
  calculatePAYETax,
  calculateNewTaxReformPAYE,
  type PayrollBreakdown,
} from "@/lib/hr/payroll-utils"
import type { EmployeeSalaryPreset } from "./page"
import {
  Calculator,
  DollarSign,
  TrendingDown,
  CheckCircle2,
  RefreshCw,
  User,
  Sliders,
  Sparkles,
  Percent,
  Minus,
  Plus,
  Briefcase,
  Layers,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { toast } from "sonner"

interface DummyPayrollPageProps {
  initialData: {
    employees: EmployeeSalaryPreset[]
    isAdmin: boolean
  }
}

const PRESET_GROSS_SALARIES = [
  150000,
  200000,
  250000,
  350000,
  500000,
  750000,
  1000000,
  1500000,
  2000000,
]

export function DummyPayrollCalculatorPage({ initialData }: DummyPayrollPageProps) {
  const employees = initialData.employees

  // Selected employee preset (default to first employee or null)
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id || "")

  // Selected employee reference
  const selectedEmp = useMemo(() => {
    return employees.find((e) => e.id === selectedEmpId) || null
  }, [employees, selectedEmpId])

  // Baseline Monthly Base Salary (from selected employee or default N195,000)
  const baselineMonthlyBase = selectedEmp ? selectedEmp.basic_salary : 195000

  // Interactive state
  const [monthlyBaseInput, setMonthlyBaseInput] = useState<number>(baselineMonthlyBase)
  const [communicationAllowance, setCommunicationAllowance] = useState<number>(5000)
  const [workdays, setWorkdays] = useState<number>(23)
  const [missedHours, setMissedHours] = useState<number>(0)
  const [absentDays, setAbsentDays] = useState<number>(0)
  const [bonus, setBonus] = useState<number>(0)
  const [loanRepayment, setLoanRepayment] = useState<number>(0)
  const [lunchDeduction, setLunchDeduction] = useState<number>(0)
  const [otherDeductions, setOtherDeductions] = useState<number>(0)

  // Approval Simulation state
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false)
  const [approvalNote, setApprovalNote] = useState("")
  const [approvedStatus, setApprovedStatus] = useState<"pending" | "approved">("pending")

  // Expanded Tax Relief Dropdown state (supports multi-expansion)
  type ReliefType = "pension" | "cra" | "chargeable" | "reform-pension" | "reform-static" | "reform-chargeable"
  const [expandedReliefs, setExpandedReliefs] = useState<Record<string, boolean>>({})

  const toggleReliefExpand = (type: ReliefType) => {
    setExpandedReliefs((prev) => ({
      ...prev,
      [type]: !prev[type],
    }))
  }

  const isReliefExpanded = (type: ReliefType) => Boolean(expandedReliefs[type])

  // Sync state when employee selection changes
  const handleEmployeeChange = (empId: string) => {
    setSelectedEmpId(empId)
    const emp = employees.find((e) => e.id === empId)
    const base = emp ? emp.basic_salary : 195000
    setMonthlyBaseInput(base)
    setApprovedStatus("pending")
    toast.info(`Loaded base salary for ${emp ? emp.full_name : "Default"}`)
  }

  // Monthly Gross Salary derived: (Base + Communication Allowance)
  const currentGrossSalary = monthlyBaseInput + communicationAllowance

  // Direct alteration handler for Monthly Gross Salary
  const handleGrossChange = (newGross: number) => {
    const safeGross = Math.max(communicationAllowance, newGross)
    setMonthlyBaseInput(safeGross - communicationAllowance)
    setApprovedStatus("pending")
  }

  // Direct alteration handler for Monthly Base Salary
  const handleBaseChange = (newBase: number) => {
    const safeBase = Math.max(0, newBase)
    setMonthlyBaseInput(safeBase)
    setApprovedStatus("pending")
  }

  // Direct alteration handler for Communication Allowance
  const handleCommunicationChange = (newComm: number) => {
    const safeComm = Math.max(0, newComm)
    setCommunicationAllowance(safeComm)
    setApprovedStatus("pending")
  }

  // Percentage Adjustments (+5%, +10%, -5%, -10%)
  const handlePercentageAdjust = (percent: number) => {
    const factor = 1 + percent / 100
    const newGross = Math.round(currentGrossSalary * factor)
    handleGrossChange(newGross)
    toast.success(`Gross salary adjusted by ${percent > 0 ? "+" : ""}${percent}%`)
  }

  // Reset to Baseline
  const handleReset = () => {
    setMonthlyBaseInput(baselineMonthlyBase)
    setCommunicationAllowance(5000)
    setWorkdays(23)
    setMissedHours(0)
    setAbsentDays(0)
    setBonus(0)
    setLoanRepayment(0)
    setLunchDeduction(0)
    setOtherDeductions(0)
    setApprovedStatus("pending")
    toast.info("Reset calculator to baseline values")
  }

  // Calculate Baseline Payroll Breakdown
  const baselineBreakdown: PayrollBreakdown = useMemo(() => {
    return calculatePayroll({
      monthlyBase: baselineMonthlyBase,
      workdays: 23,
      missedHours: 0,
      absentDays: 0,
      bonus: 0,
      loanRepayment: 0,
      lunchDeduction: 0,
      otherDeductions: 0,
      communicationConfig: 60000,
    })
  }, [baselineMonthlyBase])

  // Calculate Current Altered Payroll Breakdown
  const currentBreakdown: PayrollBreakdown = useMemo(() => {
    return calculatePayroll({
      monthlyBase: monthlyBaseInput,
      workdays,
      missedHours,
      absentDays,
      bonus,
      loanRepayment,
      lunchDeduction,
      otherDeductions,
      communicationConfig: communicationAllowance * 12,
    })
  }, [monthlyBaseInput, communicationAllowance, workdays, missedHours, absentDays, bonus, loanRepayment, lunchDeduction, otherDeductions])

  // Detailed Tax Bracket calculation for current breakdown
  const taxDetail = useMemo(() => {
    const annualGross = currentBreakdown.annualGross
    const pensionEmployee = currentBreakdown.pensionEmployeeAnnual
    const payeResult = calculatePAYETax(annualGross, pensionEmployee)

    const chargeable = payeResult.chargeableIncome
    let rem = chargeable

    const b1 = Math.min(rem, 300000)
    const t1 = b1 * 0.07
    rem -= b1

    const b2 = Math.min(rem, 300000)
    const t2 = b2 * 0.11
    rem -= b2

    const b3 = Math.min(rem, 500000)
    const t3 = b3 * 0.15
    rem -= b3

    const b4 = Math.min(rem, 500000)
    const t4 = b4 * 0.19
    rem -= b4

    const b5 = Math.min(rem, 1600000)
    const t5 = b5 * 0.21
    rem -= b5

    const b6 = Math.max(0, rem)
    const t6 = b6 * 0.24

    return {
      ...payeResult,
      brackets: [
        { label: "First ₦300,000 @ 7%", amount: b1, tax: t1, rate: "7%" },
        { label: "Next ₦300,000 @ 11%", amount: b2, tax: t2, rate: "11%" },
        { label: "Next ₦500,000 @ 15%", amount: b3, tax: t3, rate: "15%" },
        { label: "Next ₦500,000 @ 19%", amount: b4, tax: t4, rate: "19%" },
        { label: "Next ₦1,600,000 @ 21%", amount: b5, tax: t5, rate: "21%" },
        { label: "Above ₦3,200,000 @ 24%", amount: b6, tax: t6, rate: "24%" },
      ],
    }
  }, [currentBreakdown])

  // Proposed New Tax Reform Schedule calculation
  const reformTaxDetail = useMemo(() => {
    return calculateNewTaxReformPAYE(
      currentBreakdown.annualGross,
      currentBreakdown.pensionEmployeeAnnual
    )
  }, [currentBreakdown])

  // Deltas (Altered vs Baseline)
  const grossDelta = currentBreakdown.monthlyGross - baselineBreakdown.monthlyGross
  const netDelta = currentBreakdown.netPay - baselineBreakdown.netPay
  const taxDelta = currentBreakdown.monthlyTax - baselineBreakdown.monthlyTax
  const deductionDelta = currentBreakdown.totalDeductions - baselineBreakdown.totalDeductions

  const money = (num: number) =>
    `₦${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const handleApprove = () => {
    setApprovedStatus("approved")
    setApprovalDialogOpen(false)
    toast.success("Payroll calculation approved for simulation!")
  }

  return (
    <DataTablePage
      title="Dummy Payroll Sandbox & Gross Salary Calculator"
      description="Interactively adjust gross salary, simulate payroll calculations, compare baseline vs altered pay, and preview approval figures."
      icon={Calculator}
      backLink={{ href: "/admin/hr/payroll", label: "Back to Payroll" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Reset to Baseline
          </Button>
          <Button
            size="sm"
            className={approvedStatus === "approved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
            onClick={() => setApprovalDialogOpen(true)}
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            {approvedStatus === "approved" ? "Approved Summary" : "Simulate Approval"}
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Altered Monthly Gross"
            value={money(currentBreakdown.monthlyGross)}
            description={
              grossDelta !== 0
                ? `${grossDelta > 0 ? "+" : ""}${money(grossDelta)} vs baseline`
                : "Matches baseline"
            }
            icon={DollarSign}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Simulated Net Pay"
            value={money(currentBreakdown.netPay)}
            description={
              netDelta !== 0
                ? `${netDelta > 0 ? "+" : ""}${money(netDelta)} vs baseline`
                : "Matches baseline"
            }
            icon={Sparkles}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Monthly PAYE Tax"
            value={money(currentBreakdown.monthlyTax)}
            description={
              taxDelta !== 0
                ? `${taxDelta > 0 ? "+" : ""}${money(taxDelta)} vs baseline`
                : "Matches baseline"
            }
            icon={Percent}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Total Deductions"
            value={money(currentBreakdown.totalDeductions)}
            description={
              deductionDelta !== 0
                ? `${deductionDelta > 0 ? "+" : ""}${money(deductionDelta)} vs baseline`
                : "Matches baseline"
            }
            icon={TrendingDown}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <div className="space-y-6">
        {/* Status Alert Banner */}
        {approvedStatus === "approved" && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-semibold text-sm">Calculation Approved for Simulation</p>
                <p className="text-xs opacity-90">
                  {selectedEmp ? selectedEmp.full_name : "Target Employee"} gross salary approved at{" "}
                  <strong>{money(currentBreakdown.monthlyGross)}</strong> (Net Pay:{" "}
                  <strong>{money(currentBreakdown.netPay)}</strong>).
                  {approvalNote && ` Note: "${approvalNote}"`}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              Approved
            </Badge>
          </div>
        )}

        {/* SECTION 1: Interactive Control Panel */}
        <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Sliders className="h-4 w-4 text-primary" />
                Gross Salary & Payroll Parameter Adjuster
              </h2>
              <p className="text-xs text-muted-foreground">
                Alter the gross salary and optional attendance/financial inputs below to recalculate instantly.
              </p>
            </div>

            {/* Employee Preset Dropdown */}
            {employees.length > 0 && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="employee-preset" className="text-xs font-medium whitespace-nowrap">
                  Load Employee:
                </Label>
                <select
                  id="employee-preset"
                  value={selectedEmpId}
                  onChange={(e) => handleEmployeeChange(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.department}) — Base: ₦{emp.basic_salary.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Primary Inputs: Gross & Base Salary */}
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="gross-salary" className="text-sm font-bold text-primary flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" />
                  Monthly Gross Salary (Target)
                </Label>
                <Badge variant="secondary" className="font-mono text-xs">
                  Base ₦{monthlyBaseInput.toLocaleString()} + ₦5k Comm.
                </Badge>
              </div>

              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm font-semibold text-muted-foreground">₦</span>
                <Input
                  id="gross-salary"
                  type="number"
                  step="1000"
                  value={currentGrossSalary}
                  onChange={(e) => handleGrossChange(parseFloat(e.target.value) || 0)}
                  className="pl-8 text-lg font-bold text-primary font-mono h-11"
                />
              </div>

              {/* Slider for Gross Salary */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-xs text-muted-foreground font-mono">
                  <span>₦50,000</span>
                  <span>₦1,000,000</span>
                  <span>₦3,000,000</span>
                </div>
                <input
                  type="range"
                  min="50000"
                  max="3000000"
                  step="10000"
                  value={currentGrossSalary}
                  onChange={(e) => handleGrossChange(parseFloat(e.target.value) || 50000)}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>

              {/* Quick Presets */}
              <div className="space-y-1.5 pt-2">
                <span className="text-xs font-medium text-muted-foreground">Quick Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_GROSS_SALARIES.map((val) => (
                    <Button
                      key={val}
                      type="button"
                      variant={currentGrossSalary === val ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleGrossChange(val)}
                      className="text-xs h-7 px-2 font-mono"
                    >
                      ₦{(val / 1000).toFixed(0)}k
                    </Button>
                  ))}
                </div>
              </div>

              {/* Percentage Adjustments */}
              <div className="space-y-1.5 pt-2 border-t border-border/40">
                <span className="text-xs font-medium text-muted-foreground">Alter Percentage:</span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(-10)}
                    className="text-xs h-7 text-red-600 dark:text-red-400"
                  >
                    <Minus className="mr-1 h-3 w-3" /> 10%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(-5)}
                    className="text-xs h-7 text-red-600 dark:text-red-400"
                  >
                    <Minus className="mr-1 h-3 w-3" /> 5%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(5)}
                    className="text-xs h-7 text-emerald-600 dark:text-emerald-400"
                  >
                    <Plus className="mr-1 h-3 w-3" /> 5%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(10)}
                    className="text-xs h-7 text-emerald-600 dark:text-emerald-400"
                  >
                    <Plus className="mr-1 h-3 w-3" /> 10%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(15)}
                    className="text-xs h-7 text-emerald-600 dark:text-emerald-400"
                  >
                    <Plus className="mr-1 h-3 w-3" /> 15%
                  </Button>
                </div>
              </div>
            </div>

            {/* Attendance & Financial Parameters */}
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                Attendance & Financial Adjustments
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="base-salary" className="text-xs">
                    Monthly Base Salary (₦)
                  </Label>
                  <Input
                    id="base-salary"
                    type="number"
                    value={monthlyBaseInput}
                    onChange={(e) => handleBaseChange(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="comm-allowance" className="text-xs text-primary font-medium">
                    Communication Allowance (₦)
                  </Label>
                  <Input
                    id="comm-allowance"
                    type="number"
                    value={communicationAllowance}
                    onChange={(e) => handleCommunicationChange(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1 text-primary font-semibold"
                  />
                </div>

                <div>
                  <Label htmlFor="workdays" className="text-xs">
                    Workdays in Month
                  </Label>
                  <Input
                    id="workdays"
                    type="number"
                    min="1"
                    max="31"
                    value={workdays}
                    onChange={(e) => setWorkdays(parseInt(e.target.value) || 23)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="missed-hours" className="text-xs">
                    Missed Hours (Lateness)
                  </Label>
                  <Input
                    id="missed-hours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={missedHours}
                    onChange={(e) => setMissedHours(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="absent-days" className="text-xs">
                    Absent Days
                  </Label>
                  <Input
                    id="absent-days"
                    type="number"
                    min="0"
                    value={absentDays}
                    onChange={(e) => setAbsentDays(parseInt(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="bonus" className="text-xs">
                    Bonus / Allowance (₦)
                  </Label>
                  <Input
                    id="bonus"
                    type="number"
                    value={bonus}
                    onChange={(e) => setBonus(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="loan-repayment" className="text-xs">
                    Loan Repayment (₦)
                  </Label>
                  <Input
                    id="loan-repayment"
                    type="number"
                    value={loanRepayment}
                    onChange={(e) => setLoanRepayment(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="lunch-deduction" className="text-xs">
                    Lunch Deduction (₦)
                  </Label>
                  <Input
                    id="lunch-deduction"
                    type="number"
                    value={lunchDeduction}
                    onChange={(e) => setLunchDeduction(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="other-deductions" className="text-xs">
                    Other Deductions (₦)
                  </Label>
                  <Input
                    id="other-deductions"
                    type="number"
                    value={otherDeductions}
                    onChange={(e) => setOtherDeductions(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: Current PITA vs Proposed New Tax Reform Matrix */}
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div>
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Comparison Matrix: Current PITA System vs Proposed New Tax Reform
              </h3>
              <p className="text-xs text-muted-foreground">
                Side-by-side payroll matrix showing exact tax and net pay impact under the new Tax Reform Act.
              </p>
            </div>

            {selectedEmp && (
              <Badge variant="outline" className="text-xs font-medium">
                Employee: {selectedEmp.full_name} ({selectedEmp.employee_number})
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/80">
                  <TableHead className="font-semibold">Payroll Element</TableHead>
                  <TableHead className="text-right font-semibold text-amber-700 dark:text-amber-300">
                    Current PITA System
                  </TableHead>
                  <TableHead className="text-right font-semibold text-primary">
                    Proposed New Tax Reform
                  </TableHead>
                  <TableHead className="text-right font-semibold">Reform Impact (Delta)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-xs sm:text-sm">Monthly Base Salary</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyBase)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold text-primary">
                    {money(currentBreakdown.monthlyBase)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                <TableRow className="bg-muted/30">
                  <TableCell className="font-semibold text-xs sm:text-sm">Total Monthly Gross Salary</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">{money(currentBreakdown.monthlyGross)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-primary">
                    {money(currentBreakdown.monthlyGross)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                {/* Sub components */}
                <TableRow>
                  <TableCell className="pl-6 text-xs text-muted-foreground">Basic Salary (50%)</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{money(currentBreakdown.monthlyBasic)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyBasic)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="pl-6 text-xs text-muted-foreground">Housing Allowance (30%)</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{money(currentBreakdown.monthlyHousing)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyHousing)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="pl-6 text-xs text-muted-foreground">Transport Allowance (10%)</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{money(currentBreakdown.monthlyTransport)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyTransport)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="pl-6 text-xs text-muted-foreground">Leave Allowance (10%)</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{money(currentBreakdown.monthlyLeave)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyLeave)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="pl-6 text-xs text-muted-foreground">Communication Allowance</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{money(currentBreakdown.monthlyCommunication)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyCommunication)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                {/* Deductions */}
                <TableRow>
                  <TableCell className="font-medium text-xs sm:text-sm text-red-600 dark:text-red-400">
                    Employee Pension (8% Basic)
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyPensionEmployee)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">{money(currentBreakdown.monthlyPensionEmployee)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                {/* PAYE Tax Comparison */}
                <TableRow className="bg-amber-500/10">
                  <TableCell className="font-semibold text-xs sm:text-sm text-amber-700 dark:text-amber-300">
                    PAYE Income Tax
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {money(currentBreakdown.monthlyTax)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-primary">
                    {money(reformTaxDetail.monthlyTax)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">
                    {reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                        {reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax ? "-" : "+"}
                        {money(Math.abs(reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="font-medium text-xs sm:text-sm">Attendance Surcharges & Adjustments</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.latenessSurcharge + currentBreakdown.absentSurcharge)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">
                    {money(currentBreakdown.latenessSurcharge + currentBreakdown.absentSurcharge)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">—</TableCell>
                </TableRow>

                {/* Total Deductions */}
                <TableRow className="bg-red-500/5">
                  <TableCell className="font-semibold text-xs sm:text-sm text-red-600 dark:text-red-400">
                    Total Monthly Deductions
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold text-red-600 dark:text-red-400">
                    {money(currentBreakdown.totalDeductions)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-red-600 dark:text-red-400">
                    {money(currentBreakdown.totalDeductions - currentBreakdown.monthlyTax + reformTaxDetail.monthlyTax)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">
                    {reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                        {reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax ? "-" : "+"}
                        {money(Math.abs(reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>

                {/* Net Take-Home Pay */}
                <TableRow className="bg-emerald-500/10 border-t-2 border-emerald-500/30">
                  <TableCell className="font-bold text-sm sm:text-base text-emerald-700 dark:text-emerald-300">
                    Net Take-Home Pay
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    {money(currentBreakdown.netPay)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                    {money(currentBreakdown.monthlyGross - (currentBreakdown.totalDeductions - currentBreakdown.monthlyTax + reformTaxDetail.monthlyTax))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-extrabold">
                    {reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={currentBreakdown.monthlyTax - reformTaxDetail.monthlyTax > 0 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-red-600 dark:text-red-400 font-bold"}>
                        {currentBreakdown.monthlyTax - reformTaxDetail.monthlyTax > 0 ? "+" : "-"}
                        {money(Math.abs(currentBreakdown.monthlyTax - reformTaxDetail.monthlyTax))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        {/* SECTION 3: Step-by-Step PAYE Tax Bracket Inspection */}
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6 shadow-sm space-y-4">
          <div className="border-b border-border/60 pb-3">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Percent className="h-4 w-4 text-amber-500" />
              PAYE Income Tax Breakdown (Progressive Nigerian Tax Bands)
            </h3>
            <p className="text-xs text-muted-foreground">
              Calculated on annual taxable gross of <strong>{money(currentBreakdown.annualGross)}</strong> after deducting Pension and Consolidated Relief Allowance (CRA).
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* COLUMN 1: Current PITA Reliefs */}
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
              <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                <span className="font-semibold text-xs text-amber-700 dark:text-amber-300">
                  Current PITA Relief Structure
                </span>
                <Badge variant="outline" className="text-[9px] font-mono">
                  PITA Act
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* PITA Pension Card */}
                <div
                  onClick={() => toggleReliefExpand("pension")}
                  className={`rounded-md border p-2.5 transition-all cursor-pointer select-none ${
                    isReliefExpanded("pension")
                      ? "border-amber-500 bg-amber-500/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-amber-500/50"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>1. Pension (8%)</span>
                    {isReliefExpanded("pension") ? <ChevronUp className="h-3.5 w-3.5 text-amber-600" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                  <p className="text-xs font-mono font-bold">{money(taxDetail.totalReliefs)}</p>
                  <span className="text-[10px] text-primary underline">
                    {isReliefExpanded("pension") ? "Hide ▲" : "Math ▼"}
                  </span>
                </div>

                {/* PITA CRA Card */}
                <div
                  onClick={() => toggleReliefExpand("cra")}
                  className={`rounded-md border p-2.5 transition-all cursor-pointer select-none ${
                    isReliefExpanded("cra")
                      ? "border-amber-500 bg-amber-500/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-amber-500/50"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>2. CRA (Comp 1 & 2)</span>
                    {isReliefExpanded("cra") ? <ChevronUp className="h-3.5 w-3.5 text-amber-600" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                  <p className="text-xs font-mono font-bold">{money(taxDetail.cra)}</p>
                  <span className="text-[10px] text-primary underline">
                    {isReliefExpanded("cra") ? "Hide ▲" : "Math ▼"}
                  </span>
                </div>
              </div>

              {/* PITA Chargeable Income */}
              <div
                onClick={() => toggleReliefExpand("chargeable")}
                className={`rounded-md border p-2.5 transition-all cursor-pointer select-none ${
                  isReliefExpanded("chargeable")
                    ? "border-amber-500 bg-amber-500/20"
                    : "border-amber-500/40 bg-amber-500/10 hover:border-amber-500"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  <span>PITA Chargeable Income (Annual)</span>
                  {isReliefExpanded("chargeable") ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </div>
                <p className="text-sm font-mono font-bold text-amber-700 dark:text-amber-300">{money(taxDetail.chargeableIncome)}</p>
              </div>

              {/* PITA Dropdown Accordion Content */}
              {isReliefExpanded("pension") && (
                <div className="rounded border border-border bg-background p-2.5 text-xs font-mono space-y-1">
                  <div className="font-sans font-semibold text-[11px] border-b border-border/40 pb-1">PITA Pension Relief Math:</div>
                  <div className="flex justify-between text-[10px]"><span>Annual Basic Salary (50%):</span><span>{money(currentBreakdown.basic)}</span></div>
                  <div className="flex justify-between font-bold text-amber-600 text-[10px]"><span>Annual Pension (8% × Basic):</span><span>{money(currentBreakdown.pensionEmployeeAnnual)}</span></div>
                </div>
              )}

              {isReliefExpanded("cra") && (
                <div className="rounded border border-border bg-background p-2.5 text-xs font-mono space-y-1">
                  <div className="font-sans font-semibold text-[11px] border-b border-border/40 pb-1">PITA CRA Math (Comp 1 + Comp 2):</div>
                  <div className="flex justify-between text-[10px]"><span>Gross Income:</span><span>{money(currentBreakdown.annualGross)}</span></div>
                  <div className="flex justify-between text-[10px] text-red-600"><span>Less Pension:</span><span>-{money(taxDetail.totalReliefs)}</span></div>
                  <div className="flex justify-between text-[10px]"><span>Net Income:</span><span>{money(taxDetail.netForCRA)}</span></div>
                  <div className="flex justify-between text-[10px] text-muted-foreground"><span>Comp 1 [Max(1% Net, ₦200k)]:</span><span>{money(Math.max(0.01 * taxDetail.netForCRA, 200000))}</span></div>
                  <div className="flex justify-between text-[10px] text-muted-foreground"><span>Comp 2 [20% of Net Income]:</span><span>{money(0.2 * taxDetail.netForCRA)}</span></div>
                  <div className="flex justify-between font-bold text-amber-600 border-t border-border/40 pt-1 text-[10px]"><span>Total CRA Relief:</span><span>{money(taxDetail.cra)}</span></div>
                </div>
              )}

              {isReliefExpanded("chargeable") && (
                <div className="rounded border border-border bg-background p-2.5 text-xs font-mono space-y-1">
                  <div className="font-sans font-semibold text-[11px] border-b border-border/40 pb-1">PITA Chargeable Income Math:</div>
                  <div className="flex justify-between text-[10px]"><span>Net Income (Gross - Pension):</span><span>{money(taxDetail.netForCRA)}</span></div>
                  <div className="flex justify-between text-[10px] text-amber-600"><span>Less CRA Relief:</span><span>-{money(taxDetail.cra)}</span></div>
                  <div className="flex justify-between font-bold text-amber-600 border-t border-border/40 pt-1 text-[10px]"><span>PITA Chargeable Income:</span><span>{money(taxDetail.chargeableIncome)}</span></div>
                </div>
              )}
            </div>

            {/* COLUMN 2: New Tax Reform Reliefs (No Comp 1/2 + Static 500k Relief) */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
              <div className="flex items-center justify-between border-b border-primary/20 pb-2">
                <span className="font-semibold text-xs text-primary">
                  New Tax Reform Relief Structure
                </span>
                <Badge variant="default" className="text-[9px] font-mono bg-primary">
                  2025/2026 Reform
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Reform Pension Card */}
                <div
                  onClick={() => toggleReliefExpand("reform-pension")}
                  className={`rounded-md border p-2.5 transition-all cursor-pointer select-none ${
                    isReliefExpanded("reform-pension")
                      ? "border-primary bg-primary/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>1. Pension (8%)</span>
                    {isReliefExpanded("reform-pension") ? <ChevronUp className="h-3.5 w-3.5 text-primary" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                  <p className="text-xs font-mono font-bold">{money(currentBreakdown.pensionEmployeeAnnual)}</p>
                  <span className="text-[10px] text-primary underline">
                    {isReliefExpanded("reform-pension") ? "Hide ▲" : "Math ▼"}
                  </span>
                </div>

                {/* Reform Static 500k Relief Card */}
                <div
                  onClick={() => toggleReliefExpand("reform-static")}
                  className={`rounded-md border p-2.5 transition-all cursor-pointer select-none ${
                    isReliefExpanded("reform-static")
                      ? "border-primary bg-primary/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>2. Static Relief (No CRA)</span>
                    {isReliefExpanded("reform-static") ? <ChevronUp className="h-3.5 w-3.5 text-primary" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                  <p className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">₦500,000.00</p>
                  <span className="text-[10px] text-primary underline">
                    {isReliefExpanded("reform-static") ? "Hide ▲" : "Rule info ▼"}
                  </span>
                </div>
              </div>

              {/* Reform Chargeable Income */}
              <div
                onClick={() => toggleReliefExpand("reform-chargeable")}
                className={`rounded-md border p-2.5 transition-all cursor-pointer select-none ${
                  isReliefExpanded("reform-chargeable")
                    ? "border-primary bg-primary/20"
                    : "border-primary/40 bg-primary/10 hover:border-primary"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-semibold text-primary">
                  <span>New Reform Chargeable Income (Annual)</span>
                  {isReliefExpanded("reform-chargeable") ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </div>
                <p className="text-sm font-mono font-bold text-primary">{money(reformTaxDetail.chargeableIncome)}</p>
              </div>

              {/* Reform Dropdown Accordion Content */}
              {isReliefExpanded("reform-pension") && (
                <div className="rounded border border-border bg-background p-2.5 text-xs font-mono space-y-1">
                  <div className="font-sans font-semibold text-[11px] border-b border-border/40 pb-1">New Reform Pension Math:</div>
                  <div className="flex justify-between text-[10px]"><span>Annual Basic Salary (50%):</span><span>{money(currentBreakdown.basic)}</span></div>
                  <div className="flex justify-between font-bold text-primary text-[10px]"><span>Annual Pension Relief (8%):</span><span>{money(currentBreakdown.pensionEmployeeAnnual)}</span></div>
                </div>
              )}

              {isReliefExpanded("reform-static") && (
                <div className="rounded border border-border bg-background p-2.5 text-xs font-mono space-y-1">
                  <div className="font-sans font-semibold text-[11px] border-b border-border/40 pb-1 text-primary">New Tax Reform Exemption Rule:</div>
                  <p className="text-[10px] text-muted-foreground font-sans">
                    Under the new Tax Reform Act, CRA Components 1 & 2 (1% Net & 20% Net) are <strong>removed</strong>. Instead, employees receive a <strong>static ₦500,000 statutory relief</strong> plus the 0% tax threshold on the first ₦800,000!
                  </p>
                  <div className="flex justify-between font-bold text-emerald-600 text-[10px] pt-1 border-t border-border/40"><span>Fixed Statutory Relief:</span><span>₦500,000.00</span></div>
                </div>
              )}

              {isReliefExpanded("reform-chargeable") && (
                <div className="rounded border border-border bg-background p-2.5 text-xs font-mono space-y-1">
                  <div className="font-sans font-semibold text-[11px] border-b border-border/40 pb-1">New Reform Chargeable Income Math:</div>
                  <div className="flex justify-between text-[10px]"><span>Annual Gross Income:</span><span>{money(currentBreakdown.annualGross)}</span></div>
                  <div className="flex justify-between text-[10px] text-red-600"><span>Less Pension (8%):</span><span>-{money(currentBreakdown.pensionEmployeeAnnual)}</span></div>
                  <div className="flex justify-between text-[10px] text-emerald-600"><span>Less Static Relief:</span><span>-₦500,000.00</span></div>
                  <div className="flex justify-between font-bold text-primary border-t border-border/40 pt-1 text-[10px]"><span>New Chargeable Income:</span><span>{money(reformTaxDetail.chargeableIncome)}</span></div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Tax Bracket Computation (2-Column Schedule Comparison):
              </h4>
              <Badge variant="outline" className="text-[11px] w-fit font-mono bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
                PITA vs New Tax Reform Act
              </Badge>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Column 1: Current Tax Schedule (PITA) */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                  <span className="font-semibold text-xs text-amber-700 dark:text-amber-300">
                    Column 1: Current PITA Tax Schedule
                  </span>
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    7% – 24%
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {taxDetail.brackets.map((b, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded border border-border/40 bg-background/60 p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
                          B{idx + 1}
                        </Badge>
                        <span className="font-medium text-[11px]">{b.label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-muted-foreground">{money(b.amount)}</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400">
                          {money(b.tax)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded border border-amber-500/40 bg-amber-500/10 p-2.5 mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">
                  <span>Current Monthly Tax:</span>
                  <span className="font-mono text-sm">{money(currentBreakdown.monthlyTax)}</span>
                </div>
              </div>

              {/* Column 2: New Tax Reform Schedule (Proposed) */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-primary/20 pb-2">
                  <span className="font-semibold text-xs text-primary">
                    Column 2: New Tax Reform Schedule
                  </span>
                  <Badge variant="default" className="text-[10px] font-mono bg-primary">
                    0% – 25% (2025/2026 Reform)
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {reformTaxDetail.brackets.map((b, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded border border-border/40 bg-background/60 p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
                          B{idx + 1}
                        </Badge>
                        <span className="font-medium text-[11px]">{b.label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-muted-foreground">{money(b.amount)}</span>
                        <span className="font-bold text-primary">
                          {money(b.tax)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded border border-primary/40 bg-primary/10 p-2.5 mt-2 text-xs font-bold text-primary">
                  <span>New Reform Monthly Tax:</span>
                  <span className="font-mono text-sm">{money(reformTaxDetail.monthlyTax)}</span>
                </div>
              </div>
            </div>

            {/* Variance & Savings Banner */}
            <div className="flex flex-col sm:flex-row items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-xs gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-semibold">New Tax Reform Impact:</span>
                <span className="text-muted-foreground">
                  Monthly Tax Diff:{" "}
                  <strong className={reformTaxDetail.monthlyTax <= currentBreakdown.monthlyTax ? "text-emerald-600" : "text-red-600"}>
                    {reformTaxDetail.monthlyTax <= currentBreakdown.monthlyTax ? "-" : "+"}
                    {money(Math.abs(reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax))}
                  </strong>
                </span>
              </div>

              <div className="font-mono font-bold text-xs">
                Take-Home Net (New Reform):{" "}
                <span className="text-emerald-600 dark:text-emerald-400">
                  {money(currentBreakdown.monthlyGross - (currentBreakdown.totalDeductions - currentBreakdown.monthlyTax + reformTaxDetail.monthlyTax))}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 4: Approval Simulation Modal */}
        <Dialog open={approvalDialogOpen} onOpenChange={setApprovalDialogOpen}>
          <DialogContent className="sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                Simulate Gross Salary Approval
              </DialogTitle>
              <DialogDescription className="text-xs">
                Review and approve the altered gross salary for {selectedEmp ? selectedEmp.full_name : "this employee"}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-3">
              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Target Employee:</span>
                  <span className="font-semibold">{selectedEmp ? selectedEmp.full_name : "General Sandbox"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Original Baseline Gross:</span>
                  <span className="font-mono">{money(baselineBreakdown.monthlyGross)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Approved Monthly Gross:</span>
                  <span className="font-mono font-bold text-primary">{money(currentBreakdown.monthlyGross)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Approved Net Take-Home:</span>
                  <span className="font-mono font-bold text-emerald-600">{money(currentBreakdown.netPay)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Approved PAYE Tax:</span>
                  <span className="font-mono">{money(currentBreakdown.monthlyTax)}</span>
                </div>
              </div>

              <div>
                <Label htmlFor="approval-note" className="text-xs font-medium">
                  Approval Notes / Comments (Optional)
                </Label>
                <Input
                  id="approval-note"
                  placeholder="e.g. Approved gross salary increase following Q3 promotion..."
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setApprovalDialogOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleApprove}>
                Confirm & Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DataTablePage>
  )
}
