"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DollarSign, Search, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

interface SalaryRow {
  user_id: string
  full_name: string
  employee_number: string
  department: string
  is_department_lead: boolean
  gross_salary: number
}

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

function parseRawNumber(val: string): number {
  if (!val) return 0
  const cleaned = String(val)
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "")
  return parseFloat(cleaned) || 0
}

/**
 * Every active employee's gross salary, all editable inline in one register —
 * no per-row "Edit" hop. Only rows the admin actually changes are submitted,
 * in one bulk save, so an untouched employee's salary history is never
 * disturbed by a save that didn't concern them.
 *
 * Self-contained: fetches its own data when opened, so it drops into any page
 * (the payroll register, a period's worksheet) as `<ManageGrossSalaryDialog />`
 * with no props — one component, one API route, one formula (SSOT).
 */
export function ManageGrossSalaryDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<SalaryRow[]>([])
  const [search, setSearch] = useState("")
  const [edits, setEdits] = useState<Record<string, string>>({})

  const loadSalaries = async () => {
    setLoading(true)
    try {
      const res = await apiFetch("/api/admin/payroll/salaries")
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load salaries")
      setRows(payload.data || [])
      setEdits({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load salaries")
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) loadSalaries()
  }

  const dirtyUserIds = Object.keys(edits).filter((userId) => {
    const row = rows.find((r) => r.user_id === userId)
    if (!row) return false
    const parsed = parseRawNumber(edits[userId])
    return parsed > 0 && Math.abs(parsed - row.gross_salary) > 0.005
  })

  const handleSave = async () => {
    if (dirtyUserIds.length === 0 || saving) return
    setSaving(true)
    try {
      const updates = dirtyUserIds.map((userId) => ({
        user_id: userId,
        gross_salary: parseRawNumber(edits[userId]),
      }))

      const res = await apiFetch("/api/admin/payroll/salaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save salary changes")

      const failed = (payload.results || []).filter((r: any) => r.error)
      if (failed.length > 0) {
        toast.error(`${failed.length} of ${updates.length} salary changes failed to save`)
      } else {
        toast.success(`Updated gross salary for ${payload.updated} employee${payload.updated === 1 ? "" : "s"}`)
      }

      await loadSalaries()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save salary changes")
    } finally {
      setSaving(false)
    }
  }

  const filtered = rows.filter((emp) =>
    `${emp.full_name} ${emp.employee_number} ${emp.department}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <DollarSign className="mr-1.5 h-4 w-4" /> Manage Gross Salary
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-emerald-500" />
            Manage Employee Gross Salary
          </DialogTitle>
          <DialogDescription className="text-xs">
            Edit any employee&apos;s monthly gross salary directly in the table below, then save. Changes take effect
            from today.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold">Active Salaries Register ({filtered.length})</span>
            <div className="relative w-full sm:w-48">
              <Search className="text-muted-foreground absolute top-2 left-2 h-3.5 w-3.5" />
              <Input
                placeholder="Search staff..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 pl-7 text-[11px]"
              />
            </div>
          </div>

          <div className="border-border/60 max-h-[360px] overflow-x-auto overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-[11px]">
                  <TableHead>Staff Member</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="font-mono">Gross Salary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground py-8 text-center">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground py-8 text-center">
                      No employees found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((emp) => {
                    const isDirty = dirtyUserIds.includes(emp.user_id)
                    return (
                      <TableRow key={emp.user_id} className={isDirty ? "bg-emerald-500/5" : ""}>
                        <TableCell className="py-2">
                          <div className="text-foreground font-medium">{emp.full_name}</div>
                          <div className="text-muted-foreground font-mono text-[10px]">
                            {emp.employee_number}
                            {emp.is_department_lead ? " • Dept Lead" : ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground py-2 text-xs">{emp.department}</TableCell>
                        <TableCell className="py-2">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={edits[emp.user_id] ?? formatWithCommas(emp.gross_salary)}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) =>
                              setEdits((prev) => ({ ...prev, [emp.user_id]: formatWithCommas(e.target.value) }))
                            }
                            className={`h-8 w-32 font-mono text-xs font-bold ${
                              isDirty ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" : ""
                            }`}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={dirtyUserIds.length === 0 || saving}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              `Save Changes${dirtyUserIds.length > 0 ? ` (${dirtyUserIds.length})` : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
