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
import { Building2, Check, Copy, Download, Mail, MapPin, Phone, RefreshCw, ShieldCheck, Users } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

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
  employment_status: string | null
}

/** Field/contract staff are on the payroll but have no office contact details to look up. */
function isContractStaff(row: DirectoryRow): boolean {
  return (row.employment_status || "").toLowerCase() === "contract"
}

/**
 * Directory values copy on click rather than launching anything. Opening a mail client
 * is rarely what people want here — they are looking a colleague up to paste the detail
 * somewhere else. Rendered as a <button> so the data table's row handler ignores the
 * click and doesn't expand the row underneath.
 */
function CopyValue({ value, className, muted }: { value: string | null; className?: string; muted?: boolean }) {
  const [copied, setCopied] = useState(false)

  if (!value) return <span className="text-muted-foreground">-</span>

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success("Copied", { description: value })
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access")
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Click to copy"
      className={cn(
        "hover:text-primary inline-flex max-w-full items-center gap-1.5 text-left transition-colors",
        muted && "text-muted-foreground",
        className
      )}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  )
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
  // Rows currently visible in the table (after search + filters + sort).
  const [processedRows, setProcessedRows] = useState<DirectoryRow[]>([])

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: QUERY_KEYS.directory(), queryFn: fetchDirectory })

  const handleExport = (format: string) => {
    const source = processedRows.length ? processedRows : rows
    const exportRows: DirectoryExportRow[] = source.map((r) => ({
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

  // Stats follow what the table is actually showing, so the headline count doesn't claim
  // people the default staff-type filter has hidden.
  const stats = useMemo(() => {
    const source = processedRows.length ? processedRows : rows
    const total = source.length
    const departments = new Set(source.map((r) => r.department).filter(Boolean)).size
    const leads = source.filter((r) => r.is_department_lead).length
    const offices = new Set(source.map((r) => r.office_location).filter(Boolean)).size
    return { total, departments, leads, offices }
  }, [rows, processedRows])

  const columns = useMemo<DataTableColumn<DirectoryRow>[]>(
    () => [
      {
        key: "full_name",
        label: "Name",
        sortable: true,
        accessor: (r) => displayName(r),
        render: (r) => (
          <div className="group space-y-1">
            <div className="flex items-center gap-2">
              <CopyValue value={displayName(r)} className="font-medium" />
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
          <div className="group space-y-0.5">
            <CopyValue value={r.company_email} />
            {r.additional_email && <CopyValue value={r.additional_email} className="text-xs" muted />}
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => r.department || "",
        render: (r) => (
          <div className="group">
            <CopyValue value={r.department} />
          </div>
        ),
      },
      {
        key: "phone_number",
        label: "Phone",
        accessor: (r) => r.phone_number || "",
        hideOnMobile: true,
        render: (r) => (
          <div className="group space-y-0.5">
            <CopyValue value={r.phone_number} />
            {r.additional_phone && <CopyValue value={r.additional_phone} className="text-xs" muted />}
          </div>
        ),
      },
      {
        key: "office_location",
        label: "Office",
        accessor: (r) => r.office_location || "",
        hideOnMobile: true,
        render: (r) => (
          <div className="group">
            <CopyValue value={r.office_location} />
          </div>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<DirectoryRow>[]>(
    () => [
      { key: "department", label: "Department", options: departmentOptions },
      { key: "office_location", label: "Office", options: officeOptions },
      {
        // Contract/field staff are hidden unless asked for: they have no office contact
        // details, so they add ~46 empty rows to what is meant to be a lookup tool.
        key: "staff_type",
        label: "Staff type",
        options: [
          { value: "permanent", label: "Office staff" },
          { value: "contract", label: "Contract staff" },
        ],
        defaultValues: ["permanent"],
        mode: "custom",
        filterFn: (row, values) => values.includes(isContractStaff(row) ? "contract" : "permanent"),
      },
      {
        // Not "Role" — that means the system role (admin/employee) on the HR employees page,
        // and using the same word for two different things made the two pages read alike.
        key: "is_department_lead",
        label: "Position",
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
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setExportOpen(true)} disabled={rows.length === 0}>
            <Download className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Export</span>
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
        onProcessedDataChange={setProcessedRows}
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
        viewToggle
        cardRenderer={(r) => (
          <div className="group space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CopyValue value={displayName(r)} className="font-medium" />
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
                <Mail className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <div className="space-y-0.5">
                  <CopyValue value={r.company_email} />
                  {r.additional_email && <CopyValue value={r.additional_email} className="text-xs" muted />}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <div className="space-y-0.5">
                  <CopyValue value={r.phone_number} />
                  {r.additional_phone && <CopyValue value={r.additional_phone} className="text-xs" muted />}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <CopyValue value={r.department} />
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <CopyValue value={r.office_location} />
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
