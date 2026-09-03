"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toast } from "sonner"
import { MessageSquare, AlertCircle, Clock, XCircle, Eye, ShieldCheck, Mail, UserCog } from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FeedbackDetailDialog } from "@/components/feedback/feedback-detail-dialog"
import type { FeedbackRecord } from "@/components/feedback/types"
import { cn, formatName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

interface AdminFeedbackContentProps {
  initialFeedback: FeedbackRecord[]
  initialStats: {
    total: number
    open: number
    inProgress: number
    resolved: number
    closed: number
  }
}

interface FilterData {
  employees: { id: string; first_name: string; last_name: string; department: string }[]
  departments: string[]
}

const TYPE_OPTIONS = [
  { value: "complaint", label: "Complaint" },
  { value: "suggestion", label: "Suggestion" },
  { value: "concern", label: "Concern" },
  { value: "praise", label: "Praise" },
]

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
]

const STATUS_COLOR_MAP: Record<string, string> = {
  open: "bg-emerald-500/10 text-emerald-500 border-emerald-200",
  in_progress: "bg-blue-500/10 text-blue-500 border-blue-200",
  resolved: "bg-purple-500/10 text-purple-500 border-purple-200",
  closed: "bg-muted text-muted-foreground",
}

async function fetchFilterData(): Promise<FilterData> {
  const res = await apiFetch("/api/admin/feedback/filters", { cache: "no-store" })
  if (!res.ok) return { employees: [], departments: [] }
  const json = await res.json()
  return { employees: json.employees || [], departments: json.departments || [] }
}

