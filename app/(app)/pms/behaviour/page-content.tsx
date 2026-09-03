"use client"

import { useMemo } from "react"
import { ShieldCheck } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"

import type { ReviewCycleOption } from "../_lib"
import { useCycleUrlFilters } from "../_components/cycle-selector"

type BehaviourRow = {
  competency: string
  value: number
  cycle: string
}

export function BehaviourContent({
  rows,
  average,
  cycle,
  strengths,
  areasForImprovement,
  managerComments,
  headerActions,
  cycles,
  activeCycleId,
}: {
  rows: Array<{ competency: string; value: number }>
  average: number | null
  cycle: string
  strengths: string
  areasForImprovement: string
  managerComments: string
  headerActions?: React.ReactNode
  cycles?: ReviewCycleOption[]
  activeCycleId?: string | null
}) {
  const tableRows = useMemo<BehaviourRow[]>(
    () =>
      rows.map((row) => ({
        ...row,
        cycle: cycle || "-",
      })),
    [cycle, rows]
  )

  const columns = useMemo<DataTableColumn<BehaviourRow>[]>(
    () => [
      {
        key: "cycle",
        label: "Cycle",
        sortable: true,
        accessor: (row) => row.cycle,
      },
      {
        key: "competency",
        label: "Competency",
        sortable: true,
        accessor: (row) => row.competency,
        render: (row) => <span className="font-medium">{row.competency}</span>,
      },
      {
        key: "value",
        label: "Score",
        sortable: true,
        accessor: (row) => row.value,
        render: (row) => `${row.value}%`,
      },
    ],
    []
  )

  const cycleFilters = useCycleUrlFilters<BehaviourRow>({ cycles, activeCycleId })

  const filters = useMemo<DataTableFilter<BehaviourRow>[]>(() => {
    const list: DataTableFilter<BehaviourRow>[] = []

    if (cycles && cycles.length > 0) {
      list.push(...cycleFilters)
    }

    // The cycle selector above already scopes the page to one cycle; a second
    // single-option "Cycle" dropdown was just noise.
    list.push({
      key: "competency",
      label: "Competency",
      options: rows.map((row) => ({ value: row.competency, label: row.competency })),
    })

    return list
  }, [cycleFilters, cycles, rows])

  return (
    <DataTablePage
      title="PMS Behaviour"
      description="Your behaviour review by competency with manager notes."
      icon={ShieldCheck}
      backLink={{ href: "/pms", label: "Back to PMS" }}
      spacing="tight"
      actions={headerActions}
      stats={
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatCard
            variant="compact"
            title="Competencies"
            value={rows.length}
            icon={ShieldCheck}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Average"
            value={average === null ? "-" : `${average}%`}
            icon={ShieldCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Comments"
            value={[strengths, areasForImprovement, managerComments].filter(Boolean).length}
            icon={ShieldCheck}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<BehaviourRow>
        data={tableRows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.competency}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search competency..."
        searchFn={(row, query) => row.competency.toLowerCase().includes(query)}
        stickyToolbar
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          title: (row) => row.competency,
          subtitle: (row) => row.cycle,
          trailing: (row) => (
            <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">{row.value}%</span>
          ),
          detail: {
            title: (row) => row.competency,
            fields: (_row) => [
              { label: "Strengths", value: strengths || "-" },
              { label: "Areas for Improvement", value: areasForImprovement || "-" },
              { label: "Manager Comments", value: managerComments || "-" },
            ],
          },
        }}
        viewToggle
        cardRenderer={(row) => (
          <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{row.competency}</span>
              <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">{row.value}%</span>
            </div>
            <div className="border-border/40 text-muted-foreground flex items-center justify-between border-t pt-2 text-xs">
              <span>Cycle</span>
              <span>{row.cycle}</span>
            </div>
          </div>
        )}
        emptyTitle="No behaviour competencies"
        emptyDescription="No behaviour score entries available."
        emptyIcon={ShieldCheck}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
