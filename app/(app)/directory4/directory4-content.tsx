"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { PageHeader, PageWrapper } from "@/components/layout"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetTrigger,
} from "@/components/ui/sheet"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toLocalISODate } from "@/lib/utils/date"
import { exportDirectoryToCsv, exportDirectoryToExcel, type DirectoryExportRow } from "@/lib/directory/export"
import {
  Building2,
  Check,
  Copy,
  Download,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  Users,
  Search,
  X,
  SlidersHorizontal,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react"
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
  avatar_url: string | null
}

function isContractStaff(row: DirectoryRow): boolean {
  return (row.employment_status || "").toLowerCase() === "contract"
}

function displayName(row: DirectoryRow): string {
  return (
    row.full_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    row.company_email ||
    "Unknown Colleague"
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (name.slice(0, 2) || "AC").toUpperCase()
}

type TableSortKey = "name" | "department" | "email" | "phone" | "office"

const TABLE_SORT_ACCESSORS: Record<TableSortKey, (r: DirectoryRow) => string> = {
  name: (r) => displayName(r),
  department: (r) => r.department || "",
  email: (r) => r.company_email || "",
  phone: (r) => r.phone_number || "",
  office: (r) => r.office_location || "",
}

async function fetchDirectory(): Promise<DirectoryRow[]> {
  const res = await fetch("/api/directory", { method: "GET", credentials: "include", cache: "no-store" })
  const payload = await res.json()
  if (!res.ok) throw new Error(payload?.error || `Failed to load directory (${res.status})`)
  return (payload?.data || []) as DirectoryRow[]
}

function copyToClipboard(value: string, label: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`Copied ${label}`, { description: value }))
    .catch(() => toast.error("Couldn't copy — clipboard access was blocked"))
}

