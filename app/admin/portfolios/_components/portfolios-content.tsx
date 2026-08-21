"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, FolderGit2, FolderKanban, Layers, Plus, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Progress } from "@/components/ui/progress"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"
import { PROJECT_HEALTH_LABELS, type ProjectHealthStatus } from "@/lib/projects/health"
import { PortfolioDialog } from "./portfolio-dialog"

type ProjectHealthRow = {
  id: string
  project_name: string
  lifecycle_status: string | null
  deliveryPct: number | null
  qualityPct: number | null
  timeElapsedPct: number | null
  variancePct: number | null
  status: ProjectHealthStatus
  overdueCount: number
  totalWeight: number
  taskCount: number
}

type PortfolioRollup = {
  projectCount: number
  onTrack: number
  atRisk: number
  behindSchedule: number
  completed: number
  overdueCount: number
  deliveryPct: number | null
  qualityPct: number | null
}

export type Portfolio = {
  id: string
  name: string
  code: string | null
  description: string | null
  status: "active" | "on_hold" | "closed"
  projects: ProjectHealthRow[]
  rollup: PortfolioRollup
}

function healthBadge(status: ProjectHealthStatus) {
  switch (status) {
    case "on_track":
      return <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-500">On Track</Badge>
    case "at_risk":
      return <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-500">At Risk</Badge>
    case "behind_schedule":
      return <Badge className="border-red-500/20 bg-red-500/10 text-red-500">Behind Schedule</Badge>
    case "completed":
      return <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-500">Completed</Badge>
  }
}

