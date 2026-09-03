"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Calendar, CheckCircle2, Loader2, Lock, Plus, RefreshCw, Trash2 } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"

type CycleStatus = "planned" | "active" | "closed" | "locked"

type ReviewCycle = {
  id: string
  name: string
  review_type: string
  start_date: string
  end_date: string
  status: CycleStatus | null
  created_at: string
  updated_at: string | null
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  planned: "secondary",
  active: "default",
  closed: "outline",
  locked: "destructive",
}

const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  active: "Active",
  closed: "Closed",
  locked: "Locked",
}

const STATUS_TRANSITIONS: Record<CycleStatus, CycleStatus[]> = {
  planned: ["active"],
  active: ["closed"],
  closed: ["active", "locked"],
  locked: [],
}

function formatDate(date: string) {
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

function StatusBadge({ status }: { status: CycleStatus | null }) {
  const key = String(status)
  return <Badge variant={STATUS_COLORS[key] || "outline"}>{STATUS_LABELS[key] || key}</Badge>
}

function CycleCard({
  cycle,
  onAdvance,
  onDelete,
}: {
  cycle: ReviewCycle
  onAdvance: (cycle: ReviewCycle, nextStatus: CycleStatus) => void
  onDelete: (cycle: ReviewCycle) => void
}) {
  const nextStatuses = STATUS_TRANSITIONS[(cycle.status || "planned") as CycleStatus] || []

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{cycle.name}</p>
          <p className="text-muted-foreground text-xs capitalize">{cycle.review_type}</p>
        </div>
        <StatusBadge status={cycle.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Start</p>
          <p>{formatDate(cycle.start_date)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">End</p>
          <p>{formatDate(cycle.end_date)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {nextStatuses.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={status === "locked" ? "destructive" : "outline"}
            onClick={() => onAdvance(cycle, status)}
          >
            {status === "active" && cycle.status === "closed" ? "Reopen" : `Mark ${STATUS_LABELS[status]}`}
          </Button>
        ))}
        {!["active", "locked"].includes(String(cycle.status)) ? (
          <Button size="sm" variant="destructive" onClick={() => onDelete(cycle)}>
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function ReviewCyclesPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  const [cycles, setCycles] = useState<ReviewCycle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ReviewCycle | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ cycle: ReviewCycle; newStatus: CycleStatus } | null>(null)

  const [name, setName] = useState("")
  const [reviewType, setReviewType] = useState("quarterly")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [status, setStatus] = useState<CycleStatus>("planned")

  const loadCycles = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/hr/performance/cycles")
      const data = (await res.json().catch(() => ({}))) as { data?: ReviewCycle[]; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to load cycles")
      setCycles(data.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCycles()
  }, [loadCycles])

  function resetForm() {
    setName("")
    setReviewType("quarterly")
    setStartDate("")
    setEndDate("")
    setStatus("planned")
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await apiFetch("/api/hr/performance/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, review_type: reviewType, start_date: startDate, end_date: endDate, status }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) throw new Error(data.error || "Failed to create")
      toast.success(data.message || "Cycle created")
      setIsCreateOpen(false)
      resetForm()
      void loadCycles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create cycle")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStatusChange(cycle: ReviewCycle, newStatus: CycleStatus) {
    setIsSubmitting(true)
    try {
      const res = await apiFetch("/api/hr/performance/cycles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cycle.id, status: newStatus }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) throw new Error(data.error || "Failed to update")
      toast.success(data.message || "Cycle updated")
      setStatusTarget(null)
      void loadCycles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update cycle")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(cycle: ReviewCycle) {
    setIsSubmitting(true)
    try {
      const res = await apiFetch(`/api/hr/performance/cycles?id=${encodeURIComponent(cycle.id)}`, {
        method: "DELETE",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) throw new Error(data.error || "Failed to delete")
      toast.success(data.message || "Cycle deleted")
      setDeleteTarget(null)
      void loadCycles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete cycle")
    } finally {
      setIsSubmitting(false)
    }
  }

  const activeCycle = useMemo(() => cycles.find((c) => c.status === "active"), [cycles])
  const reviewTypeOptions = useMemo(
    () => Array.from(new Set(cycles.map((cycle) => cycle.review_type).filter(Boolean))).sort(),
    [cycles]
  )

  const columns: DataTableColumn<ReviewCycle>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Name",
        sortable: true,
        accessor: (cycle) => cycle.name,
        render: (cycle) => <span className="font-medium">{cycle.name}</span>,
        resizable: true,
        initialWidth: 240,
      },
      {
        key: "review_type",
        label: "Type",
        sortable: true,
        accessor: (cycle) => cycle.review_type,
        render: (cycle) => <span className="capitalize">{cycle.review_type}</span>,
        hideOnMobile: true,
      },
      {
        key: "start_date",
        label: "Start",
        sortable: true,
        accessor: (cycle) => cycle.start_date,
        render: (cycle) => formatDate(cycle.start_date),
        hideOnMobile: true,
      },
      {
        key: "end_date",
        label: "End",
        sortable: true,
        accessor: (cycle) => cycle.end_date,
        render: (cycle) => formatDate(cycle.end_date),
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (cycle) => cycle.status || "",
        render: (cycle) => <StatusBadge status={cycle.status} />,
      },
    ],
    []
  )

  // Rows here are the cycles themselves, so only the cadence half applies.
  const { filters: cadenceFilters } = useCycleFilters<ReviewCycle>({
    cycles,
    getRowCycleId: (cycle) => cycle.id,
    includeCyclePicker: false,
  })

  const filters: DataTableFilter<ReviewCycle>[] = useMemo(
    () => [
      ...cadenceFilters,
      {
        key: "status",
        label: "Status",
        options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
        placeholder: "All Statuses",
      },
      {
        key: "review_type",
        label: "Review Type",
        options: reviewTypeOptions.map((value) => ({ value, label: value.replace(/_/g, " ") })),
        placeholder: "All Review Types",
      },
    ],
    [cadenceFilters, reviewTypeOptions]
  )

  const rowActions: RowAction<ReviewCycle>[] = useMemo(
    () => [
      {
        label: "Activate",
        onClick: (cycle) => setStatusTarget({ cycle, newStatus: "active" }),
        hidden: (cycle) => !["planned", "closed"].includes(String(cycle.status)),
      },
      {
        label: "Close",
        onClick: (cycle) => setStatusTarget({ cycle, newStatus: "closed" }),
        hidden: (cycle) => cycle.status !== "active",
      },
      {
        label: "Lock Permanently",
        variant: "destructive",
        onClick: (cycle) => setStatusTarget({ cycle, newStatus: "locked" }),
        hidden: (cycle) => cycle.status !== "closed",
      },
      {
        label: "Delete",
        icon: Trash2,
        variant: "destructive",
        onClick: (cycle) => setDeleteTarget(cycle),
        hidden: (cycle) => ["active", "locked"].includes(String(cycle.status)),
      },
    ],
    []
  )

  return (
    <DataTablePage
      title="Review Cycles"
      description="Create and manage performance review cycles. Only one cycle can be active at a time."
      icon={RefreshCw}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms", label: "Back to PMS" }}
      actions={
        <Button onClick={() => setIsCreateOpen(true)} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Cycle</span>
          <span className="sm:hidden">New</span>
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total"
            value={cycles.length}
            icon={Calendar}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Active"
            value={activeCycle ? activeCycle.name : "None"}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Planned"
            value={cycles.filter((cycle) => cycle.status === "planned").length}
            icon={Calendar}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Closed"
            value={cycles.filter((cycle) => ["closed", "locked"].includes(String(cycle.status))).length}
            icon={Lock}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<ReviewCycle>
        data={cycles}
        columns={columns}
        filters={filters}
        getRowId={(cycle) => cycle.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search cycle name, type, status…"
        searchFn={(cycle, query) => {
          const name = cycle.name.toLowerCase()
          const type = cycle.review_type.toLowerCase()
          const statusText = String(cycle.status || "").toLowerCase()
          return name.includes(query) || type.includes(query) || statusText.includes(query)
        }}
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadCycles()}
        rowActions={rowActions}
        expandable={{
          render: (cycle) => (
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">Lifecycle</p>
                <p className="font-medium">Planned → Active → Closed → Locked</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Created</p>
                <p>{formatDate(cycle.created_at)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Updated</p>
                <p>{cycle.updated_at ? formatDate(cycle.updated_at) : "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Next Transition</p>
                <p>{STATUS_TRANSITIONS[(cycle.status || "planned") as CycleStatus]?.[0] || "None"}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (cycle) =>
            cycle.status === "active"
              ? "bg-emerald-500"
              : cycle.status === "closed"
                ? "bg-blue-500"
                : cycle.status === "locked"
                  ? "bg-slate-500"
                  : "bg-amber-500",
          title: (cycle) => cycle.name,
          subtitle: (cycle) =>
            `${cycle.review_type.replace(/_/g, " ")} · ${formatDate(cycle.start_date)} - ${formatDate(cycle.end_date)}`,
          trailing: (cycle) => <StatusBadge status={cycle.status} />,
        }}
        cardRenderer={(cycle) => (
          <CycleCard
            cycle={cycle}
            onAdvance={(item, next) => {
              setStatusTarget({ cycle: item, newStatus: next })
            }}
            onDelete={(item) => setDeleteTarget(item)}
          />
        )}
        emptyTitle="No review cycles yet"
        emptyDescription="Create the first cycle using the New Cycle button."
        emptyIcon={Calendar}
        skeletonRows={6}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Review Cycle</DialogTitle>
            <DialogDescription>Define a new performance review period.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Cycle Name *</Label>
              <Input
                placeholder="e.g. Q1 2026 Performance Review"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Review Type *</Label>
              <Select value={reviewType} onValueChange={setReviewType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="mid_year">Mid-Year</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="probation">Probation</SelectItem>
                  <SelectItem value="ad_hoc">Ad Hoc</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Date *</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>End Date *</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  min={startDate}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Initial Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as CycleStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="active">Active (starts immediately)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateOpen(false)
                  resetForm()
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create Cycle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(statusTarget)} onOpenChange={() => setStatusTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mark cycle as {statusTarget ? STATUS_LABELS[statusTarget.newStatus] : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusTarget?.newStatus === "active"
                ? "Activating this cycle will allow reviews and feedback to be submitted. Ensure the previous cycle is closed."
                : statusTarget?.newStatus === "closed"
                  ? "Closing this cycle prevents new reviews from being submitted. Existing reviews remain accessible."
                  : statusTarget?.newStatus === "locked"
                    ? "Locking is permanent. The cycle cannot be re-opened or modified after this."
                    : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <Button
              loading={isSubmitting}
              onClick={async () => {
                if (statusTarget) await handleStatusChange(statusTarget.cycle, statusTarget.newStatus)
              }}
            >
              Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cycle {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the cycle. This cannot be undone. Cycles with linked reviews cannot be
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isSubmitting}
              onClick={async () => {
                if (deleteTarget) await handleDelete(deleteTarget)
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
