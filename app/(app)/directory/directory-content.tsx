"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toLocalISODate } from "@/lib/utils/date"
import { exportDirectoryToCsv, exportDirectoryToExcel, type DirectoryExportRow } from "@/lib/directory/export"
import { Building2, Download, Mail, MapPin, Phone, RefreshCw, ShieldCheck, Users } from "lucide-react"

type DirectoryRow = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_email: string | null
  additional_email: string | null
  phone_number: string | null
  additional_phone: string | null
  department: string | null
  designation: string | null
  office_location: string | null
  is_department_lead: boolean | null
  lead_departments: string[] | null
}

function displayName(row: DirectoryRow): string {
  return (
    row.full_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    row.company_email ||
    "Unknown"
  )
}

async function fetchDirectory(): Promise<DirectoryRow[]> {
  const res = await fetch("/api/directory", { method: "GET", credentials: "include", cache: "no-store" })
  const payload = await res.json()
  if (!res.ok) throw new Error(payload?.error || `Failed to load directory (${res.status})`)
  return (payload?.data || []) as DirectoryRow[]
}

export function DirectoryContent() {
  const queryClient = useQueryClient()
  const [exportOpen, setExportOpen] = useState(false)

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: QUERY_KEYS.directory(), queryFn: fetchDirectory })

  const handleExport = (format: string) => {
    const exportRows: DirectoryExportRow[] = rows.map((r) => ({
      Name: displayName(r),
      Designation: r.designation || "",
      Department: r.department || "",
      "Department Lead": r.is_department_lead ? "Yes" : "No",
      "Company Email": r.company_email || "",
      "Additional Email": r.additional_email || "",
      Phone: r.phone_number || "",
      "Additional Phone": r.additional_phone || "",
      Office: r.office_location || "",
    }))
    const filename = `acob-staff-directory-${toLocalISODate(new Date())}`
    if (format === "excel") void exportDirectoryToExcel(exportRows, filename)
    else exportDirectoryToCsv(exportRows, filename)
  }

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.department).filter((d): d is string => Boolean(d))))
        .sort()
        .map((d) => ({ value: d, label: d })),
    [rows]
  )

  const officeOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.office_location).filter((o): o is string => Boolean(o))))
        .sort()
        .map((o) => ({ value: o, label: o })),
    [rows]
  )

  const stats = useMemo(() => {
    const total = rows.length
    const departments = new Set(rows.map((r) => r.department).filter(Boolean)).size
    const leads = rows.filter((r) => r.is_department_lead).length
    const offices = new Set(rows.map((r) => r.office_location).filter(Boolean)).size
    return { total, departments, leads, offices }
  }, [rows])

  const columns = useMemo<DataTableColumn<DirectoryRow>[]>(
    () => [
      {
        key: "full_name",
        label: "Name",
        sortable: true,
        accessor: (r) => displayName(r),
        render: (r) => (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{displayName(r)}</p>
              {r.is_department_lead && (
                <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
                  Lead
                </Badge>
              )}
            </div>
            {r.designation && <p className="text-muted-foreground text-xs">{r.designation}</p>}
          </div>
        ),
      },
      {
        key: "company_email",
        label: "Email",
        sortable: true,
        accessor: (r) => r.company_email || "",
        render: (r) => (
          <div className="space-y-0.5">
            {r.company_email ? (
              <a href={`mailto:${r.company_email}`} className="text-primary hover:underline">
                {r.company_email}
              </a>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
            {r.additional_email && <p className="text-muted-foreground text-xs">{r.additional_email}</p>}
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => r.department || "",
        render: (r) => r.department || "-",
      },
      {
        key: "phone_number",
        label: "Phone",
        accessor: (r) => r.phone_number || "",
        hideOnMobile: true,
        render: (r) =>
          r.phone_number ? (
            <a href={`tel:${r.phone_number}`} className="text-primary hover:underline">
              {r.phone_number}
            </a>
          ) : (
            "-"
          ),
      },
      {
        key: "office_location",
        label: "Office",
        accessor: (r) => r.office_location || "",
        hideOnMobile: true,
        render: (r) => r.office_location || "-",
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<DirectoryRow>[]>(
    () => [
      { key: "department", label: "Department", options: departmentOptions },
      { key: "office_location", label: "Office", options: officeOptions },
      {
        key: "is_department_lead",
        label: "Role",
        options: [
          { value: "lead", label: "Department leads" },
          { value: "member", label: "Team members" },
        ],
        mode: "custom",
        filterFn: (row, value) => {
          const v = row.is_department_lead ? "lead" : "member"
          return Array.isArray(value) ? value.includes(v) : v === value
        },
      },
    ],
    [departmentOptions, officeOptions]
  )

  return (
    <DataTablePage
      title="Staff Directory"
      description="Contact details for everyone at ACOB — search by name, department or office."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory() })}
            disabled={isLoading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setExportOpen(true)} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            title="People"
            value={stats.total}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Departments"
            value={stats.departments}
            icon={Building2}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Department Leads"
            value={stats.leads}
            icon={ShieldCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Offices"
            value={stats.offices}
            icon={MapPin}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <ExportOptionsDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Staff Directory"
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "csv", label: "CSV (.csv)", icon: "excel" },
        ]}
        onSelect={handleExport}
      />

      <DataTable<DirectoryRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search name, email, department, phone…"
        searchFn={(row, query) => {
          const q = query.toLowerCase()
          return (
            displayName(row).toLowerCase().includes(q) ||
            (row.company_email || "").toLowerCase().includes(q) ||
            (row.additional_email || "").toLowerCase().includes(q) ||
            (row.department || "").toLowerCase().includes(q) ||
            (row.designation || "").toLowerCase().includes(q) ||
            (row.phone_number || "").toLowerCase().includes(q) ||
            (row.office_location || "").toLowerCase().includes(q)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        expandable={{
          render: (r) => (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Email</p>
                <p className="mt-2 text-sm">{r.company_email || "-"}</p>
                {r.additional_email && <p className="text-muted-foreground mt-1 text-sm">{r.additional_email}</p>}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Phone</p>
                <p className="mt-2 text-sm">{r.phone_number || "-"}</p>
                {r.additional_phone && <p className="text-muted-foreground mt-1 text-sm">{r.additional_phone}</p>}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Department &amp; Office</p>
                <p className="mt-2 text-sm">{r.department || "-"}</p>
                <p className="text-muted-foreground mt-1 text-sm">{r.office_location || "-"}</p>
                {r.is_department_lead && (r.lead_departments?.length ?? 0) > 0 && (
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Leads: {r.lead_departments?.join(", ")}
                  </p>
                )}
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(r) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{displayName(r)}</p>
                {r.designation && <p className="text-muted-foreground text-sm">{r.designation}</p>}
              </div>
              {r.is_department_lead && (
                <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
                  Lead
                </Badge>
              )}
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="text-muted-foreground h-3.5 w-3.5" />
                <span className="truncate">{r.company_email || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="text-muted-foreground h-3.5 w-3.5" />
                <span>{r.phone_number || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="text-muted-foreground h-3.5 w-3.5" />
                <span>{r.department || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="text-muted-foreground h-3.5 w-3.5" />
                <span>{r.office_location || "-"}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No colleagues found"
        emptyDescription="Staff contact details will appear here."
        emptyIcon={Users}
        skeletonRows={6}
        urlSync
      />
    </DataTablePage>
  )
}
