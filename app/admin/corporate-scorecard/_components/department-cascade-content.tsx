"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ClipboardEdit, PlusCircle, Target } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api-client"
import { averageCappedPct, ragStatus, type RagStatus } from "@/lib/corporate-scorecard/attainment"
import { formatWATDate } from "@/lib/utils/date"

type CascadeRow = {
  assignment_id: string
  kpi_id: string
  source_sn: number
  perspective: string
  strategic_objective: string
  measure: string
  target_text: string
  measure_type: "count" | "percentage" | "currency" | "milestone"
  direction: "at_least" | "at_most"
  role: "core" | "support"
  target_value: number | null
  target_unit: string | null
  department_target: string | null
  proposed_action: string | null
  latest_actual: {
    actual_value: number | null
    milestones_completed: number | null
    milestones_total: number | null
    note: string | null
    recorded_at: string
  } | null
  raw_pct: number | null
  capped_pct: number | null
}

function ragBadge(status: RagStatus | null) {
  if (status === "green")
    return <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-500">On Target</Badge>
  if (status === "amber")
    return <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-500">Needs Attention</Badge>
  if (status === "red") return <Badge className="border-red-500/20 bg-red-500/10 text-red-500">At Risk</Badge>
  return <span className="text-muted-foreground text-xs">No data</span>
}

/**
 * One department's scorecard cascade: every KPI it is CORE or SUPPORT on,
 * each with its own numeric target and recorded progress. Only CORE rows
 * count toward the department's own scorecard number — SUPPORT is here for
 * visibility, per the agreed rule that a department is not judged on work it
 * merely contributes to.
 */
