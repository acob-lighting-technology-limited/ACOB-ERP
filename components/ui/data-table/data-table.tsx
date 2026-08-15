"use client"

import {
  Fragment,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core"
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable"
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import {
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Inbox,
  SlidersHorizontal,
  X,
  LayoutGrid,
  List,
  Check,
  GripVertical,
  MoreHorizontal,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { DataTableProps, SortConfig } from "./types"

// ─── Debounce hook ───────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ─── Column resize hook ──────────────────────────────────────────────────────

function useColumnResize(initialWidths: Record<string, number>) {
  const [colWidths, setColWidths] = useState<Record<string, number>>(initialWidths)
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null)

  const startResize = useCallback((key: string, startX: number, startW: number) => {
    resizingRef.current = { key, startX, startW }

    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = e.clientX - resizingRef.current.startX
      const newW = Math.max(60, resizingRef.current.startW + delta)
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.key]: newW }))
    }

    const onMouseUp = () => {
      resizingRef.current = null
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [])

  return { colWidths, startResize }
}

// ─── Skeleton rows ───────────────────────────────────────────────────────────

function TableSkeleton({
  rows,
  cols,
  headerClassName,
  borderless,
}: {
  rows: number
  cols: number
  headerClassName: string
  borderless?: boolean
}) {
  const table = (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className={headerClassName}>
          <TableRow>
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-24" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <TableRow key={rowIdx}>
              {Array.from({ length: cols }).map((_, colIdx) => (
                <TableCell key={colIdx}>
                  <Skeleton className={cn("h-4", colIdx === 0 ? "w-32" : colIdx === cols - 1 ? "w-16" : "w-24")} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )

  if (borderless) return table

  return (
    <Card>
      <CardContent className="p-0">{table}</CardContent>
    </Card>
  )
}

// ─── Sortable column header ───────────────────────────────────────────────────

interface SortableColHeadProps {
  id: string
  label: string
  align?: "left" | "center" | "right"
  hideOnMobile?: boolean
  sortable?: boolean
  resizable?: boolean
  sortConfig: { key: string; direction: "asc" | "desc" } | null
  colWidth?: number
  colClass?: string
  onSort?: () => void
  onResizeStart: (clientX: number, currentW: number) => void
}

function SortableColHead({
  id,
  label,
  align,
  hideOnMobile,
  sortable,
  resizable,
  sortConfig,
  colWidth,
  colClass,
  onSort,
  onResizeStart,
}: SortableColHeadProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    ...(colWidth ? { width: colWidth } : {}),
  }

  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className={cn(
        !colWidth && colClass,
        align === "right" && "text-right",
        align === "center" && "text-center",
        hideOnMobile && "hidden md:table-cell",
        sortable && "hover:text-foreground cursor-pointer transition-colors select-none",
        resizable && "relative",
        "group"
      )}
      onClick={sortable ? onSort : undefined}
      aria-sort={sortConfig?.key === id ? (sortConfig.direction === "asc" ? "ascending" : "descending") : undefined}
    >
      <span className="inline-flex items-center gap-1">
        {/* Drag handle — shown on hover */}
        <span
          {...attributes}
          {...listeners}
          className="text-muted-foreground/40 hover:text-muted-foreground mr-0.5 hidden cursor-grab group-hover:inline-flex active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Drag to reorder ${label} column`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {label}
        {sortable &&
          (sortConfig?.key === id ? (
            sortConfig.direction === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
          ))}
      </span>
      {/* Resize handle */}
      {resizable && (
        <div
          role="separator"
          aria-label={`Resize ${label} column`}
          className="hover:bg-border active:bg-primary/40 absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent transition-colors select-none"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const th = e.currentTarget.closest("th")
            const currentW = th ? th.getBoundingClientRect().width : (colWidth ?? 120)
            onResizeStart(e.clientX, currentW)
          }}
        />
      )}
    </TableHead>
  )
}

