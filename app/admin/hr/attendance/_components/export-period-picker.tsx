"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { monthBounds, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { apiFetch } from "@/lib/api-client"
import { logger } from "@/lib/logger"

const log = logger("export-period-picker")

export type ExportPeriodType = "month" | "custom" | "payroll"

export interface ResolvedExportPeriod {
  start: string
  end: string
  /** Filename-safe label. */
  label: string
  /** Human-readable label for report headings. */
  title: string
}

export interface PayrollPeriodOption {
  id: string
  name: string
  start_date: string
  end_date: string
}

/**
 * Shared period selection for attendance exports: a calendar month, a free date
 * range, or an existing payroll period. The payroll option exists so an exported
 * attendance/lunch sheet covers exactly the days payroll charged for — the payroll
 * run is driven by `payroll_periods.start_date/end_date`, which need not be a month.
 */
export function useExportPeriod() {
  const [periodType, setPeriodType] = useState<ExportPeriodType>("month")
  const [month, setMonth] = useState(toLocalYearMonth())
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [payrollPeriodId, setPayrollPeriodId] = useState("")
  const [payrollPeriods, setPayrollPeriods] = useState<PayrollPeriodOption[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch("/api/admin/payroll/periods", { cache: "no-store" })
        const payload = (await res.json().catch(() => null)) as { data?: PayrollPeriodOption[] } | null
        if (!cancelled && res.ok) setPayrollPeriods(payload?.data ?? [])
      } catch (err) {
        log.error({ err: String(err) }, "Failed to load payroll periods for export picker")
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  function resolve(): ResolvedExportPeriod | null {
    if (periodType === "month") {
      const { start, end } = monthBounds(month)
      return { start, end, label: month, title: month }
    }
    if (periodType === "payroll") {
      const selected = payrollPeriods.find((p) => p.id === payrollPeriodId)
      if (!selected) return null
      return {
        start: selected.start_date,
        end: selected.end_date,
        label: selected.name.replace(/\s+/g, "_"),
        title: `${selected.name} (${selected.start_date} → ${selected.end_date})`,
      }
    }
    if (!startDate || !endDate || startDate > endDate) return null
    return {
      start: startDate,
      end: endDate,
      label: `${startDate}_to_${endDate}`,
      title: `${startDate} → ${endDate}`,
    }
  }

  function validationMessage(): string {
    if (periodType === "payroll") return "Pick a payroll period"
    if (periodType === "custom") return "Pick a valid start and end date"
    return "Pick a month"
  }

  return {
    periodType,
    setPeriodType,
    month,
    setMonth,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    payrollPeriodId,
    setPayrollPeriodId,
    payrollPeriods,
    resolve,
    validationMessage,
  }
}

export function ExportPeriodFields({
  picker,
  monthOptions,
}: {
  picker: ReturnType<typeof useExportPeriod>
  monthOptions: { value: string; label: string }[]
}) {
  const selectedPayroll = picker.payrollPeriods.find((p) => p.id === picker.payrollPeriodId)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Period</Label>
        <Select value={picker.periodType} onValueChange={(v) => picker.setPeriodType(v as ExportPeriodType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Specific Month</SelectItem>
            <SelectItem value="custom">Custom Date Range</SelectItem>
            <SelectItem value="payroll">Payroll Period</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {picker.periodType === "month" && (
        <div className="space-y-2">
          <Label>Month</Label>
          <Select value={picker.month} onValueChange={picker.setMonth}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {picker.periodType === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Start Date</Label>
            <Input type="date" value={picker.startDate} onChange={(e) => picker.setStartDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>End Date</Label>
            <Input
              type="date"
              min={picker.startDate || undefined}
              value={picker.endDate}
              onChange={(e) => picker.setEndDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {picker.periodType === "payroll" && (
        <div className="space-y-2">
          <Label>Payroll Period</Label>
          <Select value={picker.payrollPeriodId} onValueChange={picker.setPayrollPeriodId}>
            <SelectTrigger>
              <SelectValue placeholder={picker.payrollPeriods.length ? "Select period" : "No payroll periods yet"} />
            </SelectTrigger>
            <SelectContent>
              {picker.payrollPeriods.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedPayroll && (
            <p className="text-muted-foreground text-xs">
              Covers {selectedPayroll.start_date} → {selectedPayroll.end_date} — the exact days this payroll run charges
              for.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
