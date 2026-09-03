"use client"

import { useMemo, useState } from "react"
import { Brain, CheckCircle2, Clock3, Download, FileText, ShieldCheck, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { StatCard } from "@/components/ui/stat-card"
import { exportPmsRowsToExcel, exportPmsRowsToPdf } from "@/lib/pms/export"
import { toLocalISODate, formatWATDate } from "@/lib/utils/date"
import { CbtAttemptDetail } from "@/components/pms/cbt-attempt-detail"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ATTENDANCE_STATUS_LABELS, normalizeStoredAttendanceStatus } from "@/lib/hr/attendance-status"
import type { ReviewCycleOption } from "@/app/(app)/pms/_lib"
import { CycleSelector } from "@/app/(app)/pms/_components/cycle-selector"

type IconKey = "kpi" | "goals" | "attendance" | "cbt" | "behaviour" | "reviews"
type TableColumn = { key: string; label: string }
type TableRowData = Record<string, unknown> & { __rowId?: string }

interface PmsTablePageProps {
  title: string
  description: string
  backHref: string
  backLabel: string
  icon: IconKey
  tableTitle: string
  tableDescription: string
  rows: TableRowData[]
  columns: TableColumn[]
  searchPlaceholder?: string
  summaryCards?: Array<{ label: string; value: string | number }>
  filterKey?: string
  filterLabel?: string
  filterAllLabel?: string
  /**
   * Extra single-select filters, each driven by a row field. Used for the PMS
   * cadence filters (quarter / half / year), which are separate row values
   * rather than one column.
   */
  extraFilters?: { key: string; label: string; allLabel?: string }[]
  hideSecondaryFilter?: boolean
  cbtExpandable?: boolean
  headerActions?: React.ReactNode
  cycles?: ReviewCycleOption[]
  activeCycleId?: string | null
}

const iconMap = {
  kpi: Target,
  goals: CheckCircle2,
  attendance: Clock3,
  cbt: Brain,
  behaviour: ShieldCheck,
  reviews: FileText,
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "-"
  return String(value)
}

function renderStatusBadge(rawStatus: unknown) {
  if (rawStatus === null || rawStatus === undefined || rawStatus === "" || rawStatus === "-") return "-"
  const strStatus = String(rawStatus)
  const norm = normalizeStoredAttendanceStatus(strStatus)
  const label = (norm && ATTENDANCE_STATUS_LABELS[norm]) || strStatus

  let badgeClasses = "bg-muted text-muted-foreground border-muted-foreground/20"

  const s = strStatus.toLowerCase()
  if (s === "lwp" || s === "lateness_with_permission" || norm === "lateness_with_permission") {
    badgeClasses = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
  } else if (s === "iwp" || s === "incomplete_with_permission" || norm === "incomplete_with_permission") {
    badgeClasses = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
  } else if (
    s === "awp" ||
    s === "absence_with_permission" ||
    s === "absent_with_permission" ||
    norm === "absent_with_permission"
  ) {
    badgeClasses = "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
  } else if (s === "lewp" || s === "early_departure_with_permission" || norm === "early_departure_with_permission") {
    badgeClasses = "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20"
  } else if (s === "lwop" || s === "leave_without_pay" || norm === "lwop") {
    badgeClasses = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
  } else if (s === "present" || norm === "present") {
    badgeClasses = "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
  } else if (s === "early" || norm === "early") {
    badgeClasses = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
  } else if (s === "late" || norm === "late") {
    badgeClasses = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
  } else if (s === "incomplete" || norm === "incomplete") {
    badgeClasses = "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20"
  } else if (s === "absent" || norm === "absent") {
    badgeClasses = "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
  } else if (s === "on_leave" || norm === "on_leave") {
    badgeClasses = "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20"
  }

  return (
    <Badge className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold capitalize shadow-none", badgeClasses)}>
      {label}
    </Badge>
  )
}

