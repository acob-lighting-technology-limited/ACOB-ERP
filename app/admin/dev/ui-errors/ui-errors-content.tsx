"use client"

import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { formatWATDateTime } from "@/lib/utils/date"
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
        render: (r) => <span className="text-xs whitespace-nowrap">{formatWATDateTime(r.created_at)}</span>,
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
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatCard variant="compact" title="Total Captured" value={stats.total} icon={Bug} />
          <StatCard variant="compact" title="Last 24h" value={stats.last24h} icon={AlertTriangle} />
          <StatCard variant="compact" title="Boundary Catches" value={stats.boundaries} icon={ShieldAlert} />
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
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: () => "bg-red-500",
          title: (r) => r.message,
          subtitle: (r) => `${r.source} · ${r.route || "-"} · ${formatWATDateTime(r.created_at)}`,
          trailing: (r) => (
            <Badge variant="outline" className="text-[10px]">
              {r.source}
            </Badge>
          ),
        }}
        cardRenderer={(r) => (
          <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="line-clamp-2 text-sm font-semibold">{r.message}</p>
                <p className="text-muted-foreground font-mono text-xs">{r.route || "-"}</p>
              </div>
              <Badge variant="outline">{r.source}</Badge>
            </div>
            <div className="text-muted-foreground flex justify-between border-t pt-2 text-[10px]">
              <span>{r.user_name || "Anonymous"}</span>
              <span>{formatWATDateTime(r.created_at)}</span>
            </div>
          </div>
        )}
      />
    </DataTablePage>
  )
}
