"use client"

import React, { useState, useEffect, useCallback } from "react"
import { DataTablePage, DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Plus, FileCheck2, Clock, CheckCircle2, AlertCircle, RefreshCw, Siren, Building2 } from "lucide-react"
import type { Requisition } from "@/lib/requisitions/types"
import { getStageLabel } from "@/lib/requisitions/workflow"
import { NewRequisitionDialog } from "@/app/(app)/requisition/_components/new-requisition-dialog"
import Link from "next/link"
import { useRouter } from "next/navigation"

function StageBadge({ requisition }: { requisition: Requisition }) {
  if (requisition.status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Fully Approved
      </span>
    )
  }
  if (requisition.status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-red-600">
        <AlertCircle className="h-3 w-3" /> Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-600">
      <Clock className="h-3 w-3" /> {getStageLabel(requisition.current_stage_code)}
    </span>
  )
}

interface DeptRequisitionsContentProps {
  deptId: string
  deptName: string
  userId: string
}

export function DeptRequisitionsContent({ deptId, deptName, userId }: DeptRequisitionsContentProps) {
  const router = useRouter()
  const [rows, setRows] = useState<Requisition[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false)

  const fetchRequisitions = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/requisitions")
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to load requisitions")
      }

      // Lock to this department console's department
      const allRows: Requisition[] = json.data || []
      const scopedRows = allRows.filter((r) => r.department?.toLowerCase() === deptName.toLowerCase())

      setRows(scopedRows)
    } catch (err: any) {
      setError(err.message || "Failed to fetch department requisitions")
    } finally {
      setIsLoading(false)
    }
  }, [deptName])

  useEffect(() => {
    fetchRequisitions()
  }, [fetchRequisitions])

  const totalCount = rows.length
  const pendingCount = rows.filter((r) => r.status === "pending").length
  const approvedCount = rows.filter((r) => r.status === "approved").length
  const totalAmount = rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0)

  const columns: DataTableColumn<Requisition>[] = [
    {
      key: "requisition_number",
      label: "Requisition #",
      sortable: true,
      accessor: (r) => r.requisition_number,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <Link href={`/requisition/${r.id}`} className="text-primary font-mono font-bold hover:underline">
            {r.requisition_number}
          </Link>
          {r.is_emergency && (
            <span className="inline-flex w-fit items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
              <Siren className="h-2.5 w-2.5" /> Emergency
            </span>
          )}
        </div>
      ),
      initialWidth: 140,
    },
    {
      key: "requester",
      label: "Requester",
      sortable: true,
      accessor: (r) => r.requester?.full_name || "",
      render: (r) => <span className="text-xs font-semibold">{r.requester?.full_name || "Unknown"}</span>,
      initialWidth: 170,
    },
    {
      key: "project_name",
      label: "Project",
      sortable: true,
      accessor: (r) => r.project_name,
      render: (r) => <span className="text-xs font-medium">{r.project_name}</span>,
      initialWidth: 160,
    },
    {
      key: "funding_category_name",
      label: "Funding",
      sortable: true,
      accessor: (r) => r.funding_category_name || "",
      render: (r) => <span className="text-xs">{r.funding_category_name || "—"}</span>,
      initialWidth: 150,
      hideOnMobile: true,
    },
    {
      key: "amount",
      label: "Amount (₦)",
      sortable: true,
      accessor: (r) => Number(r.amount) || 0,
      render: (r) => (
        <span className="font-mono text-xs font-semibold">
          ₦{(Number(r.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}
        </span>
      ),
      initialWidth: 130,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (r) => r.status,
      render: (r) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            r.status === "approved"
              ? "bg-emerald-500/10 text-emerald-600"
              : r.status === "rejected"
                ? "bg-red-500/10 text-red-600"
                : "bg-amber-500/10 text-amber-600"
          }`}
        >
          {r.status.toUpperCase()}
        </span>
      ),
      initialWidth: 110,
    },
    {
      key: "stage",
      label: "Approval Stage",
      sortable: true,
      accessor: (r) => r.current_stage_code,
      render: (r) => <StageBadge requisition={r} />,
      initialWidth: 180,
    },
    {
      key: "actions",
      label: "Action",
      render: (r) => (
        <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-xs">
          <Link href={`/requisition/${r.id}`}>View Form</Link>
        </Button>
      ),
      initialWidth: 100,
    },
  ]

  const filters: DataTableFilter<Requisition>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "pending", label: "Pending" },
        { value: "approved", label: "Approved" },
        { value: "rejected", label: "Rejected" },
      ],
    },
    {
      key: "current_stage_code",
      label: "Stage",
      options: [
        { value: "pending_reviewed_by", label: "Pending Review" },
        { value: "pending_authorized_by", label: "Pending Authorization" },
        { value: "pending_verified_by", label: "Pending Verification" },
        { value: "pending_approved_by", label: "Pending MD Approval" },
        { value: "completed", label: "Completed" },
      ],
    },
    {
      key: "funding_category_name",
      label: "Funding",
      mode: "custom",
      options: Array.from(new Set(rows.map((r) => r.funding_category_name).filter((v): v is string => Boolean(v)))).map(
        (name) => ({ value: name, label: name })
      ),
      filterFn: (row, selected) => selected.includes(row.funding_category_name || ""),
    },
    {
      key: "route",
      label: "Route",
      mode: "custom",
      options: [
        { value: "emergency", label: "Emergency" },
        { value: "standard", label: "Standard" },
      ],
      filterFn: (row, selected) => selected.includes(row.is_emergency ? "emergency" : "standard"),
    },
  ]

  return (
    <DataTablePage
      title={`${deptName} Requisitions`}
      description={`Manage and track payment request forms for ${deptName}.`}
      icon={FileCheck2}
      backLink={{ href: `/dept/${deptId}`, label: `Back to ${deptName} Console` }}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Total Requisitions"
            value={totalCount}
            icon={FileCheck2}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Pending Stage"
            value={pendingCount}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Fully Approved"
            value={approvedCount}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Total Amount (₦)"
            value={`₦${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0 })}`}
            icon={FileCheck2}
            iconBgColor="bg-purple-500/10"
            iconColor="text-purple-500"
          />
        </div>
      }
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchRequisitions} className="gap-1 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)} className="gap-1 text-xs">
            <Plus className="h-4 w-4" /> New Requisition
          </Button>
        </div>
      }
    >
      <DataTable<Requisition>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search requisition #, requester, project..."
        searchFn={(row, q) =>
          row.requisition_number.toLowerCase().includes(q) ||
          row.project_name.toLowerCase().includes(q) ||
          (row.requester?.full_name || "").toLowerCase().includes(q) ||
          (row.funding_category_name || "").toLowerCase().includes(q)
        }
        filters={filters}
        isLoading={isLoading}
        error={error}
        onRetry={fetchRequisitions}
        pagination={{ pageSize: 25 }}
        stickyToolbar
        viewToggle
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (r) =>
            r.is_emergency
              ? "bg-rose-500"
              : r.status === "approved"
                ? "bg-emerald-500"
                : r.status === "rejected"
                  ? "bg-slate-400"
                  : "bg-amber-500",
          title: (r) => r.purpose,
          subtitle: (r) =>
            `${r.requisition_number} · ${r.project_name || r.department} · ₦${(Number(r.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}`,
          trailing: (r) => <StageBadge requisition={r} />,
          onSelect: (r) => router.push(`/requisition/${r.id}`),
        }}
        cardRenderer={(r) => (
          <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground font-mono text-xs font-bold">{r.requisition_number}</span>
              <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                ₦{(Number(r.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}
              </span>
            </div>
            <div>
              <h4 className="line-clamp-2 text-sm font-semibold">{r.purpose}</h4>
              <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                {r.project_name || r.department}
              </p>
            </div>
            <div className="border-border/40 flex items-center justify-between gap-2 border-t pt-2">
              <StageBadge requisition={r} />
              <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-xs">
                <Link href={`/requisition/${r.id}`}>View form</Link>
              </Button>
            </div>
          </div>
        )}
      />

      <NewRequisitionDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        userDepartment={deptName}
        onSuccess={fetchRequisitions}
      />
    </DataTablePage>
  )
}