export function PmsTablePage({
  title,
  description,
  backHref,
  backLabel,
  icon,
  tableTitle,
  tableDescription,
  rows,
  columns,
  searchPlaceholder = "Search records...",
  summaryCards = [],
  filterKey = "department",
  filterLabel = "Department",
  filterAllLabel = "All Departments",
  extraFilters,
  hideSecondaryFilter = false,
  cbtExpandable = false,
  headerActions,
  cycles,
  activeCycleId,
}: PmsTablePageProps) {
  const Icon = iconMap[icon]
  const [isExportOpen, setIsExportOpen] = useState(false)
  // Rows currently visible in the table (after search + filters + sort).
  const [processedRows, setProcessedRows] = useState<TableRowData[]>([])

  const tableColumns = useMemo<DataTableColumn<TableRowData>[]>(() => {
    return columns.map((column, index) => ({
      key: column.key,
      label: column.label,
      sortable: true,
      accessor: (row) => normalizeCell(row[column.key]),
      resizable: index < 2,
      initialWidth: index === 0 ? 220 : index === 1 ? 260 : undefined,
      hideOnMobile: index >= 3,
      render: (row) => {
        if (column.key === "status") {
          return renderStatusBadge(row.__rawStatus || row.status)
        }
        const value = normalizeCell(row[column.key])
        return index === 0 ? <span className="font-medium">{value}</span> : value
      },
    }))
  }, [columns])

  const secondaryFilterOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => normalizeCell(row[filterKey])).filter((value) => value !== "-"))).map(
        (value) => ({
          value,
          label: value,
        })
      ),
    [filterKey, rows]
  )

  const firstColumnKey = columns[0]?.key || filterKey
  const firstColumnLabel = columns[0]?.label || "Type"
  const firstColumnOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => normalizeCell(row[firstColumnKey])).filter((value) => value !== "-"))).map(
        (value) => ({
          value,
          label: value,
        })
      ),
    [firstColumnKey, rows]
  )

  const filters = useMemo<DataTableFilter<TableRowData>[]>(() => {
    const activeFilters: DataTableFilter<TableRowData>[] = []
    const hasCycles = Boolean(cycles && cycles.length > 0)

    if (hasCycles && cycles) {
      activeFilters.push({
        key: "cycle_selector",
        label: "Review Cycle",
        options: cycles.map((c) => ({ value: c.id, label: c.name })),
        render: () => <CycleSelector cycles={cycles} activeCycleId={activeCycleId} />,
      })
    }

    if (!hideSecondaryFilter && (!hasCycles || filterKey !== "cycle")) {
      activeFilters.push({
        key: filterKey,
        label: filterLabel,
        placeholder: filterAllLabel,
        options: secondaryFilterOptions,
        mode: "custom",
        filterFn: (row, selected) => {
          if (!selected || selected.length === 0 || selected.includes("all")) return true
          return selected.includes(normalizeCell(row[filterKey]))
        },
        multi: false,
      })
    }

    if (!hasCycles || firstColumnKey !== "cycle") {
      activeFilters.push({
        key: firstColumnKey,
        label: firstColumnLabel,
        placeholder: `All ${firstColumnLabel}`,
        options: firstColumnOptions,
        mode: "custom",
        filterFn: (row, selected) => {
          if (!selected || selected.length === 0 || selected.includes("all")) return true
          return selected.includes(normalizeCell(row[firstColumnKey]))
        },
        multi: false,
      })
    }

    for (const extra of extraFilters ?? []) {
      if (hasCycles && extra.key === "cycle") continue

      const options = Array.from(
        new Set(rows.map((row) => normalizeCell(row[extra.key])).filter((value) => value !== "-"))
      )
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((value) => ({ value, label: value }))

      activeFilters.push({
        key: extra.key,
        label: extra.label,
        placeholder: extra.allLabel || `All ${extra.label}`,
        options,
        mode: "custom",
        filterFn: (row, selected) => {
          if (!selected || selected.length === 0 || selected.includes("all")) return true
          return selected.includes(normalizeCell(row[extra.key]))
        },
        multi: false,
      })
    }

    return activeFilters
  }, [
    activeCycleId,
    cycles,
    extraFilters,
    rows,
    filterAllLabel,
    filterKey,
    filterLabel,
    firstColumnKey,
    firstColumnLabel,
    firstColumnOptions,
    secondaryFilterOptions,
    hideSecondaryFilter,
  ])

  // Export the rows currently visible in the table (respects search + filters + sort),
  // falling back to the full set before the table has reported its processed rows.
  const exportRows = useMemo(() => {
    const source = processedRows.length ? processedRows : rows
    return source.map((row, index) =>
      Object.fromEntries([
        ["S/N", index + 1],
        ...columns.map((column) => [column.label, normalizeCell(row[column.key])]),
      ])
    )
  }, [columns, rows, processedRows])

  const shouldRenderTaskExpansion = rows.some((row) => Array.isArray((row as { __tasks?: unknown }).__tasks))

  return (
    <DataTablePage
      title={title}
      description={description}
      icon={Icon}
      backLink={{ href: backHref, label: backLabel }}
      spacing="tight"
      actionsPlacement="inline-always"
      actions={
        <div className="flex items-center gap-2">
          {headerActions}
          <Button variant="outline" onClick={() => setIsExportOpen(true)} disabled={rows.length === 0} size="sm">
            <Download className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      }
      stats={
        summaryCards.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
            {summaryCards.map((card, index) => (
              <StatCard
                key={card.label}
                variant="compact"
                title={card.label}
                value={card.value}
                icon={Icon}
                iconBgColor={index === 0 ? "bg-blue-500/10" : index === 1 ? "bg-emerald-500/10" : "bg-amber-500/10"}
                iconColor={index === 0 ? "text-blue-500" : index === 1 ? "text-emerald-500" : "text-amber-500"}
              />
            ))}
          </div>
        ) : undefined
      }
    >
      <DataTable<TableRowData>
        data={rows.map((row, index) => ({ ...row, __rowId: `row-${index}-${normalizeCell(row[firstColumnKey])}` }))}
        columns={tableColumns}
        onProcessedDataChange={setProcessedRows}
        filters={filters}
        getRowId={(row) => row.__rowId || normalizeCell(row[firstColumnKey])}
        pagination={{ pageSize: 50 }}
        searchPlaceholder={searchPlaceholder}
        searchFn={(row, query) =>
          columns.some((column) => normalizeCell(row[column.key]).toLowerCase().includes(query))
        }
        stickyToolbar
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          title: (row) => normalizeCell(row[firstColumnKey]),
          subtitle: (row) => {
            const second = columns[1]?.key ? normalizeCell(row[columns[1].key]) : null
            const scoreCol = columns.find((c) => ["cbt_score", "score", "rating", "metric_value"].includes(c.key))
            const scoreVal = scoreCol ? normalizeCell(row[scoreCol.key]) : null
            const parts = [
              second && second !== "-" ? second : null,
              scoreVal && scoreVal !== "-" ? `${scoreCol?.label || "Score"}: ${scoreVal}` : null,
            ].filter(Boolean)
            return parts.length > 0 ? parts.join(" · ") : undefined
          },
          trailing: (row) => {
            const statusVal = row.__rawStatus || row.status
            const scoreCol = columns.find((c) => ["cbt_score", "score"].includes(c.key))
            const scoreVal = scoreCol ? normalizeCell(row[scoreCol.key]) : null
            const hasScore = Boolean(scoreVal && scoreVal !== "-")
            const hasStatus = Boolean(statusVal && statusVal !== "-")

            if (!hasScore && !hasStatus) return undefined

            return (
              <div className="flex flex-col items-end gap-1">
                {scoreVal && scoreVal !== "-" && (
                  <span className="text-foreground font-mono text-xs font-bold">
                    {scoreVal.includes("%") ? scoreVal : `${scoreVal}%`}
                  </span>
                )}
                {hasStatus ? renderStatusBadge(statusVal) : null}
              </div>
            )
          },
          detail: {
            title: (row) => normalizeCell(row[firstColumnKey]),
            fields: (row) =>
              columns.slice(1).map((col) => ({
                label: col.label,
                value:
                  col.key === "status" ? normalizeCell(row.__rawStatus || row.status) : normalizeCell(row[col.key]),
              })),
          },
        }}
        expandable={
          shouldRenderTaskExpansion
            ? {
                canExpand: (row) => Array.isArray((row as { __tasks?: unknown[] }).__tasks),
                render: (row) => {
                  const tasks =
                    (
                      row as {
                        __tasks?: Array<{
                          id: string
                          title: string
                          description?: string | null
                          status: string
                          dueDate?: string | null
                          assignmentType?: string | null
                          weight?: number | null
                          rating?: number | null
                        }>
                      }
                    ).__tasks || []
                  if (tasks.length === 0) {
                    return (
                      <p className="text-muted-foreground text-sm">No tasks in this group for the selected cycle.</p>
                    )
                  }

                  return (
                    <div className="space-y-3">
                      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                        Assigned Tasks
                      </p>
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Task</th>
                              <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Status</th>
                              <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Type</th>
                              <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">
                                Due Date
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Weight</th>
                              <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Rating</th>
                              <th className="px-3 py-2 text-left text-xs font-bold tracking-wide uppercase">Earned</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tasks.map((task) => (
                              <tr key={task.id} className="border-t">
                                <td className="px-3 py-2">
                                  <p className="font-medium">{task.title}</p>
                                  {task.description ? (
                                    <p className="text-muted-foreground text-xs">{task.description}</p>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 capitalize">{String(task.status || "").replace(/_/g, " ")}</td>
                                <td className="px-3 py-2 capitalize">
                                  {String(task.assignmentType || "department").replace(/_/g, " ")}
                                </td>
                                <td className="px-3 py-2">{task.dueDate ? formatWATDate(task.dueDate) : "-"}</td>
                                <td className="px-3 py-2">{task.weight ?? "-"}</td>
                                <td className="px-3 py-2">{task.rating ? `${task.rating}/5` : "Unrated"}</td>
                                <td className="px-3 py-2">
                                  {task.weight
                                    ? `${Math.round(((task.weight * (task.rating ?? 0)) / 5) * 100) / 100} / ${task.weight}`
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                },
              }
            : cbtExpandable
              ? {
                  canExpand: (row) => !!(row.user_id && row.review_cycle_id),
                  render: (row) => (
                    <CbtAttemptDetail profileId={row.user_id as string} reviewCycleId={row.review_cycle_id as string} />
                  ),
                }
              : undefined
        }
        emptyTitle={tableTitle}
        emptyDescription={tableDescription}
        emptyIcon={Icon}
        skeletonRows={5}
        viewToggle
        cardRenderer={(row) => {
          const firstVal = normalizeCell(row[firstColumnKey])
          const secondKey = columns[1]?.key
          const secondVal = secondKey ? normalizeCell(row[secondKey]) : null
          const statusVal = row.__rawStatus || row.status

          return (
            <div className="space-y-3 rounded-xl border p-3.5 sm:p-4">
              <div className="flex items-start justify-between gap-2 border-b pb-2">
                <div>
                  <span className="text-foreground block text-sm font-semibold">{firstVal}</span>
                  {secondVal && secondVal !== "-" && (
                    <span className="text-muted-foreground block text-xs">{secondVal}</span>
                  )}
                </div>
                {Boolean(statusVal && statusVal !== "-") && renderStatusBadge(statusVal)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {columns.slice(2).map((col) => {
                  if (col.key === "status") return null
                  const val = normalizeCell(row[col.key])
                  if (val === "-") return null
                  return (
                    <div key={col.key}>
                      <span className="text-muted-foreground block text-[10px] font-medium uppercase">{col.label}</span>
                      <span className="text-foreground font-medium">{val}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }}
        urlSync
      />

      <ExportOptionsDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        title={`Export ${title}`}
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
        ]}
        onSelect={(id) => {
          const filename = `${title.toLowerCase().replace(/\s+/g, "-")}-${toLocalISODate()}`
          if (id === "excel") {
            void exportPmsRowsToExcel(exportRows, filename)
            return
          }
          void exportPmsRowsToPdf(exportRows, filename, title)
        }}
      />
    </DataTablePage>
  )
}
