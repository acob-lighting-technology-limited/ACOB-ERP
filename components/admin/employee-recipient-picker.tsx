"use client"

import { useEffect, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, X } from "lucide-react"

export interface DirectoryEmployee {
  id: string
  name: string
  email: string | null
  department: string | null
}

interface DirectoryRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
  department: string | null
  employment_status: string | null
}

interface EmployeeRecipientPickerProps {
  /** IDs of the currently selected employees. */
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** Extra read-only/removable badges shown alongside picked employees (e.g. legacy emails that don't map to a profile). */
  extraBadges?: Array<{ key: string; label: string; onRemove: () => void }>
  /** Fires once the directory has loaded — lets callers reconcile ids against externally-stored data (e.g. legacy emails). */
  onEmployeesLoaded?: (employees: DirectoryEmployee[]) => void
  /** Message shown when nothing is selected. */
  emptyHint?: string
}

export function EmployeeRecipientPicker({
  selectedIds,
  onChange,
  extraBadges = [],
  onEmployeesLoaded,
  emptyHint = "No recipients selected yet.",
}: EmployeeRecipientPickerProps) {
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/directory", { cache: "no-store" })
        const payload = (await res.json().catch(() => null)) as { data?: DirectoryRow[] } | null
        if (cancelled) return
        const rows = (payload?.data ?? [])
          .filter((r) => r.employment_status !== "exited")
          .map((r) => ({
            id: r.id,
            name: r.full_name?.trim() || [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
            email: r.company_email || r.additional_email || null,
            department: r.department,
          }))
          .filter((e) => e.email)
        setEmployees(rows)
        onEmployeesLoaded?.(rows)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.email ?? "").toLowerCase().includes(q) ||
        (e.department ?? "").toLowerCase().includes(q)
    )
  }, [employees, query])

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((v) => v !== id))
    else onChange([...selectedIds, id])
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search by name, email, or department..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="max-h-[240px] space-y-1 overflow-y-auto rounded-lg border p-2">
        {loading ? (
          <div className="text-muted-foreground py-6 text-center text-sm">Loading employees…</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-sm">No employees found</div>
        ) : (
          filtered.map((emp) => (
            <label
              key={emp.id}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                selectedIds.includes(emp.id) ? "bg-green-50 dark:bg-green-950/20" : "hover:bg-muted/50"
              }`}
            >
              <Checkbox checked={selectedIds.includes(emp.id)} onCheckedChange={() => toggle(emp.id)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{emp.name}</div>
                <div className="text-muted-foreground truncate text-xs">{emp.email}</div>
              </div>
              {emp.department && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {emp.department}
                </Badge>
              )}
            </label>
          ))
        )}
      </div>

      {(selectedIds.length > 0 || extraBadges.length > 0) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {selectedIds.map((id) => {
            const emp = employeeById.get(id)
            return (
              <Badge key={id} variant="secondary" className="gap-1">
                {emp?.name ?? "Unknown"}
                <button
                  type="button"
                  onClick={() => onChange(selectedIds.filter((v) => v !== id))}
                  className="hover:text-destructive ml-1 rounded-full"
                  aria-label={`Remove ${emp?.name ?? id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
          {extraBadges.map((b) => (
            <Badge key={b.key} variant="outline" className="gap-1">
              {b.label}
              <button
                type="button"
                onClick={b.onRemove}
                className="hover:text-destructive ml-1 rounded-full"
                aria-label={`Remove ${b.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {selectedIds.length === 0 && extraBadges.length === 0 && (
        <p className="text-muted-foreground text-xs">{emptyHint}</p>
      )}
    </div>
  )
}
