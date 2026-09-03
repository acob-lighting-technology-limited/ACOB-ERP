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
import { Badge } from "@/components/ui/badge"
import { FileCheck2, Clock, CheckCircle2, AlertCircle, Eye, RefreshCw, Siren, Wallet, Plus } from "lucide-react"
import type { Requisition, RequisitionFundingCategory } from "@/lib/requisitions/types"
import { getStageLabel } from "@/lib/requisitions/workflow"
import { apiFetch } from "@/lib/api-client"
import { FundingCategoryDialog } from "./_components/funding-category-dialog"
import Link from "next/link"

const TABS: DataTableTab[] = [
  { key: "requisitions", label: "Requisitions", icon: FileCheck2 },
  { key: "funding", label: "Funding Categories", icon: Wallet },
]

export default function AdminRequisitionsPage() {
  const [tab, setTab] = useState<string>("requisitions")

  const [rows, setRows] = useState<Requisition[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const [fundingCategories, setFundingCategories] = useState<RequisitionFundingCategory[]>([])
  const [isLoadingFunding, setIsLoadingFunding] = useState<boolean>(true)
  const [fundingError, setFundingError] = useState<string | null>(null)

  const [isFundingDialogOpen, setIsFundingDialogOpen] = useState<boolean>(false)
  const [editingCategory, setEditingCategory] = useState<RequisitionFundingCategory | null>(null)
  const [isSavingCategory, setIsSavingCategory] = useState<boolean>(false)
  const [saveCategoryError, setSaveCategoryError] = useState<string | null>(null)

  const fetchRequisitions = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/requisitions")
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
  }, [])

  const fetchFundingCategories = useCallback(async () => {
    setIsLoadingFunding(true)
    setFundingError(null)
    try {
      const res = await apiFetch("/api/requisitions/funding-categories?include_inactive=true")
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to load funding categories")
      }

      setFundingCategories(json.data || [])
    } catch (err: any) {
      setFundingError(err.message || "Failed to fetch funding categories")
    } finally {
      setIsLoadingFunding(false)
    }
  }, [])

  useEffect(() => {
    fetchRequisitions()
    fetchFundingCategories()
  }, [fetchRequisitions, fetchFundingCategories])

  const totalCount = rows.length
  const pendingCount = rows.filter((r) => r.status === "pending").length
  const approvedCount = rows.filter((r) => r.status === "approved").length
  const emergencyCount = rows.filter((r) => r.is_emergency).length
  const totalAmount = rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0)

  const saveCategory = async (payload: { name: string; description: string; sort_order: number }) => {
    setIsSavingCategory(true)
    setSaveCategoryError(null)
    try {
      const res = await apiFetch("/api/requisitions/funding-categories", {
        method: editingCategory ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingCategory
            ? {
                id: editingCategory.id,
                name: payload.name,
                description: payload.description || undefined,
                sort_order: payload.sort_order,
              }
            : {
                name: payload.name,
                description: payload.description || undefined,
                sort_order: payload.sort_order,
              }
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || json.message || "Failed to save funding category")

      setIsFundingDialogOpen(false)
      setEditingCategory(null)
      await fetchFundingCategories()
    } catch (err: any) {
      setSaveCategoryError(err.message || "Failed to save funding category")
    } finally {
      setIsSavingCategory(false)
    }
  }

  const toggleCategoryActive = async (category: RequisitionFundingCategory) => {
    setFundingError(null)
    try {
      const res = await apiFetch("/api/requisitions/funding-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: category.id, is_active: !category.is_active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || json.message || "Failed to update funding category")
      await fetchFundingCategories()
    } catch (err: any) {
      setFundingError(err.message || "Failed to update funding category")
    }
  }

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
      key: "requester",
      label: "Requester",
      sortable: true,
      accessor: (r) => r.requester?.full_name || "",
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-xs font-semibold">{r.requester?.full_name || "Unknown"}</span>
          <span className="text-muted-foreground text-[10px]">{r.department}</span>
        </div>
      ),
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
    {
      key: "funding_category_name",
      label: "Funding",
      mode: "custom",
      options: fundingCategories.map((category) => ({ value: category.name, label: category.name })),
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

  const fundingColumns: DataTableColumn<RequisitionFundingCategory>[] = [
    {
      key: "name",
      label: "Funding Category",
      sortable: true,
      accessor: (c) => c.name,
      render: (c) => (
        <div className="flex flex-col">
          <span className="text-xs font-semibold">{c.name}</span>
          {c.description && <span className="text-muted-foreground text-[10px]">{c.description}</span>}
        </div>
      ),
      initialWidth: 260,
    },
    {
      key: "code",
      label: "Code",
      sortable: true,
      accessor: (c) => c.code,
      render: (c) => <span className="font-mono text-xs">{c.code}</span>,
      initialWidth: 140,
      hideOnMobile: true,
    },
    {
      key: "usage",
      label: "Requisitions",
      sortable: true,
      accessor: (c) => rows.filter((r) => r.funding_category_id === c.id).length,
      render: (c) => <span className="text-xs">{rows.filter((r) => r.funding_category_id === c.id).length}</span>,
      initialWidth: 120,
      hideOnMobile: true,
    },
    {
      key: "is_active",
      label: "Status",
      sortable: true,
      accessor: (c) => String(c.is_active),
      render: (c) => <Badge variant={c.is_active ? "default" : "outline"}>{c.is_active ? "Active" : "Inactive"}</Badge>,
      initialWidth: 110,
    },
    {
      key: "sort_order",
      label: "Order",
      sortable: true,
      accessor: (c) => c.sort_order,
      render: (c) => <span className="text-muted-foreground text-xs">{c.sort_order}</span>,
      initialWidth: 90,
      hideOnMobile: true,
    },
  ]

  const fundingFilters: DataTableFilter<RequisitionFundingCategory>[] = [
    {
      key: "is_active",
      label: "Status",
      mode: "custom",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
      filterFn: (row, selected) => selected.includes(String(row.is_active)),
    },
  ]

  return (
    <DataTablePage
      title="Company Requisitions (Accounts Overview)"
      description="Manage, review, and audit company payment request forms, funding lines, and approvals."
      icon={FileCheck2}
      backLink={{ href: "/admin/accounts", label: "Back to Accounts" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
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
            title="Emergency Route"
            value={emergencyCount}
            icon={Siren}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
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
        tab === "funding" ? (
          <Button
            size="sm"
            onClick={() => {
              setEditingCategory(null)
              setSaveCategoryError(null)
              setIsFundingDialogOpen(true)
            }}
            className="gap-1 text-xs"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Funding Category</span>
            <span className="sm:hidden">New</span>
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={fetchRequisitions} className="gap-1 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh Data</span>
            <span className="sm:hidden">Refresh</span>
          </Button>
        )
      }
    >
      {tab === "requisitions" ? (
        <DataTable<Requisition>
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search requisition #, requester, project, funding, department..."
          searchFn={(row, q) =>
            row.requisition_number.toLowerCase().includes(q) ||
            row.project_name.toLowerCase().includes(q) ||
            (row.requester?.full_name || "").toLowerCase().includes(q) ||
            (row.funding_category_name || "").toLowerCase().includes(q) ||
            row.department.toLowerCase().includes(q)
          }
          filters={filters}
          isLoading={isLoading}
          error={error}
          onRetry={fetchRequisitions}
          pagination={{ pageSize: 25 }}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (r) =>
              r.status === "rejected"
                ? "bg-rose-500"
                : r.status === "approved"
                  ? "bg-emerald-500"
                  : r.is_emergency
                    ? "bg-red-500"
                    : "bg-amber-500",
            title: (r) => `${r.requisition_number} · ₦${Number(r.amount).toLocaleString()}`,
            subtitle: (r) => `${r.project_name} · ${r.requester?.full_name || "Staff"} · ${r.department}`,
            trailing: (r) => (
              <Badge
                variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}
                className="text-[10px]"
              >
                {r.status}
              </Badge>
            ),
          }}
          cardRenderer={(r) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono font-semibold">{r.requisition_number}</span>
                  <p className="text-muted-foreground mt-0.5">{r.project_name}</p>
                </div>
                <Badge
                  variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}
                >
                  {r.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground">{r.requester?.full_name || r.department}</span>
                <span className="font-semibold">₦{Number(r.amount).toLocaleString()}</span>
              </div>
            </div>
          )}
        />
      ) : (
        <DataTable<RequisitionFundingCategory>
          data={fundingCategories}
          columns={fundingColumns}
          getRowId={(c) => c.id}
          searchPlaceholder="Search funding categories..."
          searchFn={(row, q) => row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q)}
          filters={fundingFilters}
          isLoading={isLoadingFunding}
          error={fundingError}
          onRetry={fetchFundingCategories}
          pagination={{ pageSize: 25 }}
          emptyTitle="No funding categories"
          emptyDescription="Add the project funding lines requisitions are drawn against."
          emptyIcon={Wallet}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (c) => (c.is_active ? "bg-emerald-500" : "bg-slate-400"),
            title: (c) => c.name,
            subtitle: (c) => `${c.code} · ${c.description || "No description"}`,
            trailing: (c) => (
              <Badge variant={c.is_active ? "default" : "outline"} className="text-[10px]">
                {c.is_active ? "Active" : "Inactive"}
              </Badge>
            ),
            onSelect: (c) => {
              setEditingCategory(c)
              setSaveCategoryError(null)
              setIsFundingDialogOpen(true)
            },
          }}
          cardRenderer={(c) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{c.name}</p>
                  <span className="text-muted-foreground font-mono text-[10px]">{c.code}</span>
                </div>
                <Badge variant={c.is_active ? "default" : "outline"}>{c.is_active ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="text-muted-foreground text-xs">{c.description || "No description"}</p>
            </div>
          )}
          rowActions={[
            {
              label: "Edit",
              onClick: (row) => {
                setEditingCategory(row)
                setSaveCategoryError(null)
                setIsFundingDialogOpen(true)
              },
            },
            {
              label: "Activate",
              onClick: (row) => {
                void toggleCategoryActive(row)
              },
              hidden: (row) => row.is_active,
            },
            {
              label: "Deactivate",
              onClick: (row) => {
                void toggleCategoryActive(row)
              },
              hidden: (row) => !row.is_active,
            },
          ]}
        />
      )}

      <FundingCategoryDialog
        open={isFundingDialogOpen}
        onOpenChange={(open) => {
          setIsFundingDialogOpen(open)
          if (!open) setEditingCategory(null)
        }}
        category={editingCategory}
        onSave={saveCategory}
        isSaving={isSavingCategory}
        error={saveCategoryError}
      />
    </DataTablePage>
  )
}
