"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { PageHeader, PageWrapper } from "@/components/layout"
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
  Filter,
  ArrowUpDown,
  LayoutGrid,
  Table as TableIcon,
  Layers,
  ChevronDown,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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

type ViewMode = "cards" | "table" | "grouped"
type SortOption = "name_asc" | "name_desc" | "dept_asc" | "office_asc"

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
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return (name.slice(0, 2) || "AC").toUpperCase()
}

/** 1-click copy with clear feedback */
function CopyValue({
  value,
  className,
  muted,
  label,
}: {
  value: string | null | undefined
  className?: string
  muted?: boolean
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  if (!value) return <span className="text-muted-foreground/60 text-xs">-</span>

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(label ? `Copied ${label}` : "Copied to clipboard", { description: value })
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy — clipboard access was blocked")
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Click to copy"
      className={cn(
        "hover:text-primary group/copy inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left transition-colors",
        muted && "text-muted-foreground",
        className
      )}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-70" />
      )}
    </button>
  )
}

async function fetchDirectory(): Promise<DirectoryRow[]> {
  const res = await fetch("/api/directory", { method: "GET", credentials: "include", cache: "no-store" })
  const payload = await res.json()
  if (!res.ok) throw new Error(payload?.error || `Failed to load directory (${res.status})`)
  return (payload?.data || []) as DirectoryRow[]
}

