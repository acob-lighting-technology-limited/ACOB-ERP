"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Trash2, CalendarDays, ShieldOff, MapPin, CheckCircle2, Plane, Pencil, Clock, Sunrise } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate } from "@/lib/hr/attendance-utils"
import { formatWATDate } from "@/lib/utils/date"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("attendance-manager-dialog")

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface AttendanceReport {
  user_id: string
  user_name: string
  department: string
  employee_no?: string
  attendance_exempt?: boolean
  exempted_days?: number
}

interface Holiday {
  holiday_date: string
  name?: string | null
}

interface AttendanceManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reports: AttendanceReport[]
  yearMonth: string
  holidays: Holiday[]
  onHolidaysChanged: () => void
  onReportChanged: () => void
  lockedDepartment?: string
}

// ────────────────────────────────────────────────────────────
// Date helpers + grouping
// ────────────────────────────────────────────────────────────

function formatDay(date: string) {
  return formatWATDate(date, { month: "short", day: "numeric" })
}

/** "Jun 12" for a single day, "Jun 15 – 17" / "Jun 30 – Jul 2" for a range. */
function formatRangeLabel(start: string, end: string) {
  if (start === end) return formatDay(start)
  return `${formatDay(start)} – ${formatDay(end)}`
}

interface ManualRecord {
  id: string
  user_id: string
  user_name: string
  date: string
  manual_comment: string | null
}

interface EntryGroup {
  user_id: string
  user_name: string
  ids: string[]
  start: string
  end: string
  comment: string | null
}

