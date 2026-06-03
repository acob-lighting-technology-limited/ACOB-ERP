"use client"

import { useMemo } from "react"
import { ShieldCheck } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"

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
}: {
  rows: Array<{ competency: string; value: number }>
  average: number | null
  cycle: string
  strengths: string
  areasForImprovement: string
  managerComments: string
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
      {
        key: "cycle",
        label: "Cycle",
        sortable: true,
        accessor: (row) => row.cycle,
        hideOnMobile: true,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<BehaviourRow>[]>(
    () => [
      {
        key: "cycle",
        label: "Cycle",
        options: [{ value: cycle || "-", label: cycle || "-" }],
        multi: false,
      },
      {
        key: "competency",
        label: "Competency",
        options: rows.map((row) => ({ value: row.competency, label: row.competency })),
      },
    ],
    [cycle, rows]
  )

  return (
    <DataTablePage
      title="PMS Behaviour"
      description="Your behaviour review by competency with manager notes."
      icon={ShieldCheck}
      backLink={{ href: "/pms", label: "Back to PMS" }}
      stats={
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
