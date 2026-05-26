"use client"

import { Fragment, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Package,
  Edit,
  Trash2,
  User,
  Building2,
  Eye,
  History,
  Building,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Calendar,
  ClipboardList,
  MapPin,
} from "lucide-react"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { cn } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"

export type { Asset, UserProfile, Employee } from "@/app/admin/assets/admin-assets-content"
import type { Asset, UserProfile } from "@/app/admin/assets/admin-assets-content"

interface AssetListViewProps {
  assets: Asset[]
  viewMode: "list" | "card"
  userProfile: UserProfile
  isDeleting: boolean
  onEdit: (asset: Asset) => void
  onIssues: (asset: Asset) => void
  onHistory: (asset: Asset) => void
  onDelete: (asset: Asset) => void
  onRestore: (asset: Asset) => void
  getStatusColor: (status: string) => string
  getEffectiveAssignmentType: (asset: Asset) => string
  getAssignedPersonName: (asset: Asset) => string | null
  getCreatedByLabel: (createdBy: string) => string
  sortConfig: { key: string; direction: "asc" | "desc" } | null
  onSort: (key: string) => void
  hasActiveFilters: boolean
}

function SortIcon({
  columnKey,
  sortConfig,
}: {
  columnKey: string
  sortConfig: { key: string; direction: "asc" | "desc" } | null
}) {
  if (sortConfig?.key !== columnKey) {
    return <ArrowUpDown className="text-muted-foreground h-3 w-3" />
  }

  return sortConfig.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

export function AssetListView({
  assets,
  viewMode,
  userProfile,
  isDeleting,
  onEdit,
  onIssues,
  onHistory,
  onDelete,
  onRestore,
  getStatusColor,
  getEffectiveAssignmentType,
  getAssignedPersonName,
  getCreatedByLabel,
  sortConfig,
  onSort,
  hasActiveFilters,
}: AssetListViewProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const toggleRow = (assetId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  if (assets.length === 0) {
    return (
      <Card className="border-2">
        <CardContent className="p-12 text-center">
          <Package className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
          <h3 className="text-foreground mb-2 text-xl font-semibold">No Assets Found</h3>
          <p className="text-muted-foreground">
            {hasActiveFilters ? "No assets match your filters" : "Get started by adding your first asset"}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (viewMode === "list") {
    return (
      <Card className="border-2">
        <div className="table-responsive">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead className="text-foreground w-12 font-bold">#</TableHead>
                <TableHead
                  className="text-foreground hover:bg-muted/50 cursor-pointer font-bold select-none"
                  onClick={() => onSort("unique_code")}
                >
                  <div className="flex items-center gap-2">
                    Unique Code
                    <SortIcon columnKey="unique_code" sortConfig={sortConfig} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-foreground hover:bg-muted/50 cursor-pointer font-bold select-none"
                  onClick={() => onSort("asset_type")}
                >
                  <div className="flex items-center gap-2">
                    Asset Type
                    <SortIcon columnKey="asset_type" sortConfig={sortConfig} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-foreground hover:bg-muted/50 cursor-pointer font-bold select-none"
                  onClick={() => onSort("model")}
                >
                  <div className="flex items-center gap-2">
                    Model / Serial
                    <SortIcon columnKey="model" sortConfig={sortConfig} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-foreground hover:bg-muted/50 cursor-pointer font-bold select-none"
                  onClick={() => onSort("year")}
                >
                  <div className="flex items-center gap-2">
                    Year
                    <SortIcon columnKey="year" sortConfig={sortConfig} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-foreground hover:bg-muted/50 cursor-pointer font-bold select-none"
                  onClick={() => onSort("status")}
                >
                  <div className="flex items-center gap-2">
                    Status
                    <SortIcon columnKey="status" sortConfig={sortConfig} />
                  </div>
                </TableHead>
                <TableHead
                  className="text-foreground hover:bg-muted/50 cursor-pointer font-bold select-none"
                  onClick={() => onSort("assigned_to")}
                >
                  <div className="flex items-center gap-2">
                    Assigned To
                    <SortIcon columnKey="assigned_to" sortConfig={sortConfig} />
                  </div>
                </TableHead>
                <TableHead className="text-foreground w-[120px] text-right font-bold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset, index) => {
                const isExpanded = expandedRows.has(asset.id)
                const assignmentType = getEffectiveAssignmentType(asset)
                const assignedPersonName = getAssignedPersonName(asset)
                const assignedDepartment = asset.current_assignment?.department || asset.department || "-"
                const assignedOffice = asset.current_assignment?.office_location || asset.office_location || "-"
                const notes = asset.notes?.trim() || "No notes added for this asset."
                const createdOn = asset.created_at ? formatWATDate(asset.created_at) : "-"
                const isAssignedLike =
                  asset.status === "assigned" || asset.status === "retired" || asset.status === "maintenance"

                return (
                  <Fragment key={asset.id}>
                    <TableRow
                      className={cn("hover:bg-muted/30 cursor-pointer transition-colors", isExpanded && "bg-muted/30")}
                      onClick={() => toggleRow(asset.id)}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="text-muted-foreground h-4 w-4" />
                        ) : (
                          <ChevronRight className="text-muted-foreground h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-foreground font-mono text-xs font-medium">{asset.unique_code}</span>
                          {(asset.unresolved_issues_count ?? 0) > 0 && (
                            <div className="flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 dark:bg-orange-900/30">
                              <AlertCircle className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                              <span className="text-[10px] font-medium text-orange-700 dark:text-orange-300">
                                {asset.unresolved_issues_count}
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-foreground text-sm font-medium">
                          {ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type}
                        </div>
                      </TableCell>
                      <TableCell>
                        {asset.asset_model || asset.serial_number ? (
                          <div className="text-sm">
                            {asset.asset_model && <div className="text-foreground">{asset.asset_model}</div>}
                            {asset.serial_number && (
                              <div className="text-muted-foreground font-mono text-xs">{asset.serial_number}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-foreground text-sm">{asset.acquisition_year}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(asset.deleted_at ? "archived" : asset.status)}>
                          {asset.deleted_at ? "archived" : asset.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isAssignedLike ? (
                          assignmentType === "office" ? (
                            <div className="flex items-center gap-2 text-sm">
                              <Building className="text-muted-foreground h-3 w-3" />
                              <span className="text-foreground">
                                {asset.current_assignment?.office_location || asset.office_location || "Office"}
                              </span>
                              {(asset.status === "retired" || asset.status === "maintenance") && (
                                <span className="text-muted-foreground text-xs">({asset.status})</span>
                              )}
                            </div>
                          ) : asset.current_assignment ? (
                            (assignmentType === "individual" || asset.current_assignment.assigned_to) &&
                            assignedPersonName ? (
                              <div className="flex items-center gap-2 text-sm">
                                <User className="text-muted-foreground h-3 w-3" />
                                <span className="text-foreground">{assignedPersonName}</span>
                                {(asset.status === "retired" || asset.status === "maintenance") && (
                                  <span className="text-muted-foreground text-xs">({asset.status})</span>
                                )}
                              </div>
                            ) : assignmentType === "department" && asset.current_assignment.department ? (
                              <div className="flex items-center gap-2 text-sm">
                                <Building2 className="text-muted-foreground h-3 w-3" />
                                <span className="text-foreground">{asset.current_assignment.department}</span>
                                {(asset.status === "retired" || asset.status === "maintenance") && (
                                  <span className="text-muted-foreground text-xs">({asset.status})</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">Assigned</span>
                            )
                          ) : (
                            <span className="text-muted-foreground text-sm">Unassigned</span>
                          )
                        ) : asset.status === "available" ? (
                          assignedPersonName ? (
                            <div className="flex items-center gap-2 text-sm opacity-70">
                              <History className="text-muted-foreground h-3 w-3" />
                              <span className="text-muted-foreground italic">Last: {assignedPersonName}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm italic">Available</span>
                          )
                        ) : (
                          <span className="text-muted-foreground text-sm">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-nowrap items-center justify-end gap-1 sm:gap-2">
                          {!userProfile?.is_department_lead && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onEdit(asset)}
                              disabled={Boolean(asset.deleted_at)}
                              title={
                                asset.deleted_at
                                  ? "Archived asset cannot be edited until restored"
                                  : asset.status === "assigned" && asset.current_assignment
                                    ? "Edit or Reassign Asset"
                                    : "Edit Asset"
                              }
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onIssues(asset)}
                            title={`Asset Issues (${asset.unresolved_issues_count || 0} unresolved)`}
                            className={`h-8 w-8 p-0 ${(asset.unresolved_issues_count || 0) > 0 ? "border-orange-500 text-orange-600" : ""}`}
                          >
                            <AlertCircle className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onHistory(asset)}
                            title="View assignment history"
                            className="h-8 w-8 p-0"
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          {!userProfile?.is_department_lead && asset.deleted_at ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onRestore(asset)}
                              title="Restore asset"
                              className="h-8 w-8 p-0 text-green-700 hover:text-green-800"
                              loading={isDeleting}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
                          ) : !userProfile?.is_department_lead ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onDelete(asset)}
                              title="Archive asset"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/10 hover:bg-muted/10 border-t-0">
                        <TableCell colSpan={9} className="p-0">
                          <div className="animate-in slide-in-from-top-2 grid grid-cols-1 gap-4 p-6 duration-200 md:grid-cols-3">
                            <div className="space-y-3 rounded-lg border bg-white/60 p-4 dark:bg-slate-950/40">
                              <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-blue-600 uppercase">
                                <Package className="h-3.5 w-3.5" />
                                Asset Overview
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Type</span>
                                  <span className="text-foreground text-right font-medium">
                                    {ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Model</span>
                                  <span className="text-foreground text-right font-medium">
                                    {asset.asset_model || "-"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Serial Number</span>
                                  <span className="text-foreground text-right font-mono text-xs">
                                    {asset.serial_number || "-"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Year</span>
                                  <span className="text-foreground font-medium">{asset.acquisition_year}</span>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3 rounded-lg border bg-white/60 p-4 dark:bg-slate-950/40">
                              <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-emerald-600 uppercase">
                                <ClipboardList className="h-3.5 w-3.5" />
                                Assignment Snapshot
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Assignment Type</span>
                                  <span className="text-foreground text-right font-medium capitalize">
                                    {isAssignedLike ? assignmentType : "unassigned"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Assigned Person</span>
                                  <span className="text-foreground text-right font-medium">
                                    {assignedPersonName || "-"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Department</span>
                                  <span className="text-foreground text-right font-medium">{assignedDepartment}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Office</span>
                                  <span className="text-foreground text-right font-medium">{assignedOffice}</span>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3 rounded-lg border bg-white/60 p-4 dark:bg-slate-950/40">
                              <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-amber-600 uppercase">
                                <Calendar className="h-3.5 w-3.5" />
                                Record Details
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Created</span>
                                  <span className="text-foreground font-medium">{createdOn}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Created By</span>
                                  <span className="text-foreground text-right font-medium">
                                    {getCreatedByLabel(asset.created_by)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Issue Count</span>
                                  <span className="text-foreground font-medium">
                                    {asset.unresolved_issues_count || 0}
                                  </span>
                                </div>
                                <div className="flex items-start gap-2 pt-1">
                                  <MapPin className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <p className="text-foreground/85 text-sm leading-relaxed">{notes}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <Card key={asset.id} className="border-2 transition-shadow hover:shadow-lg">
          <CardHeader className="from-primary/5 to-background border-b bg-linear-to-r">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 rounded-lg p-2">
                  <Package className="text-primary h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="font-mono text-sm">{asset.unique_code}</CardTitle>
                    {(asset.unresolved_issues_count ?? 0) > 0 && (
                      <div className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 dark:bg-orange-900/30">
                        <AlertCircle className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                        <span className="text-xs font-medium text-orange-700 dark:text-orange-300">
                          {asset.unresolved_issues_count || 0} issue
                          {(asset.unresolved_issues_count || 0) > 1 ? "s" : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Status:</span>
              <Badge className={getStatusColor(asset.deleted_at ? "archived" : asset.status)}>
                {asset.deleted_at ? "archived" : asset.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Year:</span>
              <span className="text-foreground text-sm font-medium">{asset.acquisition_year}</span>
            </div>
            {asset.asset_model && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Model:</span>
                <span className="text-foreground text-sm">{asset.asset_model}</span>
              </div>
            )}
            {asset.serial_number && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Serial:</span>
                <span className="text-foreground font-mono text-sm">{asset.serial_number}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Assigned To:</span>
              {asset.status === "assigned" || asset.status === "retired" || asset.status === "maintenance" ? (
                getEffectiveAssignmentType(asset) === "office" ? (
                  <div className="flex items-center gap-2">
                    <Building className="text-muted-foreground h-3 w-3" />
                    <span className="text-foreground text-sm font-medium">
                      {asset.current_assignment?.office_location || asset.office_location || "Office"}
                    </span>
                    {asset.status === "retired" && <span className="text-muted-foreground text-xs">(retired)</span>}
                    {asset.status === "maintenance" && (
                      <span className="text-muted-foreground text-xs">(maintenance)</span>
                    )}
                  </div>
                ) : asset.current_assignment ? (
                  getEffectiveAssignmentType(asset) === "department" && asset.current_assignment.department ? (
                    <div className="flex items-center gap-2">
                      <Building2 className="text-muted-foreground h-3 w-3" />
                      <span className="text-foreground text-sm font-medium">{asset.current_assignment.department}</span>
                      {asset.status === "retired" && <span className="text-muted-foreground text-xs">(retired)</span>}
                      {asset.status === "maintenance" && (
                        <span className="text-muted-foreground text-xs">(maintenance)</span>
                      )}
                    </div>
                  ) : getAssignedPersonName(asset) ? (
                    <div className="flex items-center gap-2">
                      <User className="text-muted-foreground h-3 w-3" />
                      <span className="text-foreground text-sm font-medium">{getAssignedPersonName(asset)}</span>
                      {asset.status === "retired" && <span className="text-muted-foreground text-xs">(retired)</span>}
                      {asset.status === "maintenance" && (
                        <span className="text-muted-foreground text-xs">(maintenance)</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">Assigned</span>
                  )
                ) : (
                  <span className="text-muted-foreground text-sm">Unassigned</span>
                )
              ) : (
                <span className="text-muted-foreground text-sm">Unassigned</span>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              {!userProfile?.is_department_lead && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(asset)}
                  disabled={Boolean(asset.deleted_at)}
                  title={
                    asset.deleted_at
                      ? "Archived asset cannot be edited until restored"
                      : asset.status === "assigned" && asset.current_assignment
                        ? "Edit or Reassign Asset"
                        : "Edit Asset"
                  }
                  className="flex-1 gap-2"
                >
                  <Edit className="h-3 w-3" />
                  Edit
                </Button>
              )}
              {!userProfile?.is_department_lead && asset.deleted_at ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRestore(asset)}
                  title="Restore Asset"
                  className="text-green-700 hover:text-green-800"
                  loading={isDeleting}
                >
                  <CheckCircle2 className="h-3 w-3" />
                </Button>
              ) : !userProfile?.is_department_lead ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDelete(asset)}
                  title="Archive Asset"
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onIssues(asset)}
                title={`Asset Issues (${asset.unresolved_issues_count || 0} unresolved)`}
                className={`${(asset.unresolved_issues_count || 0) > 0 ? "border-orange-500 text-orange-600" : ""}`}
              >
                <AlertCircle className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => onHistory(asset)} title="View assignment history">
                <Eye className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
