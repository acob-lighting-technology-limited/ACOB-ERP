"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toast } from "sonner"
import { formatName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CheckCircle2, Package, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { StatCard } from "@/components/ui/stat-card"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("assets-issues")

interface AssetIssue {
  id: string
  asset_id: string
  description: string
  resolved: boolean
  created_at: string
  resolved_at?: string
  resolved_by?: string
  created_by: string
  asset?: {
    unique_code: string
    asset_type: string
    status: string
    assignment_type?: string
    department?: string
    office_location?: string
    current_assignment?: {
      type?: "individual" | "department" | "office"
      department?: string
      office_location?: string
      user?: {
        first_name: string
        last_name: string
        department?: string | null
      }
    }
  }
  creator?: {
    first_name: string
    last_name: string
  }
  resolver?: {
    first_name: string
    last_name: string
  }
}

async function fetchAssetIssues(): Promise<AssetIssue[]> {
  // Department scoping is resolved server-side (shared between /admin/assets/issues
  // and /dept/[id]/assets/issues via getScopedDepartments) — no client-side lock.
  const res = await apiFetch("/api/admin/assets/issues", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load asset issues")
  const json = await res.json()
  return (json.data || []) as AssetIssue[]
}

function assignedTo(issue: AssetIssue) {
  if (!issue.asset?.current_assignment) return "Unassigned"
  if (issue.asset.current_assignment.type === "individual" && issue.asset.current_assignment.user) {
    return `${formatName(issue.asset.current_assignment.user.first_name)} ${formatName(issue.asset.current_assignment.user.last_name)}`
  }
  if (issue.asset.current_assignment.type === "department" && issue.asset.current_assignment.department) {
    return issue.asset.current_assignment.department
  }
  if (issue.asset.current_assignment.type === "office" && issue.asset.current_assignment.office_location) {
    return issue.asset.current_assignment.office_location
  }
  return "Unassigned"
}

function IssueCard({
  issue,
  onToggle,
  onDelete,
}: {
  issue: AssetIssue
  onToggle: (issue: AssetIssue) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{issue.asset?.unique_code || "Unknown Asset"}</p>
          <p className="text-muted-foreground text-xs">
            {ASSET_TYPE_MAP[issue.asset?.asset_type || ""]?.label || issue.asset?.asset_type || "-"}
          </p>
        </div>
        <Badge variant={issue.resolved ? "default" : "secondary"}>{issue.resolved ? "Resolved" : "Unresolved"}</Badge>
      </div>
      <p className={`text-sm ${issue.resolved ? "text-muted-foreground line-through" : ""}`}>{issue.description}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Assigned To</p>
          <p>{assignedTo(issue)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Reported By</p>
          <p>
            {issue.creator
              ? `${formatName(issue.creator.first_name)} ${formatName(issue.creator.last_name)}`
              : "Unknown"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onToggle(issue)}>
          {issue.resolved ? "Mark Unresolved" : "Resolve"}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onDelete(issue.id)}>
          Delete
        </Button>
      </div>
    </div>
  )
}

export function AssetIssuesPage({
  backLinkHref,
  lockedDepartment,
}: { backLinkHref?: string; lockedDepartment?: string } = {}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isDeletingIssue, setIsDeletingIssue] = useState(false)
  const queryClient = useQueryClient()

  const {
    data: issues = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [...QUERY_KEYS.adminAssetIssues(), lockedDepartment ?? "all"],
    queryFn: () => fetchAssetIssues(),
  })

  async function handleToggleResolved(issue: AssetIssue) {
    try {
      const res = await apiFetch(`/api/admin/assets/${issue.asset_id}/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: !issue.resolved }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to update issue")
      toast.success(issue.resolved ? "Issue marked as unresolved" : "Issue marked as resolved")
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminAssetIssues() })
    } catch (err: unknown) {
      log.error("Error toggling issue:", err)
      toast.error("Failed to update issue")
    }
  }

  async function handleDeleteIssue(issue: AssetIssue) {
    try {
      const res = await apiFetch(`/api/admin/assets/${issue.asset_id}/issues/${issue.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to delete issue")
      toast.success("Issue deleted")
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminAssetIssues() })
    } catch (err: unknown) {
      log.error("Error deleting issue:", err)
      toast.error("Failed to delete issue")
    }
  }

  const assetTypeOptions = useMemo(
    () =>
      Object.entries(ASSET_TYPE_MAP).map(([value, item]) => ({
        value,
        label: item.label,
      })),
    []
  )

  const columns: DataTableColumn<AssetIssue>[] = [
    {
      key: "resolved",
      label: "Status",
      sortable: true,
      accessor: (issue) => (issue.resolved ? "resolved" : "unresolved"),
      render: (issue) => (
        <Badge variant={issue.resolved ? "default" : "secondary"}>{issue.resolved ? "Resolved" : "Unresolved"}</Badge>
      ),
    },
    {
      key: "asset",
      label: "Asset",
      sortable: true,
      accessor: (issue) => issue.asset?.unique_code || "",
      render: (issue) => (
        <div>
          <div className="font-mono text-xs font-medium">{issue.asset?.unique_code || "-"}</div>
          <div className="text-muted-foreground text-xs">
            {ASSET_TYPE_MAP[issue.asset?.asset_type || ""]?.label || issue.asset?.asset_type || "-"}
          </div>
        </div>
      ),
      resizable: true,
      initialWidth: 180,
    },
    {
      key: "description",
      label: "Issue Description",
      sortable: true,
      accessor: (issue) => issue.description,
      render: (issue) => (
        <span
          className={`block max-w-[320px] truncate text-sm ${issue.resolved ? "text-muted-foreground line-through" : ""}`}
        >
          {issue.description}
        </span>
      ),
      resizable: true,
      initialWidth: 320,
    },
    {
      key: "assigned_to",
      label: "Assigned To",
      sortable: true,
      accessor: (issue) => assignedTo(issue),
      render: (issue) => <span className="text-sm">{assignedTo(issue)}</span>,
      resizable: true,
      initialWidth: 180,
    },
    {
      key: "reported_by",
      label: "Reported By",
      sortable: true,
      hideOnMobile: true,
      accessor: (issue) =>
        issue.creator ? `${formatName(issue.creator.first_name)} ${formatName(issue.creator.last_name)}` : "Unknown",
      render: (issue) => (
        <span className="text-sm">
          {issue.creator ? `${formatName(issue.creator.first_name)} ${formatName(issue.creator.last_name)}` : "Unknown"}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      hideOnMobile: true,
      accessor: (issue) => issue.created_at,
      render: (issue) => <span className="text-muted-foreground text-sm">{formatWATDate(issue.created_at)}</span>,
    },
  ]

  const tableFilters: DataTableFilter<AssetIssue>[] = [
    {
      key: "resolved",
      label: "Status",
      options: [
        { value: "resolved", label: "Resolved" },
        { value: "unresolved", label: "Unresolved" },
      ],
      placeholder: "All Statuses",
    },
    {
      key: "asset_type",
      label: "Asset Type",
      options: assetTypeOptions,
      placeholder: "All Asset Types",
      mode: "custom",
      filterFn: (issue, values) => values.length === 0 || values.includes(issue.asset?.asset_type || ""),
    },
  ]

  const rowActions: RowAction<AssetIssue>[] = [
    {
      label: "Resolve",
      icon: CheckCircle2,
      onClick: (issue) => void handleToggleResolved(issue),
    },
    {
      label: "Delete",
      icon: Trash2,
      variant: "destructive",
      onClick: (issue) => setPendingDeleteId(issue.id),
    },
  ]

  const stats = {
    total: issues.length,
    unresolved: issues.filter((issue) => !issue.resolved).length,
    resolved: issues.filter((issue) => issue.resolved).length,
    assigned: issues.filter((issue) => assignedTo(issue) !== "Unassigned").length,
  }

  return (
    <DataTablePage
      title="Asset Issues"
      description="Track and manage asset issues across the organization."
      icon={AlertCircle}
      backLink={{ href: backLinkHref ?? "/admin/assets", label: "Back to Assets" }}
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total Issues"
            value={stats.total}
            icon={AlertCircle}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Unresolved"
            value={stats.unresolved}
            icon={AlertCircle}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Resolved"
            value={stats.resolved}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Assigned Assets"
            value={stats.assigned}
            icon={Package}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<AssetIssue>
        data={issues}
        columns={columns}
        filters={tableFilters}
        getRowId={(issue) => issue.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search issue description, asset code, assignee, or reporter..."
        searchFn={(issue, query) =>
          [
            issue.description,
            issue.asset?.unique_code || "",
            assignedTo(issue),
            issue.creator ? `${formatName(issue.creator.first_name)} ${formatName(issue.creator.last_name)}` : "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={error instanceof Error ? error.message : error ? String(error) : null}
        onRetry={() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminAssetIssues() })}
        rowActions={rowActions}
        expandable={{
          render: (issue) => (
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground text-xs">Issue</p>
                <p className="mt-1">{issue.description}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Assigned To</p>
                <p className="mt-1">{assignedTo(issue)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Reported</p>
                <p className="mt-1">{formatWATDate(issue.created_at)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(issue) => (
          <IssueCard issue={issue} onToggle={(item) => void handleToggleResolved(item)} onDelete={setPendingDeleteId} />
        )}
        emptyTitle="No asset issues found"
        emptyDescription="Open issues will appear here when assets are reported for maintenance or follow-up."
        emptyIcon={AlertCircle}
        skeletonRows={6}
      />

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Issue</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this issue? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingIssue}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isDeletingIssue}
              onClick={async () => {
                const pendingIssue = issues.find((item) => item.id === pendingDeleteId)
                if (pendingIssue) {
                  setIsDeletingIssue(true)
                  try {
                    await handleDeleteIssue(pendingIssue)
                    setPendingDeleteId(null)
                  } finally {
                    setIsDeletingIssue(false)
                  }
                }
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
