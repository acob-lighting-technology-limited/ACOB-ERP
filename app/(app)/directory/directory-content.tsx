"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
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
  /** Short-lived signed URL; the private storage path never leaves the server. */
  avatar_url: string | null
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (name.slice(0, 2) || "AC").toUpperCase()
}

/**
 * "Surname, Firstname" — a directory is scanned down the surname column and grouped
 * by its initial, so the surname has to lead. Falls back to whatever is available:
 * a row with only `full_name` keeps its last word as the surname.
 */
const AVATAR_SIZES = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-9 w-9 text-[11px]",
  lg: "h-12 w-12 text-sm",
  xl: "h-16 w-16 text-lg",
} as const

/**
 * The person, in every view. A directory is a list of people, so the face (or
 * the initials standing in for it) belongs in the table cell and the card as
 * much as in the contacts row — it was previously written inline twice and
 * missing from the other two.
 */
function DirectoryAvatar({ row, size = "md" }: { row: DirectoryRow; size?: keyof typeof AVATAR_SIZES }) {
  const name = displayName(row)
  return (
    <span
      className={cn(
        "bg-primary/10 text-primary flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        AVATAR_SIZES[size]
      )}
    >
      {row.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.avatar_url} alt={name} className="h-full w-full object-cover" />
      ) : (
        getInitials(name)
      )}
    </span>
  )
}

function displayName(row: DirectoryRow): string {
  const first = row.first_name?.trim()
  const last = row.last_name?.trim()
  if (last && first) return `${last}, ${first}`
  if (last) return last

  const full = row.full_name?.trim()
  if (full) {
    const parts = full.split(/\s+/)
    if (parts.length > 1) return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`
    return full
  }

  return first || row.company_email || "Unknown"
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
  // Controlled only so the "leads" metric can toggle its own filter; the toolbar
  // still renders and drives these values exactly as it does uncontrolled.
  const [filterValues, setFilterValues] = useState<Record<string, string[]>>({ staff_type: ["permanent"] })
  const leadsOnly = filterValues.is_department_lead?.length === 1 && filterValues.is_department_lead[0] === "lead"

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
          <div className="group flex items-center gap-2.5">
            <DirectoryAvatar row={r} size="sm" />
            <div className="min-w-0 space-y-1">
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
        // Seeded in `filterValues` above: defaults are ignored in controlled mode.
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
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} disabled={rows.length === 0}>
            <Download className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      }
      // box in the first screenful, which four stat cards do not allow.
      // Paired with `statBadges`: the line carries mobile, these take over from `md`
      // where there is room. `compact` keeps them to a slim band rather than the
      // full-height cards that used to push search off a small screen.
      stats={
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
          <StatCard
            variant="compact"
            title="Colleagues"
            value={stats.total === rows.length ? stats.total : `${stats.total} of ${rows.length}`}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Departments"
            value={stats.departments}
            icon={Building2}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          {/* Clickable like its badge counterpart — the toggle must not vanish just
              because the viewport crossed `md`. Shown on the same condition as that
              badge too, so the two never disagree about which metrics exist. */}
          {(stats.leads > 0 || leadsOnly) && (
            <button
              type="button"
              onClick={() => setFilterValues((prev) => ({ ...prev, is_department_lead: leadsOnly ? [] : ["lead"] }))}
              aria-pressed={leadsOnly}
              title={leadsOnly ? "Show everyone" : "Show department leads only"}
              className="rounded-xl text-left transition-colors"
            >
              <StatCard
                variant="compact"
                title={leadsOnly ? "Leads · filtered" : "Department Leads"}
                value={stats.leads}
                icon={ShieldCheck}
                iconBgColor="bg-emerald-500/10"
                iconColor="text-emerald-500"
                className={cn("h-full", leadsOnly && "border-primary/50 bg-primary/5")}
              />
            </button>
          )}
          {stats.offices > 0 && (
            <StatCard
              variant="compact"
              title="Offices"
              value={stats.offices}
              icon={MapPin}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
              className="hidden sm:block"
            />
          )}
        </div>
      }
      spacing="tight"
      actionsPlacement="inline-always"
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
        filterValues={filterValues}
        onFilterValuesChange={setFilterValues}
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
        mobileRow={{
          // A-Z sections, contacts-app style
          groupBy: (r) => {
            const letter = displayName(r).trim()[0]?.toUpperCase() || "#"
            return /[A-Z]/.test(letter) ? letter : "#"
          },
          leading: (r) => <DirectoryAvatar row={r} />,
          title: (r) => displayName(r),
          subtitle: (r) => [r.designation, r.department].filter(Boolean).join(" · ") || "—",
          trailing: (r) =>
            r.is_department_lead ? (
              <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400">
                Lead
              </Badge>
            ) : null,
          detail: {
            title: (r) => displayName(r),
            subtitle: (r) => r.designation,
            avatar: (r) => <DirectoryAvatar row={r} size="xl" />,
            badges: (r) =>
              r.is_department_lead ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                >
                  Lead
                </Badge>
              ) : null,
            fields: (r) => [
              { icon: Mail, label: "Email", value: r.company_email },
              { icon: Mail, label: "Alt. email", value: r.additional_email, muted: true },
              { icon: Phone, label: "Phone", value: r.phone_number },
              { icon: Phone, label: "Alt. phone", value: r.additional_phone, muted: true },
              { icon: Building2, label: "Department", value: r.department },
              { icon: MapPin, label: "Office", value: r.office_location },
            ],
            actions: (r) => [
              ...(r.phone_number
                ? [
                    {
                      label: "Call",
                      icon: Phone,
                      href: `tel:${r.phone_number.replace(/\s+/g, "")}`,
                    },
                  ]
                : []),
              ...(r.company_email
                ? [{ label: "Email", icon: Mail, href: `mailto:${r.company_email}`, variant: "outline" as const }]
                : []),
            ],
          },
        }}
        viewToggle
        // A directory is a lookup tool: the A–Z contacts list is the right default
        // on desktop too, with the table there for anyone scanning columns.
        contactsView
        defaultViewMode="contacts"
        cardRenderer={(r) => (
          <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <DirectoryAvatar row={r} size="lg" />
                <div className="min-w-0">
                  <CopyValue value={displayName(r)} className="font-medium" />
                  {r.designation && <p className="text-muted-foreground text-sm">{r.designation}</p>}
                </div>
              </div>
              {r.is_department_lead && (
                <Badge variant="outline" className="shrink-0 text-emerald-600 dark:text-emerald-400">
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
        stickyToolbar
        urlSync
      />
    </DataTablePage>
  )
}
