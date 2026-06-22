"use client"

import { useMemo, useState, useCallback } from "react"
import { ScrollText, Download, Eye, FileText, Plus, Pencil, Trash2, Copy } from "lucide-react"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AuditLogDetailPanel } from "@/components/audit/AuditLogDetailPanel"
import { exportAuditLogsToExcel, exportAuditLogsToPDF, exportAuditLogsToWord } from "@/lib/audit/audit-log-export"
import {
  HIDDEN_ACTIONS,
  VISIBLE_AUDIT_ACTIONS,
  getAuditLogSummary,
  getAuditSource,
  getDepartmentLocation,
  getObjectIdentifier,
  getPerformedBy,
  getTargetDescription,
  getAuditChangedFields,
  getAuditChangedFieldsDisplay,
} from "@/lib/audit/audit-log-display"
import { getAuditActionColor } from "@/lib/audit/action-colors"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import type { AuditLog, EmployeeMember, UserProfile } from "./types"
import { formatName } from "@/lib/utils"

export type { AuditLog, EmployeeMember, UserProfile }

interface AdminAuditLogsContentProps {
  initialLogs: AuditLog[]
  initialTotalCount: number
  initialemployee: EmployeeMember[]
  initialDepartments: string[]
  userProfile: UserProfile
}

export function AdminAuditLogsContent({
  initialLogs,
  initialTotalCount,
  initialemployee,
  initialDepartments,
  userProfile,
}: AdminAuditLogsContentProps) {
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)

  const handleCopyEntry = useCallback(async (r: AuditLog) => {
    const userName = r.user ? `${r.user.first_name} ${r.user.last_name}` : "System"
    const summary = getAuditLogSummary(r)
    const text = `[${new Date(r.created_at).toLocaleString("en-US", { timeZone: "Africa/Lagos" })}] ${r.action.toUpperCase()} ${r.entity_type} — ${summary} (by ${userName})`
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Entry copied")
    } catch {
      toast.error("Failed to copy")
    }
  }, [])

  const scopedDepartments = useMemo(
    () => userProfile.managed_departments ?? userProfile.lead_departments ?? [],
    [userProfile.managed_departments, userProfile.lead_departments]
  )

  const filteredData = useMemo(() => {
    return initialLogs.filter((l) => {
      // 1. Hide system-level / hidden actions
      const action = (l.action || "unknown").toLowerCase()
      if (HIDDEN_ACTIONS.includes(action as (typeof HIDDEN_ACTIONS)[number])) return false

      // 2. Department scoping for leads
      if (userProfile?.managed_departments || userProfile?.lead_departments) {
        if (scopedDepartments.length > 0) {
          const auditDept = getDepartmentLocation(l)
          const actorDept = l.user?.department || initialemployee.find((s) => s.id === l.user_id)?.department
          const targetDept = l.target_user?.department
          const candidates = [auditDept, actorDept, targetDept].filter(Boolean)
          if (!candidates.some((dept) => scopedDepartments.includes(String(dept)))) return false
        }
      }

      return true
    })
  }, [initialLogs, initialemployee, userProfile, scopedDepartments])

  const stats = useMemo(
    () => ({
      total: initialTotalCount,
      creates: filteredData.filter((l) => l.action === "create").length,
      updates: filteredData.filter((l) => l.action === "update").length,
      deletes: filteredData.filter((l) => l.action === "delete").length,
    }),
    [filteredData, initialTotalCount]
  )

  const columns: DataTableColumn<AuditLog>[] = useMemo(
    () => [
      {
        key: "created_at",
        label: "Time",
        sortable: true,
        accessor: (r) => r.created_at,
        hideOnMobile: true,
        render: (r) => (
          <div className="flex flex-col text-xs">
            <span className="font-medium">
              {new Date(r.created_at).toLocaleDateString("en-US", {
                timeZone: "Africa/Lagos",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="text-muted-foreground">
              {new Date(r.created_at).toLocaleTimeString("en-US", {
                timeZone: "Africa/Lagos",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ),
      },
      {
        key: "action",
        label: "Action",
        sortable: true,
        accessor: (r) => r.action || "update",
        render: (r) => (
          <Badge className={getAuditActionColor(r.action || "update")}>{formatName(r.action || "update")}</Badge>
        ),
      },
      {
        key: "entity_type",
        label: "Module",
        sortable: true,
        accessor: (r) => r.entity_type,
        render: (r) => (
          <Badge variant="outline" className="font-normal capitalize">
            {r.entity_type.replace("_", " ")}
          </Badge>
        ),
      },
      {
        key: "user",
        label: "Performed By",
        resizable: true,
        initialWidth: 200,
        accessor: (r) => getPerformedBy(r),
        render: (r) => (
          <div className="flex items-center gap-2">
            <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold">
              {r.user ? r.user.first_name.charAt(0) : "S"}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {r.user ? `${r.user.first_name} ${r.user.last_name}` : "System"}
              </span>
              {r.user?.company_email && (
                <span className="text-muted-foreground text-[10px]">{r.user.company_email}</span>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "target",
        label: "Target",
        resizable: true,
        initialWidth: 190,
        accessor: (r) => getTargetDescription(r),
        render: (r) => <span className="block max-w-[190px] truncate text-sm">{getTargetDescription(r)}</span>,
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        resizable: true,
        initialWidth: 170,
        accessor: (r) => getDepartmentLocation(r),
        render: (r) => <span className="block max-w-[170px] truncate text-sm">{getDepartmentLocation(r)}</span>,
      },
    ],
    []
  )

  const entityTypes = useMemo(() => Array.from(new Set(initialLogs.map((l) => l.entity_type))).sort(), [initialLogs])

  const filters: DataTableFilter<AuditLog>[] = useMemo(
    () => [
      {
        key: "action",
        label: "Action",
        options: [...VISIBLE_AUDIT_ACTIONS],
      },
      {
        key: "entity_type",
        label: "Module",
        options: entityTypes.map((t) => ({ value: t, label: formatName(t) })),
      },
      {
        key: "department",
        label: "Department",
        options: initialDepartments.map((d) => ({ value: d, label: d })),
        mode: "custom",
        filterFn: (row, vals) => {
          if (vals.length === 0) return true
          const actorDept = row.user?.department || initialemployee.find((e) => e.id === row.user_id)?.department
          const targetDept = row.target_user?.department
          const auditDept = getDepartmentLocation(row)
          return [auditDept, actorDept, targetDept].some((dept) => !!dept && vals.includes(String(dept)))
        },
      },
    ],
    [entityTypes, initialDepartments, initialemployee]
  )

  return (
    <DataTablePage
      title="Audit Logs"
      description="Comprehensive system activity trail for security and transparency."
      icon={ScrollText}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => setExportOptionsOpen(true)}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total logs"
            value={stats.total}
            icon={ScrollText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Creates"
            value={stats.creates}
            icon={Plus}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Updates"
            value={stats.updates}
            icon={Pencil}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Deletes"
            value={stats.deletes}
            icon={Trash2}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <DataTable<AuditLog>
        data={filteredData}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search action, module, user or summary..."
        searchFn={(r, q) => {
          const summary = getAuditLogSummary(r)
          return [
            r.action,
            r.entity_type,
            getPerformedBy(r),
            getTargetDescription(r),
            getObjectIdentifier(r),
            getDepartmentLocation(r),
            getAuditSource(r),
            summary,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
        }}
        filters={filters}
        pagination={{ pageSize: 50 }}
        rowActions={[
          {
            label: "View Details",
            icon: Eye,
            onClick: (r) => {
              setSelectedLog(r)
              setIsDetailsOpen(true)
            },
          },
          {
            label: "Copy Entry",
            icon: Copy,
            onClick: handleCopyEntry,
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 space-y-6 border-t p-6">
              <div className="space-y-2">
                <h4 className="text-muted-foreground text-[10px] font-black tracking-widest uppercase">Log Summary</h4>
                <p className="text-sm font-medium">{getAuditLogSummary(r)}</p>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="space-y-2">
                  <h4 className="text-muted-foreground text-[10px] font-black tracking-widest uppercase">
                    Entity & Object Details
                  </h4>
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground mr-2 font-medium">Type:</span>{" "}
                      <span className="capitalize">{r.entity_type}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground mr-2 font-medium">ID:</span>{" "}
                      <span className="font-mono text-xs">{r.entity_id || "—"}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground mr-2 font-medium">Object:</span>{" "}
                      <span>{getObjectIdentifier(r)}</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-muted-foreground text-[10px] font-black tracking-widest uppercase">
                    Origin & Source
                  </h4>
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground mr-2 font-medium">Source:</span>{" "}
                      <span>{getAuditSource(r)}</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-muted-foreground text-[10px] font-black tracking-widest uppercase">
                    Change Details
                  </h4>
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground mr-2 font-medium">Fields Changed:</span>{" "}
                      <span>{getAuditChangedFields(r).length}</span>
                    </p>
                    <p className="text-muted-foreground text-xs">{getAuditChangedFieldsDisplay(r)}</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedLog(r)
                    setIsDetailsOpen(true)
                  }}
                  className="gap-2"
                >
                  <FileText className="h-4 w-4" /> Comprehensive View
                </Button>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(r) => (
          <div
            className="bg-card group relative cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md"
            onClick={() => {
              setSelectedLog(r)
              setIsDetailsOpen(true)
            }}
          >
            <div className="mb-2 flex items-start justify-between">
              <Badge className={getAuditActionColor(r.action || "update")}>{formatName(r.action || "update")}</Badge>
              <span className="text-muted-foreground font-mono text-[10px]">
                {new Date(r.created_at).toLocaleTimeString("en-US", {
                  timeZone: "Africa/Lagos",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <h4 className="truncate text-sm font-semibold">{getAuditLogSummary(r)}</h4>
            <div className="mt-3 flex items-center gap-2 border-t pt-3">
              <div className="bg-muted flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold">
                {r.user ? r.user.first_name.charAt(0) : "S"}
              </div>
              <span className="text-muted-foreground truncate text-xs">
                {r.user ? `${r.user.first_name} ${r.user.last_name}` : "System"}
              </span>
              <div className="ml-auto">
                <Badge variant="outline" className="text-[9px] font-normal uppercase">
                  {r.entity_type}
                </Badge>
              </div>
            </div>
          </div>
        )}
        urlSync
      />

      <AuditLogDetailPanel log={selectedLog} open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} />

      <ExportOptionsDialog
        open={exportOptionsOpen}
        onOpenChange={setExportOptionsOpen}
        title="Export Audit Logs"
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
          { id: "word", label: "Word (.docx)", icon: "word" },
        ]}
        onSelect={(id) => {
          if (id === "excel") return exportAuditLogsToExcel(initialLogs)
          if (id === "pdf") return exportAuditLogsToPDF(initialLogs)
          exportAuditLogsToWord(initialLogs)
        }}
      />
    </DataTablePage>
  )
}