export function AdminFeedbackContent({ initialFeedback, initialStats }: AdminFeedbackContentProps) {
  const router = useRouter()
  const [feedback, setFeedback] = useState(initialFeedback)
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackRecord | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [activeTab, setActiveTab] = useState<"general" | "leads">("general")

  // Lead-directed feedback is fully anonymous upward feedback about a department
  // lead. It is kept in its own tab and never reaches the lead it names.
  const leadFeedback = useMemo(() => feedback.filter((f) => Boolean(f.target_lead_id)), [feedback])
  const generalFeedback = useMemo(() => feedback.filter((f) => !f.target_lead_id), [feedback])
  const hasLeadFeedback = leadFeedback.length > 0
  const visibleFeedback = hasLeadFeedback && activeTab === "leads" ? leadFeedback : generalFeedback

  const tabs: DataTableTab[] = useMemo(
    () => [
      { key: "general", label: `General (${generalFeedback.length})` },
      { key: "leads", label: `About Leads (${leadFeedback.length})` },
    ],
    [generalFeedback.length, leadFeedback.length]
  )

  const { data: filterData } = useQuery({
    queryKey: QUERY_KEYS.feedbackViewer(),
    queryFn: fetchFilterData,
  })

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedFeedback) return
    setIsUpdating(true)

    try {
      const res = await apiFetch("/api/admin/feedback/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedFeedback.id, status: newStatus, oldStatus: selectedFeedback.status }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to update status")

      toast.success("Status updated successfully!")
      setFeedback((prev) => prev.map((f) => (f.id === selectedFeedback.id ? { ...f, status: newStatus } : f)))
      setSelectedFeedback((prev) => (prev ? { ...prev, status: newStatus } : null))
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to update status")
    } finally {
      setIsUpdating(false)
    }
  }

  const showingLeadFeedback = hasLeadFeedback && activeTab === "leads"

  const columns: DataTableColumn<FeedbackRecord>[] = useMemo(
    () => [
      {
        key: "reference_number",
        label: "Ref #",
        sortable: true,
        accessor: (r) => r.id,
        hideOnMobile: true,
        render: (r) => (
          <span className="text-muted-foreground font-mono text-xs font-semibold">
            {r.id.substring(0, 8).toUpperCase()}
          </span>
        ),
      },
      {
        key: "requester",
        label: "Requester",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) =>
          r.is_anonymous
            ? "Anonymous"
            : r.profiles
              ? `${r.profiles.first_name || ""} ${r.profiles.last_name || ""}`.trim() || "Unknown"
              : "Unknown",
        render: (r) => (
          <div className="flex items-center gap-2">
            <div className="bg-muted ring-border flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-1">
              {r.is_anonymous ? "A" : r.profiles?.first_name ? r.profiles.first_name.charAt(0) : "?"}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {r.is_anonymous
                  ? "Anonymous"
                  : r.profiles
                    ? `${r.profiles.first_name || ""} ${r.profiles.last_name || ""}`.trim() || "Unknown"
                    : "Unknown"}
              </span>
              {!r.is_anonymous && r.profiles?.company_email && (
                <div className="text-muted-foreground group flex items-center gap-1 text-[10px]">
                  <Mail className="h-2.5 w-2.5" />
                  <span className="group-hover:text-foreground transition-colors">{r.profiles.company_email}</span>
                </div>
              )}
            </div>
          </div>
        ),
      },
      ...(showingLeadFeedback
        ? [
            {
              key: "target_lead",
              label: "About Lead",
              sortable: true,
              resizable: true,
              initialWidth: 220,
              accessor: (r: FeedbackRecord) =>
                `${r.target_lead?.first_name || ""} ${r.target_lead?.last_name || ""}`.trim() || "Unknown lead",
              render: (r: FeedbackRecord) => (
                <div className="flex items-center gap-2">
                  <UserCog className="text-muted-foreground h-3.5 w-3.5" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {`${r.target_lead?.first_name || ""} ${r.target_lead?.last_name || ""}`.trim() || "Unknown lead"}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {r.target_department || r.target_lead?.department || "—"}
                    </span>
                  </div>
                </div>
              ),
            } satisfies DataTableColumn<FeedbackRecord>,
          ]
        : []),
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (r) => (r.is_anonymous ? "Hidden" : r.profiles?.department || "Unassigned"),
        hideOnMobile: true,
        render: (r) => <span className="text-sm">{r.is_anonymous ? "Hidden" : r.profiles?.department || "—"}</span>,
      },
      {
        key: "title",
        label: "Context",
        sortable: true,
        resizable: true,
        initialWidth: 250,
        accessor: (r) => r.title || "",
        render: (r) => (
          <div className="flex max-w-[280px] flex-col">
            <span className="truncate font-medium">{r.title}</span>
            <Badge variant="outline" className="mt-1 w-fit text-[10px] font-normal uppercase">
              {r.feedback_type}
            </Badge>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (r) => r.status,
        render: (r) => (
          <Badge className={cn("px-2.5 py-0.5", STATUS_COLOR_MAP[r.status] || "bg-muted text-muted-foreground")}>
            {formatName(r.status)}
          </Badge>
        ),
      },
      {
        key: "created_at",
        label: "Date Created",
        sortable: true,
        accessor: (r) => r.created_at,
        hideOnMobile: true,
        render: (r) => <span className="text-muted-foreground text-xs">{formatWATDate(r.created_at)}</span>,
      },
    ],
    [showingLeadFeedback]
  )

  const filters: DataTableFilter<FeedbackRecord>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: STATUS_OPTIONS,
      },
      {
        key: "feedback_type",
        label: "Type",
        options: TYPE_OPTIONS,
      },
      {
        key: "department",
        label: "Department",
        options: filterData?.departments.map((d) => ({ value: d, label: d })) || [],
      },
    ],
    [filterData]
  )

  return (
    <DataTablePage
      title="User Feedback"
      description="Centralized portal for managing employee concerns, suggestions and system praise."
      icon={MessageSquare}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      tabs={hasLeadFeedback ? tabs : undefined}
      activeTab={hasLeadFeedback ? activeTab : undefined}
      onTabChange={(tab) => setActiveTab(tab as "general" | "leads")}
      stats={
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
          <StatCard
            variant="compact"
            title="Total"
            value={initialStats.total}
            icon={MessageSquare}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Open"
            value={initialStats.open}
            icon={AlertCircle}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="In Progress"
            value={initialStats.inProgress}
            icon={Clock}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Resolved"
            value={initialStats.resolved}
            icon={ShieldCheck}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            variant="compact"
            title="Closed"
            value={initialStats.closed}
            icon={XCircle}
            iconBgColor="bg-gray-500/10"
            iconColor="text-gray-500"
          />
        </div>
      }
    >
      <DataTable<FeedbackRecord>
        data={visibleFeedback}
        columns={columns}
        getRowId={(r) => r.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search ref #, title, requester name or email..."
        searchFn={(r, q) =>
          `${r.id} ${r.title} ${r.is_anonymous ? "anonymous" : ""} ${r.profiles?.first_name || ""} ${r.profiles?.last_name || ""} ${r.profiles?.company_email || ""} ${r.target_lead?.first_name || ""} ${r.target_lead?.last_name || ""} ${r.target_department || ""}`
            .toLowerCase()
            .includes(q)
        }
        filters={filters}
        rowActions={[
          {
            label: "Review Detail",
            icon: Eye,
            onClick: (r) => {
              setSelectedFeedback(r)
              setIsModalOpen(true)
            },
          },
        ]}
        expandable={{
          render: (r) => (
            <div className="bg-muted/20 space-y-4 border-t p-6">
              <div>
                <h4 className="text-muted-foreground mb-2 text-[10px] font-black tracking-widest uppercase">
                  Description / Feedback
                </h4>
                <div className="bg-background rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {r.description || "No detailed description provided."}
                </div>
              </div>
              <div className="flex gap-3">
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedFeedback(r)
                    setIsModalOpen(true)
                  }}
                  className="gap-2"
                >
                  <Eye className="h-4 w-4" /> Comprehensive Review
                </Button>
              </div>
            </div>
          ),
        }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (r) =>
            r.status === "open"
              ? "bg-emerald-500"
              : r.status === "in_progress"
                ? "bg-blue-500"
                : r.status === "resolved"
                  ? "bg-violet-500"
                  : "bg-slate-400",
          title: (r) => r.title,
          subtitle: (r) =>
            `${r.is_anonymous ? "Anonymous" : r.profiles ? `${r.profiles.first_name || ""} ${r.profiles.last_name || ""}`.trim() || "Unknown" : "Unknown"} · ${r.feedback_type} · ${formatWATDate(r.created_at)}`,
          trailing: (r) => (
            <Badge
              className={cn("px-2 py-0.5 text-[10px]", STATUS_COLOR_MAP[r.status] || "bg-muted text-muted-foreground")}
            >
              {formatName(r.status)}
            </Badge>
          ),
          onSelect: (r) => {
            setSelectedFeedback(r)
            setIsModalOpen(true)
          },
        }}
        cardRenderer={(r) => (
          <div
            className="bg-card group relative cursor-pointer rounded-xl border p-4 transition-all hover:shadow-md"
            onClick={() => {
              setSelectedFeedback(r)
              setIsModalOpen(true)
            }}
          >
            <div className="mb-2 flex items-start justify-between">
              <span className="text-muted-foreground font-mono text-[10px]">{r.id.substring(0, 8).toUpperCase()}</span>
              <Badge
                className={cn(
                  "px-1.5 py-0 text-[10px]",
                  STATUS_COLOR_MAP[r.status] || "bg-muted text-muted-foreground"
                )}
              >
                {formatName(r.status)}
              </Badge>
            </div>
            <h4 className="truncate text-sm font-semibold">{r.title}</h4>
            <div className="mt-4 flex items-center gap-2 border-t pt-3">
              <div className="bg-muted flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold">
                {r.is_anonymous ? "A" : r.profiles?.first_name ? r.profiles.first_name.charAt(0) : "?"}
              </div>
              <span className="text-muted-foreground truncate text-xs">
                {r.is_anonymous
                  ? "Anonymous"
                  : r.profiles
                    ? `${r.profiles.first_name || ""} ${r.profiles.last_name || ""}`.trim() || "Unknown"
                    : "Unknown"}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] font-normal uppercase">
                  {r.feedback_type}
                </Badge>
              </div>
            </div>
          </div>
        )}
        urlSync
      />

      <FeedbackDetailDialog
        feedback={selectedFeedback}
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        onUpdateStatus={handleUpdateStatus}
        isUpdating={isUpdating}
      />
    </DataTablePage>
  )
}
