"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Building2, Hash, Package, User } from "lucide-react"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { formatName } from "@/lib/utils"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import type { AssetAssignment } from "./page"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"

interface AssetsContentProps {
  initialAssignments: AssetAssignment[]
  initialError?: string | null
}

type AssetRow = AssetAssignment & {
  assignmentType: "Personal" | "Department" | "Office"
  assetTypeLabel: string
  statusLabel: string
}

export function AssetsContent({ initialAssignments, initialError }: AssetsContentProps) {
  const [assignments] = useState<AssetAssignment[]>(initialAssignments)

  useEffect(() => {
    if (initialError) toast.error(initialError)
  }, [initialError])

  const rows = useMemo<AssetRow[]>(
    () =>
      assignments.map((assignment) => {
        const assignmentType =
          assignment.id.startsWith("shared-") && assignment.asset?.assignment_type === "department"
            ? "Department"
            : assignment.id.startsWith("shared-") && assignment.asset?.assignment_type === "office"
              ? "Office"
              : "Personal"

        return {
          ...assignment,
          assignmentType,
          assetTypeLabel:
            ASSET_TYPE_MAP[assignment.asset?.asset_type || ""]?.label || assignment.asset?.asset_type || "-",
          statusLabel: assignment.asset?.status || "available",
        }
      }),
    [assignments]
  )

  const statusClass = (status: string) => {
    if (status === "assigned") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    if (status === "maintenance") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    if (status === "available") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }

  const assignmentTypeClass = (type: string) => {
    if (type === "Personal") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    if (type === "Department") return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400"
    if (type === "Office") return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
    return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }

  const columns = useMemo<DataTableColumn<AssetRow>[]>(
    () => [
      {
        key: "asset_type",
        label: "Asset",
        sortable: true,
        accessor: (row) => row.assetTypeLabel,
        resizable: true,
        initialWidth: 220,
        render: (row) => <span className="font-medium">{row.assetTypeLabel}</span>,
      },
      {
        key: "unique_code",
        label: "Unique Code",
        sortable: true,
        accessor: (row) => row.asset?.unique_code || "",
        render: (row) => (
          <div className="flex items-center gap-1.5">
            <Hash className="text-muted-foreground h-3.5 w-3.5" />
            <span className="font-mono text-sm">{row.asset?.unique_code || "-"}</span>
          </div>
        ),
      },
      {
        key: "asset_model",
        label: "Model",
        sortable: true,
        accessor: (row) => row.asset?.asset_model || "",
      },
      {
        key: "serial_number",
        label: "Serial",
        sortable: true,
        accessor: (row) => row.asset?.serial_number || "",
        hideOnMobile: true,
      },
      {
        key: "acquisition_year",
        label: "Year",
        sortable: true,
        accessor: (row) => row.asset?.acquisition_year || 0,
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.statusLabel,
        render: (row) => <Badge className={statusClass(row.statusLabel)}>{row.statusLabel}</Badge>,
      },
      {
        key: "assignmentType",
        label: "Assignment",
        sortable: true,
        accessor: (row) => row.assignmentType,
        render: (row) => <Badge className={assignmentTypeClass(row.assignmentType)}>{row.assignmentType}</Badge>,
      },
      {
        key: "assigned_at",
        label: "Assigned",
        sortable: true,
        accessor: (row) => row.assigned_at,
        render: (row) => formatWATDate(row.assigned_at, { day: "2-digit", month: "short", year: "numeric" }),
      },
    ],
    []
  )

  const assignmentTypeOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.assignmentType))).map((type) => ({
        value: type,
        label: type,
      })),
    [rows]
  )

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.statusLabel))).map((status) => ({
        value: status,
        label: status,
      })),
    [rows]
  )

  const assetTypeOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.assetTypeLabel))).map((assetType) => ({
        value: assetType,
        label: assetType,
      })),
    [rows]
  )

  const filters = useMemo<DataTableFilter<AssetRow>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: statusOptions,
      },
      {
        key: "assignmentType",
        label: "Assignment Type",
        options: assignmentTypeOptions,
      },
      {
        key: "asset_type",
        label: "Asset Type",
        options: assetTypeOptions,
      },
    ],
    [assignmentTypeOptions, assetTypeOptions, statusOptions]
  )

  return (
    <DataTablePage
      title="My Assets"
      description="View your currently assigned assets and equipment."
      icon={Package}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            title="Assigned Assets"
            value={rows.length}
            icon={Package}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Personal"
            value={rows.filter((row) => row.assignmentType === "Personal").length}
            icon={User}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Department"
            value={rows.filter((row) => row.assignmentType === "Department").length}
            icon={Building2}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Office"
            value={rows.filter((row) => row.assignmentType === "Office").length}
            icon={Package}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<AssetRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search asset name, code, model, serial, or assignment..."
        searchFn={(row, query) => {
          const q = query.toLowerCase()
          return (
            row.assetTypeLabel.toLowerCase().includes(q) ||
            String(row.asset?.unique_code || "")
              .toLowerCase()
              .includes(q) ||
            String(row.asset?.asset_model || "")
              .toLowerCase()
              .includes(q) ||
            String(row.asset?.serial_number || "")
              .toLowerCase()
              .includes(q) ||
            row.assignmentType.toLowerCase().includes(q) ||
            String(row.department || "")
              .toLowerCase()
              .includes(q) ||
            `${row.assigner?.first_name || ""} ${row.assigner?.last_name || ""}`.toLowerCase().includes(q)
          )
        }}
        emptyTitle="No assets found"
        emptyDescription={
          rows.length === 0 ? "You do not have any assets assigned yet." : "No assets match the current filters."
        }
        emptyIcon={Package}
        skeletonRows={6}
        viewToggle
        cardRenderer={(row) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{row.assetTypeLabel}</p>
                <p className="text-muted-foreground font-mono text-sm">{row.asset?.unique_code || "-"}</p>
              </div>
              <Badge className={assignmentTypeClass(row.assignmentType)}>{row.assignmentType}</Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge className={statusClass(row.statusLabel)}>{row.statusLabel}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Model</span>
                <span>{row.asset?.asset_model || "-"}</span>
              </div>
            </div>
          </div>
        )}
        expandable={{
          render: (row) => (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Serial:</span>{" "}
                  <span className="font-mono">{row.asset?.serial_number || "-"}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Acquisition Year:</span> {row.asset?.acquisition_year || "-"}
                </p>
                <p>
                  <span className="text-muted-foreground">Assigned:</span> {formatWATDateTime(row.assigned_at)}
                </p>
              </div>
              <div className="space-y-2 text-sm">
                {row.department ? (
                  <p>
                    <span className="text-muted-foreground">Department:</span> {row.department}
                  </p>
                ) : null}
                {row.assigner ? (
                  <p>
                    <span className="text-muted-foreground">Assigned By:</span>{" "}
                    {`${formatName(row.assigner.first_name)} ${formatName(row.assigner.last_name)}`}
                  </p>
                ) : null}
                <p>
                  <span className="text-muted-foreground">Notes:</span> {row.assignment_notes || "-"}
                </p>
              </div>
            </div>
          ),
        }}
        urlSync
      />
    </DataTablePage>
  )
}