export function Directory4Content() {
  const queryClient = useQueryClient()
  const [exportOpen, setExportOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedDept, setSelectedDept] = useState<string>("all")
  const [selectedOffice, setSelectedOffice] = useState<string>("all")
  const [staffType, setStaffType] = useState<"permanent" | "contract" | "all">("permanent")
  const [leadOnly, setLeadOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<DirectoryRow | null>(null)
  const [tableSort, setTableSort] = useState<{ key: TableSortKey; direction: "asc" | "desc" }>({
    key: "name",
    direction: "asc",
  })

  const {
    data: rows = [],
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useQuery({ queryKey: QUERY_KEYS.directory(), queryFn: fetchDirectory })

  const departmentOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter((d): d is string => Boolean(d)))).sort(),
    [rows]
  )
  const officeOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.office_location).filter((o): o is string => Boolean(o)))).sort(),
    [rows]
  )

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (staffType === "permanent" && isContractStaff(r)) return false
        if (staffType === "contract" && !isContractStaff(r)) return false
        if (leadOnly && !r.is_department_lead) return false
        if (selectedDept !== "all" && r.department !== selectedDept) return false
        if (selectedOffice !== "all" && r.office_location !== selectedOffice) return false
        if (!q) return true
        const name = displayName(r).toLowerCase()
        return (
          name.includes(q) ||
          (r.company_email || "").toLowerCase().includes(q) ||
          (r.department || "").toLowerCase().includes(q) ||
          (r.designation || "").toLowerCase().includes(q) ||
          (r.phone_number || "").toLowerCase().includes(q) ||
          (r.office_location || "").toLowerCase().includes(q)
        )
      })
      .sort((a, b) => displayName(a).localeCompare(displayName(b)))
  }, [rows, search, staffType, leadOnly, selectedDept, selectedOffice])

  // Desktop table only — the mobile list is always alphabetical by design (A-Z sections).
  const tableRows = useMemo(() => {
    const accessor = TABLE_SORT_ACCESSORS[tableSort.key]
    const sorted = [...filteredRows].sort((a, b) => accessor(a).localeCompare(accessor(b)))
    return tableSort.direction === "asc" ? sorted : sorted.reverse()
  }, [filteredRows, tableSort])

  const toggleTableSort = (key: TableSortKey) => {
    setTableSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    )
  }

  // A-Z sections, contacts-app style — the pattern every phone's own address book uses.
  const sections = useMemo(() => {
    const map = new Map<string, DirectoryRow[]>()
    for (const row of filteredRows) {
      const letter = displayName(row).trim()[0]?.toUpperCase() || "#"
      const key = /[A-Z]/.test(letter) ? letter : "#"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredRows])

  const stats = useMemo(() => {
    const total = filteredRows.length
    const departments = new Set(filteredRows.map((r) => r.department).filter(Boolean)).size
    const leads = filteredRows.filter((r) => r.is_department_lead).length
    return { total, departments, leads }
  }, [filteredRows])

  const activeFilterCount =
    (selectedDept !== "all" ? 1 : 0) +
    (selectedOffice !== "all" ? 1 : 0) +
    (staffType !== "permanent" ? 1 : 0) +
    (leadOnly ? 1 : 0)

  const resetFilters = () => {
    setSelectedDept("all")
    setSelectedOffice("all")
    setStaffType("permanent")
    setLeadOnly(false)
  }

  const handleExport = (format: string) => {
    const exportRows: DirectoryExportRow[] = filteredRows.map((r) => ({
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

  return (
    <PageWrapper maxWidth="full" background="gradient" spacing="compact" className="pb-12">
      <div className="flex flex-row items-end justify-between gap-3 sm:items-center">
        <PageHeader title="Directory" icon={Users} className="mb-0 min-w-0 pb-0" />
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading || isRefetching}
            className="h-9 gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isRefetching) && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setExportOpen(true)}
            disabled={filteredRows.length === 0}
            className="h-9 gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Sticky search + one filter trigger — the only two controls needed for a lookup tool */}
      <div className="bg-background sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b px-4 py-2 shadow-sm sm:static sm:mx-0 sm:border-b-0 sm:px-0 sm:py-0 sm:shadow-none">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search name, email, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card h-10 border-2 pr-9 pl-10 shadow-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter directory</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">Staff type</p>
                <div className="flex gap-1.5">
                  {(["permanent", "contract", "all"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setStaffType(t)}
                      className={cn(
                        "flex-1 rounded-lg border py-2 text-xs font-medium capitalize transition-colors",
                        staffType === t ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
                      )}
                    >
                      {t === "permanent" ? "Office" : t}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setLeadOnly((v) => !v)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  leadOnly
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "text-foreground"
                )}
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Department leads only
                </span>
                {leadOnly && <Check className="h-4 w-4" />}
              </button>

              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">Department</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedDept("all")}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      selectedDept === "all"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    All
                  </button>
                  {departmentOptions.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDept(d)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        selectedDept === d
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">Office</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedOffice("all")}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      selectedOffice === "all"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    All
                  </button>
                  {officeOptions.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setSelectedOffice(o)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs",
                        selectedOffice === o
                          ? "border-primary bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button variant="outline" className="flex-1" onClick={resetFilters}>
                Reset
              </Button>
              <SheetClose asChild>
                <Button className="flex-1">Apply</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <div className="-mt-1 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {stats.total} {stats.total === 1 ? "person" : "people"}
        </Badge>
        <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
          {stats.departments} {stats.departments === 1 ? "department" : "departments"}
        </Badge>
        {stats.leads > 0 && (
          <Badge variant="outline" className="text-muted-foreground rounded-full px-2.5 py-1 text-xs font-normal">
            {stats.leads} {stats.leads === 1 ? "lead" : "leads"}
          </Badge>
        )}
      </div>

      {/* Mobile: native-contacts-app pattern — sticky A-Z section headers, one line per person */}
      <div className="md:hidden">
        {isLoading ? (
          <div className="space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-1 py-2.5">
                <div className="bg-muted h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="bg-muted h-3.5 w-32 rounded" />
                  <div className="bg-muted h-3 w-20 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyDirectory
            hasFilters={Boolean(search) || activeFilterCount > 0}
            onReset={resetFilters}
            search={search}
            setSearch={setSearch}
          />
        ) : (
          <div className="divide-y">
            {sections.map(([letter, people]) => (
              <div key={letter}>
                <div className="bg-muted text-muted-foreground sticky top-[57px] z-[5] border-b px-1 py-1 text-xs font-bold">
                  {letter}
                </div>
                {people.map((person) => {
                  const name = displayName(person)
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => setSelected(person)}
                      className="hover:bg-muted/40 flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors"
                    >
                      <PersonAvatar row={person} name={name} className="h-10 w-10" fallbackClassName="text-xs" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{name}</span>
                          {person.is_department_lead && (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                            >
                              Lead
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          {[person.designation, person.department].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      <ChevronRight className="text-muted-foreground/50 h-4 w-4 shrink-0" />
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: a real dense table — different device, different affordances */}
      <div className="hidden md:block">
        {isLoading ? (
          <div className="bg-card space-y-2 rounded-xl border p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-muted h-8 w-full animate-pulse rounded" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <EmptyDirectory
            hasFilters={Boolean(search) || activeFilterCount > 0}
            onReset={resetFilters}
            search={search}
            setSearch={setSearch}
          />
        ) : (
          <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-medium tracking-wide uppercase">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center">S/N</th>
                    <SortableHeader label="Name & Role" sortKey="name" current={tableSort} onSort={toggleTableSort} />
                    <SortableHeader
                      label="Department"
                      sortKey="department"
                      current={tableSort}
                      onSort={toggleTableSort}
                    />
                    <SortableHeader label="Email" sortKey="email" current={tableSort} onSort={toggleTableSort} />
                    <SortableHeader label="Phone" sortKey="phone" current={tableSort} onSort={toggleTableSort} />
                    <SortableHeader label="Office" sortKey="office" current={tableSort} onSort={toggleTableSort} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tableRows.map((person, index) => {
                    const name = displayName(person)
                    return (
                      <tr
                        key={person.id}
                        className="hover:bg-muted/40 cursor-pointer"
                        onClick={() => setSelected(person)}
                      >
                        <td className="text-muted-foreground px-4 py-3 text-center font-mono">{index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <PersonAvatar
                              row={person}
                              name={name}
                              className="h-8 w-8"
                              fallbackClassName="text-[10px]"
                            />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-foreground font-semibold">{name}</span>
                                {person.is_department_lead && (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-bold text-emerald-700 dark:text-emerald-300"
                                  >
                                    Lead
                                  </Badge>
                                )}
                              </div>
                              {person.designation && (
                                <p className="text-muted-foreground text-[11px]">{person.designation}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {person.department || <span className="text-muted-foreground/60">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {person.company_email || <span className="text-muted-foreground/60">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {person.phone_number || <span className="text-muted-foreground/60">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {person.office_location || <span className="text-muted-foreground/60">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Contact detail sheet — same interaction on both breakpoints */}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="items-center text-center">
                <PersonAvatar
                  row={selected}
                  name={displayName(selected)}
                  className="h-16 w-16"
                  fallbackClassName="text-lg"
                />
                <SheetTitle className="mt-1 flex items-center gap-1.5 text-base">
                  {displayName(selected)}
                  {selected.is_department_lead && (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                    >
                      Lead
                    </Badge>
                  )}
                </SheetTitle>
                {selected.designation && <p className="text-muted-foreground text-sm">{selected.designation}</p>}
              </SheetHeader>

              <div className="space-y-1 px-4">
                <ContactRow icon={Mail} label="Email" value={selected.company_email} onCopy={copyToClipboard} />
                {selected.additional_email && (
                  <ContactRow
                    icon={Mail}
                    label="Alt. email"
                    value={selected.additional_email}
                    onCopy={copyToClipboard}
                    muted
                  />
                )}
                <ContactRow icon={Phone} label="Phone" value={selected.phone_number} onCopy={copyToClipboard} />
                {selected.additional_phone && (
                  <ContactRow
                    icon={Phone}
                    label="Alt. phone"
                    value={selected.additional_phone}
                    onCopy={copyToClipboard}
                    muted
                  />
                )}
                <ContactRow icon={Building2} label="Department" value={selected.department} onCopy={copyToClipboard} />
                <ContactRow icon={MapPin} label="Office" value={selected.office_location} onCopy={copyToClipboard} />
              </div>

              <SheetFooter className="flex-row gap-2">
                {selected.phone_number && (
                  <Button asChild className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-500">
                    <a href={`tel:${selected.phone_number.replace(/\s+/g, "")}`}>
                      <Phone className="h-4 w-4" />
                      Call
                    </a>
                  </Button>
                )}
                {selected.company_email && (
                  <Button asChild variant="outline" className="flex-1 gap-2">
                    <a href={`mailto:${selected.company_email}`}>
                      <Mail className="h-4 w-4" />
                      Email
                    </a>
                  </Button>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

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
    </PageWrapper>
  )
}

function SortableHeader({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string
  sortKey: TableSortKey
  current: { key: TableSortKey; direction: "asc" | "desc" }
  onSort: (key: TableSortKey) => void
}) {
  const isActive = current.key === sortKey
  return (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        {label}
        {isActive ? (
          current.direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

/** Real profile photo when the directory has one, initials only as the fallback. */
function PersonAvatar({
  row,
  name,
  className,
  fallbackClassName,
}: {
  row: DirectoryRow
  name: string
  className?: string
  fallbackClassName?: string
}) {
  return (
    <Avatar className={cn("shrink-0 border", className)}>
      {row.avatar_url && <AvatarImage src={row.avatar_url} alt={name} />}
      <AvatarFallback className={cn("bg-primary/10 text-primary font-bold", fallbackClassName)}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

function ContactRow({
  icon: Icon,
  label,
  value,
  onCopy,
  muted,
}: {
  icon: React.ElementType
  label: string
  value: string | null | undefined
  onCopy: (value: string, label: string) => void
  muted?: boolean
}) {
  if (!value) return null
  return (
    <button
      type="button"
      onClick={() => onCopy(value, label)}
      className="hover:bg-muted/40 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors"
    >
      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-[11px]">{label}</p>
        <p className={cn("truncate text-sm", muted && "text-muted-foreground")}>{value}</p>
      </div>
      <Copy className="text-muted-foreground/60 h-3.5 w-3.5 shrink-0" />
    </button>
  )
}

function EmptyDirectory({
  hasFilters,
  onReset,
  search,
  setSearch,
}: {
  hasFilters: boolean
  onReset: () => void
  search: string
  setSearch: (v: string) => void
}) {
  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center">
      <Users className="text-muted-foreground/50 h-10 w-10" />
      <h3 className="mt-3 text-sm font-semibold">No colleagues found</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-xs">
        {hasFilters ? "Nothing matches your search or filters." : "Staff contact details will appear here."}
      </p>
      {hasFilters && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSearch("")
            onReset()
          }}
          className="mt-4"
        >
          Clear filters
        </Button>
      )}
    </div>
  )
}