/** The project rows shown when a portfolio is expanded. */
function PortfolioProjects({ projects }: { projects: ProjectHealthRow[] }) {
  if (projects.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed py-6 text-center text-sm">
        No projects in this portfolio yet.
      </p>
    )
  }

  return (
    <div className="bg-background overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Project</th>
            <th className="px-3 py-2 text-left font-medium">Elapsed</th>
            <th className="px-3 py-2 text-left font-medium">Delivered</th>
            <th className="px-3 py-2 text-left font-medium">Quality</th>
            <th className="px-3 py-2 text-left font-medium">Variance</th>
            <th className="px-3 py-2 text-left font-medium">Overdue</th>
            <th className="px-3 py-2 text-left font-medium">Health</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className="border-t">
              <td className="px-3 py-2 font-medium">
                {project.project_name}
                <span className="text-muted-foreground ml-2 text-xs">
                  {project.taskCount} task{project.taskCount === 1 ? "" : "s"}
                </span>
              </td>
              <td className="text-muted-foreground px-3 py-2">
                {project.timeElapsedPct === null ? "-" : `${project.timeElapsedPct}%`}
              </td>
              <td className="px-3 py-2">
                <div className="w-24">
                  <Progress value={project.deliveryPct ?? 0} className="h-1.5" />
                  <span className="text-muted-foreground text-[11px]">{project.deliveryPct ?? 0}%</span>
                </div>
              </td>
              <td className="px-3 py-2">{project.qualityPct === null ? "-" : `${project.qualityPct}%`}</td>
              <td
                className={
                  project.variancePct !== null && project.variancePct < 0 ? "px-3 py-2 text-red-500" : "px-3 py-2"
                }
              >
                {project.variancePct === null ? "-" : `${project.variancePct > 0 ? "+" : ""}${project.variancePct}%`}
              </td>
              <td className="px-3 py-2">
                {project.overdueCount > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400">{project.overdueCount}</span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </td>
              <td className="px-3 py-2">{healthBadge(project.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PortfoliosContent() {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editing, setEditing] = useState<Portfolio | null>(null)

  const { data, isLoading, error, refetch } = useQuery<{ data: Portfolio[]; unassigned: Portfolio["rollup"] }>({
    queryKey: ["portfolios"],
    queryFn: async () => {
      const res = await apiFetch("/api/portfolios", { cache: "no-store" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load portfolios")
      return payload
    },
  })

  const rows = useMemo(() => data?.data ?? [], [data])

  const stats = useMemo(() => {
    const projectCount = rows.reduce((sum, row) => sum + row.rollup.projectCount, 0)
    const atRisk = rows.reduce((sum, row) => sum + row.rollup.atRisk + row.rollup.behindSchedule, 0)
    const overdue = rows.reduce((sum, row) => sum + row.rollup.overdueCount, 0)
    return { portfolios: rows.length, projectCount, atRisk, overdue }
  }, [rows])

  const columns = useMemo<DataTableColumn<Portfolio>[]>(
    () => [
      {
        key: "name",
        label: "Portfolio",
        sortable: true,
        accessor: (r) => r.name,
        render: (r) => (
          <div className="space-y-1">
            <p className="text-foreground font-semibold">{r.code ? `${r.code} — ${r.name}` : r.name}</p>
            {r.description && <p className="text-muted-foreground line-clamp-1 text-xs">{r.description}</p>}
          </div>
        ),
      },
      {
        key: "projects",
        label: "Projects",
        sortable: true,
        accessor: (r) => r.rollup.projectCount,
        render: (r) => (
          <div className="text-xs">
            <p className="text-foreground font-medium">{r.rollup.projectCount} total</p>
            <p className="text-muted-foreground">
              {r.rollup.onTrack} on track · {r.rollup.atRisk} at risk · {r.rollup.behindSchedule} behind
            </p>
          </div>
        ),
      },
      {
        key: "delivery",
        label: "Delivery / Quality",
        sortable: true,
        accessor: (r) => r.rollup.deliveryPct ?? 0,
        render: (r) =>
          r.rollup.deliveryPct === null ? (
            <span className="text-muted-foreground text-xs">No tasks</span>
          ) : (
            <div className="w-32 space-y-1">
              <Progress value={r.rollup.deliveryPct} className="h-1.5" />
              <p className="text-muted-foreground text-[11px]">
                {r.rollup.deliveryPct}% delivered · {r.rollup.qualityPct ?? 0}% quality
              </p>
            </div>
          ),
      },
      {
        key: "overdue",
        label: "Overdue Tasks",
        sortable: true,
        accessor: (r) => r.rollup.overdueCount,
        render: (r) =>
          r.rollup.overdueCount > 0 ? (
            <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-500">{r.rollup.overdueCount}</Badge>
          ) : (
            <span className="text-muted-foreground text-xs">None</span>
          ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => (
          <Badge variant="outline" className="capitalize">
            {r.status.replaceAll("_", " ")}
          </Badge>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<Portfolio>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "on_hold", label: "On Hold" },
          { value: "closed", label: "Closed" },
        ],
      },
      {
        key: "health",
        label: "Contains",
        options: [
          { value: "at_risk", label: PROJECT_HEALTH_LABELS.at_risk },
          { value: "behind_schedule", label: PROJECT_HEALTH_LABELS.behind_schedule },
          { value: "overdue", label: "Overdue tasks" },
        ],
        mode: "custom",
        filterFn: (row, selected) =>
          selected.some((value) =>
            value === "overdue" ? row.rollup.overdueCount > 0 : row.projects.some((project) => project.status === value)
          ),
      },
    ],
    []
  )

  return (
    <DataTablePage
      title="Project Portfolios"
      description="Programmes and client groupings, each holding its own projects. Progress is derived from project tasks."
      icon={Layers}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["portfolios"] })}
            disabled={isLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Portfolio
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            title="Portfolios"
            value={stats.portfolios}
            icon={Layers}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Projects"
            value={stats.projectCount}
            icon={FolderKanban}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="At Risk / Behind"
            value={stats.atRisk}
            icon={AlertTriangle}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Overdue Tasks"
            value={stats.overdue}
            icon={FolderGit2}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <DataTable<Portfolio>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.id}
        searchPlaceholder="Search portfolio name or code..."
        searchFn={(row, query) => {
          const q = query.toLowerCase()
          return (
            row.name.toLowerCase().includes(q) ||
            (row.code || "").toLowerCase().includes(q) ||
            (row.description || "").toLowerCase().includes(q)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        rowActions={[{ label: "Edit Portfolio", onClick: (r) => setEditing(r) }]}
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 rounded-lg border p-2">
              <PortfolioProjects projects={r.projects} />
            </div>
          ),
        }}
        emptyTitle="No Portfolios Yet"
        emptyDescription="Create a portfolio to group related projects under one programme or client."
        emptyIcon={Layers}
        urlSync
      />

      <PortfolioDialog
        open={isAddOpen || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddOpen(false)
            setEditing(null)
          }
        }}
        portfolio={editing}
        onSuccess={() => {
          toast.success(editing ? "Portfolio updated" : "Portfolio created")
          setIsAddOpen(false)
          setEditing(null)
          void queryClient.invalidateQueries({ queryKey: ["portfolios"] })
        }}
      />
    </DataTablePage>
  )
}
