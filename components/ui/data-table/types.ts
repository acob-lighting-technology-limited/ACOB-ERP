import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

/** The three renderings a `DataTable` can show. */
export type DataTableViewMode = "list" | "card" | "contacts"

// ─── Mobile detail sheet ─────────────────────────────────────────────────────

/** One labelled value in the standard mobile detail sheet. Tapping copies it. */
export interface DataTableDetailField {
  icon?: LucideIcon
  label: string
  value: string | null | undefined
  /**
   * Turns the row into a link opening in a new tab — for an attachment, a signed
   * download, a record elsewhere in the app. Takes precedence over `copyable`:
   * a value you can open is one you want to open, not copy.
   */
  href?: string
  /** Set false for values that make no sense to copy (a computed total, say). */
  copyable?: boolean
  muted?: boolean
}

/** A primary action button in the detail sheet footer (call, email, open…). */
export interface DataTableDetailAction {
  label: string
  icon?: LucideIcon
  /** Renders an anchor — use for tel:/mailto:/links. */
  href?: string
  onClick?: () => void
  variant?: "default" | "outline" | "destructive"
  className?: string
}

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
  /** Custom filter rendering */
  render?: (selectedValues: string[], onChange: (values: string[]) => void) => ReactNode
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
  /**
   * Controlled filter state, keyed by filter key. Supplying this hands ownership
   * of filter values to the parent — the table renders what you pass and reports
   * every change through `onFilterValuesChange` instead of storing it.
   *
   * Only reach for this when something *outside* the toolbar has to drive a
   * filter — a stat badge that toggles its own metric, a link that lands
   * pre-filtered. Leave it undefined for the normal case: the table owning its
   * own state is what keeps pages free of the inline filter state that the
   * Table Page Standard prohibits.
   *
   * `defaultValues` on a filter are ignored in controlled mode; seed the parent's
   * initial state instead.
   */
  filterValues?: Record<string, string[]>
  /** Required companion to `filterValues` — receives the complete next state. */
  onFilterValuesChange?: (filters: Record<string, string[]>) => void

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
  forceRowActionsDropdown?: boolean

  // ── Bulk Actions ─────────────────────────────────────────────────────────
  bulkActions?: BulkAction<TData>[]
  selectable?: boolean

  // ── View Modes ───────────────────────────────────────────────────────────
  /** Show the view-mode toggle */
  viewToggle?: boolean
  /** Enables the "Cards" mode — renders a card for each row */
  cardRenderer?: (row: TData) => ReactNode
  /**
   * Enables a third "Contacts" mode: the `mobileRow` list — grouped section
   * headers, tap-to-open detail sheet and all — rendered at *every* breakpoint
   * rather than only below `md`.
   *
   * For lookup-oriented pages (a staff directory, a supplier list) a phone-style
   * A–Z list beats a data table on desktop too, and this keeps that one list
   * anatomy instead of a page hand-rolling a second one. Requires `mobileRow`;
   * ignored without it. Opt-in, so pages that don't set it are unaffected — it
   * also un-hides the toggle below `md`, which is otherwise desktop-only.
   */
  contactsView?: boolean
  /**
   * Which mode the page opens in. Defaults to "list" (the table), so existing
   * pages are unchanged. Falls back to the table if the requested mode isn't
   * available.
   *
   * Pass `{ mobile, desktop }` when the best opening view differs by width. A
   * records page with eight columns wants the row list on a phone and the table
   * on a desktop that has room for all of them; a lookup page like the staff
   * directory wants its A–Z list at both, and passes a plain string.
   *
   * This is only the *default* — once the reader picks a mode from the toggle,
   * their choice holds across resizes.
   */
  defaultViewMode?: DataTableViewMode | { mobile: DataTableViewMode; desktop: DataTableViewMode }

  /**
   * Mobile row anatomy. Supplying this switches the table for a native-style list
   * below `md` — the pattern workforce/directory apps use, where a squeezed data
   * table is unreadable.
   *
   * Deliberately a *structured* config rather than a free render function: every
   * page then produces the same row anatomy (accent · leading · title/subtitle ·
   * fixed-width trailing), so values stay aligned down the page across the whole
   * app. Pages that omit it keep the existing table on mobile, so this is opt-in
   * and changes nothing until adopted.
   */
  mobileRow?: {
    /** Left status accent bar, e.g. "bg-red-500". */
    accentClass?: (row: TData) => string | undefined
    /** Avatar, S/N bubble, or icon slot. Receives row and 1-based Serial Number (sn). */
    leading?: (row: TData, sn: number) => ReactNode
    /** Primary line. */
    title: (row: TData) => ReactNode
    /** Secondary line — status, category, meta. */
    subtitle?: (row: TData) => ReactNode
    /** Right-hand slot, fixed width so it aligns across rows. */
    trailing?: (row: TData) => ReactNode
    /** Tapping the row. Ignored when `detail` is set (the sheet opens instead). */
    onSelect?: (row: TData) => void

    /**
     * Sticky section headers, contacts-app style — return the heading a row belongs
     * under (e.g. its surname initial). Grouping applies to the mobile list only;
     * the desktop table keeps its own sort.
     */
    groupBy?: (row: TData) => string

    /**
     * The standard detail sheet. Supplying this makes tapping a row open a bottom
     * sheet with the same anatomy on every page — avatar, title, badges, tap-to-copy
     * fields, and footer actions — so no page hand-rolls its own.
     */
    detail?: {
      title: (row: TData) => string
      subtitle?: (row: TData) => ReactNode
      avatar?: (row: TData) => ReactNode
      badges?: (row: TData) => ReactNode
      fields: (row: TData) => DataTableDetailField[]
      actions?: (row: TData) => DataTableDetailAction[]
    }
  }

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
  /**
   * Pins the search/filter toolbar below the app bar while the list scrolls.
   * Opt-in: it only helps on long, scan-heavy lists, and on pages that scroll
   * inside their own container it would pin to the wrong edge.
   */
  stickyToolbar?: boolean
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
  /**
   * Stats row rendered between header and table content. When `statBadges` is
   * supplied as well, the two form a responsive pair: badges below `md`, this
   * from `md` up.
   */
  stats?: ReactNode

  /**
   * Compact metric pills shown under the header — the mobile-friendly counterpart
   * to `stats`. Full StatCards cost most of a phone screen before any data is
   * visible, so pages should prefer these and reserve `stats` for desktop-heavy
   * dashboards. Rendered as outline pills so they never sit on a filled
   * background (muted text on a filled badge fails contrast).
   */
  statBadges?: {
    label: string
    tone?: string
    /** Leading glyph. Used by both styles. */
    icon?: LucideIcon
    /**
     * Makes the badge a control. Only supply this where the metric maps onto a
     * filter one-to-one — a count of *distinct* values (12 offices) has no single
     * value to filter to, and a badge that looks pressable but isn't is worse than
     * a plain one.
     */
    onClick?: () => void
    /** Renders the badge in its engaged state; pairs with `onClick`. */
    active?: boolean
  }[]
  /**
   * How `statBadges` render.
   * - "pill" (default) bordered chips, one per metric
   * - "line"           a single muted metadata row, icon + value + label, scrolling
   *                    horizontally on mobile rather than wrapping into a ragged
   *                    block. Preferred on lookup pages, where the metrics are
   *                    context rather than content and every row above the search
   *                    box costs a phone screen.
   */
  statBadgeStyle?: "pill" | "line"
  /** Vertical rhythm between page sections. See PageWrapper's `spacing`. */
  spacing?: "standard" | "responsive" | "compact" | "tight" | "none"
  /** Where header actions sit. See PageHeader's `actionsPlacement`. */
  actionsPlacement?: "inline" | "inline-always" | "below"
  children: ReactNode
}
