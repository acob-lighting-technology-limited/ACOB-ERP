"use client"

import React, { useState, useEffect, useCallback } from "react"
import { DataTablePage, DataTable, type DataTableColumn, type DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Plus, FileCheck2, Clock, CheckCircle2, AlertCircle, Eye, RefreshCw } from "lucide-react"
import type { Requisition } from "@/lib/requisitions/types"
import { getStageLabel } from "@/lib/requisitions/workflow"
import { NewRequisitionDialog } from "@/app/(app)/requisition/_components/new-requisition-dialog"
import Link from "next/link"

interface DeptRequisitionsContentProps {
  deptId: string
  deptName: string
  userId: string
}

export function DeptRequisitionsContent({ deptId, deptName, userId }: DeptRequisitionsContentProps) {
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
        <Link href={`/requisition/${r.id}`} className="text-primary font-mono font-bold hover:underline">
          {r.requisition_number}
        </Link>
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
      key: "amount",
      label: "Amount (₦)",
      sortable: true,
      accessor: (r) => r.amount,
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          ₦{Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      ),
      initialWidth: 140,
    },
    {
      key: "status",
      label: "Stage / Status",
      sortable: true,
      accessor: (r) => r.status,
      render: (r) => {
        if (r.status === "approved") {
          return (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Fully Approved
            </span>
          )
        }
        if (r.status === "rejected") {
          return (
            <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600">
              <AlertCircle className="h-3 w-3" /> Rejected
            </span>
          )
        }
        return (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
            <Clock className="h-3 w-3" /> {getStageLabel(r.current_stage_code)}
          </span>
        )
      },
      initialWidth: 200,
    },
    {
      key: "created_at",
      label: "Submitted",
      sortable: true,
      accessor: (r) => r.created_at,
      render: (r) => (
        <span className="text-muted-foreground text-xs">
          {new Date(r.created_at).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
      initialWidth: 120,
    },
    {
      key: "actions",
      label: "Action",
      render: (r) => (
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/requisition/${r.id}`} className="gap-1 text-xs">
            <Eye className="h-3.5 w-3.5" /> View Form
          </Link>
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
            title="Total Requisitions"
            value={totalCount}
            icon={FileCheck2}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Pending Stage"
            value={pendingCount}
            icon={Clock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Fully Approved"
            value={approvedCount}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
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
          (row.requester?.full_name || "").toLowerCase().includes(q)
        }
        filters={filters}
        isLoading={isLoading}
        error={error}
        onRetry={fetchRequisitions}
        pagination={{ pageSize: 25 }}
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
