"use client"

import { useState, useEffect, useCallback } from "react"
import {
  DataTablePage,
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Plus, FileCheck2, Clock, CheckCircle2, AlertCircle, RefreshCw, Siren, Wallet, Building2 } from "lucide-react"
import type { Requisition } from "@/lib/requisitions/types"
import { getStageLabel } from "@/lib/requisitions/workflow"
import { NewRequisitionDialog } from "./_components/new-requisition-dialog"
import { createClient } from "@/lib/supabase/client"
import { apiFetch } from "@/lib/api-client"
import { formatWATDate } from "@/lib/utils/date"
import Link from "next/link"
import { useRouter } from "next/navigation"

const TABS: DataTableTab[] = [
  { key: "my", label: "My Requisitions" },
  { key: "approvals", label: "Pending Approvals" },
  { key: "all", label: "All Requisitions" },
]

/**
 * The stage pill. Extracted so the table cell, the mobile row and the card all
 * render the same thing — they previously showed three different summaries of
 * the same state, and the card's was a bare lowercase stage label.
 */
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

function formatNaira(amount: number | string | null | undefined, decimals = 2) {
  return `₦${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: decimals })}`
}

export default function RequisitionListPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>("my")
  const [rows, setRows] = useState<Requisition[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false)
  // A requisition is always raised for the requester's own department, so the
  // dialog shows it read-only rather than asking them to type it.
  const [userDepartment, setUserDepartment] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from("profiles").select("department").eq("id", user.id).single()
      setUserDepartment(data?.department ?? null)
    })()
  }, [])

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

      const res = await apiFetch(url)
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to load requisitions")
      }

      setRows(json.data || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch requisitions")
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
          {formatNaira(r.amount)}
        </span>
      ),
      initialWidth: 140,
    },
    {
      key: "status",
      label: "Stage / Status",
      sortable: true,
      accessor: (r) => r.status,
      render: (r) => <StageBadge requisition={r} />,
      initialWidth: 200,
    },
    {
      key: "created_at",
      label: "Date",
      sortable: true,
      accessor: (r) => r.created_at,
      render: (r) => <span className="text-muted-foreground text-xs">{formatWATDate(r.created_at)}</span>,
      initialWidth: 120,
    },
    // No "Action" column: it held a second link to `/requisition/[id]`, which the
    // requisition number in the first column already is — and the row itself now
    // opens the form.
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
      backLink={{ href: "/profile", label: "Back to Home" }}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      spacing="tight"
      actionsPlacement="inline-always"
      statBadgeStyle="line"
      statBadges={[
        { icon: FileCheck2, label: `${totalCount} total` },
        { icon: Clock, label: `${pendingCount} pending` },
        { icon: CheckCircle2, label: `${approvedCount} approved` },
        { icon: Wallet, label: formatNaira(totalAmount, 0) },
      ]}
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
            title="Total Amount"
            value={formatNaira(totalAmount, 0)}
            icon={Wallet}
            iconBgColor="bg-purple-500/10"
            iconColor="text-purple-500"
          />
        </div>
      }
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchRequisitions}>
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Requisition</span>
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
        stickyToolbar
        viewToggle
        contactsView
        // Eight columns of form data: a table where it fits, the row list where it
        // does not.
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          // An emergency requisition is the one that cannot wait in the queue.
          accentClass: (r) =>
            r.is_emergency
              ? "bg-rose-500"
              : r.status === "approved"
                ? "bg-emerald-500"
                : r.status === "rejected"
                  ? "bg-slate-400"
                  : "bg-amber-500",
          title: (r) => r.purpose,
          subtitle: (r) => `${r.requisition_number} · ${r.project_name || r.department} · ${formatNaira(r.amount)}`,
          trailing: (r) => <StageBadge requisition={r} />,
          // A requisition's detail is a whole form on its own route, so the row
          // navigates there rather than opening a sheet that could only ever show
          // a summary of it.
          onSelect: (r) => router.push(`/requisition/${r.id}`),
        }}
        emptyTitle="No requisitions"
        emptyDescription="Requisitions you raise or need to approve will appear here."
        emptyIcon={FileCheck2}
        skeletonRows={6}
        urlSync
        cardRenderer={(r) => (
          <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground font-mono text-xs font-bold">{r.requisition_number}</span>
              <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                {formatNaira(r.amount)}
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
        userDepartment={userDepartment}
        onSuccess={fetchRequisitions}
      />
    </DataTablePage>
  )
}
