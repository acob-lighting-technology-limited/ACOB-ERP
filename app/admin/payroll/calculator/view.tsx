"use client"

import { useState, useMemo } from "react"
import { DataTablePage } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

interface CalculatorPageProps {
  initialData: {
    employees: EmployeeSalaryPreset[]
    currentUserId: string
    isAdmin: boolean
  }
}

const PRESET_GROSS_SALARIES = [150000, 200000, 250000, 350000, 500000, 750000, 1000000, 1500000, 2000000]

/**
 * Formats a raw numeric string with thousands commas while typing.
 * E.g., "1000000" -> "1,000,000", "" -> ""
 */
function formatWithCommas(val: string | number): string {
  if (val === "" || val === null || val === undefined) return ""
  const str = String(val)
  const cleaned = str.replace(/[^0-9.]/g, "")
  if (!cleaned) return ""

  const parts = cleaned.split(".")
  const integerPart = parts[0]
  const decimalPart = parts.length > 1 ? "." + parts[1] : ""

  if (!integerPart && decimalPart) return "0" + decimalPart
  const formattedInteger = integerPart ? parseInt(integerPart, 10).toLocaleString("en-US") : ""
  return formattedInteger + decimalPart
}

/**
 * Strips commas and parses a float number for calculations.
 */
function parseRawNumber(val: string): number {
  if (!val) return 0
  const cleaned = String(val)
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "")
  return parseFloat(cleaned) || 0
}