/** Groups per-day manual records (same employee + comment, contiguous workdays) into ranges. */
function groupRecords(records: ManualRecord[]): EntryGroup[] {
  const byKey = new Map<string, ManualRecord[]>()
  for (const r of records) {
    const key = `${r.user_id}::${r.manual_comment ?? ""}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(r)
  }

  const groups: EntryGroup[] = []
  for (const list of byKey.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date))
    let cur: ManualRecord[] = []
    const flush = () => {
      if (cur.length === 0) return
      groups.push({
        user_id: cur[0].user_id,
        user_name: cur[0].user_name,
        ids: cur.map((c) => c.id),
        start: cur[0].date,
        end: cur[cur.length - 1].date,
        comment: cur[0].manual_comment,
      })
      cur = []
    }
    for (const r of list) {
      if (cur.length === 0) {
        cur = [r]
        continue
      }
      const prev = cur[cur.length - 1].date
      const gapDays = (Date.parse(`${r.date}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`)) / 86_400_000
      // Bridge weekends so Fri→Mon stays one range, but split on real gaps.
      if (gapDays >= 1 && gapDays <= 3) cur.push(r)
      else {
        flush()
        cur = [r]
      }
    }
    flush()
  }

  groups.sort((a, b) => b.start.localeCompare(a.start))
  return groups
}

// ────────────────────────────────────────────────────────────
// Shared presentational helpers
// ────────────────────────────────────────────────────────────

function EntriesPanel({
  title,
  loading,
  count,
  emptyText,
  children,
  search,
  onSearchChange,
  searchPlaceholder,
}: {
  title: string
  loading: boolean
  count: number
  emptyText: string
  children: ReactNode
  search?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
}) {
  return (
    <div className="mt-2">
      <Label className="text-muted-foreground mb-2 block text-xs tracking-wider uppercase">{title}</Label>
      {onSearchChange && (
        <Input
          className="mb-2 h-8 text-sm"
          placeholder={searchPlaceholder ?? "Search…"}
          value={search ?? ""}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      )}
      <div className="max-h-56 space-y-1 overflow-auto rounded border p-2">
        {loading ? (
          <p className="text-muted-foreground py-2 text-center text-sm">Loading…</p>
        ) : count === 0 ? (
          <p className="text-muted-foreground py-2 text-center text-sm">{search?.trim() ? "No matches" : emptyText}</p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function EntryRow({
  primary,
  badge,
  comment,
  onEdit,
  onDelete,
  busy,
}: {
  primary: string
  badge: string
  comment?: string | null
  onEdit?: () => void
  onDelete: () => void
  busy?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{primary}</span>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {badge}
          </Badge>
        </div>
        {comment ? <p className="text-muted-foreground truncate text-xs">{comment}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onEdit && (
          <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onEdit} disabled={busy}>
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onDelete} disabled={busy}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  onConfirm: () => void
  busy?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Searchable single-employee picker (leave is per-person, so no multi-select). */
function EmployeeSingleSelect({
  reports,
  selectedId,
  onSelect,
}: {
  reports: AttendanceReport[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = useState("")
  const filtered = reports.filter((r) =>
    `${r.user_name} ${r.department} ${r.employee_no ?? ""}`.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div className="space-y-2">
      <Input placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-40 space-y-0.5 overflow-auto rounded border p-2">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-2 text-center text-sm">No employees found</p>
        ) : (
          filtered.map((row) => (
            <label
              key={row.user_id}
              className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
            >
              <input
                type="radio"
                name="leave-employee"
                checked={selectedId === row.user_id}
                onChange={() => onSelect(row.user_id)}
              />
              <span>{row.user_name}</span>
              <span className="text-muted-foreground text-xs">({row.department})</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}

function EmployeeCheckList({
  reports,
  selected,
  onChange,
  search,
  onSearchChange,
}: {
  reports: AttendanceReport[]
  selected: string[]
  onChange: (ids: string[]) => void
  search: string
  onSearchChange: (v: string) => void
}) {
  const filtered = reports.filter((r) =>
    `${r.user_name} ${r.department} ${r.employee_no ?? ""}`.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div className="space-y-2">
      <Input placeholder="Search employee…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(filtered.map((r) => r.user_id))}>
          Select All
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
          Clear
        </Button>
        {selected.length > 0 && (
          <span className="text-muted-foreground ml-auto text-xs">{selected.length} selected</span>
        )}
      </div>
      <div className="max-h-44 space-y-0.5 overflow-auto rounded border p-2">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-2 text-center text-sm">No employees found</p>
        ) : (
          filtered.map((row) => (
            <label
              key={row.user_id}
              className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(row.user_id)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, row.user_id] : selected.filter((id) => id !== row.user_id))
                }
              />
              <span>{row.user_name}</span>
              <span className="text-muted-foreground text-xs">({row.department})</span>
              {(row.attendance_exempt || (row.exempted_days ?? 0) > 0) && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  Exempted
                </Badge>
              )}
            </label>
          ))
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Exemption
// ────────────────────────────────────────────────────────────

interface ExemptionEntry {
  kind: "permanent" | "period"
  id: string | null
  user_id: string
  user_name: string
  start_date: string | null
  end_date: string | null
  reason: string | null
}

function ExemptionTab({
  reports,
  yearMonth,
  onDone,
}: {
  reports: AttendanceReport[]
  yearMonth: string
  onDone: () => void
}) {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mode, setMode] = useState<"off" | "infinite" | "weekly" | "monthly" | "period">("off")
  const [month, setMonth] = useState(yearMonth)
  const [weeks, setWeeks] = useState<number[]>([])
  const [months, setMonths] = useState<string[]>([])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [entries, setEntries] = useState<ExemptionEntry[] | null>(null)
  const [listSearch, setListSearch] = useState("")
  const [pastView, setPastView] = useState(false)
  const [confirmEntry, setConfirmEntry] = useState<ExemptionEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<ExemptionEntry | null>(null)
  const [eStart, setEStart] = useState("")
  const [eEnd, setEEnd] = useState("")
  const [eReason, setEReason] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  const loadEntries = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/hr/attendance/exemptions?list=1", { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: ExemptionEntry[] } | null
      setEntries(res.ok ? (payload?.data ?? []) : [])
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  async function save() {
    if (selectedIds.length === 0) {
      toast.error("Select at least one employee")
      return
    }
    if (mode !== "off" && !reason.trim()) {
      toast.error("A comment is required")
      return
    }
    setSaving(true)
    try {
      // Custom periods are additive — adding/editing one window must not wipe an
      // employee's other exemption periods. Edit = delete the old period + add the new.
      if (mode === "period") {
        if (!startDate || !endDate || endDate < startDate) {
          toast.error("Choose a valid start and end date")
          return
        }
        // Additive — adds a window per selected employee without touching their others.
        for (const uid of selectedIds) {
          const res = await apiFetch("/api/admin/hr/attendance/exemptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: uid, start_date: startDate, end_date: endDate, reason: reason.trim() }),
          })
          if (!res.ok) {
            const payload = (await res.json().catch(() => null)) as { error?: string } | null
            toast.error(payload?.error || "Failed to add exemption")
            return
          }
        }
        toast.success("Exemption saved")
        setSelectedIds([])
        setReason("")
        void loadEntries()
        onDone()
        return
      }

      // Pattern modes (off/weekly/monthly/infinite) deterministically rebuild the set.
      const body: Record<string, unknown> = {
        user_ids: selectedIds,
        mode,
        reason: mode === "off" ? undefined : reason.trim(),
      }
      if (mode === "weekly") {
        body.month = month
        body.weeks = weeks
      }
      if (mode === "monthly") body.months = months
      const res = await apiFetch("/api/admin/hr/attendance/exemptions/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to save exemption")
        return
      }
      toast.success("Exemption saved")
      setSelectedIds([])
      setReason("")
      void loadEntries()
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "exemption save failed")
      toast.error("Failed to save exemption")
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!confirmEntry) return
    const entry = confirmEntry
    setDeleting(true)
    try {
      const res =
        entry.kind === "period" && entry.id
          ? await apiFetch(`/api/admin/hr/attendance/exemptions?period_id=${encodeURIComponent(entry.id)}`, {
              method: "DELETE",
            })
          : await apiFetch("/api/admin/hr/attendance/exemptions/bulk", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_ids: [entry.user_id], mode: "off" }),
            })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to remove exemption")
        return
      }
      toast.success("Exemption removed")
      setConfirmEntry(null)
      void loadEntries()
      onDone()
    } finally {
      setDeleting(false)
    }
  }

  function openEdit(entry: ExemptionEntry) {
    setEditing(entry)
    setEStart(entry.start_date ?? "")
    setEEnd(entry.end_date ?? "")
    setEReason(entry.reason ?? "")
  }

  async function saveEdit() {
    if (!editing || !editing.id) return
    if (!eStart || !eEnd || eEnd < eStart || !eReason.trim()) {
      toast.error("Set a valid date range and reason")
      return
    }
    setEditSaving(true)
    try {
      // Replace just this window: remove the old period, add the new one (additive).
      const del = await apiFetch(`/api/admin/hr/attendance/exemptions?period_id=${encodeURIComponent(editing.id)}`, {
        method: "DELETE",
      })
      if (!del.ok) {
        const payload = (await del.json().catch(() => null)) as { error?: string } | null
        toast.error(payload?.error || "Failed to update exemption")
        return
      }
      const res = await apiFetch("/api/admin/hr/attendance/exemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: editing.user_id, start_date: eStart, end_date: eEnd, reason: eReason.trim() }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(payload?.error || "Failed to update exemption")
        return
      }
      toast.success("Exemption updated")
      setEditing(null)
      void loadEntries()
      onDone()
    } finally {
      setEditSaving(false)
    }
  }

  const today = toLocalISODate()
  const listQuery = listSearch.trim().toLowerCase()
  const visible = (entries ?? [])
    .filter((e) =>
      pastView
        ? e.kind === "period" && (e.end_date ?? "") < today
        : !(e.kind === "period" && (e.end_date ?? "") < today)
    )
    .filter((e) => `${e.user_name} ${e.reason ?? ""}`.toLowerCase().includes(listQuery))

  return (
    <div className="space-y-4 pt-2">
      <EmployeeCheckList
        reports={reports}
        selected={selectedIds}
        onChange={setSelectedIds}
        search={search}
        onSearchChange={setSearch}
      />

      <div className="space-y-2">
        <Label>Exemption Mode</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Disabled (remove exemption)</SelectItem>
            <SelectItem value="infinite">Permanent (until disabled)</SelectItem>
            <SelectItem value="weekly">Specific weeks in a month</SelectItem>
            <SelectItem value="monthly">Specific months</SelectItem>
            <SelectItem value="period">Custom date range</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "weekly" && (
        <div className="space-y-2">
          <Label>Month</Label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
          <Label>Weeks</Label>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((wk) => (
              <Button
                key={wk}
                type="button"
                variant={weeks.includes(wk) ? "default" : "outline"}
                size="sm"
                onClick={() => setWeeks((prev) => (prev.includes(wk) ? prev.filter((x) => x !== wk) : [...prev, wk]))}
              >
                Week {wk}
              </Button>
            ))}
          </div>
        </div>
      )}

      {mode === "monthly" && (
        <div className="space-y-2">
          <Label>Months</Label>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (!months.includes(month)) setMonths((prev) => [...prev, month].sort())
              }}
            >
              Add Month
            </Button>
          </div>
          {months.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {months.map((m) => (
                <Badge key={m} variant="secondary" className="gap-1">
                  {m}
                  <button
                    type="button"
                    onClick={() => setMonths((prev) => prev.filter((x) => x !== m))}
                    className="hover:text-destructive ml-0.5"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "period" && (
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
      )}

      {mode !== "off" && (
        <div className="space-y-1">
          <Label>
            Comment <span className="text-destructive">*</span>
          </Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Remote assignment" />
        </div>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={saving || selectedIds.length === 0}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : mode === "off" ? "Remove Exemption" : "Apply Exemption"}
      </Button>
      {mode !== "off" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ Exemption takes precedence in the roster even on days the employee clocked in. Their attendance is kept —
          removing the exemption restores it.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" variant={pastView ? "outline" : "default"} onClick={() => setPastView(false)}>
          Current
        </Button>
        <Button type="button" size="sm" variant={pastView ? "default" : "outline"} onClick={() => setPastView(true)}>
          Past
        </Button>
      </div>

      <EntriesPanel
        title={pastView ? "Past exemptions" : "Current exemptions"}
        loading={entries === null}
        count={visible.length}
        emptyText={pastView ? "No past exemptions" : "No active exemptions"}
        search={listSearch}
        onSearchChange={setListSearch}
        searchPlaceholder="Search exemptions…"
      >
        {visible.map((entry) => {
          const key = entry.id ?? `permanent-${entry.user_id}`
          return (
            <EntryRow
              key={key}
              primary={entry.user_name}
              badge={
                entry.kind === "permanent"
                  ? "Permanent"
                  : entry.start_date && entry.end_date
                    ? formatRangeLabel(entry.start_date, entry.end_date)
                    : "Period"
              }
              comment={entry.reason}
              onEdit={entry.kind === "period" && entry.id ? () => openEdit(entry) : undefined}
              onDelete={() => setConfirmEntry(entry)}
              busy={false}
            />
          )
        })}
      </EntriesPanel>

      {/* Edit modal (custom periods only) */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit exemption period</DialogTitle>
            <DialogDescription>{editing ? editing.user_name : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Date</Label>
                <Input type="date" value={eStart} onChange={(e) => setEStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End Date</Label>
                <Input type="date" min={eStart || undefined} value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>
                Comment <span className="text-destructive">*</span>
              </Label>
              <Input value={eReason} onChange={(e) => setEReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmEntry !== null}
        onOpenChange={(o) => !o && setConfirmEntry(null)}
        title="Remove exemption?"
        description={
          confirmEntry
            ? confirmEntry.kind === "permanent"
              ? `This removes ${confirmEntry.user_name}'s permanent exemption.`
              : `This removes ${confirmEntry.user_name}'s exemption window${confirmEntry.start_date && confirmEntry.end_date ? ` (${formatRangeLabel(confirmEntry.start_date, confirmEntry.end_date)})` : ""}.`
            : undefined
        }
        confirmLabel="Remove"
        onConfirm={() => void doDelete()}
        busy={deleting}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Holiday
// ────────────────────────────────────────────────────────────

function HolidayTab({ onChanged }: { onChanged: () => void }) {
  const [date, setDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isRange, setIsRange] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [allHolidays, setAllHolidays] = useState<Holiday[] | null>(null)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [listSearch, setListSearch] = useState("")
  const [confirmHoliday, setConfirmHoliday] = useState<Holiday | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/hr/attendance/holidays", { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: Holiday[] } | null
      setAllHolidays(res.ok ? (payload?.data ?? []) : [])
    } catch {
      setAllHolidays([])
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function addHoliday() {
    if (!date || !name.trim()) {
      toast.error("Please fill in the date and name")
      return
    }
    setSaving(true)
    const res = await apiFetch("/api/admin/hr/attendance/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holiday_date: date,
        holiday_date_end: isRange && endDate ? endDate : undefined,
        name: name || undefined,
      }),
    })
    const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    if (!res.ok) {
      toast.error(payload?.error || "Failed to add holiday")
    } else {
      toast.success(payload?.message || "Holiday added")
      setDate("")
      setEndDate("")
      setName("")
      void loadAll()
      onChanged()
    }
    setSaving(false)
  }

  async function removeHoliday(holidayDate: string) {
    setBusyDate(holidayDate)
    try {
      const res = await apiFetch(`/api/admin/hr/attendance/holidays?holiday_date=${encodeURIComponent(holidayDate)}`, {
        method: "DELETE",
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to remove holiday")
        return
      }
      toast.success("Holiday removed")
      void loadAll()
      onChanged()
    } finally {
      setBusyDate(null)
    }
  }

  // Group holidays by YYYY-MM for month headings (filtered by the list search)
  const listQuery = listSearch.trim().toLowerCase()
  const visibleHolidays = (allHolidays ?? []).filter((h) =>
    `${h.name ?? ""} ${h.holiday_date}`.toLowerCase().includes(listQuery)
  )
  const byMonth = new Map<string, Holiday[]>()
  for (const h of visibleHolidays) {
    const ym = h.holiday_date.slice(0, 7)
    if (!byMonth.has(ym)) byMonth.set(ym, [])
    byMonth.get(ym)!.push(h)
  }
  const monthKeys = [...byMonth.keys()].sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <Switch
          id="mgr-holiday-range"
          checked={isRange}
          onCheckedChange={(c) => {
            setIsRange(c)
            if (!c) setEndDate("")
          }}
        />
        <Label htmlFor="mgr-holiday-range">Date range (multiple days)</Label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{isRange ? "Start Date" : "Date"}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {isRange ? (
          <div className="space-y-1">
            <Label>
              End Date <span className="text-destructive">*</span>
            </Label>
            <Input type="date" min={date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label>
              Name <span className="text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Workers Day" />
          </div>
        )}
      </div>
      {isRange && (
        <div className="space-y-1">
          <Label>
            Name <span className="text-destructive">*</span>
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Christmas Break" />
        </div>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={!date || !name.trim() || saving || (isRange && (!endDate || endDate < date))}
        onClick={() => void addHoliday()}
      >
        {saving ? "Saving…" : isRange ? "Add Holidays" : "Add Holiday"}
      </Button>

      <div className="mt-2">
        <Label className="text-muted-foreground mb-2 block text-xs tracking-wider uppercase">All holidays</Label>
        <Input
          className="mb-2 h-8 text-sm"
          placeholder="Search holidays…"
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
        />
        <div className="max-h-60 space-y-2 overflow-auto rounded border p-2">
          {allHolidays === null ? (
            <p className="text-muted-foreground py-2 text-center text-sm">Loading…</p>
          ) : monthKeys.length === 0 ? (
            <p className="text-muted-foreground py-2 text-center text-sm">
              {listQuery ? "No matches" : "No holidays configured"}
            </p>
          ) : (
            monthKeys.map((ym) => (
              <div key={ym} className="space-y-1">
                <p className="text-muted-foreground px-1 text-[11px] font-semibold uppercase">
                  {formatWATDate(`${ym}-01`, { month: "long", year: "numeric" })}
                </p>
                {byMonth.get(ym)!.map((h) => (
                  <div
                    key={h.holiday_date}
                    className="flex items-center justify-between rounded border px-2 py-1.5 text-sm"
                  >
                    <span>
                      {formatDay(h.holiday_date)}
                      {h.name ? ` • ${h.name}` : ""}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      disabled={busyDate === h.holiday_date}
                      onClick={() => setConfirmHoliday(h)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmHoliday !== null}
        onOpenChange={(o) => !o && setConfirmHoliday(null)}
        title="Remove holiday?"
        description={
          confirmHoliday
            ? `This removes ${formatDay(confirmHoliday.holiday_date)}${confirmHoliday.name ? ` • ${confirmHoliday.name}` : ""} for everyone.`
            : undefined
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmHoliday) void removeHoliday(confirmHoliday.holiday_date)
          setConfirmHoliday(null)
        }}
        busy={confirmHoliday ? busyDate === confirmHoliday.holiday_date : false}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Early Closure (org-wide early office-close days)
// ────────────────────────────────────────────────────────────

interface EarlyClosure {
  closure_date: string
  close_time: string
  name?: string | null
}

function EarlyClosureTab({ onChanged }: { onChanged: () => void }) {
  const [date, setDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isRange, setIsRange] = useState(false)
  const [closeTime, setCloseTime] = useState("15:00")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [all, setAll] = useState<EarlyClosure[] | null>(null)
  const [listSearch, setListSearch] = useState("")
  const [confirm, setConfirm] = useState<EarlyClosure | null>(null)
  const [busyDate, setBusyDate] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/hr/attendance/early-closures", { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: EarlyClosure[] } | null
      setAll(res.ok ? (payload?.data ?? []) : [])
    } catch {
      setAll([])
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function add() {
    if (!date || !closeTime) {
      toast.error("Pick a date and closing time")
      return
    }
    setSaving(true)
    const res = await apiFetch("/api/admin/hr/attendance/early-closures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        closure_date: date,
        closure_date_end: isRange && endDate ? endDate : undefined,
        close_time: closeTime,
        name: name.trim() || undefined,
      }),
    })
    const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    if (!res.ok) {
      toast.error(payload?.error || "Failed to add early closure")
    } else {
      toast.success(payload?.message || "Early closure added")
      setDate("")
      setEndDate("")
      setName("")
      void loadAll()
      onChanged()
    }
    setSaving(false)
  }

  async function remove(closureDate: string) {
    setBusyDate(closureDate)
    try {
      const res = await apiFetch(
        `/api/admin/hr/attendance/early-closures?closure_date=${encodeURIComponent(closureDate)}`,
        { method: "DELETE" }
      )
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to remove early closure")
        return
      }
      toast.success("Early closure removed")
      void loadAll()
      onChanged()
    } finally {
      setBusyDate(null)
    }
  }

  const listQuery = listSearch.trim().toLowerCase()
  const visible = (all ?? []).filter((c) => `${c.name ?? ""} ${c.closure_date}`.toLowerCase().includes(listQuery))

  return (
    <div className="space-y-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Mark a day the whole office closed early. Staff who left <strong>at or after</strong> the closing time are not
        penalised; anyone who left before it still counts as Left Early.
      </p>
      <div className="flex items-center gap-3">
        <Switch
          id="mgr-closure-range"
          checked={isRange}
          onCheckedChange={(c) => {
            setIsRange(c)
            if (!c) setEndDate("")
          }}
        />
        <Label htmlFor="mgr-closure-range">Date range (multiple days)</Label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{isRange ? "Start Date" : "Date"}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {isRange ? (
          <div className="space-y-1">
            <Label>
              End Date <span className="text-destructive">*</span>
            </Label>
            <Input type="date" min={date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label>
              Closing Time <span className="text-destructive">*</span>
            </Label>
            <Input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
          </div>
        )}
      </div>
      {isRange && (
        <div className="space-y-1">
          <Label>
            Closing Time <span className="text-destructive">*</span>
          </Label>
          <Input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label>Reason / Note</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Company end-of-year event" />
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={!date || !closeTime || saving || (isRange && (!endDate || endDate < date))}
        onClick={() => void add()}
      >
        {saving ? "Saving…" : isRange ? "Add Early Closures" : "Add Early Closure"}
      </Button>

      <EntriesPanel
        title="All early closures"
        loading={all === null}
        count={visible.length}
        emptyText="No early closures configured"
        search={listSearch}
        onSearchChange={setListSearch}
        searchPlaceholder="Search early closures…"
      >
        {visible.map((c) => (
          <EntryRow
            key={c.closure_date}
            primary={`${formatDay(c.closure_date)} • closes ${c.close_time.slice(0, 5)}`}
            badge="Early Closure"
            comment={c.name}
            onDelete={() => setConfirm(c)}
            busy={busyDate === c.closure_date}
          />
        ))}
      </EntriesPanel>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Remove early closure?"
        description={
          confirm ? `This removes the early closure on ${formatDay(confirm.closure_date)} for everyone.` : undefined
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirm) void remove(confirm.closure_date)
          setConfirm(null)
        }}
        busy={confirm ? busyDate === confirm.closure_date : false}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Late Resumption (org-wide late-start days)
// ────────────────────────────────────────────────────────────

interface LateResumption {
  resumption_date: string
  resumption_time: string
  name?: string | null
}

function LateResumptionTab({ onChanged }: { onChanged: () => void }) {
  const [date, setDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isRange, setIsRange] = useState(false)
  const [resumptionTime, setResumptionTime] = useState("10:00")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [all, setAll] = useState<LateResumption[] | null>(null)
  const [listSearch, setListSearch] = useState("")
  const [confirm, setConfirm] = useState<LateResumption | null>(null)
  const [busyDate, setBusyDate] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/hr/attendance/late-resumptions", { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: LateResumption[] } | null
      setAll(res.ok ? (payload?.data ?? []) : [])
    } catch {
      setAll([])
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function add() {
    if (!date || !resumptionTime) {
      toast.error("Pick a date and resumption time")
      return
    }
    setSaving(true)
    const res = await apiFetch("/api/admin/hr/attendance/late-resumptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumption_date: date,
        resumption_date_end: isRange && endDate ? endDate : undefined,
        resumption_time: resumptionTime,
        name: name.trim() || undefined,
      }),
    })
    const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    if (!res.ok) {
      toast.error(payload?.error || "Failed to add late resumption")
    } else {
      toast.success(payload?.message || "Late resumption added")
      setDate("")
      setEndDate("")
      setName("")
      void loadAll()
      onChanged()
    }
    setSaving(false)
  }

  async function remove(resumptionDate: string) {
    setBusyDate(resumptionDate)
    try {
      const res = await apiFetch(
        `/api/admin/hr/attendance/late-resumptions?resumption_date=${encodeURIComponent(resumptionDate)}`,
        { method: "DELETE" }
      )
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to remove late resumption")
        return
      }
      toast.success("Late resumption removed")
      void loadAll()
      onChanged()
    } finally {
      setBusyDate(null)
    }
  }

  const listQuery = listSearch.trim().toLowerCase()
  const visible = (all ?? []).filter((r) => `${r.name ?? ""} ${r.resumption_date}`.toLowerCase().includes(listQuery))

  return (
    <div className="space-y-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Mark a day the whole office started late. Staff who clocked in <strong>at or before</strong> the resumption time
        are not penalised; anyone who arrived after it is measured from the late resumption time instead of the normal
        8:20 AM grace.
      </p>
      <div className="flex items-center gap-3">
        <Switch
          id="mgr-resumption-range"
          checked={isRange}
          onCheckedChange={(c) => {
            setIsRange(c)
            if (!c) setEndDate("")
          }}
        />
        <Label htmlFor="mgr-resumption-range">Date range (multiple days)</Label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{isRange ? "Start Date" : "Date"}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {isRange ? (
          <div className="space-y-1">
            <Label>
              End Date <span className="text-destructive">*</span>
            </Label>
            <Input type="date" min={date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label>
              Resumption Time <span className="text-destructive">*</span>
            </Label>
            <Input type="time" value={resumptionTime} onChange={(e) => setResumptionTime(e.target.value)} />
          </div>
        )}
      </div>
      {isRange && (
        <div className="space-y-1">
          <Label>
            Resumption Time <span className="text-destructive">*</span>
          </Label>
          <Input type="time" value={resumptionTime} onChange={(e) => setResumptionTime(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label>Reason / Note</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Heavy rainfall, road flooding"
        />
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={!date || !resumptionTime || saving || (isRange && (!endDate || endDate < date))}
        onClick={() => void add()}
      >
        {saving ? "Saving…" : isRange ? "Add Late Resumptions" : "Add Late Resumption"}
      </Button>

      <EntriesPanel
        title="All late resumptions"
        loading={all === null}
        count={visible.length}
        emptyText="No late resumptions configured"
        search={listSearch}
        onSearchChange={setListSearch}
        searchPlaceholder="Search late resumptions…"
      >
        {visible.map((r) => (
          <EntryRow
            key={r.resumption_date}
            primary={`${formatDay(r.resumption_date)} • resumes ${r.resumption_time.slice(0, 5)}`}
            badge="Late Resumption"
            comment={r.name}
            onDelete={() => setConfirm(r)}
            busy={busyDate === r.resumption_date}
          />
        ))}
      </EntriesPanel>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Remove late resumption?"
        description={
          confirm
            ? `This removes the late resumption on ${formatDay(confirm.resumption_date)} for everyone.`
            : undefined
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirm) void remove(confirm.resumption_date)
          setConfirm(null)
        }}
        busy={confirm ? busyDate === confirm.resumption_date : false}
      />
    </div>
  )
}
// ────────────────────────────────────────────────────────────
// Tab: Manual day-records (OOS / Waiver)
// ────────────────────────────────────────────────────────────

interface OpenOosPeriod {
  id: string
  user_id: string
  user_name: string
  start_date: string
  reason: string | null
}

function ManualRecordsTab({
  reports,
  onDone,
  status,
  intro,
  applyLabel,
  sendWaiverReason,
  placeholder,
  badge,
  oosModes,
}: {
  reports: AttendanceReport[]
  onDone: () => void
  status: "out_of_station" | "waiver"
  intro: ReactNode
  applyLabel: string
  sendWaiverReason?: boolean
  placeholder: string
  badge: string
  oosModes?: boolean
}) {
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mode, setMode] = useState<"range" | "monthly" | "indefinite">("range")
  const [month, setMonth] = useState(() => toLocalISODate().slice(0, 7))
  const [startDate, setStartDate] = useState(toLocalISODate())
  const [endDate, setEndDate] = useState(toLocalISODate())
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [entries, setEntries] = useState<EntryGroup[] | null>(null)
  const [listSearch, setListSearch] = useState("")
  const [pastView, setPastView] = useState(false)
  const [confirmGroup, setConfirmGroup] = useState<EntryGroup | null>(null)
  const [deleting, setDeleting] = useState(false)
  // When set: a punch conflict was detected — incomplete days will be overridden, complete days skipped.
  const [confirmOverride, setConfirmOverride] = useState<{ incomplete: number; complete: number } | null>(null)

  // Indefinite OOS directives (open-ended) — only used when oosModes is set.
  const [openOos, setOpenOos] = useState<OpenOosPeriod[] | null>(null)
  const [stopping, setStopping] = useState<OpenOosPeriod | null>(null)
  const [stopBusy, setStopBusy] = useState(false)

  // Edit modal state
  const [editing, setEditing] = useState<EntryGroup | null>(null)
  const [eStart, setEStart] = useState("")
  const [eEnd, setEEnd] = useState("")
  const [eComment, setEComment] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  const loadEntries = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/admin/hr/attendance/records/manual?status=${status}`, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: ManualRecord[] } | null
      setEntries(res.ok ? groupRecords(payload?.data ?? []) : [])
    } catch {
      setEntries([])
    }
  }, [status])

  const loadOpenOos = useCallback(async () => {
    if (!oosModes) return
    try {
      const res = await apiFetch("/api/admin/hr/attendance/oos-periods", { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: OpenOosPeriod[] } | null
      setOpenOos(res.ok ? (payload?.data ?? []) : [])
    } catch {
      setOpenOos([])
    }
  }, [oosModes])

  useEffect(() => {
    void loadEntries()
    void loadOpenOos()
  }, [loadEntries, loadOpenOos])

  /** First and last calendar day of a YYYY-MM month (weekends are skipped server-side). */
  function monthBounds(ym: string): { start: string; end: string } {
    const [y, m] = ym.split("-").map(Number)
    const start = `${ym}-01`
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { start, end: `${ym}-${String(last).padStart(2, "0")}` }
  }

  async function deleteIds(ids: string[]): Promise<boolean> {
    const res = await apiFetch("/api/admin/hr/attendance/records/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      toast.error(payload?.error || "Failed to delete records")
      return false
    }
    return true
  }

  async function postRange(
    userIds: string[],
    start: string,
    end: string,
    commentText: string
  ): Promise<{ created: number; overrode: number; overridden: number; skipped: number } | null> {
    const res = await apiFetch("/api/admin/hr/attendance/records/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_ids: userIds,
        start_date: start,
        end_date: end,
        status,
        manual_comment: commentText,
      }),
    })
    const payload = (await res.json().catch(() => null)) as {
      error?: string
      created?: number
      overrode?: number
      overridden?: number
      skipped?: number
    } | null
    if (!res.ok) {
      toast.error(payload?.error || "Failed to apply")
      return null
    }
    return {
      created: payload?.created ?? 0,
      overrode: payload?.overrode ?? 0,
      overridden: payload?.overridden ?? 0,
      skipped: payload?.skipped ?? 0,
    }
  }

  /**
   * Split the selected employees' days in the range into fully-present (clock-in AND
   * clock-out) vs incomplete (a punch but no complete day). OOS skips the former and
   * overrides the latter; waiver overrides both.
   */
  async function countPunched(
    userIds: string[],
    start: string,
    end: string
  ): Promise<{ complete: number; incomplete: number }> {
    try {
      const qs = new URLSearchParams({ start_date: start, end_date: end })
      const res = await apiFetch(`/api/admin/hr/attendance/records?${qs.toString()}`, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as {
        records?: Array<{ user_id: string; clock_in: string | null; clock_out: string | null }>
      } | null
      const sel = new Set(userIds)
      let complete = 0
      let incomplete = 0
      for (const r of payload?.records ?? []) {
        if (!sel.has(r.user_id)) continue
        if (r.clock_in && r.clock_out) complete++
        else if (r.clock_in || r.clock_out) incomplete++
      }
      return { complete, incomplete }
    } catch {
      return { complete: 0, incomplete: 0 }
    }
  }

  async function save() {
    if (selectedIds.length === 0) return toast.error("Select at least one employee")
    if (!comment.trim()) return toast.error("A comment is required")

    if (oosModes && mode === "indefinite") {
      if (!startDate) return toast.error("Choose a start date")
      const todayIso = toLocalISODate()
      setSaving(true)
      const { complete, incomplete } = await countPunched(selectedIds, startDate, todayIso)
      setSaving(false)
      if (incomplete > 0) return setConfirmOverride({ incomplete, complete })
      return applyIndefinite()
    }

    const start = oosModes && mode === "monthly" ? monthBounds(month).start : startDate
    const end = oosModes && mode === "monthly" ? monthBounds(month).end : endDate
    if (!start || !end || end < start) return toast.error("Set a valid date range")

    setSaving(true)
    const { complete, incomplete } = await countPunched(selectedIds, start, end)
    setSaving(false)
    // OOS only overrides incomplete days (fully-present days are skipped); waiver overrides all.
    const conflicts = status === "out_of_station" ? incomplete : complete + incomplete
    if (conflicts > 0) return setConfirmOverride({ incomplete, complete })
    await doApply(start, end)
  }

  /** Dispatch the correct apply after the override confirm. */
  async function proceed() {
    setConfirmOverride(null)
    if (oosModes && mode === "indefinite") return applyIndefinite()
    const start = oosModes && mode === "monthly" ? monthBounds(month).start : startDate
    const end = oosModes && mode === "monthly" ? monthBounds(month).end : endDate
    await doApply(start, end)
  }

  async function doApply(start: string, end: string) {
    setConfirmOverride(null)
    setSaving(true)
    try {
      const result = await postRange(selectedIds, start, end, comment.trim())
      if (!result) return
      const parts: string[] = []
      if (result.overridden > 0) parts.push(`${result.overridden} incomplete day(s) overridden (restorable)`)
      if (result.skipped > 0) parts.push(`${result.skipped} fully-present day(s) skipped`)
      if (parts.length > 0) toast.warning(`Applied — ${parts.join("; ")}.`)
      else toast.success(`Applied for ${selectedIds.length} employee(s)`)
      setSelectedIds([])
      setComment("")
      void loadEntries()
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "manual record save failed")
      toast.error("Failed to apply")
    } finally {
      setSaving(false)
    }
  }

  async function applyIndefinite() {
    setConfirmOverride(null)
    setSaving(true)
    try {
      const res = await apiFetch("/api/admin/hr/attendance/oos-periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: selectedIds, start_date: startDate, reason: comment.trim() }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string; skipped?: number } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to apply indefinite OOS")
        return
      }
      toast.success(
        `Indefinite OOS applied to ${selectedIds.length} employee(s)${payload?.skipped ? ` — ${payload.skipped} fully-present day(s) skipped` : ""}`
      )
      setSelectedIds([])
      setComment("")
      void loadEntries()
      void loadOpenOos()
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "indefinite OOS save failed")
      toast.error("Failed to apply indefinite OOS")
    } finally {
      setSaving(false)
    }
  }

  async function stopIndefinite() {
    if (!stopping) return
    setStopBusy(true)
    try {
      const res = await apiFetch(`/api/admin/hr/attendance/oos-periods?id=${encodeURIComponent(stopping.id)}`, {
        method: "DELETE",
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to stop indefinite OOS")
        return
      }
      toast.success("Indefinite OOS stopped — days up to today are kept")
      setStopping(null)
      void loadOpenOos()
      void loadEntries()
      onDone()
    } finally {
      setStopBusy(false)
    }
  }

  function openEdit(group: EntryGroup) {
    setEditing(group)
    setEStart(group.start)
    setEEnd(group.end)
    setEComment(group.comment ?? "")
  }

  async function saveEdit() {
    if (!editing) return
    if (!eStart || !eEnd || eEnd < eStart || !eComment.trim()) return toast.error("Set a valid date range and comment")
    setEditSaving(true)
    try {
      // Edit = delete the old range then create the new one cleanly.
      const removed = await deleteIds(editing.ids)
      if (!removed) return
      const result = await postRange([editing.user_id], eStart, eEnd, eComment.trim())
      if (!result) return
      toast.success("Entry updated")
      setEditing(null)
      void loadEntries()
      onDone()
    } finally {
      setEditSaving(false)
    }
  }

  async function doDelete() {
    if (!confirmGroup) return
    setDeleting(true)
    try {
      const ok = await deleteIds(confirmGroup.ids)
      if (!ok) return
      toast.success("Entry removed")
      setConfirmGroup(null)
      void loadEntries()
      onDone()
    } finally {
      setDeleting(false)
    }
  }

  const today = toLocalISODate()
  const listQuery = listSearch.trim().toLowerCase()
  const visible = (entries ?? [])
    .filter((g) => (pastView ? g.end < today : g.end >= today))
    .filter((g) => `${g.user_name} ${g.comment ?? ""}`.toLowerCase().includes(listQuery))

  return (
    <div className="space-y-4 pt-2">
      <p className="text-muted-foreground text-sm">{intro}</p>
      <EmployeeCheckList
        reports={reports}
        selected={selectedIds}
        onChange={setSelectedIds}
        search={search}
        onSearchChange={setSearch}
      />
      {oosModes && (
        <div className="space-y-2">
          <Label>Mode</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="range">Custom date range</SelectItem>
              <SelectItem value="monthly">Whole month</SelectItem>
              <SelectItem value="indefinite">Indefinite (until stopped)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {oosModes && mode === "monthly" ? (
        <div className="space-y-1">
          <Label>Month</Label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
      ) : oosModes && mode === "indefinite" ? (
        <div className="space-y-1">
          <Label>Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <p className="text-muted-foreground text-xs">
            Applies from this date onward and keeps extending each workday until you stop it.
          </p>
        </div>
      ) : (
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
      )}
      <div className="space-y-1">
        <Label>
          Comment <span className="text-destructive">*</span>
        </Label>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={placeholder} rows={2} />
      </div>
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        {status === "out_of_station" ? (
          <>
            ⚠ Days the employee was <strong>fully present</strong> (clocked in and out) are skipped — you can&apos;t be
            out of station and in the office. A day with a clock-in but <strong>no clock-out</strong> (left mid-day) is
            overridden; the punch is kept, so removing this entry restores it.
          </>
        ) : (
          <>
            ⚠ Days where the employee already clocked in <strong>will be overridden</strong>. Their clock-ins are
            preserved — removing this entry restores the original attendance.
          </>
        )}
      </p>
      <Button
        type="button"
        className="w-full"
        disabled={saving || selectedIds.length === 0}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : applyLabel}
      </Button>

      {oosModes && (openOos?.length ?? 0) > 0 && (
        <EntriesPanel
          title="Active indefinite OOS"
          loading={openOos === null}
          count={openOos?.length ?? 0}
          emptyText=""
        >
          {(openOos ?? []).map((p) => (
            <EntryRow
              key={p.id}
              primary={p.user_name}
              badge={`Indefinite • from ${formatDay(p.start_date)}`}
              comment={p.reason}
              onDelete={() => setStopping(p)}
              busy={false}
            />
          ))}
        </EntriesPanel>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" variant={pastView ? "outline" : "default"} onClick={() => setPastView(false)}>
          Current
        </Button>
        <Button type="button" size="sm" variant={pastView ? "default" : "outline"} onClick={() => setPastView(true)}>
          Past
        </Button>
      </div>

      <EntriesPanel
        title={pastView ? "Past entries" : "Current entries"}
        loading={entries === null}
        count={visible.length}
        emptyText={pastView ? "No past entries" : "No current entries"}
        search={listSearch}
        onSearchChange={setListSearch}
        searchPlaceholder="Search entries…"
      >
        {visible.map((group) => (
          <EntryRow
            key={group.ids.join(",")}
            primary={group.user_name}
            badge={`${badge} • ${formatRangeLabel(group.start, group.end)}`}
            comment={group.comment}
            onEdit={() => openEdit(group)}
            onDelete={() => setConfirmGroup(group)}
            busy={false}
          />
        ))}
      </EntriesPanel>

      {/* Edit modal */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit {badge} entry</DialogTitle>
            <DialogDescription>{editing ? editing.user_name : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Date</Label>
                <Input type="date" value={eStart} onChange={(e) => setEStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End Date</Label>
                <Input type="date" min={eStart || undefined} value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>
                Comment <span className="text-destructive">*</span>
              </Label>
              <Textarea value={eComment} onChange={(e) => setEComment(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmGroup !== null}
        onOpenChange={(o) => !o && setConfirmGroup(null)}
        title={`Remove ${badge} entry?`}
        description={
          confirmGroup
            ? `This removes ${confirmGroup.user_name}'s ${badge} (${formatRangeLabel(confirmGroup.start, confirmGroup.end)}).`
            : undefined
        }
        confirmLabel="Remove"
        onConfirm={() => void doDelete()}
        busy={deleting}
      />

      <ConfirmDialog
        open={confirmOverride !== null}
        onOpenChange={(o) => !o && setConfirmOverride(null)}
        title="Some days have clock-ins"
        description={
          confirmOverride
            ? status === "out_of_station"
              ? `${confirmOverride.incomplete} day(s) have a clock-in but no clock-out (looks like they left mid-day) — applying OOS will override those.${confirmOverride.complete > 0 ? ` ${confirmOverride.complete} fully-present day(s) are skipped.` : ""} Punches are kept and restored if you remove this entry. Proceed?`
              : `${confirmOverride.complete + confirmOverride.incomplete} of these day(s) already have a clock-in. Applying ${badge} will override them. Their attendance is kept and restored if you remove this entry. Proceed?`
            : undefined
        }
        confirmLabel="Proceed"
        onConfirm={() => void proceed()}
        busy={saving}
      />

      <ConfirmDialog
        open={stopping !== null}
        onOpenChange={(o) => !o && setStopping(null)}
        title="Stop indefinite OOS?"
        description={
          stopping
            ? `This stops ${stopping.user_name}'s indefinite OOS at today. Every OOS day up to today is kept; no new OOS days are added going forward.`
            : undefined
        }
        confirmLabel="Stop"
        onConfirm={() => void stopIndefinite()}
        busy={stopBusy}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Tab: Leave (manual bypass)
// ────────────────────────────────────────────────────────────

interface ManualLeave {
  id: string
  user_id: string
  user_name: string
  start_date: string
  end_date: string
  leave_type: string
  days_count: number | null
  notes: string | null
}

interface LeaveTypeOption {
  id: string
  name: string
  /** null when the employee has no balance row for the year — remaining is untracked, not zero. */
  remaining: number | null
  /** Policy entitlement for the type (leave_types.max_days) — the "max" figure in the label. */
  maxDays: number | null
  /** Policy requires supporting documents the employee hasn't provided (admin collects offline). */
  needsEvidence: boolean
}

/** Mirrors the leave module's option label: "Annual Leave (12 days left, max 15)". */
function leaveTypeLabel(t: LeaveTypeOption): string {
  // Uncapped types (LWOP) have no yearly allowance, so a "days left" figure would be a fiction.
  if (t.remaining == null) return `${t.name} (no annual limit — granted case by case)`
  const max = t.maxDays == null ? null : `max ${t.maxDays}`
  return `${t.name} (${[`${t.remaining} day${t.remaining === 1 ? "" : "s"} left`, max].filter(Boolean).join(", ")})`
}

function daysInclusive(start: string, end: string): number | null {
  if (!start || !end || end < start) return null
  const ms = new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1
}

async function fetchLeaveTypeOptions(userId: string): Promise<LeaveTypeOption[]> {
  try {
    const res = await apiFetch(`/api/admin/hr/attendance/leave/balances?user_id=${encodeURIComponent(userId)}`, {
      cache: "no-store",
    })
    const payload = (await res.json().catch(() => null)) as {
      data?: Array<{
        leave_type_id: string
        has_balance?: boolean
        eligibility_status?: string
        allocated_days?: number | null
        used_days?: number | null
        carry_forward_days?: number | null
        balance_days?: number | null
        leave_type?: { id: string; name: string; max_days?: number | null } | null
      }>
    } | null
    if (!res.ok) return []
    return (payload?.data ?? []).map((b) => {
      const remaining =
        b.has_balance === false
          ? null
          : b.balance_days != null
            ? Number(b.balance_days)
            : Number(b.allocated_days || 0) + Number(b.carry_forward_days || 0) - Number(b.used_days || 0)
      return {
        id: b.leave_type_id,
        name: b.leave_type?.name ?? "Leave",
        remaining,
        maxDays: b.leave_type?.max_days ?? null,
        needsEvidence: b.eligibility_status === "missing_evidence",
      }
    })
  } catch {
    return []
  }
}

function LeaveTab({ reports, onDone }: { reports: AttendanceReport[]; onDone: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [types, setTypes] = useState<LeaveTypeOption[]>([])
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [leaveTypeId, setLeaveTypeId] = useState("")
  const [startDate, setStartDate] = useState(toLocalISODate())
  const [endDate, setEndDate] = useState(toLocalISODate())
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [entries, setEntries] = useState<ManualLeave[] | null>(null)
  const [listSearch, setListSearch] = useState("")
  const [pastView, setPastView] = useState(false)
  const [confirmEntry, setConfirmEntry] = useState<ManualLeave | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Edit modal state
  const [editing, setEditing] = useState<ManualLeave | null>(null)
  const [editTypes, setEditTypes] = useState<LeaveTypeOption[]>([])
  const [eTypeId, setETypeId] = useState("")
  const [eStart, setEStart] = useState("")
  const [eEnd, setEEnd] = useState("")
  const [eReason, setEReason] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  const loadEntries = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/hr/attendance/leave/manual", { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as { data?: ManualLeave[] } | null
      setEntries(res.ok ? (payload?.data ?? []) : [])
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  // Load the selected employee's leave types + remaining balances.
  useEffect(() => {
    if (!selectedId) {
      setTypes([])
      setLeaveTypeId("")
      return
    }
    setLoadingTypes(true)
    void fetchLeaveTypeOptions(selectedId).then((opts) => {
      setTypes(opts)
      setLeaveTypeId(opts[0]?.id ?? "")
      setLoadingTypes(false)
    })
  }, [selectedId])

  const selectedType = types.find((t) => t.id === leaveTypeId) ?? null
  const previewDays = daysInclusive(startDate, endDate)

  async function save() {
    if (!selectedId) {
      toast.error("Select an employee")
      return
    }
    if (!leaveTypeId) {
      toast.error("Select a leave type")
      return
    }
    if (!startDate || !endDate || endDate < startDate) {
      toast.error("Set a valid date range")
      return
    }
    if (!reason.trim()) {
      toast.error("A reason is required")
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch("/api/admin/hr/attendance/leave/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedId,
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
      setReason("")
      setSelectedId(null)
      void loadEntries()
      onDone()
    } catch (err) {
      log.error({ err: String(err) }, "leave save failed")
      toast.error("Failed to add leave")
    } finally {
      setSaving(false)
    }
  }

  function openEdit(entry: ManualLeave) {
    setEditing(entry)
    setEStart(entry.start_date)
    setEEnd(entry.end_date)
    setEReason(entry.notes ?? "")
    setETypeId("")
    setEditTypes([])
    void fetchLeaveTypeOptions(entry.user_id).then((opts) => {
      setEditTypes(opts)
      // Best-effort preselect the matching type by name.
      setETypeId(opts.find((o) => o.name === entry.leave_type)?.id ?? opts[0]?.id ?? "")
    })
  }

  async function saveEdit() {
    if (!editing) return
    if (!eTypeId || !eStart || !eEnd || eEnd < eStart || !eReason.trim()) {
      toast.error("Set a valid leave type, date range, and reason")
      return
    }
    setEditSaving(true)
    try {
      // Edit = revoke old grant (restores balance) then create the new one.
      const del = await apiFetch(`/api/admin/hr/attendance/leave/manual?id=${encodeURIComponent(editing.id)}`, {
        method: "DELETE",
      })
      if (!del.ok) {
        const payload = (await del.json().catch(() => null)) as { error?: string } | null
        toast.error(payload?.error || "Failed to update leave")
        return
      }
      const res = await apiFetch("/api/admin/hr/attendance/leave/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: editing.user_id,
          leave_type_id: eTypeId,
          start_date: eStart,
          end_date: eEnd,
          reason: eReason.trim(),
        }),
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to update leave")
        return
      }
      toast.success("Leave updated")
      setEditing(null)
      void loadEntries()
      onDone()
    } finally {
      setEditSaving(false)
    }
  }

  async function doDelete() {
    if (!confirmEntry) return
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/admin/hr/attendance/leave/manual?id=${encodeURIComponent(confirmEntry.id)}`, {
        method: "DELETE",
      })
      const payload = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(payload?.error || "Failed to delete leave")
        return
      }
      toast.success("Leave removed")
      setConfirmEntry(null)
      void loadEntries()
      onDone()
    } finally {
      setDeleting(false)
    }
  }

  const today = toLocalISODate()
  const listQuery = listSearch.trim().toLowerCase()
  const visible = (entries ?? [])
    .filter((e) => (pastView ? e.end_date < today : e.end_date >= today))
    .filter((e) => `${e.user_name} ${e.leave_type} ${e.notes ?? ""}`.toLowerCase().includes(listQuery))

  return (
    <div className="space-y-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Record <strong>approved leave</strong> for one employee, bypassing the request workflow. It posts a real
        approved leave request, draws down their balance, and shows as &ldquo;On Leave&rdquo; in attendance.
      </p>

      <div className="space-y-1">
        <Label>Employee</Label>
        <EmployeeSingleSelect reports={reports} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      <div className="space-y-1">
        <Label>Leave Type</Label>
        <Select value={leaveTypeId} onValueChange={setLeaveTypeId} disabled={!selectedId || loadingTypes}>
          <SelectTrigger>
            <SelectValue
              placeholder={!selectedId ? "Select an employee first" : loadingTypes ? "Loading…" : "Select type"}
            />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {leaveTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedId && !loadingTypes && types.length === 0 && (
          <p className="text-[11px] font-medium text-amber-600">
            No leave types this employee is eligible for — check their profile and leave policies.
          </p>
        )}
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
          {selectedType.remaining == null ? (
            " · no balance tracked for this type"
          ) : (
            <>
              {" · balance "}
              {selectedType.remaining} →{" "}
              <span className={selectedType.remaining - previewDays < 0 ? "font-medium text-red-600" : ""}>
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
        ⚠ If the employee clocked in on these days, the leave takes precedence in the roster. Their attendance is kept
        — removing the leave restores it.
      </p>
      <Button
        type="button"
        className="w-full"
        disabled={saving || !selectedId || !leaveTypeId}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Add Leave Record"}
      </Button>

      <div className="mt-2 flex items-center gap-2">
        <Button type="button" size="sm" variant={pastView ? "outline" : "default"} onClick={() => setPastView(false)}>
          Current
        </Button>
        <Button type="button" size="sm" variant={pastView ? "default" : "outline"} onClick={() => setPastView(true)}>
          Past
        </Button>
      </div>

      <EntriesPanel
        title={pastView ? "Past leave records" : "Current leave records"}
        loading={entries === null}
        count={visible.length}
        emptyText={pastView ? "No past leave records" : "No current leave records"}
        search={listSearch}
        onSearchChange={setListSearch}
        searchPlaceholder="Search leave records…"
      >
        {visible.map((entry) => (
          <EntryRow
            key={entry.id}
            primary={entry.user_name}
            badge={`${entry.leave_type} • ${formatRangeLabel(entry.start_date, entry.end_date)}${entry.days_count ? ` • ${entry.days_count}d` : ""}`}
            comment={entry.notes}
            onEdit={() => openEdit(entry)}
            onDelete={() => setConfirmEntry(entry)}
            busy={false}
          />
        ))}
      </EntriesPanel>

      {/* Edit modal */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Leave</DialogTitle>
            <DialogDescription>{editing ? editing.user_name : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>Leave Type</Label>
              <Select value={eTypeId} onValueChange={setETypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {editTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {leaveTypeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Date</Label>
                <Input type="date" value={eStart} onChange={(e) => setEStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End Date</Label>
                <Input type="date" min={eStart || undefined} value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea value={eReason} onChange={(e) => setEReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmEntry !== null}
        onOpenChange={(o) => !o && setConfirmEntry(null)}
        title="Remove leave record?"
        description={
          confirmEntry
            ? `This revokes ${confirmEntry.user_name}'s leave (${formatRangeLabel(confirmEntry.start_date, confirmEntry.end_date)}) and restores their balance.`
            : undefined
        }
        confirmLabel="Remove"
        onConfirm={() => void doDelete()}
        busy={deleting}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Main Dialog
// ────────────────────────────────────────────────────────────

export function AttendanceManagerDialog({
  open,
  onOpenChange,
  reports,
  yearMonth,
  onHolidaysChanged,
  onReportChanged,
}: AttendanceManagerDialogProps) {
  const [activeTab, setActiveTab] = useState("exemption")

  // Reset to first tab on open
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) setActiveTab("exemption")
    prevOpen.current = open
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attendance Manager</DialogTitle>
          <DialogDescription>
            Manage exemptions, holidays, early closures, late resumptions, OOS, waivers, and leave records.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="exemption" className="text-xs">
              <ShieldOff className="mr-1 h-3.5 w-3.5 shrink-0" />
              Exempt
            </TabsTrigger>
            <TabsTrigger value="holiday" className="text-xs">
              <CalendarDays className="mr-1 h-3.5 w-3.5 shrink-0" />
              Holiday
            </TabsTrigger>
            <TabsTrigger value="closure" className="text-xs">
              <Clock className="mr-1 h-3.5 w-3.5 shrink-0" />
              Closure
            </TabsTrigger>
            <TabsTrigger value="resumption" className="text-xs">
              <Sunrise className="mr-1 h-3.5 w-3.5 shrink-0" />
              Resumption
            </TabsTrigger>
            <TabsTrigger value="oos" className="text-xs">
              <MapPin className="mr-1 h-3.5 w-3.5 shrink-0" />
              OOS
            </TabsTrigger>
            <TabsTrigger value="waiver" className="text-xs">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5 shrink-0" />
              Waiver
            </TabsTrigger>
            <TabsTrigger value="leave" className="text-xs">
              <Plane className="mr-1 h-3.5 w-3.5 shrink-0" />
              Leave
            </TabsTrigger>
          </TabsList>

          <TabsContent value="exemption">
            <ExemptionTab reports={reports} yearMonth={yearMonth} onDone={onReportChanged} />
          </TabsContent>

          <TabsContent value="holiday">
            <HolidayTab onChanged={onHolidaysChanged} />
          </TabsContent>

          <TabsContent value="closure">
            <EarlyClosureTab onChanged={onReportChanged} />
          </TabsContent>

          <TabsContent value="resumption">
            <LateResumptionTab onChanged={onReportChanged} />
          </TabsContent>

          <TabsContent value="oos">
            <ManualRecordsTab
              reports={reports}
              onDone={onReportChanged}
              status="out_of_station"
              badge="OOS"
              oosModes
              applyLabel="Apply OOS"
              placeholder="e.g. Field assignment to Lagos branch"
              intro={
                <>
                  Mark employees as <strong>Out of Station</strong> for a date range. This creates attendance records
                  with OOS status, counting as an approved absence.
                </>
              }
            />
          </TabsContent>

          <TabsContent value="waiver">
            <ManualRecordsTab
              reports={reports}
              onDone={onReportChanged}
              status="waiver"
              sendWaiverReason
              badge="Waiver"
              applyLabel="Apply Waiver"
              placeholder="e.g. National conference attendance"
              intro={
                <>
                  Apply an attendance <strong>waiver</strong> for selected employees over a date range. Waived days are
                  counted separately and do not penalise the attendance score.
                </>
              }
            />
          </TabsContent>

          <TabsContent value="leave">
            <LeaveTab reports={reports} onDone={onReportChanged} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
