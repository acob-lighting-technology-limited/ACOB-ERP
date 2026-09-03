"use client"

import { useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Briefcase, User, Calendar, CheckCircle, XCircle, Eye, Building2, UserCircle2 } from "lucide-react"
import type { UserRole } from "@/types/database"
import { JobDescriptionDialog } from "./_components/job-description-dialog"

interface Profile {
  id: string
  first_name: string
  last_name: string
  company_email: string
  department: string
  designation: string | null
  phone_number: string | null
  role: UserRole
  job_description: string | null
  job_description_updated_at: string | null
  created_at: string
}

interface UserProfile {
  role: UserRole
  is_department_lead?: boolean
  lead_departments?: string[]
}

interface JobDescriptionsData {
  profiles: Profile[]
  userProfile: UserProfile | null
}

async function fetchJobDescriptionsData(): Promise<JobDescriptionsData> {
  const res = await fetch("/api/admin/job-descriptions", { cache: "no-store" })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return { profiles: [], userProfile: null }
    throw new Error((await res.json().catch(() => null))?.error || "Failed to load job descriptions")
  }
  const json = await res.json()
  return { profiles: json.profiles || [], userProfile: json.userProfile ?? null }
}

export default function AdminJobDescriptionsPage() {
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEYS.adminJobDescriptions(),
    queryFn: fetchJobDescriptionsData,
  })

  const profiles = useMemo(() => data?.profiles ?? [], [data?.profiles])

  const stats = useMemo(() => {
    const now = new Date()
    return {
      total: profiles.length,
      completed: profiles.filter((p) => p.job_description).length,
      pending: profiles.filter((p) => !p.job_description).length,
      thisMonth: profiles.filter(
        (p) =>
          p.job_description_updated_at &&
          new Date(p.job_description_updated_at).getMonth() === now.getMonth() &&
          new Date(p.job_description_updated_at).getFullYear() === now.getFullYear()
      ).length,
    }
  }, [profiles])

  const columns: DataTableColumn<Profile>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Employee",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) => `${r.first_name} ${r.last_name}`,
        render: (r) => (
          <div className="flex items-center gap-2">
            <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold">
              {r.first_name.charAt(0)}
            </div>
            <div className="flex flex-col">
              <span className="text-sm leading-none font-medium">
                {r.first_name} {r.last_name}
              </span>
              <span className="text-muted-foreground mt-1 text-[10px]">{r.company_email}</span>
            </div>
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        resizable: true,
        initialWidth: 150,
        hideOnMobile: true,
        accessor: (r) => r.department,
        render: (r) => <span className="text-sm">{r.department}</span>,
      },
      {
        key: "designation",
        label: "Designation",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        hideOnMobile: true,
        accessor: (r) => r.designation || "N/A",
        render: (r) => <span className="text-muted-foreground text-sm">{r.designation || "—"}</span>,
      },
      {
        key: "status",
        label: "Document Status",
        sortable: true,
        accessor: (r) => (r.job_description ? "completed" : "pending"),
        render: (r) =>
          r.job_description ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-200 bg-emerald-500/10 px-2 py-0.5 text-emerald-500"
            >
              <CheckCircle className="h-3 w-3" /> Completed
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 border-amber-200 bg-amber-500/10 px-2 py-0.5 text-amber-500">
              <XCircle className="h-3 w-3" /> Pending
            </Badge>
          ),
      },
      {
        key: "updated_at",
        label: "Last Updated",
        sortable: true,
        hideOnMobile: true,
        accessor: (r) => r.job_description_updated_at || "",
        render: (r) => (
          <span className="text-muted-foreground text-xs italic">
            {r.job_description_updated_at ? formatWATDate(r.job_description_updated_at) : "Never"}
          </span>
        ),
      },
    ],
    []
  )

  const departments = useMemo(
    () => Array.from(new Set(profiles.map((p) => p.department).filter(Boolean))).sort(),
    [profiles]
  )

  const filters: DataTableFilter<Profile>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Document Status",
        options: [
          { value: "completed", label: "Completed" },
          { value: "pending", label: "Pending" },
        ],
        mode: "custom",
        filterFn: (row, vals) => {
          if (vals.length === 0) return true
          const status = row.job_description ? "completed" : "pending"
          return vals.includes(status)
        },
      },
      {
        key: "department",
        label: "Department",
        options: departments.map((d) => ({ value: d, label: d })),
      },
    ],
    [departments]
  )

  return (
    <DataTablePage
      title="Job Descriptions"
      description="Centralized registry for employee JD documentation and updates."
      icon={Briefcase}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total Staff"
            value={stats.total}
            icon={User}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Completed"
            value={stats.completed}
            icon={CheckCircle}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Pending"
            value={stats.pending}
            icon={XCircle}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Updated Recently"
            value={stats.thisMonth}
            icon={Calendar}
            iconBgColor="bg-purple-500/10"
            iconColor="text-purple-500"
          />
        </div>
      }
    >
      <DataTable<Profile>
        data={profiles}
        columns={columns}
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        isLoading={isLoading}
        searchPlaceholder="Search name, email or designation..."
        searchFn={(r, q) =>
          `${r.first_name} ${r.last_name} ${r.company_email} ${r.designation}`.toLowerCase().includes(q)
        }
        filters={filters}
        rowActions={[
          {
            label: "View Documentation",
            icon: Eye,
            onClick: (r) => {
              setSelectedProfile(r)
              setIsViewDialogOpen(true)
            },
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 space-y-4 border-t p-6">
              <div>
                <h4 className="text-muted-foreground mb-2 flex items-center gap-2 text-[10px] font-black tracking-widest uppercase">
                  <UserCircle2 className="h-3 w-3" /> Designation Details
                </h4>
                <p className="text-sm font-medium">{r.designation || "No designation specified"}</p>
              </div>
              <div className="flex gap-3">
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedProfile(r)
                    setIsViewDialogOpen(true)
                  }}
                  className="gap-2"
                >
                  <Eye className="h-4 w-4" /> Open Full Document
                </Button>
              </div>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (r) => (r.job_description ? "bg-emerald-500" : "bg-amber-500"),
          title: (r) => `${r.first_name} ${r.last_name}`,
          subtitle: (r) => `${r.department} · ${r.designation || "No designation"} · ${r.company_email}`,
          trailing: (r) =>
            r.job_description ? (
              <Badge variant="outline" className="border-transparent bg-emerald-500/10 text-[9px] text-emerald-500">
                Completed
              </Badge>
            ) : (
              <Badge variant="outline" className="border-transparent bg-amber-500/10 text-[9px] text-amber-500">
                Pending
              </Badge>
            ),
          onSelect: (r) => {
            setSelectedProfile(r)
            setIsViewDialogOpen(true)
          },
        }}
        cardRenderer={(r) => (
          <div
            className="bg-card cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md"
            onClick={() => {
              setSelectedProfile(r)
              setIsViewDialogOpen(true)
            }}
          >
            <div className="mb-3 flex items-start justify-between">
              <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold">
                {r.first_name.charAt(0)}
              </div>
              {r.job_description ? (
                <Badge
                  variant="outline"
                  className="border-transparent bg-emerald-500/10 px-1.5 text-[9px] text-emerald-500"
                >
                  Completed
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-transparent bg-amber-500/10 px-1.5 text-[9px] text-amber-500"
                >
                  Pending
                </Badge>
              )}
            </div>
            <h4 className="text-sm leading-tight font-semibold">
              {r.first_name} {r.last_name}
            </h4>
            <p className="text-muted-foreground mt-1 line-clamp-1 text-[10px]">{r.designation || "No Designation"}</p>
            <div className="text-muted-foreground mt-4 flex items-center gap-2 border-t pt-4 text-[10px] font-medium tracking-widest uppercase">
              <Building2 className="h-3 w-3" /> {r.department}
            </div>
          </div>
        )}
        urlSync
      />

      <JobDescriptionDialog profile={selectedProfile} isOpen={isViewDialogOpen} onOpenChange={setIsViewDialogOpen} />
    </DataTablePage>
  )
}
