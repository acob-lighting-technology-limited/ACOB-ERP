"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { BarChart3, Eye, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn } from "@/components/ui/data-table"
import { Progress } from "@/components/ui/progress"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"
import { ragStatus, type RagStatus } from "@/lib/corporate-scorecard/attainment"

type PerspectiveRollup = {
  perspective: string
  objectives: Array<{ strategicObjective: string; attainmentPct: number | null; kpiCount: number }>
  attainmentPct: number | null
}

type DepartmentRow = {
  department: string
  attainmentPct: number | null
  status: RagStatus | null
  recordedKpiCount: number
  coreKpiCount: number
}

type SummaryResponse = {
  data: {
    perspectives: PerspectiveRollup[]
    companyPct: number | null
    departments: DepartmentRow[]
  }
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
 * The MD view: how the company is doing against the 2026 plan, rolled up
 * KPI → objective → perspective → company (equal-weighted at every level),
 * and by department using CORE ownership only — the same rule and the same
 * shared formula (lib/corporate-scorecard/attainment) every other scorecard
 * screen uses, so this page can never disagree with a department's own.
 */
export function ScorecardSummaryContent() {
  const router = useRouter()

  const { data, isLoading, error, refetch } = useQuery<SummaryResponse>({
    queryKey: ["corporate-scorecard-summary"],
    queryFn: async () => {
      const res = await apiFetch("/api/corporate-scorecard/summary", { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load the scorecard summary")
      return payload
    },
  })

  const perspectives = useMemo(() => data?.data.perspectives ?? [], [data])
  const departments = useMemo(() => data?.data.departments ?? [], [data])
  const companyPct = data?.data.companyPct ?? null

  const columns = useMemo<DataTableColumn<DepartmentRow>[]>(
    () => [
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => r.department,
        render: (r) => <span className="font-medium">{r.department}</span>,
      },
      {
        key: "coreKpiCount",
        label: "CORE KPIs",
        sortable: true,
        accessor: (r) => r.coreKpiCount,
        render: (r) => <span className="text-xs">{r.coreKpiCount}</span>,
      },
      {
        key: "recordedKpiCount",
        label: "Recorded",
        sortable: true,
        accessor: (r) => r.recordedKpiCount,
        render: (r) => (
          <span className="text-xs">
            {r.recordedKpiCount}/{r.coreKpiCount}
          </span>
        ),
      },
      {
        key: "attainmentPct",
        label: "Attainment",
        sortable: true,
        accessor: (r) => r.attainmentPct ?? -1,
        render: (r) =>
          r.attainmentPct == null ? (
            <span className="text-muted-foreground text-xs">No data</span>
          ) : (
            <div className="w-32 space-y-1">
              <Progress value={r.attainmentPct} className="h-1.5" />
              <span className="text-muted-foreground text-[11px]">{r.attainmentPct}%</span>
            </div>
          ),
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => r.status ?? "",
        render: (r) => ragBadge(r.status),
      },
    ],
    []
  )

  return (
    <DataTablePage
      title="Scorecard Summary"
      description="Company-wide attainment against the 2026 plan. Departments are scored on CORE ownership only."
      icon={BarChart3}
      backLink={{ href: "/admin/corporate-scorecard", label: "Back to Register" }}
      stats={
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
            <StatCard
              variant="compact"
              title="Company-Wide"
              value={companyPct != null ? `${companyPct}%` : "No data"}
              icon={TrendingUp}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
              description="All 4 perspectives, equal-weighted"
            />
            {perspectives.map((p) => (
              <StatCard
                key={p.perspective}
                variant="compact"
                title={p.perspective}
                value={p.attainmentPct != null ? `${p.attainmentPct}%` : "No data"}
                description={`${p.objectives.length} objective${p.objectives.length === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        </div>
      }
    >
      <DataTable<DepartmentRow>
        data={departments}
        columns={columns}
        getRowId={(r) => r.department}
        searchPlaceholder="Search department..."
        searchFn={(row, query) => row.department.toLowerCase().includes(query.toLowerCase())}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        emptyTitle="No CORE Ownership Recorded"
        emptyDescription="No department owns any corporate KPI as CORE yet."
        emptyIcon={BarChart3}
        rowActions={[
          {
            label: "View Cascade",
            icon: Eye,
            onClick: (r) =>
              router.push(`/admin/corporate-scorecard/departments?department=${encodeURIComponent(r.department)}`),
          },
        ]}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: () => "bg-blue-500",
          title: (r) => r.department,
          subtitle: (r) =>
            `CORE KPIs: ${r.coreKpiCount} · Attainment: ${r.attainmentPct != null ? `${r.attainmentPct}%` : "No data"}`,
          trailing: (r) => ragBadge(r.status),
          onSelect: (r) =>
            router.push(`/admin/corporate-scorecard/departments?department=${encodeURIComponent(r.department)}`),
        }}
        cardRenderer={(r) => (
          <div
            className="bg-card cursor-pointer space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md"
            onClick={() =>
              router.push(`/admin/corporate-scorecard/departments?department=${encodeURIComponent(r.department)}`)
            }
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{r.department}</p>
                <p className="text-muted-foreground text-xs">{r.coreKpiCount} CORE KPIs</p>
              </div>
              {ragBadge(r.status)}
            </div>
            <div className="space-y-1 border-t pt-2">
              <div className="flex justify-between text-xs">
                <span>Attainment</span>
                <span className="font-semibold">{r.attainmentPct != null ? `${r.attainmentPct}%` : "No data"}</span>
              </div>
              {r.attainmentPct != null && <Progress value={r.attainmentPct} className="h-1.5" />}
            </div>
          </div>
        )}
      />
    </DataTablePage>
  )
}
