"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BarChart3, CheckCircle2, Clock3, Download, Loader2, Plus, ShieldCheck, Target, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { exportPmsRowsToExcel, exportPmsRowsToPdf } from "@/lib/pms/export"
import { toLocalISODate } from "@/lib/utils/date"

type MetricKey = "kpi" | "goals" | "attendance" | "behaviour"
type TabKey = "individual" | "department" | "cycle"
type IconKey = "kpi" | "goals" | "attendance" | "behaviour"

type MetricSnapshotPayload = {
  metric: MetricKey
  selected_cycle_id: string | null
  users: { id: string; name: string; department: string }[]
  departments: string[]
  cycles: { id: string; name: string; review_type: string | null }[]
  rows: {
    individual: Record<string, unknown>[]
    department: Record<string, unknown>[]
    cycle: Record<string, unknown>[]
  }
}

function asString(value: unknown) {
  if (value === null || value === undefined) return "-"
  return String(value)
}

function asNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampMetricValue(value: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ""
  return String(Math.min(100, Math.max(1, parsed)))
}

// ─── Metric Add Dialog (unchanged) ───────────────────────────────────────────

function MetricAddDialog({
  metric,
  open,
  onOpenChange,
  users,
  cycles,
  onSaved,
  initialUserId,
  initialCycleId,
}: {
  metric: MetricKey
  open: boolean
  onOpenChange: (open: boolean) => void
  users: { id: string; name: string; department: string }[]
  cycles: { id: string; name: string; review_type: string | null }[]
  onSaved: () => void
  initialUserId?: string
  initialCycleId?: string
}) {
  const [userId, setUserId] = useState("")
  const [cycleId, setCycleId] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [goalId, setGoalId] = useState("")
  const [department, setDepartment] = useState("")
  const [scoreValue, setScoreValue] = useState("")
  const [strengths, setStrengths] = useState("")
  const [areasForImprovement, setAreasForImprovement] = useState("")
  const [managerComments, setManagerComments] = useState("")
  const [competencies, setCompetencies] = useState({
    collaboration: "",
    accountability: "",
    communication: "",
    teamwork: "",
    loyalty: "",
    professional_conduct: "",
  })

  useEffect(() => {
    if (!open) return
    setUserId(initialUserId || "")
    setCycleId(initialCycleId || cycles[0]?.id || "")
    setScoreValue("")
    setStrengths("")
    setAreasForImprovement("")
    setManagerComments("")
    setCompetencies({
      collaboration: "",
      accountability: "",
      communication: "",
      teamwork: "",
      loyalty: "",
      professional_conduct: "",
    })
  }, [open, users, cycles, initialUserId, initialCycleId])

  useEffect(() => {
    if (!open || !userId || !cycleId) return
    let active = true
    setLoading(true)

    void (async () => {
      try {
        const selectedUser = users.find((user) => user.id === userId)
        setDepartment(selectedUser?.department || "")

        if (metric === "kpi") {
          const response = await fetch(
            `/api/hr/performance/reviews?user_id=${encodeURIComponent(userId)}&cycle_id=${encodeURIComponent(cycleId)}`,
            { cache: "no-store" }
          )
          const payload = (await response.json().catch(() => null)) as {
            data?: Array<{ kpi_score?: number | null }>
          } | null
          const item = payload?.data?.[0]
          if (!active) return
          setScoreValue(item?.kpi_score !== null && item?.kpi_score !== undefined ? String(item.kpi_score) : "")
        }

        if (metric === "goals") {
          const response = await fetch(
            `/api/hr/performance/goals?department=${encodeURIComponent(selectedUser?.department || "")}&cycle_id=${encodeURIComponent(cycleId)}`,
            { cache: "no-store" }
          )
          const payload = (await response.json().catch(() => null)) as { data?: Record<string, unknown>[] } | null
          const item = payload?.data?.[0]
          if (!active) return
          setGoalId(asString(item?.id) === "-" ? "" : asString(item?.id))
        }

        if (metric === "behaviour") {
          const response = await fetch(
            `/api/hr/performance/score?user_id=${encodeURIComponent(userId)}&cycle_id=${encodeURIComponent(cycleId)}`,
            { cache: "no-store" }
          )
          const payload = (await response.json().catch(() => null)) as {
            data?: {
              existing_review?: {
                behaviour_competencies?: Record<string, unknown> | null
                strengths?: string | null
                areas_for_improvement?: string | null
                manager_comments?: string | null
              } | null
            }
          } | null
          const entry = payload?.data?.existing_review?.behaviour_competencies || {}
          if (!active) return
          setCompetencies({
            collaboration:
              entry.collaboration !== undefined && entry.collaboration !== null ? asString(entry.collaboration) : "",
            accountability:
              entry.accountability !== undefined && entry.accountability !== null ? asString(entry.accountability) : "",
            communication:
              entry.communication !== undefined && entry.communication !== null ? asString(entry.communication) : "",
            teamwork: entry.teamwork !== undefined && entry.teamwork !== null ? asString(entry.teamwork) : "",
            loyalty: entry.loyalty !== undefined && entry.loyalty !== null ? asString(entry.loyalty) : "",
            professional_conduct:
              entry.professional_conduct !== undefined && entry.professional_conduct !== null
                ? asString(entry.professional_conduct)
                : "",
          })
          setStrengths(String(payload?.data?.existing_review?.strengths || ""))
          setAreasForImprovement(String(payload?.data?.existing_review?.areas_for_improvement || ""))
          setManagerComments(String(payload?.data?.existing_review?.manager_comments || ""))
        }
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [open, metric, userId, cycleId, users])

  async function handleSave() {
    setSaving(true)
    try {
      if (!userId) throw new Error("Select an employee first")
      if (!cycleId) throw new Error("Select a cycle first")

      if (metric === "kpi") {
        const numericScore = Number(scoreValue)
        if (!Number.isFinite(numericScore) || numericScore <= 0 || numericScore > 100)
          throw new Error("KPI score must be between 1 and 100")
        const response = await fetch("/api/hr/performance/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, review_cycle_id: cycleId, kpi_score: numericScore }),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) throw new Error(payload?.error || "Failed to save")
      } else if (metric === "goals") {
        const response = await fetch("/api/hr/performance/goals", {
          method: goalId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            goalId
              ? { id: goalId, achieved_value: scoreValue ? Number(scoreValue) : null }
              : { department, review_cycle_id: cycleId, title: "Department Goal" }
          ),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) throw new Error(payload?.error || "Failed to save")
      } else {
        const response = await fetch("/api/hr/performance/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            review_cycle_id: cycleId,
            behaviour_competencies: Object.fromEntries(
              Object.entries(competencies).map(([key, value]) => [key, Number(clampMetricValue(value) || 0)])
            ),
            strengths,
            areas_for_improvement: areasForImprovement,
            manager_comments: managerComments,
          }),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) throw new Error(payload?.error || "Failed to save")
      }

      toast.success("Saved successfully")
      onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Add {metric === "kpi" ? "KPI Score" : metric.charAt(0).toUpperCase() + metric.slice(1)}
          </DialogTitle>
          <DialogDescription>
            Select employee and cycle first. Existing data auto-loads when available.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Cycle</Label>
            <Select value={cycleId} onValueChange={setCycleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select cycle" />
              </SelectTrigger>
              <SelectContent>
                {cycles.map((cycle) => (
                  <SelectItem key={cycle.id} value={cycle.id}>
                    {cycle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading existing data...
          </div>
        ) : null}

        {metric === "kpi" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={department} disabled />
            </div>
            <div className="space-y-2">
              <Label>KPI Score</Label>
              <Input
                type="number"
                min="1"
                max="100"
                value={scoreValue}
                onChange={(e) => setScoreValue(clampMetricValue(e.target.value))}
              />
            </div>
          </div>
        ) : null}

        {metric === "behaviour" ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(competencies).map(([key, value]) => (
                <div key={key} className="space-y-2">
                  <Label>{key.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={value}
                    onChange={(e) => setCompetencies((prev) => ({ ...prev, [key]: clampMetricValue(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Strengths</Label>
                <Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Areas for Improvement</Label>
                <Textarea
                  value={areasForImprovement}
                  onChange={(e) => setAreasForImprovement(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Manager Comments</Label>
              <Textarea value={managerComments} onChange={(e) => setManagerComments(e.target.value)} rows={4} />
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── PmsMetricTabsPage ────────────────────────────────────────────────────────

export function PmsMetricTabsPage({
  metric,
  title,
  description,
  iconKey,
}: {
  metric: MetricKey
  title: string
  description: string
  iconKey: IconKey
}) {
  const [tab, setTab] = useState<TabKey>("individual")
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [data, setData] = useState<MetricSnapshotPayload | null>(null)
  const [cycleId, setCycleId] = useState("")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null)
  const hasLoadedSnapshotRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    let active = true
    if (hasLoadedSnapshotRef.current) {
      setIsRefreshing(true)
    } else {
      setIsInitialLoading(true)
    }

    void (async () => {
      try {
        const query = cycleId ? `&cycle_id=${encodeURIComponent(cycleId)}` : ""
        const response = await fetch(`/api/hr/performance/metric-snapshot?metric=${metric}${query}`, {
          cache: "no-store",
        })
        const payload = (await response.json().catch(() => null)) as {
          data?: MetricSnapshotPayload
          error?: string
        } | null
        if (!response.ok) throw new Error(payload?.error || "Failed to fetch data")
        if (!active || !payload?.data) return
        setData(payload.data)
        hasLoadedSnapshotRef.current = true
        if (!cycleId && payload.data.selected_cycle_id) setCycleId(payload.data.selected_cycle_id)
      } catch (error) {
        if (active) toast.error(error instanceof Error ? error.message : "Failed to fetch data")
      } finally {
        if (active) {
          setIsInitialLoading(false)
          setIsRefreshing(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [metric, cycleId, refreshKey])

  const rawRows = useMemo(() => data?.rows[tab] || [], [data, tab])

  // Column keys used for both DataTable headings and export
  const columnKeys = useMemo(() => {
    if (metric === "goals") {
      if (tab === "individual")
        return ["employee", "department", "cycle", "total_goals", "approved_goals", "completed_goals"]
      if (tab === "department") return ["department", "cycle", "total_goals", "approved_goals", "completed_goals"]
      return ["cycle", "review_type", "total_goals", "approved_goals", "completed_goals"]
    }
    if (tab === "individual") return ["employee", "department", "cycle", "metric_value"]
    if (tab === "department") return ["department", "cycle", "employee_count", "submitted_count", "metric_value"]
    return ["cycle", "review_type", "employee_count", "submitted_count", "departments_counted", "metric_value"]
  }, [metric, tab])

  const exportRows = useMemo(
    () =>
      rawRows.map((row, index) =>
        Object.fromEntries([
          ["S/N", index + 1],
          ...columnKeys.map((col) => [
            col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            asString((row as Record<string, unknown>)[col]),
          ]),
        ])
      ),
    [rawRows, columnKeys]
  )

  const MOBILE_HIDDEN_COLS = new Set([
    "cycle",
    "department",
    "employee_count",
    "submitted_count",
    "departments_counted",
  ])

  const tableColumns = useMemo<DataTableColumn<Record<string, unknown>>[]>(
    () =>
      columnKeys.map((col, index) => ({
        key: col,
        label: col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        sortable: true,
        accessor: (row) => asString(row[col]),
        hideOnMobile: index >= 2 || MOBILE_HIDDEN_COLS.has(col),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnKeys]
  )

  const tableFilters = useMemo<DataTableFilter<Record<string, unknown>>[]>(() => {
    const result: DataTableFilter<Record<string, unknown>>[] = []
    result.push({
      key: "cycle",
      label: "Cycle",
      options: (data?.cycles || []).map((cycle) => ({ value: cycle.name, label: cycle.name })),
      placeholder: "All Cycles",
      mode: "column",
    })
    if (tab === "individual" || tab === "department") {
      result.push({
        key: "department",
        label: "Department",
        options: (data?.departments || []).map((d) => ({ value: d, label: d })),
        placeholder: "All Departments",
        mode: "column",
      })
    }
    if (tab === "individual") {
      result.push({
        key: "employee_user",
        label: "Employee",
        options: (data?.users || []).map((u) => ({ value: u.id, label: u.name })),
        placeholder: "All Employees",
        mode: "custom",
        filterFn: (row, vals) => vals.length === 0 || vals.includes(asString(row.user_id)),
      })
    }
    return result
  }, [tab, data])

  const tableRowActions = useMemo<RowAction<Record<string, unknown>>[] | undefined>(() => {
    if (tab === "individual" && metric !== "goals") {
      return [
        {
          label: "Edit",
          onClick: (row) => {
            if (metric === "attendance") {
              const userId = asString(row.user_id)
              const query = userId !== "-" ? `?employee=${encodeURIComponent(userId)}` : ""
              router.push(`/admin/hr/attendance${query}`)
              return
            }
            setEditingRow(row)
            setIsModalOpen(true)
          },
        },
      ]
    }
    return undefined
  }, [tab, metric, router])

  const expandedRowsByGroup = useMemo(() => {
    const individuals = (data?.rows.individual || []) as Record<string, unknown>[]
    const byDepartment = new Map<string, Record<string, unknown>[]>()
    const byCycle = new Map<string, Record<string, unknown>[]>()

    for (const row of individuals) {
      const department = asString(row.department)
      const cycle = asString(row.cycle)
      byDepartment.set(department, [...(byDepartment.get(department) || []), row])
      byCycle.set(cycle, [...(byCycle.get(cycle) || []), row])
    }

    return { byDepartment, byCycle }
  }, [data])

  // Stats
  const metricValues = rawRows
    .map((row) => {
      const value = (row as Record<string, unknown>).metric_value
      return typeof value === "number" && Number.isFinite(value) ? value : null
    })
    .filter((v): v is number => v !== null)

  const valueAverage =
    metricValues.length > 0
      ? Math.round((metricValues.reduce((sum, v) => sum + v, 0) / metricValues.length) * 100) / 100
      : null

  const submittedTotal = rawRows.reduce(
    (sum, row) => sum + asNumber((row as Record<string, unknown>).submitted_count),
    0
  )

  const Icon =
    iconKey === "kpi" ? Target : iconKey === "goals" ? CheckCircle2 : iconKey === "attendance" ? Clock3 : ShieldCheck

  const pageTabs: DataTableTab[] = [
    { key: "individual", label: "Individual" },
    { key: "department", label: "Department" },
    { key: "cycle", label: "Cycle" },
  ]

  return (
    <DataTablePage
      title={title}
      description={description}
      icon={Icon}
      backLink={{ href: "/admin/hr/pms", label: "Back to PMS" }}
      tabs={pageTabs}
      activeTab={tab}
      onTabChange={(value) => setTab(value as TabKey)}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            title="Total Records"
            value={rawRows.length}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title={tab === "individual" ? "Average Value" : "Submitted"}
            value={tab === "individual" ? String(valueAverage ?? "-") : submittedTotal}
            icon={BarChart3}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Active Cycle"
            value={data?.cycles.find((c) => c.id === cycleId)?.name || "Current"}
            icon={Icon}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setIsExportOpen(true)}
            disabled={rawRows.length === 0 || isRefreshing}
            className="h-8 gap-2"
            size="sm"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          {metric !== "attendance" ? (
            <Button className="h-8 gap-2" size="sm" onClick={() => setIsModalOpen(true)}>
              <Plus className="h-4 w-4" />
              {metric === "kpi" ? "Add KPI Score" : "Add Behaviour"}
            </Button>
          ) : null}
        </div>
      }
    >
      <DataTable<Record<string, unknown>>
        data={rawRows as Record<string, unknown>[]}
        columns={tableColumns}
        filters={tableFilters}
        getRowId={(row) => String(row.user_id || row.department || row.cycle || JSON.stringify(row).slice(0, 40))}
        isLoading={isInitialLoading}
        skeletonRows={6}
        rowActions={tableRowActions}
        searchPlaceholder={`Search ${tab} records…`}
        searchFn={(row, query) =>
          Object.values(row)
            .map((v) => asString(v).toLowerCase())
            .some((v) => v.includes(query))
        }
        emptyIcon={Icon}
        emptyTitle={`No ${metric} records`}
        emptyDescription={`No ${metric} data found for the selected cycle and filters.`}
        expandable={
          tab === "individual"
            ? undefined
            : {
                canExpand: (row) => {
                  if (tab === "department") {
                    const department = asString(row.department)
                    return (expandedRowsByGroup.byDepartment.get(department) || []).length > 0
                  }
                  const cycle = asString(row.cycle)
                  return (expandedRowsByGroup.byCycle.get(cycle) || []).length > 0
                },
                render: (row) => {
                  const detailRows =
                    tab === "department"
                      ? expandedRowsByGroup.byDepartment.get(asString(row.department)) || []
                      : expandedRowsByGroup.byCycle.get(asString(row.cycle)) || []
                  return (
                    <div className="space-y-2">
                      <div className="text-muted-foreground text-xs">Underlying people records</div>
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full min-w-[680px] text-sm">
                          <thead className="bg-muted/60 text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left">Employee</th>
                              <th className="px-3 py-2 text-left">Department</th>
                              <th className="px-3 py-2 text-left">Cycle</th>
                              <th className="px-3 py-2 text-left">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailRows.map((detail) => (
                              <tr key={`${asString(detail.user_id)}-${asString(detail.cycle)}`} className="border-t">
                                <td className="px-3 py-2">{asString(detail.employee)}</td>
                                <td className="px-3 py-2">{asString(detail.department)}</td>
                                <td className="px-3 py-2">{asString(detail.cycle)}</td>
                                <td className="px-3 py-2">{asString(detail.metric_value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                },
              }
        }
      />

      {metric !== "attendance" ? (
        <MetricAddDialog
          metric={metric}
          open={isModalOpen}
          onOpenChange={(open) => {
            setIsModalOpen(open)
            if (!open) setEditingRow(null)
          }}
          users={data?.users || []}
          cycles={data?.cycles || []}
          onSaved={() => setRefreshKey((v) => v + 1)}
          initialUserId={asString(editingRow?.user_id) === "-" ? "" : asString(editingRow?.user_id)}
          initialCycleId={cycleId}
        />
      ) : null}

      <ExportOptionsDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        title={`Export ${title}`}
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
        ]}
        onSelect={(id) => {
          const filename = `pms-${metric}-${tab}-${toLocalISODate()}`
          if (id === "excel") {
            void exportPmsRowsToExcel(exportRows, filename)
            return
          }
          void exportPmsRowsToPdf(exportRows, filename, title)
        }}
      />
    </DataTablePage>
  )
}
