"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { toast } from "sonner"
import { BarChart3, ClipboardList, Layers, Target, Trash2, UserCog, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"

type Assignment = { id: string; department: string; role: "core" | "support" }

type RegisterRow = {
  id: string
  source_sn: number
  perspective: string
  strategic_priority: string
  strategic_objective: string
  measure: string
  target_text: string
  measure_type: string
  direction: string
  core_departments: string[]
  support_departments: string[]
  assignments: Assignment[]
}

const PERSPECTIVES = ["Financial", "Customer", "Internal Process", "Organizational Capacity"]

/**
 * The read-only master register: what the 2026 plan says, and who owns it.
 * "How we're doing against it" lives on each department's own cascade page —
 * this view is the plan, not the progress.
 */
export function CorporateScorecardRegister() {
  const queryClient = useQueryClient()
  const queryKey = ["corporate-scorecard-register"]
  const [managingRow, setManagingRow] = useState<RegisterRow | null>(null)

  const { data, isLoading, error, refetch } = useQuery<{ data: RegisterRow[] }>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch("/api/corporate-scorecard/register", { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load the corporate scorecard")
      return payload
    },
  })

  const rows = useMemo(() => data?.data ?? [], [data])

  const departmentOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) {
      for (const d of row.core_departments) set.add(d)
      for (const d of row.support_departments) set.add(d)
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }))
  }, [rows])

  const stats = useMemo(() => {
    const byPerspective = new Map<string, number>()
    for (const row of rows) byPerspective.set(row.perspective, (byPerspective.get(row.perspective) || 0) + 1)
    return { total: rows.length, byPerspective }
  }, [rows])

  const columns = useMemo<DataTableColumn<RegisterRow>[]>(
    () => [
      {
        key: "source_sn",
        label: "S/N",
        sortable: true,
        accessor: (r) => r.source_sn,
        render: (r) => <span className="text-muted-foreground font-mono text-xs">{r.source_sn}</span>,
        hideOnMobile: true,
      },
      {
        key: "measure",
        label: "KPI",
        sortable: true,
        resizable: true,
        initialWidth: 340,
        accessor: (r) => r.measure,
        render: (r) => (
          <div className="flex flex-col">
            <span className="line-clamp-2 font-medium">{r.measure}</span>
            <span className="text-muted-foreground text-[11px]">{r.strategic_objective}</span>
          </div>
        ),
      },
      {
        key: "perspective",
        label: "Perspective",
        sortable: true,
        accessor: (r) => r.perspective,
        render: (r) => (
          <Badge variant="outline" className="text-xs">
            {r.perspective}
          </Badge>
        ),
      },
      {
        key: "target_text",
        label: "2026 Target",
        accessor: (r) => r.target_text,
        render: (r) => <span className="text-xs">{r.target_text}</span>,
        hideOnMobile: true,
      },
      {
        key: "core_departments",
        label: "Core Owner(s)",
        accessor: (r) => r.core_departments.join(", "),
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {r.core_departments.map((d) => (
              <Badge key={d} className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-600">
                {d}
              </Badge>
            ))}
          </div>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<RegisterRow>[]>(
    () => [
      {
        key: "perspective",
        label: "Perspective",
        options: PERSPECTIVES.map((value) => ({ value, label: value })),
      },
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
        mode: "custom",
        filterFn: (row, selected) =>
          selected.some((dept) => row.core_departments.includes(dept) || row.support_departments.includes(dept)),
      },
    ],
    [departmentOptions]
  )

  return (
    <DataTablePage
      title="Corporate Scorecard"
      description="The 2026 strategic plan's 61 KPIs and which departments own them. This is the plan — a department's own progress lives on its cascade page."
      icon={Target}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/corporate-scorecard/departments">
              <Layers className="mr-2 h-4 w-4" />
              Department Cascade
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/corporate-scorecard/summary">
              <BarChart3 className="mr-2 h-4 w-4" />
              MD Summary
            </Link>
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            title="Total KPIs"
            value={stats.total}
            icon={ClipboardList}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          {PERSPECTIVES.map((p) => (
            <StatCard
              key={p}
              title={p}
              value={stats.byPerspective.get(p) || 0}
              icon={p === "Organizational Capacity" ? Users : Target}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
          ))}
        </div>
      }
    >
      <DataTable<RegisterRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.id}
        searchPlaceholder="Search KPI, objective, or perspective..."
        searchFn={(row, query) =>
          `${row.measure} ${row.strategic_objective} ${row.strategic_priority} ${row.perspective}`
            .toLowerCase()
            .includes(query.toLowerCase())
        }
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        emptyTitle="No KPIs Found"
        emptyDescription="The corporate scorecard hasn't been imported yet."
        emptyIcon={Target}
        rowActions={[{ label: "Manage Departments", icon: UserCog, onClick: (r) => setManagingRow(r) }]}
        expandable={{
          render: (r) => (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Strategic Priority
                </p>
                <p className="mt-1 text-sm">{r.strategic_priority}</p>
                <p className="text-muted-foreground mt-3 text-xs font-semibold tracking-wide uppercase">
                  2026 Annual Target
                </p>
                <p className="mt-1 text-sm">{r.target_text}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Supporting Departments
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.support_departments.length === 0 ? (
                    <span className="text-muted-foreground text-xs">None</span>
                  ) : (
                    r.support_departments.map((d) => (
                      <Badge key={d} variant="outline" className="text-[10px]">
                        {d}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>
          ),
        }}
        urlSync
      />

      <ManageDepartmentsDialog
        row={rows.find((r) => r.id === managingRow?.id) ?? managingRow}
        onOpenChange={(open) => !open && setManagingRow(null)}
        onChanged={() => void queryClient.invalidateQueries({ queryKey })}
      />
    </DataTablePage>
  )
}

/**
 * Add or remove a department from a KPI's RACI grid. This is the affordance
 * for the four departments the source workbook left unmapped (Logistics,
 * Monitoring & Evaluation, Executive Management, SIWES) — the schema always
 * allowed any free-text department, this is the UI to actually use that.
 */
function ManageDepartmentsDialog({
  row,
  onOpenChange,
  onChanged,
}: {
  row: RegisterRow | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const open = row !== null
  const [department, setDepartment] = useState("")
  const [role, setRole] = useState<"core" | "support">("core")
  const [isSaving, setIsSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const { data: deptData } = useQuery<{ data: Array<{ name: string }> }>({
    queryKey: ["departments-all"],
    queryFn: async () => {
      const res = await apiFetch("/api/departments", { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load departments")
      return payload
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const assignedNames = new Set((row?.assignments ?? []).map((a) => a.department))
  const availableDepartments = (deptData?.data ?? [])
    .map((d) => d.name)
    .filter((name) => !assignedNames.has(name))
    .sort((a, b) => a.localeCompare(b))

  function reset() {
    setDepartment("")
    setRole("core")
  }

  async function handleAdd() {
    if (!row || !department) return
    setIsSaving(true)
    try {
      const res = await apiFetch("/api/corporate-scorecard/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpi_id: row.id, department, role }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to add department")
      toast.success(`${department} added as ${role.toUpperCase()}`)
      reset()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add department")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRemove(assignment: Assignment) {
    setRemovingId(assignment.id)
    try {
      const res = await apiFetch(`/api/corporate-scorecard/assignments/${assignment.id}`, { method: "DELETE" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to remove department")
      toast.success(`${assignment.department} removed`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove department")
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Manage Departments</DialogTitle>
          <DialogDescription>{row?.measure}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {(row?.assignments ?? []).length === 0 ? (
            <p className="text-muted-foreground text-xs">No department assigned yet.</p>
          ) : (
            (row?.assignments ?? [])
              .slice()
              .sort((a, b) => a.department.localeCompare(b.department))
              .map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{a.department}</span>
                    {a.role === "core" ? (
                      <Badge className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-600">
                        CORE
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        SUPPORT
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive h-7 px-2"
                    disabled={removingId === a.id}
                    onClick={() => void handleRemove(a)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
          )}
        </div>

        <div className="flex items-end gap-2 border-t pt-3">
          <div className="flex-1 space-y-1.5">
            <span className="text-xs font-medium">Add department</span>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a department" />
              </SelectTrigger>
              <SelectContent>
                {availableDepartments.length === 0 ? (
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">All departments assigned</div>
                ) : (
                  availableDepartments.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28 space-y-1.5">
            <span className="text-xs font-medium">Role</span>
            <Select value={role} onValueChange={(v) => setRole(v as "core" | "support")}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="core">CORE</SelectItem>
                <SelectItem value="support">SUPPORT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-9" disabled={!department || isSaving} onClick={() => void handleAdd()}>
            Add
          </Button>
        </div>

        <p className="text-muted-foreground text-[11px]">
          Only CORE departments are scored on this KPI. Set the department&apos;s own numeric target from its cascade
          page after adding it.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