export function PayrollCalculatorPage({ initialData }: CalculatorPageProps) {
  const employees = initialData.employees

  // Default to currently logged in user if found in employee list, otherwise first employee
  const defaultEmpId = useMemo(() => {
    if (initialData.currentUserId && employees.some((e) => e.id === initialData.currentUserId)) {
      return initialData.currentUserId
    }
    return employees[0]?.id || ""
  }, [employees, initialData.currentUserId])

  // Selected employee preset state
  const [selectedEmpId, setSelectedEmpId] = useState<string>(defaultEmpId)

  // Selected employee reference
  const selectedEmp = useMemo(() => {
    return employees.find((e) => e.id === selectedEmpId) || null
  }, [employees, selectedEmpId])

  // Baseline Monthly Base Salary (from selected employee or default N195,000)
  const baselineMonthlyBase = selectedEmp ? selectedEmp.basic_salary : 195000

  // Communication Allowance: N10,000 for department leads, N5,000 for standard employees
  const initialComm = selectedEmp?.is_department_lead ? 10000 : 5000

  // Raw formatted string states for inputs to add commas live while typing & allow full clearing
  const [grossInputState, setGrossInputState] = useState<string>(formatWithCommas(baselineMonthlyBase + initialComm))
  const [baseInputState, setBaseInputState] = useState<string>(formatWithCommas(baselineMonthlyBase))
  const [commInputState, setCommInputState] = useState<string>(formatWithCommas(initialComm))
  const [workdaysState, setWorkdaysState] = useState<string>("23")
  const [missedHoursState, setMissedHoursState] = useState<string>("0")
  const [absentDaysState, setAbsentDaysState] = useState<string>("0")
  const [bonusState, setBonusState] = useState<string>("0")
  const [loanRepaymentState, setLoanRepaymentState] = useState<string>("0")
  const [lunchDeductionState, setLunchDeductionState] = useState<string>("0")
  const [otherDeductionsState, setOtherDeductionsState] = useState<string>("0")

  // Evaluated numbers for payroll calculations
  const grossVal = parseRawNumber(grossInputState)
  const baseVal = parseRawNumber(baseInputState)
  const commVal = parseRawNumber(commInputState)
  const workdaysVal = workdaysState === "" ? 0 : parseInt(workdaysState.replace(/,/g, "")) || 23
  const missedHoursVal = parseRawNumber(missedHoursState)
  const absentDaysVal = absentDaysState === "" ? 0 : parseInt(absentDaysState.replace(/,/g, "")) || 0
  const bonusVal = parseRawNumber(bonusState)
  const loanRepaymentVal = parseRawNumber(loanRepaymentState)
  const lunchDeductionVal = parseRawNumber(lunchDeductionState)
  const otherDeductionsVal = parseRawNumber(otherDeductionsState)

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
    const comm = emp?.is_department_lead ? 10000 : 5000
    setBaseInputState(formatWithCommas(base))
    setCommInputState(formatWithCommas(comm))
    setGrossInputState(formatWithCommas(base + comm))
    setApprovedStatus("pending")
    toast.info(`Loaded base salary & ₦${comm.toLocaleString()} allowance for ${emp ? emp.full_name : "Default"}`)
  }

  // Handle Gross Salary typing with live comma formatting
  const handleGrossInput = (val: string) => {
    const formatted = formatWithCommas(val)
    setGrossInputState(formatted)
    const num = parseRawNumber(val)
    if (val.trim() === "") {
      setBaseInputState("")
    } else {
      const derivedBase = Math.max(0, num - commVal)
      setBaseInputState(formatWithCommas(derivedBase))
    }
    setApprovedStatus("pending")
  }

  // Handle Base Salary typing with live comma formatting
  const handleBaseInput = (val: string) => {
    const formatted = formatWithCommas(val)
    setBaseInputState(formatted)
    const num = parseRawNumber(val)
    if (val.trim() === "") {
      setGrossInputState(formatWithCommas(commVal))
    } else {
      const derivedGross = num + commVal
      setGrossInputState(formatWithCommas(derivedGross))
    }
    setApprovedStatus("pending")
  }

  // Handle Communication Allowance typing with live comma formatting
  const handleCommInput = (val: string) => {
    const formatted = formatWithCommas(val)
    setCommInputState(formatted)
    const comm = parseRawNumber(val)
    const derivedGross = baseVal + comm
    setGrossInputState(formatWithCommas(derivedGross))
    setApprovedStatus("pending")
  }

  // Handle secondary formatted input typing
  const handleSecondaryInput = (val: string, setter: (formatted: string) => void) => {
    setter(formatWithCommas(val))
    setApprovedStatus("pending")
  }

  // Set Gross Preset button (e.g. 500k)
  const setGrossPreset = (targetGross: number) => {
    setGrossInputState(formatWithCommas(targetGross))
    const derivedBase = Math.max(0, targetGross - commVal)
    setBaseInputState(formatWithCommas(derivedBase))
    setApprovedStatus("pending")
  }

  // Percentage Adjustments (+5%, +10%, -5%, -10%)
  const handlePercentageAdjust = (percent: number) => {
    const factor = 1 + percent / 100
    const newGross = Math.round(grossVal * factor)
    setGrossPreset(newGross)
    toast.success(`Gross salary adjusted by ${percent > 0 ? "+" : ""}${percent}%`)
  }

  // Reset to Baseline
  const handleReset = () => {
    const comm = selectedEmp?.is_department_lead ? 10000 : 5000
    setBaseInputState(formatWithCommas(baselineMonthlyBase))
    setCommInputState(formatWithCommas(comm))
    setGrossInputState(formatWithCommas(baselineMonthlyBase + comm))
    setWorkdaysState("23")
    setMissedHoursState("0")
    setAbsentDaysState("0")
    setBonusState("0")
    setLoanRepaymentState("0")
    setLunchDeductionState("0")
    setOtherDeductionsState("0")
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
      communicationConfig: (selectedEmp?.is_department_lead ? 10000 : 5000) * 12,
    })
  }, [baselineMonthlyBase, selectedEmp?.is_department_lead])

  // Calculate Current Altered Payroll Breakdown
  const currentBreakdown: PayrollBreakdown = useMemo(() => {
    return calculatePayroll({
      monthlyBase: baseVal,
      workdays: workdaysVal,
      missedHours: missedHoursVal,
      absentDays: absentDaysVal,
      bonus: bonusVal,
      loanRepayment: loanRepaymentVal,
      lunchDeduction: lunchDeductionVal,
      otherDeductions: otherDeductionsVal,
      communicationConfig: commVal * 12,
    })
  }, [
    baseVal,
    commVal,
    workdaysVal,
    missedHoursVal,
    absentDaysVal,
    bonusVal,
    loanRepaymentVal,
    lunchDeductionVal,
    otherDeductionsVal,
  ])

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
    return calculateNewTaxReformPAYE(currentBreakdown.annualGross, currentBreakdown.pensionEmployeeAnnual)
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
      title="Payroll Gross Salary Calculator"
      description="Interactively adjust gross salary, simulate payroll calculations, compare baseline vs altered pay, and preview approval figures."
      icon={Calculator}
      backLink={{ href: "/admin/payroll", label: "Back to Payroll" }}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Altered Monthly Gross"
            value={money(currentBreakdown.monthlyGross)}
            description={
              grossDelta !== 0 ? `${grossDelta > 0 ? "+" : ""}${money(grossDelta)} vs baseline` : "Matches baseline"
            }
            icon={DollarSign}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Simulated Net Pay"
            value={money(currentBreakdown.netPay)}
            description={
              netDelta !== 0 ? `${netDelta > 0 ? "+" : ""}${money(netDelta)} vs baseline` : "Matches baseline"
            }
            icon={Sparkles}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Monthly PAYE Tax"
            value={money(currentBreakdown.monthlyTax)}
            description={
              taxDelta !== 0 ? `${taxDelta > 0 ? "+" : ""}${money(taxDelta)} vs baseline` : "Matches baseline"
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
                <p className="text-sm font-semibold">Calculation Approved for Simulation</p>
                <p className="text-xs opacity-90">
                  {selectedEmp ? selectedEmp.full_name : "Target Employee"} gross salary approved at{" "}
                  <strong>{money(currentBreakdown.monthlyGross)}</strong> (Net Pay:{" "}
                  <strong>{money(currentBreakdown.netPay)}</strong>).
                  {approvalNote && ` Note: "${approvalNote}"`}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
            >
              Approved
            </Badge>
          </div>
        )}

        {/* SECTION 1: Interactive Control Panel */}
        <div className="border-border/80 bg-card rounded-xl border p-4 shadow-sm sm:p-6">
          <div className="border-border/60 flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Sliders className="text-primary h-4 w-4" />
                Gross Salary & Payroll Parameter Adjuster
              </h2>
              <p className="text-muted-foreground text-xs">
                Alter the gross salary and optional attendance/financial inputs below to recalculate instantly.
              </p>
            </div>

            {/* Employee Preset Dropdown */}
            {employees.length > 0 && (
              <div className="flex items-center gap-2">
                <User className="text-muted-foreground h-4 w-4" />
                <Label htmlFor="employee-preset" className="text-xs font-medium whitespace-nowrap">
                  Load Employee:
                </Label>
                <Select value={selectedEmpId} onValueChange={(val) => handleEmployeeChange(val)}>
                  <SelectTrigger id="employee-preset" className="h-9 w-[320px] text-xs sm:w-[420px]">
                    <SelectValue placeholder="Select employee..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.department}){emp.is_department_lead ? " [Dept Lead]" : ""} — Base: ₦
                        {emp.basic_salary.toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Primary Inputs: Gross & Base Salary */}
            <div className="border-primary/20 bg-primary/5 space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="gross-salary" className="text-primary flex items-center gap-1.5 text-sm font-bold">
                  <DollarSign className="h-4 w-4" />
                  Monthly Gross Salary (Target)
                </Label>
                <Badge variant="secondary" className="font-mono text-xs">
                  Base ₦{baseVal.toLocaleString()} + ₦{(commVal / 1000).toFixed(0)}k Comm.
                </Badge>
              </div>

              <div className="relative">
                <span className="text-muted-foreground absolute top-2.5 left-3 text-sm font-semibold">₦</span>
                <Input
                  id="gross-salary"
                  type="text"
                  inputMode="numeric"
                  value={grossInputState}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => handleGrossInput(e.target.value)}
                  className="text-primary h-11 pl-8 font-mono text-lg font-bold"
                />
              </div>

              {/* Slider for Gross Salary */}
              <div className="space-y-1 pt-1">
                <div className="text-muted-foreground flex justify-between font-mono text-xs">
                  <span>₦50,000</span>
                  <span>₦1,000,000</span>
                  <span>₦3,000,000</span>
                </div>
                <input
                  type="range"
                  min="50000"
                  max="3000000"
                  step="10000"
                  value={grossVal}
                  onChange={(e) => setGrossPreset(parseFloat(e.target.value) || 50000)}
                  className="bg-muted accent-primary h-2 w-full cursor-pointer appearance-none rounded-lg"
                />
              </div>

              {/* Quick Presets */}
              <div className="space-y-1.5 pt-2">
                <span className="text-muted-foreground text-xs font-medium">Quick Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_GROSS_SALARIES.map((val) => (
                    <Button
                      key={val}
                      type="button"
                      variant={grossVal === val ? "default" : "outline"}
                      size="sm"
                      onClick={() => setGrossPreset(val)}
                      className="h-7 px-2 font-mono text-xs"
                    >
                      ₦{(val / 1000).toFixed(0)}k
                    </Button>
                  ))}
                </div>
              </div>

              {/* Percentage Adjustments */}
              <div className="border-border/40 space-y-1.5 border-t pt-2">
                <span className="text-muted-foreground text-xs font-medium">Alter Percentage:</span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(-10)}
                    className="h-7 text-xs text-red-600 dark:text-red-400"
                  >
                    <Minus className="mr-1 h-3 w-3" /> 10%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(-5)}
                    className="h-7 text-xs text-red-600 dark:text-red-400"
                  >
                    <Minus className="mr-1 h-3 w-3" /> 5%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(5)}
                    className="h-7 text-xs text-emerald-600 dark:text-emerald-400"
                  >
                    <Plus className="mr-1 h-3 w-3" /> 5%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(10)}
                    className="h-7 text-xs text-emerald-600 dark:text-emerald-400"
                  >
                    <Plus className="mr-1 h-3 w-3" /> 10%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handlePercentageAdjust(15)}
                    className="h-7 text-xs text-emerald-600 dark:text-emerald-400"
                  >
                    <Plus className="mr-1 h-3 w-3" /> 15%
                  </Button>
                </div>
              </div>
            </div>

            {/* Attendance & Financial Parameters */}
            <div className="border-border bg-card space-y-4 rounded-lg border p-4">
              <h3 className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
                <Briefcase className="text-muted-foreground h-4 w-4" />
                Attendance & Financial Adjustments
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="base-salary" className="text-xs">
                    Monthly Base Salary (₦)
                  </Label>
                  <Input
                    id="base-salary"
                    type="text"
                    inputMode="numeric"
                    value={baseInputState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleBaseInput(e.target.value)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="comm-allowance" className="text-primary text-xs font-medium">
                    Communication Allowance (₦)
                  </Label>
                  <Input
                    id="comm-allowance"
                    type="text"
                    inputMode="numeric"
                    value={commInputState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleCommInput(e.target.value)}
                    className="text-primary mt-1 h-8 font-mono text-xs font-semibold"
                  />
                </div>

                <div>
                  <Label htmlFor="workdays" className="text-xs">
                    Workdays in Month
                  </Label>
                  <Input
                    id="workdays"
                    type="text"
                    inputMode="numeric"
                    value={workdaysState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setWorkdaysState(e.target.value)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="missed-hours" className="text-xs">
                    Missed Hours (Lateness)
                  </Label>
                  <Input
                    id="missed-hours"
                    type="text"
                    inputMode="numeric"
                    value={missedHoursState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleSecondaryInput(e.target.value, setMissedHoursState)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="absent-days" className="text-xs">
                    Absent Days
                  </Label>
                  <Input
                    id="absent-days"
                    type="text"
                    inputMode="numeric"
                    value={absentDaysState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setAbsentDaysState(e.target.value)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="bonus" className="text-xs">
                    Bonus / Allowance (₦)
                  </Label>
                  <Input
                    id="bonus"
                    type="text"
                    inputMode="numeric"
                    value={bonusState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleSecondaryInput(e.target.value, setBonusState)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="loan-repayment" className="text-xs">
                    Loan Repayment (₦)
                  </Label>
                  <Input
                    id="loan-repayment"
                    type="text"
                    inputMode="numeric"
                    value={loanRepaymentState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleSecondaryInput(e.target.value, setLoanRepaymentState)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="lunch-deduction" className="text-xs">
                    Lunch Deduction (₦)
                  </Label>
                  <Input
                    id="lunch-deduction"
                    type="text"
                    inputMode="numeric"
                    value={lunchDeductionState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleSecondaryInput(e.target.value, setLunchDeductionState)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>

                <div>
                  <Label htmlFor="other-deductions" className="text-xs">
                    Other Deductions (₦)
                  </Label>
                  <Input
                    id="other-deductions"
                    type="text"
                    inputMode="numeric"
                    value={otherDeductionsState}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleSecondaryInput(e.target.value, setOtherDeductionsState)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: Current PITA vs Proposed New Tax Reform Matrix */}
        <div className="border-border bg-card space-y-4 rounded-xl border p-4 shadow-sm sm:p-6">
          <div className="border-border/60 flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Layers className="text-primary h-4 w-4" />
                Comparison Matrix: Current PITA System vs Proposed New Tax Reform
              </h3>
              <p className="text-muted-foreground text-xs">
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
                  <TableHead className="text-primary text-right font-semibold">Proposed New Tax Reform</TableHead>
                  <TableHead className="text-right font-semibold">Reform Impact (Delta)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs font-medium sm:text-sm">Monthly Base Salary</TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyBase)}</TableCell>
                  <TableCell className="text-primary text-right font-mono text-xs font-semibold">
                    {money(currentBreakdown.monthlyBase)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                <TableRow className="bg-muted/30">
                  <TableCell className="text-xs font-semibold sm:text-sm">Total Monthly Gross Salary</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">
                    {money(currentBreakdown.monthlyGross)}
                  </TableCell>
                  <TableCell className="text-primary text-right font-mono text-xs font-bold">
                    {money(currentBreakdown.monthlyGross)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                {/* Sub components */}
                <TableRow>
                  <TableCell className="text-muted-foreground pl-6 text-xs">Basic Salary (50%)</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyBasic)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyBasic)}</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="text-muted-foreground pl-6 text-xs">Housing Allowance (30%)</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyHousing)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyHousing)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="text-muted-foreground pl-6 text-xs">Transport Allowance (10%)</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyTransport)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyTransport)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="text-muted-foreground pl-6 text-xs">Leave Allowance (10%)</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyLeave)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{money(currentBreakdown.monthlyLeave)}</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="text-muted-foreground pl-6 text-xs">Communication Allowance</TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyCommunication)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyCommunication)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                {/* Deductions */}
                <TableRow>
                  <TableCell className="text-xs font-medium text-red-600 sm:text-sm dark:text-red-400">
                    Employee Pension (8% Basic)
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {money(currentBreakdown.monthlyPensionEmployee)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">
                    {money(currentBreakdown.monthlyPensionEmployee)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                {/* PAYE Tax Comparison */}
                <TableRow className="bg-amber-500/10">
                  <TableCell className="text-xs font-semibold text-amber-700 sm:text-sm dark:text-amber-300">
                    PAYE Income Tax
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {money(currentBreakdown.monthlyTax)}
                  </TableCell>
                  <TableCell className="text-primary text-right font-mono text-xs font-bold">
                    {money(reformTaxDetail.monthlyTax)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">
                    {reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={
                          reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax ? "-" : "+"}
                        {money(Math.abs(reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>

                <TableRow>
                  <TableCell className="text-xs font-medium sm:text-sm">Attendance Surcharges & Adjustments</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {money(currentBreakdown.latenessSurcharge + currentBreakdown.absentSurcharge)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">
                    {money(currentBreakdown.latenessSurcharge + currentBreakdown.absentSurcharge)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs">—</TableCell>
                </TableRow>

                {/* Total Deductions */}
                <TableRow className="bg-red-500/5">
                  <TableCell className="text-xs font-semibold text-red-600 sm:text-sm dark:text-red-400">
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
                      <span
                        className={
                          reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {reformTaxDetail.monthlyTax < currentBreakdown.monthlyTax ? "-" : "+"}
                        {money(Math.abs(reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>

                {/* Net Take-Home Pay */}
                <TableRow className="border-t-2 border-emerald-500/30 bg-emerald-500/10">
                  <TableCell className="text-sm font-bold text-emerald-700 sm:text-base dark:text-emerald-300">
                    Net Take-Home Pay
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    {money(currentBreakdown.netPay)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                    {money(
                      currentBreakdown.monthlyGross -
                        (currentBreakdown.totalDeductions - currentBreakdown.monthlyTax + reformTaxDetail.monthlyTax)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-extrabold">
                    {reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={
                          currentBreakdown.monthlyTax - reformTaxDetail.monthlyTax > 0
                            ? "font-bold text-emerald-600 dark:text-emerald-400"
                            : "font-bold text-red-600 dark:text-red-400"
                        }
                      >
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
        <div className="border-border bg-card space-y-4 rounded-xl border p-4 shadow-sm sm:p-6">
          <div className="border-border/60 border-b pb-3">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Percent className="h-4 w-4 text-amber-500" />
              PAYE Income Tax Breakdown (Progressive Nigerian Tax Bands)
            </h3>
            <p className="text-muted-foreground text-xs">
              Calculated on annual taxable gross of <strong>{money(currentBreakdown.annualGross)}</strong> after
              deducting Pension and Consolidated Relief Allowance (CRA).
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* COLUMN 1: Current PITA Reliefs */}
            <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Current PITA Relief Structure
                </span>
                <Badge variant="outline" className="font-mono text-[9px]">
                  PITA Act
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {/* PITA Pension Card */}
                <div
                  onClick={() => toggleReliefExpand("pension")}
                  className={`cursor-pointer rounded-md border p-2.5 transition-all select-none ${
                    isReliefExpanded("pension")
                      ? "border-amber-500 bg-amber-500/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-amber-500/50"
                  }`}
                >
                  <div className="text-muted-foreground flex items-center justify-between text-[11px] font-medium">
                    <span>1. Pension (8%)</span>
                    {isReliefExpanded("pension") ? (
                      <ChevronUp className="h-3.5 w-3.5 text-amber-600" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <p className="font-mono text-xs font-bold">{money(taxDetail.totalReliefs)}</p>
                  <span className="text-primary text-[10px] underline">
                    {isReliefExpanded("pension") ? "Hide ▲" : "Math ▼"}
                  </span>
                </div>

                {/* PITA CRA Card */}
                <div
                  onClick={() => toggleReliefExpand("cra")}
                  className={`cursor-pointer rounded-md border p-2.5 transition-all select-none ${
                    isReliefExpanded("cra")
                      ? "border-amber-500 bg-amber-500/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-amber-500/50"
                  }`}
                >
                  <div className="text-muted-foreground flex items-center justify-between text-[11px] font-medium">
                    <span>2. CRA (Comp 1 & 2)</span>
                    {isReliefExpanded("cra") ? (
                      <ChevronUp className="h-3.5 w-3.5 text-amber-600" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <p className="font-mono text-xs font-bold">{money(taxDetail.cra)}</p>
                  <span className="text-primary text-[10px] underline">
                    {isReliefExpanded("cra") ? "Hide ▲" : "Math ▼"}
                  </span>
                </div>
              </div>

              {/* PITA Chargeable Income */}
              <div
                onClick={() => toggleReliefExpand("chargeable")}
                className={`cursor-pointer rounded-md border p-2.5 transition-all select-none ${
                  isReliefExpanded("chargeable")
                    ? "border-amber-500 bg-amber-500/20"
                    : "border-amber-500/40 bg-amber-500/10 hover:border-amber-500"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  <span>PITA Chargeable Income (Annual)</span>
                  {isReliefExpanded("chargeable") ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </div>
                <p className="font-mono text-sm font-bold text-amber-700 dark:text-amber-300">
                  {money(taxDetail.chargeableIncome)}
                </p>
              </div>

              {/* PITA Dropdown Accordion Content */}
              {isReliefExpanded("pension") && (
                <div className="border-border bg-background space-y-1 rounded border p-2.5 font-mono text-xs">
                  <div className="border-border/40 border-b pb-1 font-sans text-[11px] font-semibold">
                    PITA Pension Relief Math:
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Annual Basic Salary (50%):</span>
                    <span>{money(currentBreakdown.basic)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-amber-600">
                    <span>Annual Pension (8% × Basic):</span>
                    <span>{money(currentBreakdown.pensionEmployeeAnnual)}</span>
                  </div>
                </div>
              )}

              {isReliefExpanded("cra") && (
                <div className="border-border bg-background space-y-1 rounded border p-2.5 font-mono text-xs">
                  <div className="border-border/40 border-b pb-1 font-sans text-[11px] font-semibold">
                    PITA CRA Math (Comp 1 + Comp 2):
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Gross Income:</span>
                    <span>{money(currentBreakdown.annualGross)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-red-600">
                    <span>Less Pension:</span>
                    <span>-{money(taxDetail.totalReliefs)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Net Income:</span>
                    <span>{money(taxDetail.netForCRA)}</span>
                  </div>
                  <div className="text-muted-foreground flex justify-between text-[10px]">
                    <span>Comp 1 [Max(1% Net, ₦200k)]:</span>
                    <span>{money(Math.max(0.01 * taxDetail.netForCRA, 200000))}</span>
                  </div>
                  <div className="text-muted-foreground flex justify-between text-[10px]">
                    <span>Comp 2 [20% of Net Income]:</span>
                    <span>{money(0.2 * taxDetail.netForCRA)}</span>
                  </div>
                  <div className="border-border/40 flex justify-between border-t pt-1 text-[10px] font-bold text-amber-600">
                    <span>Total CRA Relief:</span>
                    <span>{money(taxDetail.cra)}</span>
                  </div>
                </div>
              )}

              {isReliefExpanded("chargeable") && (
                <div className="border-border bg-background space-y-1 rounded border p-2.5 font-mono text-xs">
                  <div className="border-border/40 border-b pb-1 font-sans text-[11px] font-semibold">
                    PITA Chargeable Income Math:
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Net Income (Gross - Pension):</span>
                    <span>{money(taxDetail.netForCRA)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-amber-600">
                    <span>Less CRA Relief:</span>
                    <span>-{money(taxDetail.cra)}</span>
                  </div>
                  <div className="border-border/40 flex justify-between border-t pt-1 text-[10px] font-bold text-amber-600">
                    <span>PITA Chargeable Income:</span>
                    <span>{money(taxDetail.chargeableIncome)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* COLUMN 2: New Tax Reform Reliefs (No Comp 1/2 + Static 500k Relief) */}
            <div className="border-primary/30 bg-primary/5 space-y-3 rounded-lg border p-3">
              <div className="border-primary/20 flex items-center justify-between border-b pb-2">
                <span className="text-primary text-xs font-semibold">New Tax Reform Relief Structure</span>
                <Badge variant="default" className="bg-primary font-mono text-[9px]">
                  2025/2026 Reform
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {/* Reform Pension Card */}
                <div
                  onClick={() => toggleReliefExpand("reform-pension")}
                  className={`cursor-pointer rounded-md border p-2.5 transition-all select-none ${
                    isReliefExpanded("reform-pension")
                      ? "border-primary bg-primary/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-primary/50"
                  }`}
                >
                  <div className="text-muted-foreground flex items-center justify-between text-[11px] font-medium">
                    <span>1. Pension (8%)</span>
                    {isReliefExpanded("reform-pension") ? (
                      <ChevronUp className="text-primary h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <p className="font-mono text-xs font-bold">{money(currentBreakdown.pensionEmployeeAnnual)}</p>
                  <span className="text-primary text-[10px] underline">
                    {isReliefExpanded("reform-pension") ? "Hide ▲" : "Math ▼"}
                  </span>
                </div>

                {/* Reform Static 500k Relief Card */}
                <div
                  onClick={() => toggleReliefExpand("reform-static")}
                  className={`cursor-pointer rounded-md border p-2.5 transition-all select-none ${
                    isReliefExpanded("reform-static")
                      ? "border-primary bg-primary/20 shadow-sm"
                      : "border-border/60 bg-background/80 hover:border-primary/50"
                  }`}
                >
                  <div className="text-muted-foreground flex items-center justify-between text-[11px] font-medium">
                    <span>2. Static Relief (No CRA)</span>
                    {isReliefExpanded("reform-static") ? (
                      <ChevronUp className="text-primary h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">₦500,000.00</p>
                  <span className="text-primary text-[10px] underline">
                    {isReliefExpanded("reform-static") ? "Hide ▲" : "Rule info ▼"}
                  </span>
                </div>
              </div>

              {/* Reform Chargeable Income */}
              <div
                onClick={() => toggleReliefExpand("reform-chargeable")}
                className={`cursor-pointer rounded-md border p-2.5 transition-all select-none ${
                  isReliefExpanded("reform-chargeable")
                    ? "border-primary bg-primary/20"
                    : "border-primary/40 bg-primary/10 hover:border-primary"
                }`}
              >
                <div className="text-primary flex items-center justify-between text-[11px] font-semibold">
                  <span>New Reform Chargeable Income (Annual)</span>
                  {isReliefExpanded("reform-chargeable") ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </div>
                <p className="text-primary font-mono text-sm font-bold">{money(reformTaxDetail.chargeableIncome)}</p>
              </div>

              {/* Reform Dropdown Accordion Content */}
              {isReliefExpanded("reform-pension") && (
                <div className="border-border bg-background space-y-1 rounded border p-2.5 font-mono text-xs">
                  <div className="border-border/40 border-b pb-1 font-sans text-[11px] font-semibold">
                    New Reform Pension Math:
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Annual Basic Salary (50%):</span>
                    <span>{money(currentBreakdown.basic)}</span>
                  </div>
                  <div className="text-primary flex justify-between text-[10px] font-bold">
                    <span>Annual Pension Relief (8%):</span>
                    <span>{money(currentBreakdown.pensionEmployeeAnnual)}</span>
                  </div>
                </div>
              )}

              {isReliefExpanded("reform-static") && (
                <div className="border-border bg-background space-y-1 rounded border p-2.5 font-mono text-xs">
                  <div className="border-border/40 text-primary border-b pb-1 font-sans text-[11px] font-semibold">
                    New Tax Reform Exemption Rule:
                  </div>
                  <p className="text-muted-foreground font-sans text-[10px]">
                    Under the new Tax Reform Act, CRA Components 1 & 2 (1% Net & 20% Net) are <strong>removed</strong>.
                    Instead, employees receive a <strong>static ₦500,000 statutory relief</strong> plus the 0% tax
                    threshold on the first ₦800,000!
                  </p>
                  <div className="border-border/40 flex justify-between border-t pt-1 text-[10px] font-bold text-emerald-600">
                    <span>Fixed Statutory Relief:</span>
                    <span>₦500,000.00</span>
                  </div>
                </div>
              )}

              {isReliefExpanded("reform-chargeable") && (
                <div className="border-border bg-background space-y-1 rounded border p-2.5 font-mono text-xs">
                  <div className="border-border/40 border-b pb-1 font-sans text-[11px] font-semibold">
                    New Reform Chargeable Income Math:
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Annual Gross Income:</span>
                    <span>{money(currentBreakdown.annualGross)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-red-600">
                    <span>Less Pension (8%):</span>
                    <span>-{money(currentBreakdown.pensionEmployeeAnnual)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-emerald-600">
                    <span>Less Static Relief:</span>
                    <span>-₦500,000.00</span>
                  </div>
                  <div className="text-primary border-border/40 flex justify-between border-t pt-1 text-[10px] font-bold">
                    <span>New Chargeable Income:</span>
                    <span>{money(reformTaxDetail.chargeableIncome)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-border/40 space-y-3 border-t pt-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h4 className="text-foreground text-xs font-bold tracking-wider uppercase">
                Tax Bracket Computation (2-Column Schedule Comparison):
              </h4>
              <Badge
                variant="outline"
                className="w-fit border-amber-500/30 bg-amber-500/10 font-mono text-[11px] text-amber-700 dark:text-amber-300"
              >
                PITA vs New Tax Reform Act
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Column 1: Current Tax Schedule (PITA) */}
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Column 1: Current PITA Tax Schedule
                  </span>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    7% – 24%
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {taxDetail.brackets.map((b, idx) => (
                    <div
                      key={idx}
                      className="border-border/40 bg-background/60 flex items-center justify-between rounded border p-2 text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="px-1 py-0 font-mono text-[9px]">
                          B{idx + 1}
                        </Badge>
                        <span className="text-[11px] font-medium">{b.label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-muted-foreground">{money(b.amount)}</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400">{money(b.tax)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex items-center justify-between rounded border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs font-bold text-amber-700 dark:text-amber-300">
                  <span>Current Monthly Tax:</span>
                  <span className="font-mono text-sm">{money(currentBreakdown.monthlyTax)}</span>
                </div>
              </div>

              {/* Column 2: New Tax Reform Schedule (Proposed) */}
              <div className="border-primary/30 bg-primary/5 space-y-2 rounded-lg border p-3">
                <div className="border-primary/20 flex items-center justify-between border-b pb-2">
                  <span className="text-primary text-xs font-semibold">Column 2: New Tax Reform Schedule</span>
                  <Badge variant="default" className="bg-primary font-mono text-[10px]">
                    0% – 25% (2025/2026 Reform)
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {reformTaxDetail.brackets.map((b, idx) => (
                    <div
                      key={idx}
                      className="border-border/40 bg-background/60 flex items-center justify-between rounded border p-2 text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="px-1 py-0 font-mono text-[9px]">
                          B{idx + 1}
                        </Badge>
                        <span className="text-[11px] font-medium">{b.label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-muted-foreground">{money(b.amount)}</span>
                        <span className="text-primary font-bold">{money(b.tax)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-primary/40 bg-primary/10 text-primary mt-2 flex items-center justify-between rounded border p-2.5 text-xs font-bold">
                  <span>New Reform Monthly Tax:</span>
                  <span className="font-mono text-sm">{money(reformTaxDetail.monthlyTax)}</span>
                </div>
              </div>
            </div>

            {/* Variance & Savings Banner */}
            <div className="border-border bg-muted/30 flex flex-col items-center justify-between gap-2 rounded-lg border p-3 text-xs sm:flex-row">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary h-4 w-4" />
                <span className="font-semibold">New Tax Reform Impact:</span>
                <span className="text-muted-foreground">
                  Monthly Tax Diff:{" "}
                  <strong
                    className={
                      reformTaxDetail.monthlyTax <= currentBreakdown.monthlyTax ? "text-emerald-600" : "text-red-600"
                    }
                  >
                    {reformTaxDetail.monthlyTax <= currentBreakdown.monthlyTax ? "-" : "+"}
                    {money(Math.abs(reformTaxDetail.monthlyTax - currentBreakdown.monthlyTax))}
                  </strong>
                </span>
              </div>

              <div className="font-mono text-xs font-bold">
                Take-Home Net (New Reform):{" "}
                <span className="text-emerald-600 dark:text-emerald-400">
                  {money(
                    currentBreakdown.monthlyGross -
                      (currentBreakdown.totalDeductions - currentBreakdown.monthlyTax + reformTaxDetail.monthlyTax)
                  )}
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
              <div className="border-border bg-muted/40 space-y-2 rounded-lg border p-4">
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
                  <span className="text-primary font-mono font-bold">{money(currentBreakdown.monthlyGross)}</span>
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
              <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleApprove}>
                Confirm & Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DataTablePage>
  )
}