export function Directory2Content() {
  const queryClient = useQueryClient()
  const [exportOpen, setExportOpen] = useState(false)

  // Filters & State
  const [search, setSearch] = useState("")
  const [selectedDept, setSelectedDept] = useState<string>("all")
  const [selectedOffice, setSelectedOffice] = useState<string>("all")
  const [staffType, setStaffType] = useState<"permanent" | "contract" | "all">("permanent")
  const [leadOnly, setLeadOnly] = useState<boolean>(false)
  const [sortBy, setSortBy] = useState<SortOption>("name_asc")
  const [viewMode, setViewMode] = useState<ViewMode>("cards")

  const {
    data: rows = [],
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useQuery({ queryKey: QUERY_KEYS.directory(), queryFn: fetchDirectory })

  // Department & Office filter options
  const departmentOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter((d): d is string => Boolean(d)))).sort(),
    [rows]
  )

  const officeOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.office_location).filter((o): o is string => Boolean(o)))).sort(),
    [rows]
  )

  // Filtered & Sorted Rows
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()

    let result = rows.filter((r) => {
      // Staff Type filter
      if (staffType === "permanent" && isContractStaff(r)) return false
      if (staffType === "contract" && !isContractStaff(r)) return false

      // Lead filter
      if (leadOnly && !r.is_department_lead) return false

      // Department filter
      if (selectedDept !== "all" && r.department !== selectedDept) return false

      // Office filter
      if (selectedOffice !== "all" && r.office_location !== selectedOffice) return false

      // Search query
      if (!q) return true
      const name = displayName(r).toLowerCase()
      return (
        name.includes(q) ||
        (r.company_email || "").toLowerCase().includes(q) ||
        (r.additional_email || "").toLowerCase().includes(q) ||
        (r.department || "").toLowerCase().includes(q) ||
        (r.designation || "").toLowerCase().includes(q) ||
        (r.phone_number || "").toLowerCase().includes(q) ||
        (r.office_location || "").toLowerCase().includes(q)
      )
    })

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === "name_asc") return displayName(a).localeCompare(displayName(b))
      if (sortBy === "name_desc") return displayName(b).localeCompare(displayName(a))
      if (sortBy === "dept_asc") return (a.department || "").localeCompare(b.department || "")
      if (sortBy === "office_asc") return (a.office_location || "").localeCompare(b.office_location || "")
      return 0
    })

    return result
  }, [rows, search, staffType, leadOnly, selectedDept, selectedOffice, sortBy])

  // Dynamic metrics based on current result set
  const stats = useMemo(() => {
    const total = filteredRows.length
    const departments = new Set(filteredRows.map((r) => r.department).filter(Boolean)).size
    const leads = filteredRows.filter((r) => r.is_department_lead).length
    const offices = new Set(filteredRows.map((r) => r.office_location).filter(Boolean)).size
    return { total, departments, leads, offices }
  }, [filteredRows])

  // Grouped by Department
  const groupedByDept = useMemo(() => {
    const map = new Map<string, DirectoryRow[]>()
    for (const row of filteredRows) {
      const dept = row.department || "General / Unassigned"
      if (!map.has(dept)) map.set(dept, [])
      map.get(dept)!.push(row)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredRows])

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

  const activeFiltersCount =
    (selectedDept !== "all" ? 1 : 0) +
    (selectedOffice !== "all" ? 1 : 0) +
    (staffType !== "permanent" ? 1 : 0) +
    (leadOnly ? 1 : 0)

  return (
    <PageWrapper maxWidth="full" background="gradient" spacing="responsive" className="pb-12">
      {/* ── 1. Header & Actions ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Staff Directory"
          description="Find any colleague's contact details — email, phone, department, and office location."
          icon={Users}
          className="mb-0 pb-0"
        />

        <div className="flex items-center gap-2 self-end sm:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading || isRefetching}
            className="h-8 gap-1.5 text-xs shadow-xs"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isRefetching) && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            size="sm"
            onClick={() => setExportOpen(true)}
            disabled={filteredRows.length === 0}
            className="h-8 gap-1.5 text-xs shadow-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>

          {/* View Mode Toggle */}
          <div className="bg-muted/80 hidden items-center rounded-lg p-0.5 md:flex">
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "cards"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Grid Cards"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "table"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Interactive Table"
            >
              <TableIcon className="h-3.5 w-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grouped")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "grouped"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Grouped by Department"
            >
              <Layers className="h-3.5 w-3.5" />
              By Dept
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. Segmented Metric Strip & Staff Type Toggle ── */}
      <div className="space-y-2">
        <div className="scrollbar-none -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1.5 sm:mx-0 sm:overflow-visible sm:px-0">
          {/* Quick Staff Type Tabs */}
          <button
            type="button"
            onClick={() => setStaffType("permanent")}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-2xs transition-all",
              staffType === "permanent"
                ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                : "border-border bg-card/60 hover:bg-card text-muted-foreground"
            )}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Office Staff</span>
          </button>

          <button
            type="button"
            onClick={() => setStaffType("contract")}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-2xs transition-all",
              staffType === "contract"
                ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                : "border-border bg-card/60 hover:bg-card text-muted-foreground"
            )}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Contract Staff</span>
          </button>

          <button
            type="button"
            onClick={() => setStaffType("all")}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-2xs transition-all",
              staffType === "all"
                ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                : "border-border bg-card/60 hover:bg-card text-muted-foreground"
            )}
          >
            <span>All Staff</span>
          </button>

          {/* Department Lead Quick Filter */}
          <button
            type="button"
            onClick={() => setLeadOnly(!leadOnly)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-2xs transition-all",
              leadOnly
                ? "border-emerald-600 bg-emerald-600 font-semibold text-white shadow-xs"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Department Leads</span>
            <span
              className={cn(
                "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px]",
                leadOnly
                  ? "bg-white/20 text-white"
                  : "bg-emerald-500/20 font-bold text-emerald-700 dark:text-emerald-300"
              )}
            >
              {rows.filter((r) => r.is_department_lead).length}
            </span>
          </button>
        </div>

        {/* Dynamic Metric Bar */}
        <div className="bg-card/70 text-muted-foreground flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Colleagues: <strong className="text-foreground">{stats.total}</strong>
            </span>
            <span>•</span>
            <span>
              Departments: <strong className="text-foreground">{stats.departments}</strong>
            </span>
            <span>•</span>
            <span>
              Offices: <strong className="text-foreground">{stats.offices}</strong>
            </span>
            {stats.leads > 0 && (
              <>
                <span>•</span>
                <span>
                  Leads: <strong className="text-emerald-600 dark:text-emerald-400">{stats.leads}</strong>
                </span>
              </>
            )}
          </div>

          <span className="text-muted-foreground/80 text-[11px] italic">
            Tip: Click phone or email on any card to contact or copy
          </span>
        </div>
      </div>

      {/* ── 3. Search & Filter Bar ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search by name, email, department, designation, phone, office..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pr-8 pl-9 text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Department Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 text-xs shadow-xs">
                <Building2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Dept:</span>
                <span className="max-w-[100px] truncate font-medium">
                  {selectedDept === "all" ? "All" : selectedDept}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto text-xs">
              <DropdownMenuLabel>Filter Department</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSelectedDept("all")} className="flex items-center justify-between">
                <span>All Departments</span>
                {selectedDept === "all" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              {departmentOptions.map((dept) => (
                <DropdownMenuItem
                  key={dept}
                  onClick={() => setSelectedDept(dept)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{dept}</span>
                  {selectedDept === dept && <Check className="text-primary h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Office Location Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 text-xs shadow-xs">
                <MapPin className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Office:</span>
                <span className="max-w-[90px] truncate font-medium">
                  {selectedOffice === "all" ? "All" : selectedOffice}
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto text-xs">
              <DropdownMenuLabel>Filter Office Location</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSelectedOffice("all")} className="flex items-center justify-between">
                <span>All Offices</span>
                {selectedOffice === "all" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              {officeOptions.map((office) => (
                <DropdownMenuItem
                  key={office}
                  onClick={() => setSelectedOffice(office)}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">{office}</span>
                  {selectedOffice === office && <Check className="text-primary h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 text-xs shadow-xs">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Sort</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 text-xs">
              <DropdownMenuLabel>Sort Directory</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSortBy("name_asc")} className="flex items-center justify-between">
                <span>Name (A to Z)</span>
                {sortBy === "name_asc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("name_desc")} className="flex items-center justify-between">
                <span>Name (Z to A)</span>
                {sortBy === "name_desc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("dept_asc")} className="flex items-center justify-between">
                <span>Department Name</span>
                {sortBy === "dept_asc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("office_asc")} className="flex items-center justify-between">
                <span>Office Location</span>
                {sortBy === "office_asc" && <Check className="text-primary h-3.5 w-3.5" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Reset Filters Link */}
        <div className="text-muted-foreground flex items-center justify-between text-xs sm:justify-end sm:gap-3">
          <span>
            Showing <strong className="text-foreground">{filteredRows.length}</strong> of {rows.length}
          </span>
          {(search || activeFiltersCount > 0) && (
            <button
              type="button"
              onClick={() => {
                setSearch("")
                setSelectedDept("all")
                setSelectedOffice("all")
                setStaffType("permanent")
                setLeadOnly(false)
              }}
              className="text-primary font-medium hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* ── 4. Main Directory Presentation (Cards, Table, Grouped) ── */}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card animate-pulse space-y-3 rounded-xl border p-4">
              <div className="flex items-center gap-3">
                <div className="bg-muted h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="bg-muted h-4 w-32 rounded" />
                  <div className="bg-muted h-3 w-20 rounded" />
                </div>
              </div>
              <div className="space-y-2 pt-2">
                <div className="bg-muted h-3 w-full rounded" />
                <div className="bg-muted h-3 w-3/4 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="bg-card flex flex-col items-center justify-center rounded-xl border p-12 text-center shadow-xs">
          <div className="bg-muted text-muted-foreground rounded-full p-3">
            <Users className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold">No colleagues found</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-xs">
            {search || activeFiltersCount > 0
              ? "No colleagues match your current search or filter criteria. Try clearing filters."
              : "No staff directory records found."}
          </p>
          {(search || activeFiltersCount > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("")
                setSelectedDept("all")
                setSelectedOffice("all")
                setStaffType("permanent")
                setLeadOnly(false)
              }}
              className="mt-4 text-xs"
            >
              Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* A. MOBILE CARDS & DESKTOP GRID VIEW */}
          {(viewMode === "cards" || true) && (
            <div className={cn("space-y-3", viewMode === "cards" ? "block" : "block md:hidden")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredRows.map((colleague) => {
                  const name = displayName(colleague)
                  const initials = getInitials(name)

                  return (
                    <div
                      key={colleague.id}
                      className="group bg-card hover:bg-muted/10 hover:border-primary/40 relative flex flex-col justify-between rounded-xl border p-4 shadow-2xs transition-all hover:shadow-xs"
                    >
                      {/* Top Person Info */}
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10 shrink-0 border shadow-2xs">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <CopyValue
                                  value={name}
                                  className="text-foreground text-sm font-semibold"
                                  label="name"
                                />
                                {colleague.is_department_lead && (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                                  >
                                    Lead
                                  </Badge>
                                )}
                              </div>
                              {colleague.designation && (
                                <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                                  {colleague.designation}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Badges: Department + Office */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          {colleague.department && (
                            <span className="bg-muted/40 text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium">
                              <Building2 className="text-primary h-3 w-3" />
                              {colleague.department}
                            </span>
                          )}
                          {colleague.office_location && (
                            <span className="bg-muted/40 text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5">
                              <MapPin className="h-3 w-3 text-amber-500" />
                              {colleague.office_location}
                            </span>
                          )}
                        </div>

                        {/* Contact Lines */}
                        <div className="space-y-1.5 border-t pt-1 text-xs">
                          {colleague.company_email && (
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                                <Mail className="text-primary/70 h-3.5 w-3.5 shrink-0" />
                                <CopyValue value={colleague.company_email} className="text-xs" label="email" />
                              </div>
                              <a
                                href={`mailto:${colleague.company_email}`}
                                className="text-primary hover:text-primary/80 hover:bg-muted shrink-0 rounded p-1 text-[11px] font-medium"
                                title="Send email"
                              >
                                Email
                              </a>
                            </div>
                          )}

                          {colleague.phone_number && (
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-muted-foreground flex min-w-0 items-center gap-1.5">
                                <Phone className="h-3.5 w-3.5 shrink-0 text-emerald-600/70" />
                                <CopyValue value={colleague.phone_number} className="text-xs" label="phone" />
                              </div>
                              <a
                                href={`tel:${colleague.phone_number.replace(/\s+/g, "")}`}
                                className="hover:bg-muted shrink-0 rounded p-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
                                title="Call number"
                              >
                                Call
                              </a>
                            </div>
                          )}

                          {colleague.additional_phone && (
                            <div className="text-muted-foreground/70 flex items-center gap-1.5 text-[11px]">
                              <Phone className="h-3 w-3 shrink-0 opacity-50" />
                              <CopyValue
                                value={colleague.additional_phone}
                                className="text-[11px]"
                                muted
                                label="alt phone"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* B. DESKTOP FULL TABLE VIEW WITH S/N */}
          {viewMode === "table" && (
            <div className="bg-card hidden overflow-hidden rounded-xl border shadow-xs md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/70 text-muted-foreground border-b text-[11px] font-medium tracking-wider uppercase">
                    <tr>
                      <th className="w-12 px-3 py-3 text-center">S/N</th>
                      <th className="px-4 py-3">Name & Role</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Email Address</th>
                      <th className="px-4 py-3">Phone Number</th>
                      <th className="px-4 py-3">Office Location</th>
                      <th className="px-4 py-3 text-right">Quick Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredRows.map((colleague, index) => {
                      const name = displayName(colleague)
                      const initials = getInitials(name)

                      return (
                        <tr key={colleague.id} className="hover:bg-muted/40 transition-colors">
                          <td className="text-muted-foreground px-3 py-3 text-center font-mono text-[11px]">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="h-8 w-8 shrink-0 border">
                                <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-bold">
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <CopyValue
                                    value={name}
                                    className="text-foreground text-xs font-semibold"
                                    label="name"
                                  />
                                  {colleague.is_department_lead && (
                                    <Badge
                                      variant="outline"
                                      className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-bold text-emerald-700 dark:text-emerald-300"
                                    >
                                      Lead
                                    </Badge>
                                  )}
                                </div>
                                {colleague.designation && (
                                  <p className="text-muted-foreground line-clamp-1 text-[11px]">
                                    {colleague.designation}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {colleague.department ? (
                              <span className="text-foreground/90 font-medium">{colleague.department}</span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <CopyValue value={colleague.company_email} label="email" />
                              {colleague.additional_email && (
                                <CopyValue
                                  value={colleague.additional_email}
                                  className="text-[11px]"
                                  muted
                                  label="alt email"
                                />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <CopyValue value={colleague.phone_number} label="phone" />
                              {colleague.additional_phone && (
                                <CopyValue
                                  value={colleague.additional_phone}
                                  className="text-[11px]"
                                  muted
                                  label="alt phone"
                                />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {colleague.office_location ? (
                              <span className="text-muted-foreground inline-flex items-center gap-1">
                                <MapPin className="h-3 w-3 text-amber-500" />
                                {colleague.office_location}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {colleague.company_email && (
                                <a
                                  href={`mailto:${colleague.company_email}`}
                                  className="text-muted-foreground hover:text-primary hover:bg-muted rounded-md border p-1 transition-colors"
                                  title="Send email"
                                >
                                  <Mail className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {colleague.phone_number && (
                                <a
                                  href={`tel:${colleague.phone_number.replace(/\s+/g, "")}`}
                                  className="text-muted-foreground hover:bg-muted rounded-md border p-1 transition-colors hover:text-emerald-600"
                                  title="Call number"
                                >
                                  <Phone className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* C. DESKTOP GROUPED BY DEPARTMENT VIEW */}
          {viewMode === "grouped" && (
            <div className="hidden space-y-6 md:block">
              {groupedByDept.map(([deptName, members]) => (
                <div key={deptName} className="bg-card/60 space-y-3 rounded-xl border p-4 shadow-xs">
                  <div className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-2">
                      <div className="bg-primary/10 text-primary rounded-md p-1.5">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-semibold">{deptName}</h3>
                    </div>
                    <span className="text-muted-foreground bg-muted rounded-full border px-2 py-0.5 font-mono text-xs font-semibold">
                      {members.length} {members.length === 1 ? "colleague" : "colleagues"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {members.map((colleague) => {
                      const name = displayName(colleague)
                      const initials = getInitials(name)
                      return (
                        <div
                          key={colleague.id}
                          className="bg-card hover:border-primary/40 space-y-2 rounded-lg border p-3 shadow-2xs transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8 shrink-0 border">
                              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-bold">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <CopyValue
                                  value={name}
                                  className="text-foreground text-xs font-semibold"
                                  label="name"
                                />
                                {colleague.is_department_lead && (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-500/40 bg-emerald-500/10 px-1 py-0 text-[9px] font-bold text-emerald-700 dark:text-emerald-300"
                                  >
                                    Lead
                                  </Badge>
                                )}
                              </div>
                              {colleague.designation && (
                                <p className="text-muted-foreground line-clamp-1 text-[11px]">
                                  {colleague.designation}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="text-muted-foreground flex items-center justify-between gap-2 border-t pt-2 text-[11px]">
                            <span className="truncate">{colleague.company_email || "No email"}</span>
                            <div className="flex shrink-0 items-center gap-1">
                              {colleague.company_email && (
                                <a href={`mailto:${colleague.company_email}`} className="text-primary hover:underline">
                                  Email
                                </a>
                              )}
                              {colleague.phone_number && (
                                <>
                                  <span>•</span>
                                  <a
                                    href={`tel:${colleague.phone_number}`}
                                    className="text-emerald-600 hover:underline"
                                  >
                                    Call
                                  </a>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Export Dialog */}
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
