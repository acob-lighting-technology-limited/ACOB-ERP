"use client"

import { useEffect, useState, useMemo } from "react"
import { Brain, FileClock, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CbtAttemptDetail } from "@/components/pms/cbt-attempt-detail"
import { formatWATDateTime } from "@/lib/utils/date"

type AttemptRow = {
  id: string
  created_at: string
  submitted_at: string | null
  status: string
  score: number | null
  company_email: string | null
  cbt_details: {
    last_name?: string
    company_email?: string
    dob_day?: number
    dob_month?: number
    dob_year?: number
  } | null
  review_cycle_id: string
  profiles: {
    id: string
    first_name: string | null
    last_name: string | null
    department: string | null
  } | null
  review_cycles: {
    id: string
    name: string
    review_type: string | null
    start_date: string | null
    end_date: string | null
  } | null
}

export default function CbtDetailsLogPage() {
  const [data, setData] = useState<AttemptRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAttempts = async (quiet = false) => {
    if (quiet) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)
    try {
      const response = await fetch("/api/admin/hr/performance/cbt/attempts", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to load attempts logs")
      setData(payload.data || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load attempts logs"
      setError(msg)
      toast.error(msg)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void loadAttempts()
  }, [])

  const columns: DataTableColumn<AttemptRow>[] = useMemo(
    () => [
      {
        key: "candidate",
        label: "Employee",
        sortable: true,
        accessor: (row) => {
          const profile = row.profiles
          if (profile) {
            return [profile.first_name, profile.last_name].filter(Boolean).join(" ")
          }
          return row.company_email || "Unknown"
        },
        render: (row) => {
          const profile = row.profiles
          const name = profile
            ? [profile.first_name, profile.last_name].filter(Boolean).join(" ")
            : row.company_email || "Unknown"
          return (
            <div className="flex flex-col">
              <span className="text-foreground font-medium">{name}</span>
              <span className="text-muted-foreground text-xs">{row.company_email}</span>
            </div>
          )
        },
        resizable: true,
        initialWidth: 200,
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.profiles?.department || "-",
      },
      {
        key: "cycle",
        label: "Cycle",
        sortable: true,
        accessor: (row) => row.review_cycles?.name || "-",
      },
      {
        key: "entered_last_name",
        label: "Entered Last Name",
        sortable: true,
        accessor: (row) => row.cbt_details?.last_name || "-",
      },
      {
        key: "entered_dob",
        label: "Entered DOB",
        sortable: true,
        accessor: (row) => {
          const det = row.cbt_details
          if (det && det.dob_day !== undefined && det.dob_month !== undefined) {
            return `${String(det.dob_day).padStart(2, "0")}/${String(det.dob_month).padStart(2, "0")}/${det.dob_year || "YYYY"}`
          }
          return "-"
        },
      },
      {
        key: "created_at",
        label: "Login Time",
        sortable: true,
        accessor: (row) => row.created_at,
        render: (row) => formatWATDateTime(row.created_at),
      },
      {
        key: "status",
        label: "Status / Score",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) => {
          const isSubmitted = row.status === "submitted"
          return (
            <div className="flex items-center gap-2">
              <Badge variant={isSubmitted ? "default" : "secondary"}>{row.status}</Badge>
              {isSubmitted && typeof row.score === "number" && <span className="text-xs font-bold">{row.score}%</span>}
            </div>
          )
        },
      },
    ],
    []
  )

  // Attempts carry their cycle inline; dedupe it into the list the shared filters need.
  const cycles = useMemo(() => {
    const byId = new Map<string, NonNullable<AttemptRow["review_cycles"]>>()
    for (const row of data) {
      if (row.review_cycles?.id) byId.set(row.review_cycles.id, row.review_cycles)
    }
    return Array.from(byId.values())
  }, [data])

  const { filters: cycleFilters } = useCycleFilters<AttemptRow>({
    cycles,
    getRowCycleId: (row) => row.review_cycle_id,
  })

  const filters: DataTableFilter<AttemptRow>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "in_progress", label: "In Progress" },
          { value: "submitted", label: "Submitted" },
        ],
        placeholder: "All Statuses",
      },
      {
        key: "department",
        label: "Department",
        options: Array.from(new Set(data.map((r) => r.profiles?.department).filter(Boolean) as string[]))
          .sort()
          .map((dept) => ({ value: dept, label: dept })),
        placeholder: "All Departments",
      },
      ...cycleFilters,
    ],
    [data, cycleFilters]
  )

  return (
    <DataTablePage
      title="CBT Log Auditing"
      description="Audit logins and detail records entered by candidates for standalone CBT tests."
      icon={FileClock}
      backLink={{ href: "/admin/hr/pms/cbt", label: "Back to CBT Overview" }}
      actions={
        <Button variant="outline" size="sm" onClick={() => void loadAttempts(true)} disabled={isRefreshing}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      }
    >
      <DataTable<AttemptRow>
        data={data}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search employee, email, cycle, or status..."
        searchFn={(row, query) => {
          const name = row.profiles ? [row.profiles.first_name, row.profiles.last_name].join(" ") : ""
          return [name, row.company_email, row.cbt_details?.last_name, row.review_cycles?.name, row.status]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }}
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadAttempts()}
        expandable={{
          canExpand: (row) => row.status === "submitted" && !!row.profiles?.id,
          render: (row) => (
            <div className="space-y-4">
              {row.cbt_details && (
                <div className="bg-muted/50 flex w-fit flex-wrap gap-4 rounded-xl border p-3 text-xs text-slate-300">
                  <div>
                    <span className="text-muted-foreground block font-medium">Verified Last Name</span>
                    <span className="text-foreground font-semibold">{row.cbt_details.last_name || "-"}</span>
                  </div>
                  <div className="bg-border hidden h-6 w-[1px] sm:block" />
                  <div>
                    <span className="text-muted-foreground block font-medium">Entered DOB</span>
                    <span className="text-foreground font-semibold">
                      {row.cbt_details.dob_day !== undefined && row.cbt_details.dob_month !== undefined
                        ? `${String(row.cbt_details.dob_day).padStart(2, "0")}/${String(row.cbt_details.dob_month).padStart(2, "0")}/${row.cbt_details.dob_year || "YYYY"}`
                        : "-"}
                    </span>
                  </div>
                </div>
              )}
              <CbtAttemptDetail profileId={row.profiles?.id || ""} reviewCycleId={row.review_cycle_id} />
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (row) => (row.status === "submitted" ? "bg-emerald-500" : "bg-amber-500"),
          title: (row) => (row.profiles ? `${row.profiles.first_name} ${row.profiles.last_name}` : row.company_email),
          subtitle: (row) => `${row.profiles?.department || "No dept"} · ${row.review_cycles?.name || "No cycle"}`,
          trailing: (row) => (
            <Badge variant={row.status === "submitted" ? "default" : "secondary"} className="text-[10px]">
              {row.status === "submitted" && typeof row.score === "number" ? `${row.score}%` : row.status}
            </Badge>
          ),
        }}
        cardRenderer={(row) => (
          <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">
                  {row.profiles ? `${row.profiles.first_name} ${row.profiles.last_name}` : row.company_email}
                </p>
                <p className="text-muted-foreground text-xs">{row.company_email}</p>
              </div>
              <Badge variant={row.status === "submitted" ? "default" : "secondary"}>
                {row.status === "submitted" && typeof row.score === "number" ? `${row.score}%` : row.status}
              </Badge>
            </div>
            <div className="text-muted-foreground flex items-center justify-between border-t pt-2 text-[10px]">
              <span>{row.profiles?.department || "No dept"}</span>
              <span>{row.review_cycles?.name || "No cycle"}</span>
            </div>
          </div>
        )}
        emptyTitle="No CBT logs found"
        emptyDescription="Audit records will appear here once candidates start CBT sessions."
        emptyIcon={Brain}
        skeletonRows={8}
      />
    </DataTablePage>
  )
}