export function DepartmentCascadeContent({
  departments,
  initialDepartment,
}: {
  departments: string[]
  initialDepartment: string | null
}) {
  const queryClient = useQueryClient()
  const [department, setDepartment] = useState(initialDepartment || departments[0] || "")
  const [editingRow, setEditingRow] = useState<CascadeRow | null>(null)
  const [recordingRow, setRecordingRow] = useState<CascadeRow | null>(null)

  const queryKey = ["corporate-scorecard-department", department]

  const { data, isLoading, error, refetch } = useQuery<{ data: CascadeRow[] }>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch(`/api/corporate-scorecard/departments/${encodeURIComponent(department)}`, {
        cache: "no-store",
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load this department's scorecard")
      return payload
    },
    enabled: Boolean(department),
  })

  const rows = useMemo(() => data?.data ?? [], [data])
  const coreRows = useMemo(() => rows.filter((r) => r.role === "core"), [rows])

  const departmentAttainment = useMemo(() => averageCappedPct(coreRows.map((r) => r.capped_pct)), [coreRows])
  const recordedCount = coreRows.filter((r) => r.latest_actual !== null).length

  const columns = useMemo<DataTableColumn<CascadeRow>[]>(
    () => [
      {
        key: "measure",
        label: "KPI",
        sortable: true,
        resizable: true,
        initialWidth: 320,
        accessor: (r) => r.measure,
        render: (r) => (
          <div className="flex flex-col">
            <span className="line-clamp-2 font-medium">{r.measure}</span>
            <span className="text-muted-foreground text-[11px]">
              {r.perspective} · {r.strategic_objective}
            </span>
          </div>
        ),
      },
      {
        key: "role",
        label: "Role",
        sortable: true,
        accessor: (r) => r.role,
        render: (r) =>
          r.role === "core" ? (
            <Badge className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-600">CORE</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              SUPPORT
            </Badge>
          ),
      },
      {
        key: "target_value",
        label: "Target",
        accessor: (r) => r.target_value ?? -1,
        render: (r) =>
          r.measure_type === "milestone" ? (
            <span className="text-muted-foreground text-xs">3 milestones</span>
          ) : r.target_value != null ? (
            <span className="text-xs font-medium">
              {r.target_value} {r.target_unit || ""}
            </span>
          ) : (
            <span className="text-xs text-amber-600 dark:text-amber-400">Not set</span>
          ),
      },
      {
        key: "latest_actual",
        label: "Latest Actual",
        accessor: (r) => r.latest_actual?.actual_value ?? r.latest_actual?.milestones_completed ?? -1,
        render: (r) => {
          if (!r.latest_actual) return <span className="text-muted-foreground text-xs">Not recorded</span>
          if (r.measure_type === "milestone") {
            return (
              <span className="text-xs">
                {r.latest_actual.milestones_completed ?? 0}/{r.latest_actual.milestones_total ?? 3} milestones
              </span>
            )
          }
          return <span className="text-xs">{r.latest_actual.actual_value}</span>
        },
      },
      {
        key: "capped_pct",
        label: "Attainment",
        sortable: true,
        accessor: (r) => r.capped_pct ?? -1,
        render: (r) =>
          r.capped_pct == null ? (
            <span className="text-muted-foreground text-xs">-</span>
          ) : (
            <div className="w-28 space-y-1">
              <Progress value={r.capped_pct} className="h-1.5" />
              <span className="text-muted-foreground text-[11px]">
                {r.raw_pct}% {r.raw_pct !== r.capped_pct ? "(capped at 100 for rollup)" : ""}
              </span>
            </div>
          ),
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => r.capped_pct ?? -1,
        render: (r) => ragBadge(r.capped_pct != null ? ragStatus(r.capped_pct) : null),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<CascadeRow>[]>(
    () => [
      {
        key: "role",
        label: "Role",
        options: [
          { value: "core", label: "CORE (scored)" },
          { value: "support", label: "SUPPORT" },
        ],
      },
      {
        key: "perspective",
        label: "Perspective",
        options: [
          { value: "Financial", label: "Financial" },
          { value: "Customer", label: "Customer" },
          { value: "Internal Process", label: "Internal Process" },
          { value: "Organizational Capacity", label: "Organizational Capacity" },
        ],
      },
    ],
    []
  )

  return (
    <DataTablePage
      title="Department Cascade"
      description="This department's KPIs, its own confirmed targets, and recorded progress against them."
      icon={Target}
      backLink={{ href: "/admin/corporate-scorecard", label: "Back to Register" }}
      actions={
        <div className="w-full max-w-[260px]">
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Department Attainment"
            value={departmentAttainment != null ? `${departmentAttainment}%` : "No data"}
            icon={Target}
            description="CORE KPIs only"
          />
          <StatCard variant="compact" title="CORE KPIs" value={coreRows.length} description="Scored" />
          <StatCard
            variant="compact"
            title="SUPPORT KPIs"
            value={rows.length - coreRows.length}
            description="Visible, not scored"
          />
          <StatCard
            variant="compact"
            title="Recorded"
            value={`${recordedCount}/${coreRows.length}`}
            description="CORE KPIs with an actual"
          />
        </div>
      }
    >
      <DataTable<CascadeRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.assignment_id}
        searchPlaceholder="Search KPI or objective..."
        searchFn={(row, query) =>
          `${row.measure} ${row.strategic_objective}`.toLowerCase().includes(query.toLowerCase())
        }
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        emptyTitle="No KPIs for This Department"
        emptyDescription="This department has no CORE or SUPPORT role on any corporate KPI yet."
        emptyIcon={Target}
        rowActions={[
          { label: "Edit Target", icon: ClipboardEdit, onClick: (r) => setEditingRow(r) },
          { label: "Record Actual", icon: PlusCircle, onClick: (r) => setRecordingRow(r) },
        ]}
        expandable={{
          render: (r) => (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Corporate Target</p>
                <p className="mt-1 text-sm">{r.target_text}</p>
                <p className="text-muted-foreground mt-3 text-xs font-semibold tracking-wide uppercase">
                  This Department&apos;s Target
                </p>
                <p className="mt-1 text-sm">{r.department_target || "Not yet confirmed"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Proposed Action</p>
                <p className="mt-1 text-sm">{r.proposed_action || "Not yet defined"}</p>
                {r.latest_actual?.note && (
                  <>
                    <p className="text-muted-foreground mt-3 text-xs font-semibold tracking-wide uppercase">
                      Latest Note
                    </p>
                    <p className="mt-1 text-sm">{r.latest_actual.note}</p>
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      Recorded {formatWATDate(r.latest_actual.recorded_at)}
                    </p>
                  </>
                )}
              </div>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (r) => (r.role === "core" ? "bg-emerald-500" : "bg-blue-500"),
          title: (r) => r.measure,
          subtitle: (r) =>
            `${r.role.toUpperCase()} · ${r.perspective} · Attainment: ${r.capped_pct != null ? `${r.capped_pct}%` : "-"}`,
          trailing: (r) => ragBadge(r.capped_pct != null ? ragStatus(r.capped_pct) : null),
          onSelect: (r) => setEditingRow(r),
        }}
        cardRenderer={(r) => (
          <div
            className="bg-card cursor-pointer space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md"
            onClick={() => setEditingRow(r)}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{r.measure}</p>
                <p className="text-muted-foreground text-xs">{r.perspective}</p>
              </div>
              {ragBadge(r.capped_pct != null ? ragStatus(r.capped_pct) : null)}
            </div>
            <p className="text-muted-foreground line-clamp-2 text-xs">{r.strategic_objective}</p>
            <div className="flex items-center justify-between border-t pt-2 text-[10px]">
              <span>Role: {r.role.toUpperCase()}</span>
              <span>Attainment: {r.capped_pct != null ? `${r.capped_pct}%` : "-"}</span>
            </div>
          </div>
        )}
        urlSync
      />

      <EditTargetDialog
        row={editingRow}
        onOpenChange={(open) => !open && setEditingRow(null)}
        onSaved={() => {
          setEditingRow(null)
          void queryClient.invalidateQueries({ queryKey })
        }}
      />

      <RecordActualDialog
        row={recordingRow}
        department={department}
        onOpenChange={(open) => !open && setRecordingRow(null)}
        onSaved={() => {
          setRecordingRow(null)
          void queryClient.invalidateQueries({ queryKey })
        }}
      />
    </DataTablePage>
  )
}

function EditTargetDialog({
  row,
  onOpenChange,
  onSaved,
}: {
  row: CascadeRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [targetValue, setTargetValue] = useState("")
  const [targetUnit, setTargetUnit] = useState("")
  const [departmentTarget, setDepartmentTarget] = useState("")
  const [proposedAction, setProposedAction] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const open = row !== null

  useEffect(() => {
    if (!row) return
    setTargetValue(row.target_value != null ? String(row.target_value) : "")
    setTargetUnit(row.target_unit || "")
    setDepartmentTarget(row.department_target || "")
    setProposedAction(row.proposed_action || "")
  }, [row])

  async function handleSave() {
    if (!row) return
    setIsSaving(true)
    try {
      const res = await apiFetch(`/api/corporate-scorecard/assignments/${row.assignment_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_value: targetValue.trim() ? Number(targetValue) : null,
          target_unit: targetUnit.trim() || null,
          department_target: departmentTarget.trim() || null,
          proposed_action: proposedAction.trim() || null,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save")
      toast.success("Target updated")
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Confirm This Department&apos;s Target</DialogTitle>
          <DialogDescription>{row?.measure}</DialogDescription>
        </DialogHeader>

        {row?.measure_type === "milestone" ? (
          <p className="text-muted-foreground text-sm">
            Milestone KPIs are tracked by milestones completed, not a numeric target — record progress from the
            &ldquo;Record Actual&rdquo; action instead.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Target value</Label>
              <Input
                type="number"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Unit</Label>
              <Input
                value={targetUnit}
                onChange={(e) => setTargetUnit(e.target.value)}
                placeholder="e.g. projects, %"
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">In your own words (optional)</Label>
          <Textarea
            value={departmentTarget}
            onChange={(e) => setDepartmentTarget(e.target.value)}
            placeholder="This department's commitment toward the corporate target..."
            className="min-h-[60px] text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Proposed Action (optional)</Label>
          <Textarea
            value={proposedAction}
            onChange={(e) => setProposedAction(e.target.value)}
            placeholder="What & how this department will achieve it..."
            className="min-h-[60px] text-xs"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordActualDialog({
  row,
  department,
  onOpenChange,
  onSaved,
}: {
  row: CascadeRow | null
  department: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [actualValue, setActualValue] = useState("")
  const [milestonesCompleted, setMilestonesCompleted] = useState("")
  const [milestonesTotal, setMilestonesTotal] = useState("3")
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const open = row !== null
  const isMilestone = row?.measure_type === "milestone"

  async function handleSave() {
    if (!row) return
    if (isMilestone && !milestonesCompleted.trim()) {
      toast.error("Enter how many milestones are complete")
      return
    }
    if (!isMilestone && !actualValue.trim()) {
      toast.error("Enter the actual value")
      return
    }

    setIsSaving(true)
    try {
      const res = await apiFetch("/api/corporate-scorecard/actuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kpi_id: row.kpi_id,
          department,
          actual_value: isMilestone ? null : Number(actualValue),
          milestones_completed: isMilestone ? Number(milestonesCompleted) : null,
          milestones_total: isMilestone ? Number(milestonesTotal || 3) : null,
          note: note.trim() || null,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to record")
      toast.success("Progress recorded")
      setActualValue("")
      setMilestonesCompleted("")
      setNote("")
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Record Progress</DialogTitle>
          <DialogDescription>{row?.measure}</DialogDescription>
        </DialogHeader>

        {isMilestone ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Milestones completed *</Label>
              <Input
                type="number"
                min={0}
                value={milestonesCompleted}
                onChange={(e) => setMilestonesCompleted(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Of how many total</Label>
              <Input
                type="number"
                min={1}
                value={milestonesTotal}
                onChange={(e) => setMilestonesTotal(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Actual value *</Label>
            <Input
              type="number"
              value={actualValue}
              onChange={(e) => setActualValue(e.target.value)}
              placeholder="e.g. 3"
            />
            {row?.target_value != null && (
              <p className="text-muted-foreground text-[11px]">
                Target is {row.target_value} {row.target_unit || ""}.
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Note (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Context for this figure..."
            className="min-h-[60px] text-xs"
          />
        </div>

        <p className="text-muted-foreground text-[11px]">
          This adds a new entry to this KPI&apos;s history — it does not overwrite the previous one.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
