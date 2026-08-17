"use client"

import { useMemo } from "react"
import { ShieldCheck } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"

import type { ReviewCycleOption } from "../_lib"
import { CycleSelector } from "../_components/cycle-selector"

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

  const filters = useMemo<DataTableFilter<BehaviourRow>[]>(() => {
    const list: DataTableFilter<BehaviourRow>[] = []

    if (cycles && cycles.length > 0) {
      list.push({
        key: "cycle_selector",
        label: "Review Cycle",
        options: cycles.map((c) => ({ value: c.id, label: c.name })),
        render: () => <CycleSelector cycles={cycles} activeCycleId={activeCycleId} />,
      })
    }

    // The cycle selector above already scopes the page to one cycle; a second
    // single-option "Cycle" dropdown was just noise.
    list.push({
      key: "competency",
      label: "Competency",
      options: rows.map((row) => ({ value: row.competency, label: row.competency })),
    })

    return list
  }, [activeCycleId, cycles, rows])

  return (
    <DataTablePage
      title="PMS Behaviour"
      description="Your behaviour review by competency with manager notes."
      icon={ShieldCheck}
      backLink={{ href: "/pms", label: "Back to PMS" }}
      actions={headerActions}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
          <StatCard
            title="Competencies"
            value={rows.length}
            icon={ShieldCheck}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Average"
            value={average === null ? "-" : `${average}%`}
            icon={ShieldCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
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
        viewToggle
        cardRenderer={(row) => (
          <div className="space-y-3">
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
        expandable={{
          render: () => (
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-muted-foreground text-xs uppercase">Strengths</p>
                <p className="text-sm">{strengths || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase">Areas for Improvement</p>
                <p className="text-sm">{areasForImprovement || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase">Manager Comments</p>
                <p className="text-sm">{managerComments || "-"}</p>
              </div>
            </div>
          ),
        }}
        emptyTitle="No behaviour competencies"
        emptyDescription="No behaviour score entries available."
        emptyIcon={ShieldCheck}
        skeletonRows={5}
        urlSync
      />
    </DataTablePage>
  )
}
