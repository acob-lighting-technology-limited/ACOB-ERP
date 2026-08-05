"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { toLocalISODate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"
import { logger } from "@/lib/logger"

const log = logger("admin-hr-leave-add")

type EmployeeOption = { value: string; label: string; department?: string | null }

/** A selectable leave type. `remaining` is null when the employee has no balance row (e.g. LWOP). */
type LeaveTypeOption = { id: string; name: string; remaining: number | null }

type BalanceRow = {
  leave_type_id: string
  allocated_days?: number | null
  used_days?: number | null
  carry_forward_days?: number | null
  balance_days?: number | null
  leave_type?: { id: string; name: string } | null
}

type LeaveTypeRow = { id: string; name: string; is_active?: boolean | null }

/** Inclusive calendar-day span, mirroring the manual-leave route's own count. */
function daysInclusive(start: string, end: string): number | null {
  if (!start || !end || end < start) return null
  const ms = new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1
}

async function fetchEmployees(): Promise<EmployeeOption[]> {
  const res = await apiFetch("/api/admin/hr/leave/employees", { cache: "no-store" })
  const payload = (await res.json().catch(() => null)) as { data?: EmployeeOption[] } | null
  return res.ok ? (payload?.data ?? []) : []
}

/**
 * Types the employee can be granted: every active leave type, annotated with the
 * remaining balance where a current-year balance row exists. Types without a row
 * (LWOP) stay selectable — the route simply has no balance to draw down.
 */
async function fetchLeaveTypeOptions(userId: string): Promise<LeaveTypeOption[]> {
  try {
    const [balancesRes, typesRes] = await Promise.all([
      apiFetch(`/api/admin/hr/attendance/leave/balances?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" }),
      apiFetch("/api/hr/leave/types", { cache: "no-store" }),
    ])

    const balancePayload = (await balancesRes.json().catch(() => null)) as { data?: BalanceRow[] } | null
    const typesPayload = (await typesRes.json().catch(() => null)) as { data?: LeaveTypeRow[] } | null

    const remainingByType = new Map<string, number>()
    if (balancesRes.ok) {
      for (const b of balancePayload?.data ?? []) {
        const remaining =
          b.balance_days != null
            ? Number(b.balance_days)
            : Number(b.allocated_days || 0) + Number(b.carry_forward_days || 0) - Number(b.used_days || 0)
        remainingByType.set(b.leave_type_id, remaining)
      }
    }

    // Active types only — retired types (Casual/Encashment/Personal) must not be grantable.
    const activeTypes = (typesRes.ok ? (typesPayload?.data ?? []) : []).filter((t) => t.is_active !== false)

    return activeTypes.map((t) => ({
      id: t.id,
      name: t.name,
      remaining: remainingByType.has(t.id) ? (remainingByType.get(t.id) as number) : null,
    }))
  } catch (err) {
    log.error({ err: String(err) }, "Failed to load leave type options")
    return []
  }
}

export function AddLeaveDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [userId, setUserId] = useState("")
  const [types, setTypes] = useState<LeaveTypeOption[]>([])
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [leaveTypeId, setLeaveTypeId] = useState("")
  const [startDate, setStartDate] = useState(toLocalISODate())
  const [endDate, setEndDate] = useState(toLocalISODate())
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  // Reset to a clean form each time the dialog is opened.
  useEffect(() => {
    if (!open) return
    setUserId("")
    setTypes([])
    setLeaveTypeId("")
    setStartDate(toLocalISODate())
    setEndDate(toLocalISODate())
    setReason("")
    void fetchEmployees().then(setEmployees)
  }, [open])

  useEffect(() => {
    if (!userId) {
      setTypes([])
      setLeaveTypeId("")
      return
    }
    setLoadingTypes(true)
    void fetchLeaveTypeOptions(userId).then((opts) => {
      setTypes(opts)
      setLeaveTypeId(opts[0]?.id ?? "")
      setLoadingTypes(false)
    })
  }, [userId])

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.value,
        label: e.department ? `${e.label} — ${e.department}` : e.label,
      })),
    [employees]
  )

  const selectedType = types.find((t) => t.id === leaveTypeId) ?? null
  const previewDays = daysInclusive(startDate, endDate)
  const wouldOverdraw =
    selectedType?.remaining != null && previewDays != null && selectedType.remaining - previewDays < 0

  async function save() {
    if (!userId) return toast.error("Select an employee")
    if (!leaveTypeId) return toast.error("Select a leave type")
    if (!startDate || !endDate || endDate < startDate) return toast.error("Set a valid date range")
    if (reason.trim().length < 3) return toast.error("A reason of at least 3 characters is required")

    setSaving(true)
    try {
      const res = await apiFetch("/api/admin/hr/attendance/leave/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          leave_type_id: leaveTypeId,
          start_date: startDate,
          end_date: endDate,
          reason: reason.trim(),
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; days_count?: number } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to add leave")
        return
      }
      toast.success(`Leave recorded (${payload?.days_count ?? previewDays ?? ""} day(s))`)
      onOpenChange(false)
      onAdded()
    } catch (err) {
      log.error({ err: String(err) }, "Manual leave save failed")
      toast.error("Failed to add leave")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Leave</DialogTitle>
          <DialogDescription>
            Record approved leave directly, bypassing the request and approval workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label>
              Employee <span className="text-destructive">*</span>
            </Label>
            <SearchableSelect
              value={userId}
              onValueChange={setUserId}
              options={employeeOptions}
              placeholder="Select an employee"
              searchPlaceholder="Search employees…"
            />
          </div>

          <div className="space-y-1">
            <Label>
              Leave Type <span className="text-destructive">*</span>
            </Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId} disabled={!userId || loadingTypes}>
              <SelectTrigger>
                <SelectValue
                  placeholder={!userId ? "Select an employee first" : loadingTypes ? "Loading…" : "Select type"}
                />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.remaining != null ? ` — ${t.remaining} day(s) left` : " — no balance tracked"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>End Date</Label>
              <Input
                type="date"
                min={startDate || undefined}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {selectedType && previewDays != null && (
            <p className="text-muted-foreground text-xs">
              {previewDays} day(s)
              {selectedType.remaining != null && (
                <>
                  {" · balance "}
                  {selectedType.remaining} →{" "}
                  <span className={wouldOverdraw ? "font-medium text-red-600" : ""}>
                    {selectedType.remaining - previewDays}
                  </span>
                </>
              )}
            </p>
          )}

          <div className="space-y-1">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Emergency family situation — pre-approved by HOD"
              rows={2}
            />
          </div>

          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            ⚠ This creates an already-approved leave record and draws down the employee&rsquo;s balance. It skips the
            reliever, supervisor, and HR approval stages entirely.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !userId || !leaveTypeId}>
            {saving ? "Saving…" : "Add Leave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
