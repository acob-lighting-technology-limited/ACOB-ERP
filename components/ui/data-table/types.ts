import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

// ─── Column Definition ───────────────────────────────────────────────────────

export interface DataTableColumn<TData> {
  /** Unique key — also used as URL param key when urlSync is enabled */
  key: string
  /** Header label */
  label: string
  /** Whether the column is sortable */
  sortable?: boolean
  /** Custom width class e.g. "w-16" */
  width?: string
  /** Align content */
  align?: "left" | "center" | "right"
  /** Custom cell renderer — receives the row + global index */
  render?: (row: TData, index: number) => ReactNode
  /** Simple value accessor used for default sorting, filtering and CSV */
  accessor?: (row: TData) => string | number | null | undefined
  /** Hide on mobile (< md breakpoint) */
  hideOnMobile?: boolean
  /** Visible by default in column toggle (default: true) */
  defaultVisible?: boolean
  /** Allow this column to be dragged to resize (default: false) */
  resizable?: boolean
  /** Initial pixel width for resizable columns */
  initialWidth?: number
}

// ─── Filter Definition ───────────────────────────────────────────────────────

export interface DataTableFilterOption {
  value: string
  label: string
  icon?: ReactNode
}

export interface DataTableFilter<TData = unknown> {
  /** Unique key — used as URL param key when urlSync is enabled */
  key: string
  /** Display label */
  label: string
  /** Filter options */
  options: DataTableFilterOption[]
  /** Lucide icon shown in the trigger */
  icon?: ReactNode
  /** Placeholder text */
  placeholder?: string
  /**
   * How the filter is applied to rows.
   * - "column"  → matches against the column whose key equals this filter key (default)
   * - "custom"  → use the provided filterFn
   */
  mode?: "column" | "custom"
  /**
   * Custom filter function.
   * Called when mode === "custom" or when you need cross-column logic.
   */
  filterFn?: (row: TData, selectedValues: string[]) => boolean
  /** Whether this is multi-select (default: true) */
  multi?: boolean
  /**
   * Values selected by default on first load (e.g. show only active statuses).
   * When urlSync is enabled, values present in the URL take precedence.
   */
  defaultValues?: string[]
}

// ─── Tab Definition ──────────────────────────────────────────────────────────

export interface DataTableTab {
  key: string
  label: string
  icon?: LucideIcon
}

// ─── Sort State ──────────────────────────────────────────────────────────────

export interface SortConfig {
  key: string
  direction: "asc" | "desc"
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginationConfig {
  pageSize: number
  /** Server-side: parent owns page index and total, DataTable just shows controls */
  serverSide?: boolean
}

// ─── Expandable Row ──────────────────────────────────────────────────────────

export interface ExpandableConfig<TData> {
  render: (row: TData) => ReactNode
  canExpand?: (row: TData) => boolean
}

// ─── Row Actions ─────────────────────────────────────────────────────────────

export interface RowAction<TData> {
  label: string
  icon?: LucideIcon
  onClick: (row: TData) => void
  variant?: "default" | "destructive"
  /** Return true to hide the action for a given row */
  hidden?: (row: TData) => boolean
}

// ─── Bulk Actions ────────────────────────────────────────────────────────────

export interface BulkAction<TData> {
  label: string
  icon?: LucideIcon
  onClick: (selectedRows: TData[]) => void
  variant?: "default" | "destructive"
}

// ─── Main DataTable Props ────────────────────────────────────────────────────

export interface DataTableProps<TData> {
  // ── Core ─────────────────────────────────────────────────────────────────
  data: TData[]
  columns: DataTableColumn<TData>[]
  getRowId: (row: TData) => string

  // ── Search ───────────────────────────────────────────────────────────────
  searchPlaceholder?: string
  /** Custom search predicate — receives the row and the lowercased query */
  searchFn?: (row: TData, query: string) => boolean
  searchDisabled?: boolean

  // ── Filters ──────────────────────────────────────────────────────────────
  filters?: DataTableFilter<TData>[]

  // ── Sorting ──────────────────────────────────────────────────────────────
  /** Override default alphabetic/numeric sort */
  sortFn?: (data: TData[], sort: SortConfig) => TData[]

  // ── Pagination ───────────────────────────────────────────────────────────
  pagination?: PaginationConfig
  /** For server-side: total row count across all pages */
  totalRows?: number
  /** For server-side: current page (0-indexed) */
  currentPage?: number
  /** For server-side: called when user navigates to a new page */
  onPageChange?: (page: number) => void
  /** Called when debounced search query changes */
  onSearchChange?: (query: string) => void
  /** Called when filter values change */
  onFilterChange?: (filters: Record<string, string[]>) => void
  /** Called when table rows are processed with current search/filter/sort (before pagination) */
  onProcessedDataChange?: (rows: TData[]) => void

  // ── Expandable ───────────────────────────────────────────────────────────
  expandable?: ExpandableConfig<TData>
  /** Position of the expand control column */
  expandableColumnPosition?: "start" | "end"

  // ── Row Actions ──────────────────────────────────────────────────────────
  rowActions?: RowAction<TData>[]

  // ── Bulk Actions ─────────────────────────────────────────────────────────
  bulkActions?: BulkAction<TData>[]
  selectable?: boolean

  // ── View Modes ───────────────────────────────────────────────────────────
  /** Show list/card toggle button */
  viewToggle?: boolean
  /** Required when viewToggle is true — renders a card for each row */
  cardRenderer?: (row: TData) => ReactNode

  // ── URL Sync ─────────────────────────────────────────────────────────────
  /**
   * Sync search query + filter values to URL query params.
   * Uses Next.js useSearchParams / useRouter — requires a Suspense boundary.
   */
  urlSync?: boolean

  // ── Appearance ───────────────────────────────────────────────────────────
  /** Header row bg class. Default: emerald brand */
  headerClassName?: string
  /** Inline min-width style for the table (e.g. "1200px") */
  minWidth?: string
  /** Show S/N column (default: true) */
  showRowNumbers?: boolean
  /** Show column visibility toggle button (default: true) */
  columnToggle?: boolean
  /** Number of skeleton rows shown while loading (default: 8) */
  skeletonRows?: number

  // ── State ────────────────────────────────────────────────────────────────
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void

  // ── Empty State ──────────────────────────────────────────────────────────
  emptyIcon?: LucideIcon
  emptyTitle?: string
  emptyDescription?: string
}

// ─── DataTablePage Props ─────────────────────────────────────────────────────

export interface DataTablePageProps {
  title: string
  description?: string
  icon?: LucideIcon
  backLink?: { href: string; label: string }
  actions?: ReactNode
  tabs?: DataTableTab[]
  activeTab?: string
  onTabChange?: (tab: string) => void
  secondaryTabs?: DataTableTab[]
  secondaryActiveTab?: string
  onSecondaryTabChange?: (tab: string) => void
  /** Stats row rendered between header and table content */
  stats?: ReactNode
  children: ReactNode
}
