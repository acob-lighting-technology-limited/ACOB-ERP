"use client"

import React, { useState, useEffect, useCallback } from "react"
import {
  DataTablePage,
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Plus, FileCheck2, Clock, CheckCircle2, AlertCircle, Eye, RefreshCw, Siren } from "lucide-react"
import type { Requisition } from "@/lib/requisitions/types"
import { getStageLabel } from "@/lib/requisitions/workflow"
import { NewRequisitionDialog } from "./_components/new-requisition-dialog"
import Link from "next/link"

const TABS: DataTableTab[] = [
  { key: "my", label: "My Requisitions" },
  { key: "approvals", label: "Pending Approvals" },
  { key: "all", label: "All Requisitions" },
]

export default function RequisitionListPage() {
  const [activeTab, setActiveTab] = useState<string>("my")
  const [rows, setRows] = useState<Requisition[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false)

  const fetchRequisitions = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      let url = "/api/requisitions"
      if (activeTab === "my") {
        url += "?user_only=true"
      } else if (activeTab === "approvals") {
        url += "?status=pending"
      }

      const res = await fetch(url)
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to load requisitions")
      }

      setRows(json.data || [])
    } catch (err: any) {
      setError(err.message || "Failed to fetch requisitions")
    } finally {
      setIsLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    fetchRequisitions()
  }, [fetchRequisitions])

  // Stats computation
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
          <Link
            href={`/requisition/${r.id}`}
            className="font-mono font-bold text-emerald-700 hover:underline dark:text-emerald-400"
          >
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
      key: "project_name",
      label: "Project",
      sortable: true,
      accessor: (r) => r.project_name,
      render: (r) => <span className="text-xs font-medium">{r.project_name}</span>,
      initialWidth: 180,
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
      key: "department",
      label: "Department",
      sortable: true,
      accessor: (r) => r.department,
      render: (r) => <span className="text-xs">{r.department}</span>,
      initialWidth: 130,
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
      label: "Date",
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
      title="Requisition Portal"
      description="Create, track, and approve digital ACOB payment request forms."
      icon={FileCheck2}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
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
        searchPlaceholder="Search requisition #, project, purpose, department..."
        searchFn={(row, q) =>
          row.requisition_number.toLowerCase().includes(q) ||
          row.project_name.toLowerCase().includes(q) ||
          row.purpose.toLowerCase().includes(q) ||
          row.department.toLowerCase().includes(q)
        }
        filters={filters}
        isLoading={isLoading}
        error={error}
        onRetry={fetchRequisitions}
        pagination={{ pageSize: 25 }}
      />

      <NewRequisitionDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} onSuccess={fetchRequisitions} />
    </DataTablePage>
  )
}
