"use client"

import { useEffect, useMemo, useState } from "react"
import { formatWATDateTime } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarCheck2, CheckCircle2, Paperclip, Plus, XCircle, Box } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatCard } from "@/components/ui/stat-card"
import { Textarea } from "@/components/ui/textarea"
import { QUERY_KEYS } from "@/lib/query-keys"
import {
  DataTablePage,
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table"

type FleetResource = {
  id: string
  name: string
  resource_type: string
  description?: string | null
  is_active: boolean
}

type FleetBooking = {
  id: string
  resource_id: string
  start_at: string
  end_at: string
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  admin_note?: string | null
  requester?: { id: string; full_name?: string | null; company_email?: string | null } | null
  reviewer?: { id: string; full_name?: string | null } | null
  resource?: FleetResource | null
  attachment_count?: number
}

type FleetAttachment = {
  id: string
  file_name: string
  mime_type: string
  file_size: number
  signed_url?: string | null
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return formatWATDateTime(parsed)
}

async function fetchFleetResources(): Promise<FleetResource[]> {
  const response = await fetch("/api/admin/hr/fleet/resources")
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "Failed to load resources")
  return payload.data || []
}

async function fetchFleetBookings(): Promise<FleetBooking[]> {
  const response = await fetch(`/api/admin/hr/fleet/bookings`)
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
        const response = await fetch("/api/admin/hr/fleet/bookings?status=pending", { cache: "no-store" })
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
      const response = await fetch("/api/admin/hr/fleet/resources", {
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
      const response = await fetch("/api/admin/hr/fleet/resources", {
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
      const response = await fetch(`/api/fleet/bookings/${booking.id}/attachments`)
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
      const response = await fetch(`/api/admin/hr/fleet/bookings/${selectedBooking.id}/review`, {
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
        label: "Approver",
        accessor: (r) => r.reviewer?.full_name || "-",
        hideOnMobile: true,
        render: (r) => <span className="text-xs">{r.reviewer?.full_name || "-"}</span>,
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
        title="Shared Resource Admin"
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
      title="Shared Resource Admin"
      description="Manage bookable resources and review booking applications"
      icon={CalendarCheck2}
      backLink={{ href: "/admin/hr", label: "Back to HR Dashboard" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            title="Pending Review"
            value={pendingCount}
            icon={CalendarCheck2}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Approved"
            value={approvedCount}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
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
            <Plus className="mr-2 h-4 w-4" />
            Add Resource
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

      <Dialog open={isResourceDialogOpen} onOpenChange={setIsResourceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Resource</DialogTitle>
            <DialogDescription>Create additional bookable items for shared resource booking.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={resourceName}
                onChange={(e) => setResourceName(e.target.value)}
                placeholder="Delivery Car"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Input value={resourceType} onChange={(e) => setResourceType(e.target.value)} placeholder="vehicle" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={resourceDescription}
                onChange={(e) => setResourceDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResourceDialogOpen(false)} disabled={savingResource}>
              Cancel
            </Button>
            <Button onClick={createResource} disabled={savingResource || resourceName.trim().length < 2}>
              {savingResource ? "Saving..." : "Create Resource"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedBooking)} onOpenChange={(open) => (!open ? setSelectedBooking(null) : null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Resource Booking</DialogTitle>
            <DialogDescription>Confirm the reason and supporting files before approval.</DialogDescription>
          </DialogHeader>

          {selectedBooking ? (
            <div className="space-y-4 py-2">
              <div className="bg-muted/30 rounded border p-3">
                <p className="font-medium">{selectedBooking.resource?.name || "Resource"}</p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(selectedBooking.start_at)} - {formatDateTime(selectedBooking.end_at)}
                </p>
                <p className="mt-2 text-sm">{selectedBooking.reason}</p>
              </div>

              <div className="space-y-2">
                <Label>Attachments</Label>
                {attachments.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No attachments provided.</p>
                ) : null}
                {attachments.map((file) => (
                  <div key={file.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <div>
                      <p>{file.file_name}</p>
                      <p className="text-muted-foreground text-xs">
                        {file.mime_type} • {(file.file_size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    {file.signed_url ? (
                      <a
                        href={file.signed_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary text-sm hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs">Unavailable</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Admin Note</Label>
                <Textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={3}
                  placeholder="Add a note to explain your decision..."
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedBooking(null)}>
              Close
            </Button>
            {selectedBooking?.status === "pending" ? (
              <>
                <Button variant="destructive" onClick={() => review("reject")} disabled={reviewing}>
                  Reject
                </Button>
                <Button onClick={() => review("approve")} disabled={reviewing}>
                  Approve
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
