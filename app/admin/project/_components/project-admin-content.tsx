"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import {
  FolderGit2,
  FolderKanban,
  Plus,
  RefreshCw,
  Calendar,
  MapPin,
  Wrench,
  ShieldCheck,
  Briefcase,
} from "lucide-react"
import { toast } from "sonner"
import type { employee } from "@/app/admin/tasks/management/admin-tasks-content"
import { ProjectDialogs } from "./project-dialogs"
import { PROJECT_HEALTH_LABELS, computeProjectHealth, type ProjectHealthTask } from "@/lib/projects/health"
import { toLocalISODate } from "@/lib/utils/date"
import { Progress } from "@/components/ui/progress"
import { ProjectPlanBoard } from "./project-plan-board"

// Define core project structure
export interface Project {
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
  portfolio_id: string | null
  project_manager?: {
    id: string
    full_name: string | null
    first_name: string | null
    last_name: string | null
  } | null
  portfolio?: { id: string; name: string; code: string | null } | null
  /** Returned with the project so progress can be derived without a second call. */
  tasks?: ProjectHealthTask[] | null
}

interface ProjectAdminContentProps {
  profiles: employee[]
  currentUser: { id: string; role: string; department: string | null }
}

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects", { cache: "no-store" })
  const payload = await res.json()
  if (!res.ok) {
    throw new Error(payload?.error || `Failed to load projects (${res.status})`)
  }
  return (payload?.data || []) as Project[]
}

export function ProjectAdminContent({ profiles, currentUser }: ProjectAdminContentProps) {
  const queryClient = useQueryClient()
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)

  // React Query fetch for project list
  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
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

  // Health is derived from the project's own tasks on every render — nothing
  // about progress is stored, so these figures cannot drift from the tasks.
  const healthById = useMemo(() => {
    const today = toLocalISODate()
    return new Map(
      rows.map((project) => [
        project.id,
        computeProjectHealth({
          startDate: project.deployment_start_date,
          endDate: project.deployment_end_date,
          tasks: project.tasks || [],
          today,
        }),
      ])
    )
  }, [rows])

  const renderHealthBadge = (status: string) => {
    switch (status) {
      case "on_track":
        return <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-500">On Track</Badge>
      case "at_risk":
        return <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-500">At Risk</Badge>
      case "behind_schedule":
        return <Badge className="border-red-500/20 bg-red-500/10 text-red-500">Behind Schedule</Badge>
      case "completed":
        return <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-500">Completed</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  // Technology Types option list for filtering
  const techOptions = useMemo(() => {
    const types = Array.from(new Set(rows.map((r) => r.technology_type).filter(Boolean)))
    return types.sort().map((t) => ({ value: t!, label: t! }))
  }, [rows])

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
  const columns = useMemo<DataTableColumn<Project>[]>(
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
        key: "portfolio",
        label: "Portfolio",
        sortable: true,
        accessor: (r) => r.portfolio?.name || "",
        render: (r) =>
          r.portfolio ? (
            <Badge variant="outline" className="text-xs">
              {r.portfolio.code || r.portfolio.name}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">Unassigned</span>
          ),
      },
      {
        key: "progress",
        label: "Delivery / Quality",
        sortable: true,
        accessor: (r) => healthById.get(r.id)?.deliveryPct ?? 0,
        render: (r) => {
          const health = healthById.get(r.id)
          if (!health || health.totalWeight === 0) {
            return <span className="text-muted-foreground text-xs">No tasks</span>
          }
          return (
            <div className="w-32 space-y-1">
              <Progress value={health.deliveryPct ?? 0} className="h-1.5" />
              <p className="text-muted-foreground text-[11px]">
                {health.deliveryPct ?? 0}% delivered · {health.qualityPct ?? 0}% quality
              </p>
            </div>
          )
        },
      },
      {
        key: "health",
        label: "Health",
        sortable: true,
        accessor: (r) => PROJECT_HEALTH_LABELS[healthById.get(r.id)?.status ?? "on_track"],
        render: (r) => {
          const health = healthById.get(r.id)
          if (!health) return null
          return (
            <div className="space-y-1">
              {renderHealthBadge(health.status)}
              {health.variancePct !== null && (
                <p className="text-muted-foreground text-[11px]">
                  {health.variancePct > 0 ? "+" : ""}
                  {health.variancePct}% vs schedule
                  {health.overdueCount > 0 ? ` · ${health.overdueCount} overdue` : ""}
                </p>
              )}
            </div>
          )
        },
      },
      {
        key: "status",
        label: "Lifecycle",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => renderStatusBadge(r.status),
      },
    ],
    [healthById]
  )

  // Filters definition
  const filters = useMemo<DataTableFilter<Project>[]>(
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
      {
        key: "health",
        label: "Health",
        options: [
          { value: "On Track", label: "On Track" },
          { value: "At Risk", label: "At Risk" },
          { value: "Behind Schedule", label: "Behind Schedule" },
          { value: "Completed", label: "Completed" },
        ],
      },
    ],
    [techOptions]
  )

  return (
    <DataTablePage
      title="Projects Management"
      description="Overview and detailed task status tracking for all company ongoing installations."
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["projects"] })}
            disabled={isLoading}
          >
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setIsAddOpen(true)}>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Project</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Total Projects"
            value={stats.total}
            icon={FolderKanban}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Ongoing Projects"
            value={stats.active}
            icon={Wrench}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Completed Projects"
            value={stats.completed}
            icon={ShieldCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Total Power Capacity"
            value={stats.totalCapacity}
            icon={FolderGit2}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<Project>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.id}
        searchPlaceholder="Search project name, location..."
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
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (r) =>
            r.status === "completed" ? "bg-emerald-500" : r.status === "active" ? "bg-blue-500" : "bg-amber-500",
          title: (r) => r.project_name,
          subtitle: (r) => `${r.location} · ${formatCapacity(r.capacity_w)} · ${r.technology_type || "General"}`,
          trailing: (r) => (
            <Badge variant="outline" className="text-[10px] capitalize">
              {r.status || "Planned"}
            </Badge>
          ),
          onSelect: (r) => {
            setActiveProject(r)
            setIsEditOpen(true)
          },
        }}
        cardRenderer={(r) => (
          <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{r.project_name}</p>
                <p className="text-muted-foreground text-xs">{r.location}</p>
              </div>
              <Badge variant="outline" className="capitalize">
                {r.status || "Planned"}
              </Badge>
            </div>
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span>{formatCapacity(r.capacity_w)}</span>
              <span>{r.technology_type || "General"}</span>
            </div>
            {r.portfolio && (
              <Badge variant="secondary" className="text-[10px]">
                {r.portfolio.code || r.portfolio.name}
              </Badge>
            )}
          </div>
        )}
        rowActions={[
          {
            label: "Edit Project Details",
            onClick: (r) => {
              setActiveProject(r)
              setIsEditOpen(true)
            },
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 rounded-lg border p-2">
              <ProjectPlanBoard project={r} profiles={profiles} />
            </div>
          ),
        }}
        emptyTitle="No Projects Found"
        emptyDescription="Create a new project deployment profile to start tracking tasks."
        emptyIcon={FolderKanban}
        urlSync
      />

      <ProjectDialogs
        profiles={profiles}
        isAddOpen={isAddOpen}
        setIsAddOpen={setIsAddOpen}
        isEditOpen={isEditOpen}
        setIsEditOpen={setIsEditOpen}
        selectedProject={activeProject}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["projects"] })
        }}
      />
    </DataTablePage>
  )
}
