"use client"

import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Progress } from "@/components/ui/progress"
import { FolderGit2, FolderKanban, RefreshCw, Calendar, MapPin, Wrench, ShieldCheck, Briefcase } from "lucide-react"
import { ProjectTaskViewer } from "./_components/project-task-viewer"
import { computeProjectHealth, type ProjectHealthTask } from "@/lib/projects/health"
import { toLocalISODate } from "@/lib/utils/date"

// Define user-facing project type (includes tasks count payload)
export interface ProjectRow {
  id: string
  project_name: string
  location: string
  deployment_start_date: string
  deployment_end_date: string
  capacity_w: number | null
  technology_type: string | null
  project_manager_id: string | null
  description: string | null
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled"
  created_at: string
  updated_at: string
  project_manager?: {
    id: string
    full_name: string | null
    first_name: string | null
    last_name: string | null
  } | null
  portfolio?: { id: string; name: string; code: string | null } | null
  tasks?: ProjectHealthTask[]
}

async function fetchUserProjects(): Promise<ProjectRow[]> {
  const res = await fetch("/api/projects", { cache: "no-store" })
  const payload = await res.json()
  if (!res.ok) {
    throw new Error(payload?.error || `Failed to load projects (${res.status})`)
  }
  return (payload?.data || []) as ProjectRow[]
}

