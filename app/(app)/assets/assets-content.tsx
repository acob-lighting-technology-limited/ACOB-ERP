"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Building2, Hash, Package, User, Wrench, Layers, CalendarDays, FileText, Barcode } from "lucide-react"
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
        return {
          ...assignment,
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
        key: "assigned_at",
        label: "Assigned",
        sortable: true,
        accessor: (row) => row.assigned_at,
        render: (row) => formatWATDate(row.assigned_at, { day: "2-digit", month: "short", year: "numeric" }),
      },
    ],
    []
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
        key: "asset_type",
        label: "Asset Type",
        options: assetTypeOptions,
      },
    ],
    [assetTypeOptions, statusOptions]
  )

  const activeCount = useMemo(
    () => rows.filter((r) => r.statusLabel === "assigned" || r.statusLabel === "active").length,
    [rows]
  )
  const maintenanceCount = useMemo(() => rows.filter((r) => r.statusLabel === "maintenance").length, [rows])
  const uniqueTypesCount = useMemo(() => new Set(rows.map((r) => r.assetTypeLabel)).size, [rows])

  return (
    <DataTablePage
      title="My Assets"
      description="View your currently assigned personal assets and equipment."
      icon={Package}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      spacing="tight"
      statBadgeStyle="line"
      statBadges={[
        { icon: Package, label: `${rows.length} assets` },
        { icon: User, label: `${activeCount} active` },
        ...(maintenanceCount > 0 ? [{ icon: Wrench, label: `${maintenanceCount} in maintenance` }] : []),
        { icon: Layers, label: `${uniqueTypesCount} ${uniqueTypesCount === 1 ? "type" : "types"}` },
      ]}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Total Personal Assets"
            value={rows.length}
            icon={Package}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Active"
            value={activeCount}
            icon={User}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          {/* Only when something is actually in the workshop — matches its badge. */}
          {maintenanceCount > 0 && (
            <StatCard
              variant="compact"
              title="In Maintenance"
              value={maintenanceCount}
              icon={Wrench}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
          )}
          <StatCard
            variant="compact"
            title="Asset Types"
            value={uniqueTypesCount}
            icon={Layers}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
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
        searchPlaceholder="Search asset name, code, model, or serial..."
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
        stickyToolbar
        viewToggle
        contactsView
        // Seven columns of asset identifiers: a table where they fit, the row
        // list where they do not.
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (row) => (row.statusLabel === "maintenance" ? "bg-amber-500" : undefined),
          title: (row) => row.assetTypeLabel,
          subtitle: (row) =>
            [row.asset?.unique_code, row.asset?.asset_model].filter(Boolean).join(" · ") || "No code recorded",
          trailing: (row) => <Badge className={`${statusClass(row.statusLabel)} text-[10px]`}>{row.statusLabel}</Badge>,
          detail: {
            title: (row) => row.assetTypeLabel,
            subtitle: (row) => (
              <span className="text-muted-foreground font-mono text-xs">{row.asset?.unique_code || "No code"}</span>
            ),
            badges: (row) => <Badge className={`${statusClass(row.statusLabel)} text-[10px]`}>{row.statusLabel}</Badge>,
            // Everything the removed expandable row carried. The serial and code
            // are the values you are asked for when reporting a fault, so they
            // are tap-to-copy rather than something to read out.
            fields: (row) => [
              { icon: Hash, label: "Unique code", value: row.asset?.unique_code, copyable: true },
              { icon: Package, label: "Model", value: row.asset?.asset_model },
              { icon: Barcode, label: "Serial number", value: row.asset?.serial_number, copyable: true },
              {
                icon: CalendarDays,
                label: "Acquisition year",
                value: row.asset?.acquisition_year ? String(row.asset.acquisition_year) : null,
                copyable: false,
              },
              {
                icon: CalendarDays,
                label: "Assigned",
                value: formatWATDateTime(row.assigned_at),
                copyable: false,
              },
              { icon: Building2, label: "Department", value: row.department },
              {
                icon: User,
                label: "Assigned by",
                value: row.assigner
                  ? `${formatName(row.assigner.first_name)} ${formatName(row.assigner.last_name)}`
                  : null,
              },
              { icon: FileText, label: "Notes", value: row.assignment_notes, copyable: true },
            ],
          },
        }}
        cardRenderer={(row) => (
          <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{row.assetTypeLabel}</p>
                <p className="text-muted-foreground font-mono text-sm">{row.asset?.unique_code || "-"}</p>
              </div>
              <Badge className={statusClass(row.statusLabel)}>{row.statusLabel}</Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Model</span>
                <span>{row.asset?.asset_model || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Serial</span>
                <span className="font-mono">{row.asset?.serial_number || "-"}</span>
              </div>
            </div>
          </div>
        )}
        urlSync
      />
    </DataTablePage>
  )
}
