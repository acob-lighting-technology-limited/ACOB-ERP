"use client"

import { useEffect, useMemo, useState } from "react"
import { formatWATDateTime } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarCheck2, CheckCircle2, Paperclip, Plus, XCircle, Box } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import {
  DataTablePage,
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table"
import { BookingReviewDialog } from "./_components/booking-review-dialog"
import { ResourceDialog } from "./_components/resource-dialog"
import type { FleetAttachment, FleetBooking, FleetResource } from "./_components/fleet-types"
import { apiFetch } from "@/lib/api-client"

function formatDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return formatWATDateTime(parsed)
}

async function fetchFleetResources(): Promise<FleetResource[]> {
  const response = await apiFetch("/api/admin/hr/fleet/resources")
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "Failed to load resources")
  return payload.data || []
}

async function fetchFleetBookings(): Promise<FleetBooking[]> {
  const response = await apiFetch(`/api/admin/hr/fleet/bookings`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "Failed to load bookings")
  return payload.data || []
}

const TABS: DataTableTab[] = [
  { key: "bookings", label: "Bookings", icon: CalendarCheck2 },
  { key: "resources", label: "Resources", icon: Box },
]

export default function AdminFleetPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState("bookings")
  const [accessChecked, setAccessChecked] = useState(false)

  const [isResourceDialogOpen, setIsResourceDialogOpen] = useState(false)
  const [resourceName, setResourceName] = useState("")
  const [resourceType, setResourceType] = useState("general")
  const [resourceDescription, setResourceDescription] = useState("")
  const [savingResource, setSavingResource] = useState(false)

  const [selectedBooking, setSelectedBooking] = useState<FleetBooking | null>(null)
  const [attachments, setAttachments] = useState<FleetAttachment[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [adminNote, setAdminNote] = useState("")

  useEffect(() => {
    let isMounted = true
    async function verifyAccess() {
      try {
        const response = await apiFetch("/api/admin/hr/fleet/bookings?status=pending", { cache: "no-store" })
        if (!response.ok && (response.status === 401 || response.status === 403)) {
          router.replace("/admin/hr")
          return
        }
      } finally {
        if (isMounted) setAccessChecked(true)
      }
    }
    void verifyAccess()
    return () => {
      isMounted = false
    }
  }, [router])

  const { data: resources = [], isLoading: loadingResources } = useQuery({
    queryKey: QUERY_KEYS.adminFleetResources(),
    queryFn: fetchFleetResources,
  })

  const { data: bookings = [], isLoading: loadingBookings } = useQuery({
    queryKey: QUERY_KEYS.adminFleetBookings("all"),
    queryFn: fetchFleetBookings,
  })

  // ─── Resources Actions ───────────────────────────────────────────────────
  async function createResource() {
    setSavingResource(true)
    try {
      const response = await apiFetch("/api/admin/hr/fleet/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: resourceName,
          resource_type: resourceType,
          description: resourceDescription,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to create resource")

      toast.success("Resource created")
      setResourceName("")
      setResourceType("general")
      setResourceDescription("")
      setIsResourceDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminFleetResources() })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create resource")
    } finally {
      setSavingResource(false)
    }
  }

  async function toggleResource(resource: FleetResource) {
    try {
      const response = await apiFetch("/api/admin/hr/fleet/resources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resource.id, is_active: !resource.is_active }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to update resource")
      toast.success(`Resource ${resource.is_active ? "deactivated" : "activated"}`)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminFleetResources() })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update resource")
    }
  }

  // ─── Bookings Actions ────────────────────────────────────────────────────
  async function openReview(booking: FleetBooking) {
    setSelectedBooking(booking)
    setAdminNote(booking.admin_note || "")
    setAttachments([])

    try {
      const response = await apiFetch(`/api/fleet/bookings/${booking.id}/attachments`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to load attachments")
      setAttachments(payload.data || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load attachments")
    }
  }

  async function review(action: "approve" | "reject") {
    if (!selectedBooking) return
    setReviewing(true)
    try {
      const response = await apiFetch(`/api/admin/hr/fleet/bookings/${selectedBooking.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, admin_note: adminNote }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Review failed")
      toast.success(`Booking ${action}d`)
      setSelectedBooking(null)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminFleetBookings("all") })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review failed")
    } finally {
      setReviewing(false)
    }
  }

  // ─── Columns & Filters ───────────────────────────────────────────────────
  const bookingColumns: DataTableColumn<FleetBooking>[] = useMemo(
    () => [
      {
        key: "resource",
        label: "Resource",
        sortable: true,
        resizable: true,
        initialWidth: 200,
        accessor: (r) => r.resource?.name || "Unknown",
        render: (r) => <span className="font-medium">{r.resource?.name || "Unknown"}</span>,
      },
      {
        key: "requester",
        label: "Requester",
        sortable: true,
        accessor: (r) => r.requester?.full_name || r.requester?.company_email || "Employee",
      },
      {
        key: "timeframe",
        label: "Timeframe",
        accessor: (r) => r.start_at,
        hideOnMobile: true,
        render: (r) => (
          <div className="text-xs">
            <p>{formatDateTime(r.start_at)}</p>
            <p className="text-muted-foreground">to {formatDateTime(r.end_at)}</p>
          </div>
        ),
      },
      {
        key: "reason",
        label: "Reason",
        accessor: (r) => r.reason,
        hideOnMobile: true,
        render: (r) => <span className="max-w-[200px] truncate text-xs">{r.reason}</span>,
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => r.status,
        render: (r) => (
          <Badge
            variant={
              r.status === "approved"
                ? "default"
                : r.status === "pending"
                  ? "secondary"
                  : r.status === "rejected"
                    ? "destructive"
                    : "outline"
            }
          >
            {r.status}
          </Badge>
        ),
      },
      {
        key: "attachments",
        label: "Attachments",
        align: "center",
        accessor: (r) => String(r.attachment_count || 0),
        hideOnMobile: true,
        render: (r) => (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Paperclip className="h-3 w-3" />
            {r.attachment_count || 0}
          </span>
        ),
      },
      {
        key: "reviewer",
        label: "Decision By",
        accessor: (r) => r.reviewer?.full_name || "-",
        hideOnMobile: true,
        initialWidth: 200,
        render: (r) =>
          r.reviewer?.full_name ? (
            <div className="text-xs">
              <p className="font-medium">{r.reviewer.full_name}</p>
              {r.reviewer.department && <p className="text-muted-foreground">{r.reviewer.department}</p>}
              {r.reviewed_at && <p className="text-muted-foreground">{formatDateTime(r.reviewed_at)}</p>}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">Not yet reviewed</span>
          ),
      },
    ],
    []
  )

  const bookingFilters: DataTableFilter<FleetBooking>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "pending", label: "Pending" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        key: "resource_type",
        label: "Resource Type",
        options: Array.from(new Set(resources.map((r) => r.resource_type))).map((t) => ({ value: t, label: t })),
        mode: "custom",
        filterFn: (row, selected) => selected.includes(row.resource?.resource_type || "general"),
      },
    ],
    [resources]
  )

  const resourceColumns: DataTableColumn<FleetResource>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Name",
        sortable: true,
        resizable: true,
        initialWidth: 250,
        accessor: (r) => r.name,
        render: (r) => (
          <div>
            <p className="font-medium">{r.name}</p>
            {r.description && <p className="text-muted-foreground max-w-[300px] truncate text-xs">{r.description}</p>}
          </div>
        ),
      },
      {
        key: "resource_type",
        label: "Type",
        sortable: true,
        accessor: (r) => r.resource_type,
      },
      {
        key: "status",
        label: "Status",
        accessor: (r) => String(r.is_active),
        render: (r) => (
          <Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "Active" : "Inactive"}</Badge>
        ),
      },
    ],
    []
  )

  const resourceFilters: DataTableFilter<FleetResource>[] = useMemo(
    () => [
      {
        key: "is_active",
        label: "Status",
        options: [
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ],
        mode: "custom",
        filterFn: (row, selected) => selected.includes(String(row.is_active)),
      },
      {
        key: "resource_type",
        label: "Type",
        options: Array.from(new Set(resources.map((r) => r.resource_type))).map((t) => ({ value: t, label: t })),
      },
    ],
    [resources]
  )

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!accessChecked) {
    return (
      <DataTablePage
        title="Resource Booking Admin"
        description="Manage bookable resources and review booking applications"
        icon={CalendarCheck2}
        backLink={{ href: "/admin/hr", label: "Back to HR Dashboard" }}
      >
        <div className="text-muted-foreground rounded-md border p-6 text-sm">Loading access policy...</div>
      </DataTablePage>
    )
  }

  const pendingCount = bookings.filter((b) => b.status === "pending").length
  const approvedCount = bookings.filter((b) => b.status === "approved").length
  const rejectedCount = bookings.filter((b) => b.status === "rejected").length

  return (
    <DataTablePage
      title="Resource Booking Admin"
      description="Manage bookable resources and review booking applications"
      icon={CalendarCheck2}
      backLink={{ href: "/admin/hr", label: "Back to HR Dashboard" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      stats={
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          <StatCard
            variant="compact"
            title="Pending Review"
            value={pendingCount}
            icon={CalendarCheck2}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Approved"
            value={approvedCount}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Rejected"
            value={rejectedCount}
            icon={XCircle}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
      actions={
        tab === "resources" ? (
          <Button size="sm" onClick={() => setIsResourceDialogOpen(true)}>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Resource</span>
            <span className="sm:hidden">Add</span>
          </Button>
        ) : undefined
      }
    >
      {tab === "bookings" ? (
        <DataTable<FleetBooking>
          data={bookings}
          columns={bookingColumns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search requester, resource, reason..."
          searchFn={(row, q) =>
            [row.resource?.name, row.requester?.full_name, row.requester?.company_email, row.reason]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          }
          filters={bookingFilters}
          isLoading={loadingBookings}
          pagination={{ pageSize: 50 }}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (r) =>
              r.status === "rejected" ? "bg-rose-500" : r.status === "approved" ? "bg-emerald-500" : "bg-amber-500",
            title: (r) => `${r.resource?.name || "Resource"} · ${r.requester?.full_name || "Employee"}`,
            subtitle: (r) => `${formatDateTime(r.start_at)} - ${formatDateTime(r.end_at)} · ${r.reason || "No reason"}`,
            trailing: (r) => (
              <Badge
                variant={
                  r.status === "approved"
                    ? "default"
                    : r.status === "pending"
                      ? "secondary"
                      : r.status === "rejected"
                        ? "destructive"
                        : "outline"
                }
                className="text-[10px]"
              >
                {r.status}
              </Badge>
            ),
            onSelect: (r) => openReview(r),
          }}
          cardRenderer={(r) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{r.resource?.name || "Resource"}</p>
                  <p className="text-muted-foreground text-xs">{r.requester?.full_name || "Employee"}</p>
                </div>
                <Badge
                  variant={
                    r.status === "approved"
                      ? "default"
                      : r.status === "pending"
                        ? "secondary"
                        : r.status === "rejected"
                          ? "destructive"
                          : "outline"
                  }
                >
                  {r.status}
                </Badge>
              </div>
              <p className="text-muted-foreground line-clamp-2 text-xs">{r.reason}</p>
              <div className="text-muted-foreground border-t pt-2 text-[10px]">
                {formatDateTime(r.start_at)} – {formatDateTime(r.end_at)}
              </div>
            </div>
          )}
          rowActions={[
            {
              label: "Review",
              onClick: openReview,
            },
          ]}
        />
      ) : (
        <DataTable<FleetResource>
          data={resources}
          columns={resourceColumns}
          getRowId={(r) => r.id}
          searchPlaceholder="Search resources..."
          searchFn={(row, q) => row.name.toLowerCase().includes(q) || (row.description || "").toLowerCase().includes(q)}
          filters={resourceFilters}
          isLoading={loadingResources}
          pagination={{ pageSize: 50 }}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (r) => (r.is_active ? "bg-emerald-500" : "bg-slate-400"),
            title: (r) => r.name,
            subtitle: (r) => `${r.resource_type} · ${r.description || "No description"}`,
            trailing: (r) => (
              <Badge variant={r.is_active ? "default" : "outline"} className="text-[10px]">
                {r.is_active ? "Active" : "Inactive"}
              </Badge>
            ),
          }}
          cardRenderer={(r) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{r.name}</p>
                  <p className="text-muted-foreground text-xs capitalize">{r.resource_type}</p>
                </div>
                <Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="text-muted-foreground text-xs">{r.description || "No description"}</p>
            </div>
          )}
          rowActions={[
            {
              label: "Activate",
              onClick: toggleResource,
              hidden: (row) => row.is_active,
            },
            {
              label: "Deactivate",
              onClick: toggleResource,
              hidden: (row) => !row.is_active,
            },
          ]}
        />
      )}

      <ResourceDialog
        open={isResourceDialogOpen}
        onOpenChange={setIsResourceDialogOpen}
        resourceName={resourceName}
        onResourceNameChange={setResourceName}
        resourceType={resourceType}
        onResourceTypeChange={setResourceType}
        resourceDescription={resourceDescription}
        onResourceDescriptionChange={setResourceDescription}
        savingResource={savingResource}
        onCreateResource={() => void createResource()}
      />

      <BookingReviewDialog
        selectedBooking={selectedBooking}
        attachments={attachments}
        adminNote={adminNote}
        reviewing={reviewing}
        formatDateTime={formatDateTime}
        onAdminNoteChange={setAdminNote}
        onClose={() => setSelectedBooking(null)}
        onReview={(action) => void review(action)}
      />
    </DataTablePage>
  )
}