export function ProjectContent() {
  const queryClient = useQueryClient()

  // Fetch project list
  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["user-projects"],
    queryFn: fetchUserProjects,
  })

  // Format power capacity helper
  const formatCapacity = (watts: number | null) => {
    if (watts === null || watts === undefined) return "-"
    const kwp = watts / 1000
    return `${kwp.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWp`
  }

  // Calculate project summary statistics
  const stats = useMemo(() => {
    const total = rows.length
    const active = rows.filter((r) => r.status === "active").length
    const completed = rows.filter((r) => r.status === "completed").length
    const totalCapacityWatts = rows.reduce((sum, r) => sum + (r.capacity_w || 0), 0)
    return {
      total,
      active,
      completed,
      totalCapacity: formatCapacity(totalCapacityWatts),
    }
  }, [rows])

  // Technology Types option list for filtering
  const techOptions = useMemo(() => {
    const types = Array.from(new Set(rows.map((r) => r.technology_type).filter(Boolean)))
    return types.sort().map((t) => ({ value: t!, label: t! }))
  }, [rows])

  // Weighted delivery, from the same helper the admin project and portfolio
  // dashboards use — a count of finished tasks would report a different number
  // for the same project depending on which page you opened.
  const getProgressInfo = (project: ProjectRow) => {
    const projectTasks = project.tasks || []
    if (projectTasks.length === 0) return { percent: 0, text: "No tasks" }
    const health = computeProjectHealth({
      startDate: project.deployment_start_date,
      endDate: project.deployment_end_date,
      tasks: projectTasks,
      today: toLocalISODate(),
    })
    return {
      percent: health.deliveryPct ?? 0,
      text: `${health.qualityPct ?? 0}% quality`,
    }
  }

  // Project Status Badge formatter
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-500">Ongoing</Badge>
      case "completed":
        return <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-500">Completed</Badge>
      case "planning":
        return <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-500">Planning</Badge>
      case "on_hold":
        return <Badge className="border-red-500/20 bg-red-500/10 text-red-500">On Hold</Badge>
      case "cancelled":
        return <Badge className="border-slate-500/20 bg-slate-500/10 text-slate-500">Cancelled</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  // Table columns definition
  const columns = useMemo<DataTableColumn<ProjectRow>[]>(
    () => [
      {
        key: "project_name",
        label: "Project Title",
        sortable: true,
        accessor: (r) => r.project_name,
        render: (r) => (
          <div className="space-y-1">
            <p className="text-foreground font-semibold">{r.project_name}</p>
            {r.description && <p className="text-muted-foreground line-clamp-1 text-xs">{r.description}</p>}
          </div>
        ),
      },
      {
        key: "location",
        label: "Site Location",
        sortable: true,
        accessor: (r) => r.location,
        render: (r) => (
          <div className="flex items-center gap-1.5 text-sm">
            <MapPin className="text-muted-foreground h-3.5 w-3.5" />
            <span>{r.location}</span>
          </div>
        ),
      },
      {
        key: "technology_type",
        label: "Tech / Capacity",
        sortable: true,
        accessor: (r) => r.technology_type || "",
        render: (r) => (
          <div className="space-y-0.5 text-sm">
            <p className="font-medium">{formatCapacity(r.capacity_w)}</p>
            {r.technology_type && <p className="text-muted-foreground text-xs">{r.technology_type}</p>}
          </div>
        ),
      },
      {
        key: "progress",
        label: "Delivery / Quality",
        sortable: false,
        render: (r) => {
          const info = getProgressInfo(r)
          return (
            <div className="max-w-[180px] min-w-[120px] space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span>{info.percent}%</span>
                <span className="text-muted-foreground">{info.text}</span>
              </div>
              <Progress value={info.percent} className="h-1.5" />
            </div>
          )
        },
      },
      {
        key: "project_manager",
        label: "Project Manager",
        sortable: true,
        accessor: (r) => r.project_manager?.full_name || "",
        render: (r) => (
          <div className="flex items-center gap-1.5 text-sm">
            <Briefcase className="text-muted-foreground h-3.5 w-3.5" />
            <span>
              {r.project_manager?.full_name ||
                [r.project_manager?.first_name, r.project_manager?.last_name].filter(Boolean).join(" ") ||
                "Unassigned"}
            </span>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => renderStatusBadge(r.status),
      },
    ],
    []
  )

  // Filters definition
  const filters = useMemo<DataTableFilter<ProjectRow>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "planning", label: "Planning" },
          { value: "active", label: "Ongoing" },
          { value: "on_hold", label: "On Hold" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        key: "technology_type",
        label: "Technology",
        options: techOptions,
      },
    ],
    [techOptions]
  )

  return (
    <DataTablePage
      title="Projects &amp; Deployments"
      description="View ongoing mini-grid electrification and solar installations progress and task milestones."
      spacing="tight"
      actionsPlacement="inline-always"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["user-projects"] })}
          disabled={isLoading}
        >
          <RefreshCw className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      }
      statBadgeStyle="line"
      statBadges={[
        { icon: FolderKanban, label: `${stats.total} assigned` },
        { icon: Wrench, label: `${stats.active} active` },
        { icon: ShieldCheck, label: `${stats.completed} completed` },
        { icon: FolderGit2, label: stats.totalCapacity },
      ]}
      stats={
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Assigned Projects"
            value={stats.total}
            icon={FolderKanban}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Ongoing Status"
            value={stats.active}
            icon={Wrench}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Completed Scope"
            value={stats.completed}
            icon={ShieldCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Cumulative Capacity"
            value={stats.totalCapacity}
            icon={FolderGit2}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<ProjectRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.id}
        searchPlaceholder="Search project title or site location..."
        searchFn={(row, query) => {
          const q = query.toLowerCase()
          return (
            row.project_name.toLowerCase().includes(q) ||
            row.location.toLowerCase().includes(q) ||
            (row.description || "").toLowerCase().includes(q)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={refetch}
        viewToggle
        stickyToolbar
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          title: (r) => r.project_name,
          subtitle: (r) => [r.location, r.technology_type].filter(Boolean).join(" · ") || r.location,
          trailing: (r) => renderStatusBadge(r.status),
          detail: {
            title: (r) => r.project_name,
            subtitle: (r) => <span className="text-muted-foreground text-xs">{r.location}</span>,
            badges: (r) => renderStatusBadge(r.status),
            fields: (r) => {
              const info = getProgressInfo(r)
              return [
                { icon: MapPin, label: "Location", value: r.location },
                {
                  icon: Briefcase,
                  label: "Project manager",
                  value:
                    r.project_manager?.full_name ||
                    [r.project_manager?.first_name, r.project_manager?.last_name].filter(Boolean).join(" ") ||
                    "Unassigned",
                },
                { icon: Wrench, label: "Technology", value: r.technology_type },
                { icon: FolderGit2, label: "Capacity", value: formatCapacity(r.capacity_w) },
                { icon: Calendar, label: "Delivery progress", value: `${info.percent}% — ${info.text}` },
                { icon: FolderKanban, label: "Description", value: r.description },
              ]
            },
          },
        }}
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 rounded-lg border p-2">
              <ProjectTaskViewer projectId={r.id} projectName={r.project_name} />
            </div>
          ),
        }}
        emptyTitle="No Projects Assigned"
        emptyDescription="You will see projects here once you are assigned as a manager or member."
        emptyIcon={FolderKanban}
        urlSync
      />
    </DataTablePage>
  )
}
