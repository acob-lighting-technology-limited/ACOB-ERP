"use client"

import { useMemo } from "react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { ShieldEllipsis, ShieldCheck, TriangleAlert, UserCog } from "lucide-react"
import { formatWATDateTime } from "@/lib/utils/date"

export type AuditLogRow = {
  id: string
  action: string | null
  operation: string | null
  entity_type: string | null
  entity_id: string | null
  user_id: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function getRoleTier(row: AuditLogRow) {
  const text = `${JSON.stringify(row.new_values || {})} ${JSON.stringify(row.metadata || {})}`.toLowerCase()
  if (text.includes("super_admin")) return "Super Admin"
  if (text.includes("developer")) return "Developer"
  if (text.includes("admin")) return "Admin"
  if (text.includes("department_lead")) return "Department Lead"
  return "Role Change"
}

export function RoleEscalationsContent({ rows, error }: { rows: AuditLogRow[]; error: string | null }) {
  const stats = useMemo(
    () => ({
      total: rows.length,
      superAdmin: rows.filter((row) => getRoleTier(row) === "Super Admin").length,
      developer: rows.filter((row) => getRoleTier(row) === "Developer").length,
      adminRelated: rows.filter((row) => getRoleTier(row) === "Admin").length,
    }),
    [rows]
  )

  const roleTierOptions = useMemo(
    () =>
      ["Super Admin", "Developer", "Admin", "Department Lead", "Role Change"].map((value) => ({ value, label: value })),
    []
  )

  const entityTypeOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.entity_type).filter((value): value is string => Boolean(value))))
        .sort()
        .map((value) => ({ value, label: value })),
    [rows]
  )

  const columns: DataTableColumn<AuditLogRow>[] = useMemo(
    () => [
      {
        key: "created_at",
        label: "Time",
        sortable: true,
        accessor: (row) => row.created_at,
        resizable: true,
        initialWidth: 220,
        hideOnMobile: true,
        render: (row) => formatWATDateTime(row.created_at),
      },
      {
        key: "action",
        label: "Action",
        sortable: true,
        accessor: (row) => row.action || row.operation || "",
        render: (row) => (
          <div className="space-y-1">
            <p className="font-medium">{row.action || row.operation || "Unknown action"}</p>
            <p className="text-muted-foreground text-xs">{row.operation || "No operation"}</p>
          </div>
        ),
      },
      {
        key: "entity_type",
        label: "Entity",
        sortable: true,
        accessor: (row) => row.entity_type || "",
        hideOnMobile: true,
        render: (row) => row.entity_type || "Unknown",
      },
      {
        key: "role_tier",
        label: "Role Tier",
        accessor: (row) => getRoleTier(row),
        render: (row) => <Badge variant="outline">{getRoleTier(row)}</Badge>,
      },
      {
        key: "user_id",
        label: "Actor ID",
        accessor: (row) => row.user_id || "",
        resizable: true,
        initialWidth: 220,
        hideOnMobile: true,
        render: (row) => <span className="font-mono text-xs">{row.user_id || "-"}</span>,
      },
    ],
    []
  )

  const filters: DataTableFilter<AuditLogRow>[] = useMemo(
    () => [
      {
        key: "entity_type",
        label: "Entity Type",
        options: entityTypeOptions,
      },
      {
        key: "role_tier",
        label: "Role Tier",
        options: roleTierOptions,
      },
    ],
    [entityTypeOptions, roleTierOptions]
  )

  return (
    <DataTablePage
      title="Role Escalations"
      description="High-sensitivity role elevation and privileged change stream."
      icon={ShieldEllipsis}
      backLink={{ href: "/admin/dev", label: "Back to DEV" }}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Escalations"
            value={stats.total}
            icon={ShieldEllipsis}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Super Admin"
            value={stats.superAdmin}
            icon={TriangleAlert}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Developer"
            value={stats.developer}
            icon={UserCog}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Admin"
            value={stats.adminRelated}
            icon={ShieldCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
        </div>
      }
    >
      <DataTable<AuditLogRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search action, entity, actor, or changed values..."
        searchFn={(row, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            (row.action || "").toLowerCase().includes(normalizedQuery) ||
            (row.operation || "").toLowerCase().includes(normalizedQuery) ||
            (row.entity_type || "").toLowerCase().includes(normalizedQuery) ||
            (row.user_id || "").toLowerCase().includes(normalizedQuery) ||
            JSON.stringify(row.new_values || {})
              .toLowerCase()
              .includes(normalizedQuery) ||
            JSON.stringify(row.old_values || {})
              .toLowerCase()
              .includes(normalizedQuery)
          )
        }}
        error={error}
        expandable={{
          render: (row) => (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Before</p>
                <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                  {JSON.stringify(row.old_values || {}, null, 2)}
                </pre>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">After</p>
                <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                  {JSON.stringify(row.new_values || {}, null, 2)}
                </pre>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Metadata</p>
                <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">
                  {JSON.stringify(row.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(row) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{row.action || row.operation || "Unknown action"}</p>
                <p className="text-muted-foreground text-sm">{formatWATDateTime(row.created_at)}</p>
              </div>
              <Badge variant="outline">{getRoleTier(row)}</Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Entity</span>
                <span>{row.entity_type || "Unknown"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Actor</span>
                <span className="font-mono text-xs">{row.user_id || "-"}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No role escalations found"
        emptyDescription="No privileged role elevation events were detected in the current log window."
        emptyIcon={ShieldEllipsis}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