// ─── Active filter pill ───────────────────────────────────────────────────────

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1 text-xs font-normal">
      {label}
      <button
        onClick={onRemove}
        className="hover:bg-muted ml-0.5 rounded-sm p-0.5 transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DataTable<TData>({
  data,
  columns,
  getRowId,
  // Search
  searchPlaceholder = "Search...",
  searchFn,
  searchDisabled = false,
  // Filters
  filters = [],
  // Sorting
  sortFn,
  // Pagination
  pagination,
  totalRows,
  currentPage = 0,
  onPageChange,
  onSearchChange,
  onFilterChange,
  onProcessedDataChange,
  // Expandable
  expandable,
  expandableColumnPosition = "start",
  // Actions
  rowActions,
  forceRowActionsDropdown,
  bulkActions,
  selectable = false,
  // View
  viewToggle = false,
  cardRenderer,
  // URL sync
  urlSync = false,
  // Appearance
  headerClassName = "bg-muted/80",
  minWidth,
  showRowNumbers = true,
  columnToggle = true,
  skeletonRows = 8,
  // State
  isLoading = false,
  error = null,
  onRetry,
  // Empty
  emptyIcon: EmptyIcon = Inbox,
  emptyTitle = "No results found",
  emptyDescription = "Try adjusting your search or filters.",
}: DataTableProps<TData>) {
  const expandAtStart = expandableColumnPosition !== "end"
  // ─── Column resize ─────────────────────────────────────────────────────────
  const initialColWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const col of columns) {
      if (col.resizable && col.initialWidth) map[col.key] = col.initialWidth
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // stable on mount
  const { colWidths, startResize } = useColumnResize(initialColWidths)

  // ─── Router (URL sync) ─────────────────────────────────────────────────────
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // ─── Search state ──────────────────────────────────────────────────────────
  const initialSearch = urlSync ? (searchParams.get("q") ?? "") : ""
  const [searchInput, setSearchInput] = useState(initialSearch)
  const searchQuery = useDebounce(searchInput, 300)

  // ─── Filter state ──────────────────────────────────────────────────────────
  const initialFilters = useMemo(() => {
    const init: Record<string, string[]> = {}
    for (const f of filters) {
      // URL values (when synced) take precedence over configured defaults.
      if (urlSync) {
        const val = searchParams.getAll(f.key)
        if (val.length > 0) {
          init[f.key] = val
          continue
        }
      }
      if (f.defaultValues && f.defaultValues.length > 0) init[f.key] = f.defaultValues
    }
    return init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

  const [filterValues, setFilterValues] = useState<Record<string, string[]>>(initialFilters)

  // ─── Sync state → URL ──────────────────────────────────────────────────────
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (!urlSync) return
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const params = new URLSearchParams()
    if (searchQuery) params.set("q", searchQuery)
    for (const [key, vals] of Object.entries(filterValues)) {
      for (const v of vals) params.append(key, v)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchQuery, filterValues, urlSync, pathname, router])

  // ─── Trigger external search callback ──────────────────────────────────────
  useEffect(() => {
    if (onSearchChange) onSearchChange(searchQuery)
  }, [searchQuery, onSearchChange])

  // ─── Trigger external filter callback ──────────────────────────────────────
  useEffect(() => {
    if (onFilterChange) onFilterChange(filterValues)
  }, [filterValues, onFilterChange])

  // ─── Sort state ────────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)

  // ─── Expanded rows ─────────────────────────────────────────────────────────
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // ─── Selected rows ─────────────────────────────────────────────────────────
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  // ─── View mode (user-controlled; never auto-switch) ──────────────────────
  const [manualViewMode, setManualViewMode] = useState<"list" | "card" | null>(null)
  const viewMode = manualViewMode ?? "list"

  // ─── Column visibility ────────────────────────────────────────────────────
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultVisible === false).map((c) => c.key))
  )

  // ─── Column order (drag-to-reorder) ───────────────────────────────────────
  const [columnOrder, setColumnOrder] = useState<string[]>(() => columns.map((c) => c.key))

  // Keep order in sync when columns prop changes (e.g. tab switch)
  useEffect(() => {
    setColumnOrder((prev) => {
      const incoming = columns.map((c) => c.key)
      // Preserve existing order for keys that still exist, append new ones
      const kept = prev.filter((k) => incoming.includes(k))
      const added = incoming.filter((k) => !prev.includes(k))
      return [...kept, ...added]
    })
  }, [columns])

  const orderedColumns = useMemo(
    () =>
      columnOrder.map((key) => columns.find((c) => c.key === key)).filter((c): c is (typeof columns)[number] => !!c),
    [columns, columnOrder]
  )

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => !hiddenColumns.has(c.key)),
    [orderedColumns, hiddenColumns]
  )

  // ─── DnD sensors ─────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const handleColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setColumnOrder((prev) => {
        const oldIdx = prev.indexOf(String(active.id))
        const newIdx = prev.indexOf(String(over.id))
        return arrayMove(prev, oldIdx, newIdx)
      })
    }
  }, [])

  // ─── Client page ──────────────────────────────────────────────────────────
  const [clientPage, setClientPage] = useState(0)
  const isServerPagination = pagination?.serverSide === true
  const activePage = isServerPagination ? currentPage : clientPage
  const pageSize = pagination?.pageSize ?? data.length

  // ─── Reset page on filter/search change ───────────────────────────────────
  useEffect(() => {
    if (!isServerPagination) setClientPage(0)
  }, [searchQuery, filterValues, isServerPagination])

  // ─── Filtering ─────────────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    if (isServerPagination) return data
    let result = data

    // Search
    if (searchFn && searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter((row) => searchFn(row, q))
    }

    // Filters
    for (const filter of filters) {
      const selected = filterValues[filter.key]
      if (!selected || selected.length === 0) continue

      // An explicit filterFn always wins, whether or not mode is "custom" —
      // cross-column filters supply one without setting mode.
      if (filter.filterFn) {
        result = result.filter((row) => filter.filterFn!(row, selected))
        continue
      }

      // Otherwise match the column sharing this filter's key. Plenty of filters
      // key off a field that is displayed via a custom `render` (so the column
      // has no accessor) or is not shown as a column at all; for those, read the
      // row's own property of that name rather than silently filtering nothing.
      const col = columns.find((c) => c.key === filter.key)
      const accessor = col?.accessor
      const readValue = accessor
        ? (row: TData) => accessor(row)
        : (row: TData) => (row as Record<string, unknown> | null)?.[filter.key]

      if (process.env.NODE_ENV !== "production" && !accessor) {
        const resolvesOnRow = result.some((row) => (row as Record<string, unknown> | null)?.[filter.key] !== undefined)
        if (!resolvesOnRow) {
          console.warn(
            `[DataTable] Filter "${filter.key}" matches no column accessor and no row property, ` +
              `so selecting it will not filter anything. Add a column with this key and an ` +
              `accessor, or give the filter a filterFn.`
          )
        }
      }

      result = result.filter((row) => selected.includes(String(readValue(row) ?? "")))
    }

    return result
  }, [data, searchQuery, searchFn, filterValues, filters, columns, isServerPagination])

  // ─── Sorting ───────────────────────────────────────────────────────────────
  const sortedData = useMemo(() => {
    if (isServerPagination) return filteredData
    if (!sortConfig) return filteredData
    if (sortFn) return sortFn(filteredData, sortConfig)

    const col = columns.find((c) => c.key === sortConfig.key)
    if (!col?.accessor) return filteredData

    return [...filteredData].sort((a, b) => {
      const aVal = String(col.accessor!(a) ?? "")
      const bVal = String(col.accessor!(b) ?? "")
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
      return sortConfig.direction === "asc" ? cmp : -cmp
    })
  }, [filteredData, sortConfig, sortFn, columns, isServerPagination])

  const processedDataSignature = useMemo(() => sortedData.map((row) => getRowId(row)).join("|"), [sortedData, getRowId])

  // Keep the latest sortedData in a ref so the effect can read it without
  // depending on its (unstable) identity. `sortedData` gets a new reference
  // whenever the parent rebuilds the `columns` array (a common inline pattern),
  // and including it here would refire this effect → re-render the parent →
  // new columns → new sortedData → infinite loop (React #185). The signature
  // is the real "did the result set change?" trigger.
  const sortedDataRef = useRef(sortedData)
  const onProcessedDataChangeRef = useRef(onProcessedDataChange)

  useEffect(() => {
    sortedDataRef.current = sortedData
  }, [sortedData])

  useEffect(() => {
    onProcessedDataChangeRef.current = onProcessedDataChange
  }, [onProcessedDataChange])

  useEffect(() => {
    if (onProcessedDataChangeRef.current) onProcessedDataChangeRef.current(sortedDataRef.current)
  }, [processedDataSignature])

  // ─── Pagination ────────────────────────────────────────────────────────────
  const total = isServerPagination ? (totalRows ?? data.length) : sortedData.length
  const totalPages = pagination ? Math.ceil(total / pageSize) : 1

  const paginatedData = useMemo(() => {
    if (isServerPagination || !pagination) return sortedData
    return sortedData.slice(clientPage * pageSize, (clientPage + 1) * pageSize)
  }, [sortedData, isServerPagination, pagination, clientPage, pageSize])

  // ─── Active filters summary ────────────────────────────────────────────────
  const activeFilterPills = useMemo(() => {
    const pills: { key: string; value: string; label: string }[] = []
    for (const filter of filters) {
      const selected = filterValues[filter.key] ?? []
      for (const val of selected) {
        const opt = filter.options.find((o: { value: string }) => o.value === val)
        pills.push({ key: filter.key, value: val, label: `${filter.label}: ${opt?.label ?? val}` })
      }
    }
    return pills
  }, [filters, filterValues])

  const hasActiveFilters = searchQuery.trim().length > 0 || activeFilterPills.length > 0

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleSort = useCallback((key: string) => {
    setSortConfig((prev) => {
      if (prev?.key === key) return prev.direction === "asc" ? { key, direction: "desc" } : null
      return { key, direction: "asc" }
    })
  }, [])

  const toggleExpand = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedRows.size === paginatedData.length && paginatedData.length > 0) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(paginatedData.map(getRowId)))
    }
  }, [paginatedData, selectedRows.size, getRowId])

  const handleFilterChange = useCallback((key: string, values: string[]) => {
    setFilterValues((prev) => ({ ...prev, [key]: values }))
  }, [])

  const removeFilterPill = useCallback((key: string, value: string) => {
    setFilterValues((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).filter((v) => v !== value),
    }))
  }, [])

  const clearAllFilters = useCallback(() => {
    setSearchInput("")
    setFilterValues({})
  }, [])

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (isServerPagination && onPageChange) onPageChange(newPage)
      else setClientPage(newPage)
    },
    [isServerPagination, onPageChange]
  )

  // ─── Keyboard navigation on rows ─────────────────────────────────────────
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)
  const handleRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableRowElement>, rowId: string) => {
      if (!tableBodyRef.current) return
      const rows = Array.from(tableBodyRef.current.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]"))
      const idx = rows.findIndex((r) => r.dataset.rowId === rowId)
      if (e.key === "ArrowDown" && idx < rows.length - 1) {
        e.preventDefault()
        rows[idx + 1]?.focus()
      } else if (e.key === "ArrowUp" && idx > 0) {
        e.preventDefault()
        rows[idx - 1]?.focus()
      } else if (e.key === "Enter" || e.key === " ") {
        if (expandable) toggleExpand(rowId)
      }
    },
    [expandable, toggleExpand]
  )

  // Where the pointer went down on a row, so a click that was really a text-selection
  // drag doesn't get treated as "expand this row".
  const rowPointerDownRef = useRef<{ x: number; y: number } | null>(null)

  /** True when the click was a drag or left text highlighted — i.e. the user was copying. */
  const clickWasTextSelection = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    const origin = rowPointerDownRef.current
    rowPointerDownRef.current = null
    if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 4) return true
    return Boolean(window.getSelection()?.toString().trim())
  }, [])

  const selectedItems = useMemo(
    () => data.filter((row) => selectedRows.has(getRowId(row))),
    [data, selectedRows, getRowId]
  )

  // ─── Column count for colSpan ─────────────────────────────────────────────
  const totalCols =
    visibleColumns.length +
    (showRowNumbers ? 1 : 0) +
    (selectable ? 1 : 0) +
    (expandable ? 1 : 0) +
    (rowActions && rowActions.length > 0 ? 1 : 0)

  // ─── Toolbar (shared across all states) ──────────────────────────────────

  const showToolbar = !searchDisabled || filters.length > 0 || columnToggle || (viewToggle && cardRenderer)

  const toolbar = showToolbar ? (
    <div className="space-y-3 p-4">
      {/* Row 1: search + column toggle + view toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {!searchDisabled && (
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder={searchPlaceholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pr-9 pl-10"
              aria-label="Search"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          {columnToggle && columns.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline">Columns</span>
                  {hiddenColumns.size > 0 && (
                    <Badge variant="secondary" className="h-5 px-1 text-xs">
                      {hiddenColumns.size}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={!hiddenColumns.has(col.key)}
                    onCheckedChange={(checked) => {
                      setHiddenColumns((prev) => {
                        const next = new Set(prev)
                        if (checked) {
                          next.delete(col.key)
                        } else {
                          next.add(col.key)
                        }
                        return next
                      })
                    }}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {hiddenColumns.size > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={false}
                      onCheckedChange={() => setHiddenColumns(new Set())}
                      className="text-primary font-medium"
                    >
                      <Check className="mr-2 h-3.5 w-3.5" />
                      Show all
                    </DropdownMenuCheckboxItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {viewToggle && cardRenderer && (
            <div className="flex items-center rounded-lg border p-1">
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setManualViewMode("list")}
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "card" ? "default" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setManualViewMode("card")}
                aria-label="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: filter dropdowns */}
      {filters.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {filters.map((filter) =>
            filter.render ? (
              <div key={filter.key}>
                {filter.render(filterValues[filter.key] ?? [], (vals) => handleFilterChange(filter.key, vals))}
              </div>
            ) : filter.multi === false ? (
              <Select
                key={filter.key}
                value={filterValues[filter.key]?.[0] ?? "all"}
                onValueChange={(val) => handleFilterChange(filter.key, val === "all" ? [] : [val])}
              >
                <SelectTrigger>
                  <SelectValue placeholder={filter.placeholder ?? filter.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{filter.placeholder ?? `All ${filter.label}`}</SelectItem>
                  {filter.options.map((opt: { value: string; label: string }) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <SearchableMultiSelect
                key={filter.key}
                label={filter.label}
                icon={filter.icon}
                values={filterValues[filter.key] ?? []}
                options={filter.options}
                onChange={(vals) => handleFilterChange(filter.key, vals)}
                placeholder={filter.placeholder ?? `All ${filter.label}`}
              />
            )
          )}
        </div>
      )}
    </div>
  ) : null

  // ─── Status bar: pills + row count + bulk actions ────────────────────────

  const statusBar = (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2",
        "text-muted-foreground text-sm"
      )}
    >
      {/* Left: active filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {hasActiveFilters ? (
          <>
            {searchQuery.trim() && <FilterPill label={`"${searchQuery.trim()}"`} onRemove={() => setSearchInput("")} />}
            {activeFilterPills.map((pill) => (
              <FilterPill
                key={`${pill.key}:${pill.value}`}
                label={pill.label}
                onRemove={() => removeFilterPill(pill.key, pill.value)}
              />
            ))}
            <button
              onClick={clearAllFilters}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              Clear all
            </button>
          </>
        ) : null}

        {/* Bulk actions */}
        {selectable && selectedRows.size > 0 && bulkActions && bulkActions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-foreground font-medium">{selectedRows.size} selected</span>
            {bulkActions.map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant={action.variant === "destructive" ? "destructive" : "outline"}
                onClick={() => {
                  action.onClick(selectedItems)
                  setSelectedRows(new Set())
                }}
                className="h-6 gap-1 px-2 text-xs"
              >
                {action.icon && <action.icon className="h-3 w-3" />}
                {action.label}
              </Button>
            ))}
            <button
              onClick={() => setSelectedRows(new Set())}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Right: row count */}
      {!isLoading && !error && (
        <span className="ml-auto shrink-0">
          {pagination ? (
            <>
              Showing{" "}
              <span className="text-foreground font-medium">
                {activePage * pageSize + 1}–{Math.min((activePage + 1) * pageSize, total)}
              </span>{" "}
              of <span className="text-foreground font-medium">{total}</span>
            </>
          ) : (
            <>
              <span className="text-foreground font-medium">{sortedData.length}</span> result
              {sortedData.length !== 1 ? "s" : ""}
              {hasActiveFilters && data.length !== sortedData.length && (
                <span className="text-muted-foreground"> of {data.length}</span>
              )}
            </>
          )}
        </span>
      )}
    </div>
  )

  // ─── Table inner ──────────────────────────────────────────────────────────

  const tableInner = (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragEnd={handleColumnDragEnd}
    >
      <div className="overflow-x-auto">
        <Table style={minWidth ? { minWidth } : undefined} className={minWidth ? `min-w-[${minWidth}]` : undefined}>
          <TableHeader className={cn(headerClassName, "sticky top-0 z-10")}>
            <SortableContext items={visibleColumns.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
              <TableRow>
                {selectable && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedRows.size === paginatedData.length && paginatedData.length > 0}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all rows"
                    />
                  </TableHead>
                )}
                {expandable && expandAtStart && <TableHead className="w-10" />}
                {showRowNumbers && <TableHead className="w-14">S/N</TableHead>}
                {visibleColumns.map((col) => (
                  <SortableColHead
                    key={col.key}
                    id={col.key}
                    label={col.label}
                    align={col.align}
                    hideOnMobile={col.hideOnMobile}
                    sortable={col.sortable}
                    resizable={col.resizable}
                    sortConfig={sortConfig}
                    colWidth={colWidths[col.key]}
                    colClass={col.width}
                    onSort={() => handleSort(col.key)}
                    onResizeStart={(clientX, currentW) => startResize(col.key, clientX, currentW)}
                  />
                ))}
                {expandable && !expandAtStart && <TableHead className="w-10" />}
                {rowActions && rowActions.length > 0 && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </SortableContext>
          </TableHeader>

          <TableBody ref={tableBodyRef}>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalCols} className="p-0">
                  <EmptyState
                    EmptyIcon={EmptyIcon}
                    emptyTitle={emptyTitle}
                    emptyDescription={emptyDescription}
                    hasActiveFilters={hasActiveFilters}
                    onClearFilters={clearAllFilters}
                  />
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => {
                const rowId = getRowId(row)
                const isExpanded = expandedRows.has(rowId)
                const canExpand = expandable && (!expandable.canExpand || expandable.canExpand(row))
                const globalIndex = activePage * pageSize + index

                return (
                  <Fragment key={rowId}>
                    <TableRow
                      data-row-id={rowId}
                      tabIndex={0}
                      onKeyDown={(e) => handleRowKeyDown(e, rowId)}
                      onMouseDown={(e) => {
                        rowPointerDownRef.current = { x: e.clientX, y: e.clientY }
                      }}
                      onClick={(e) => {
                        const target = e.target as HTMLElement
                        if (
                          target.closest("button") ||
                          target.closest("a") ||
                          target.closest("input") ||
                          target.closest("label") ||
                          target.closest("[role='menuitem']") ||
                          target.closest("[role='checkbox']")
                        ) {
                          return
                        }
                        // Highlighting text inside a row must not expand it.
                        if (clickWasTextSelection(e)) return
                        if (canExpand) {
                          toggleExpand(rowId)
                        }
                      }}
                      className={cn(
                        isExpanded && "border-b-0",
                        selectedRows.has(rowId) && "bg-muted/50",
                        canExpand && "hover:bg-muted/30 cursor-pointer",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                      )}
                    >
                      {selectable && (
                        <TableCell>
                          <Checkbox
                            checked={selectedRows.has(rowId)}
                            onCheckedChange={() => toggleSelect(rowId)}
                            aria-label={`Select row ${globalIndex + 1}`}
                          />
                        </TableCell>
                      )}
                      {expandable && expandAtStart && (
                        <TableCell>
                          {canExpand ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => toggleExpand(rowId)}
                              aria-label={isExpanded ? "Collapse row" : "Expand row"}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          ) : null}
                        </TableCell>
                      )}
                      {showRowNumbers && (
                        <TableCell className="text-muted-foreground font-medium">{globalIndex + 1}</TableCell>
                      )}
                      {visibleColumns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={cn(
                            col.align === "right" && "text-right",
                            col.align === "center" && "text-center",
                            col.hideOnMobile && "hidden md:table-cell"
                          )}
                        >
                          {col.render ? col.render(row, globalIndex) : col.accessor ? (col.accessor(row) ?? "-") : "-"}
                        </TableCell>
                      ))}
                      {expandable && !expandAtStart && (
                        <TableCell>
                          {canExpand ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => toggleExpand(rowId)}
                              aria-label={isExpanded ? "Collapse row" : "Expand row"}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          ) : null}
                        </TableCell>
                      )}
                      {rowActions && rowActions.length > 0 && (
                        <TableCell className="text-right">
                          {(() => {
                            const visible = rowActions.filter((a) => !a.hidden || !a.hidden(row))
                            if (visible.length === 0) return null
                            if (visible.length === 1 && !forceRowActionsDropdown) {
                              const action = visible[0]
                              return (
                                <Button
                                  size="sm"
                                  variant={action.variant === "destructive" ? "destructive" : "outline"}
                                  onClick={() => {
                                    action.onClick(row)
                                  }}
                                  className="h-7 gap-1 px-2 text-xs"
                                >
                                  {action.icon && <action.icon className="h-3.5 w-3.5" />}
                                  {action.label}
                                </Button>
                              )
                            }
                            return (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Actions</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  {visible.map((action) => (
                                    <DropdownMenuItem
                                      key={action.label}
                                      onClick={() => {
                                        action.onClick(row)
                                      }}
                                      className={cn(
                                        "gap-2 text-sm",
                                        action.variant === "destructive" && "text-destructive focus:text-destructive"
                                      )}
                                    >
                                      {action.icon && <action.icon className="h-3.5 w-3.5" />}
                                      {action.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )
                          })()}
                        </TableCell>
                      )}
                    </TableRow>

                    {expandable && isExpanded && canExpand && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={totalCols} className="p-4">
                          {expandable.render(row)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </DndContext>
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Card view: toolbar card + grid below */}
      {!isLoading && !error && viewMode === "card" && cardRenderer ? (
        <>
          {showToolbar && (
            <Card>
              {toolbar}
              {statusBar}
            </Card>
          )}
          {paginatedData.length === 0 ? (
            <EmptyState
              EmptyIcon={EmptyIcon}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearAllFilters}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedData.map((row) => (
                <div key={getRowId(row)}>{cardRenderer(row)}</div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* Table / skeleton / error — all in one card */
        <Card>
          {toolbar}
          {statusBar}

          {isLoading ? (
            /* Skeleton rows — no top border since statusBar has border-t */
            <div className="border-t">
              <TableSkeleton
                rows={skeletonRows}
                cols={visibleColumns.length + (showRowNumbers ? 1 : 0) + (rowActions?.length ? 1 : 0)}
                headerClassName={headerClassName}
                borderless
              />
            </div>
          ) : error ? (
            <div className="space-y-3 border-t py-12 text-center">
              <p className="text-sm text-red-500">{error}</p>
              {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          ) : (
            <div className="border-t">{tableInner}</div>
          )}

          {/* Pagination inside the card footer. Left-aligned on purpose: the AcoBot
              launcher is fixed to the bottom-right of the viewport, so controls pinned
              to the right edge here sit under it whenever the footer scrolls through
              that band. */}
          {pagination && totalPages > 1 && !isLoading && !error && (
            <div className="flex items-center gap-4 border-t px-4 py-3 text-sm">
              <p className="text-muted-foreground">
                Page {activePage + 1} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activePage === 0}
                  onClick={() => handlePageChange(activePage - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activePage + 1 >= totalPages}
                  onClick={() => handlePageChange(activePage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  EmptyIcon,
  emptyTitle,
  emptyDescription,
  hasActiveFilters,
  onClearFilters,
}: {
  EmptyIcon: React.ElementType
  emptyTitle: string
  emptyDescription: string
  hasActiveFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <EmptyIcon className="text-muted-foreground/50 mx-auto mb-4 h-12 w-12" />
      <p className="text-foreground font-medium">{emptyTitle}</p>
      <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
      {hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={onClearFilters} className="mt-4 gap-2">
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  )
}
