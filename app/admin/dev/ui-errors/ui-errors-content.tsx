"use client"

import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Bug, AlertTriangle, ShieldAlert } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import { DataTablePage, DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table"

export interface UiErrorRow {
  id: string
  created_at: string
  message: string
  source: string
  route: string
  user_name: string
}

interface UiErrorsContentProps {
  rows: UiErrorRow[]
  stats: {
    total: number
    last24h: number
    boundaries: number
  }
  error: unknown
}

export function UiErrorsContent({ rows, stats, error }: UiErrorsContentProps) {
  const columns: DataTableColumn<UiErrorRow>[] = useMemo(
    () => [
      {
        key: "time",
        label: "Time",
        sortable: true,
        accessor: (r) => r.created_at,
        hideOnMobile: true,
        render: (r) => <span className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</span>,
      },
      {
        key: "source",
        label: "Source",
        sortable: true,
        accessor: (r) => r.source,
        render: (r) => (
          <Badge variant="outline" className="text-xs">
            {r.source}
          </Badge>
        ),
      },
      {
        key: "route",
        label: "Route",
        sortable: true,
        accessor: (r) => r.route,
        render: (r) => <span className="max-w-[220px] truncate font-mono text-xs">{r.route || "-"}</span>,
      },
      {
        key: "user",
        label: "User",
        sortable: true,
        accessor: (r) => r.user_name || "Anonymous",
      },
      {
        key: "message",
        label: "Message",
        sortable: true,
        resizable: true,
        initialWidth: 500,
        accessor: (r) => r.message,
        hideOnMobile: true,
        render: (r) => <span className="max-w-[520px] truncate text-xs">{r.message}</span>,
      },
    ],
    []
  )

  const filters: DataTableFilter<UiErrorRow>[] = useMemo(() => {
    const sources = Array.from(new Set(rows.map((r) => r.source))).sort()
    const routes = Array.from(new Set(rows.map((r) => r.route).filter((x): x is string => !!x))).sort()

    return [
      {
        key: "source",
        label: "Source",
        options: sources.map((s) => ({ value: s, label: s })),
      },
      {
        key: "route",
        label: "Route",
        options: routes.map((r) => ({ value: r, label: r })),
      },
    ]
  }, [rows])

  return (
    <DataTablePage
      title="UI Error Monitor"
      description="Centralized frontend runtime errors captured from all pages during beta"
      icon={Bug}
      backLink={{ href: "/admin/dev", label: "Back to DEV" }}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard title="Total Captured" value={stats.total} icon={Bug} />
          <StatCard title="Last 24h" value={stats.last24h} icon={AlertTriangle} />
          <StatCard title="Boundary Catches" value={stats.boundaries} icon={ShieldAlert} />
        </div>
      }
    >
      <DataTable<UiErrorRow>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search message, route, source, user..."
        searchFn={(row, q) =>
          row.message.toLowerCase().includes(q) ||
          row.route.toLowerCase().includes(q) ||
          row.source.toLowerCase().includes(q) ||
          row.user_name.toLowerCase().includes(q)
        }
        filters={filters}
        error={error ? "Failed to load logs from backend storage" : null}
        pagination={{ pageSize: 50 }}
      />
    </DataTablePage>
  )
}
