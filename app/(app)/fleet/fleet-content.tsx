"use client"

import { useMemo, useState } from "react"
import { formatWATDateTime } from "@/lib/utils/date"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { CalendarClock, Car, Paperclip, Plus } from "lucide-react"
import { toast } from "sonner"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { apiFetch } from "@/lib/api-client"

type FleetResource = {
  id: string
  name: string
  resource_type: string
  description?: string | null
  is_active: boolean
}

type FleetAttachment = {
  id: string
  file_name: string
  mime_type: string
  file_size: number
}

type FleetBooking = {
  id: string
  resource_id: string
  start_at: string
  end_at: string
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  admin_note?: string | null
  created_at: string
  resource?: FleetResource | null
  reviewer?: { id: string; full_name?: string | null } | null
  attachments?: FleetAttachment[]
}

type FleetSchedule = {
  id: string
  resource_id: string
  start_at: string
  end_at: string
  status: "pending" | "approved"
}

type FleetBookingRow = FleetBooking & {
  resourceName: string
  timeRange: string
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return formatWATDateTime(parsed, { day: "2-digit", month: "short", year: "numeric" })
}

function toLocalDateTimeInput(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function fetchFleetResources(): Promise<FleetResource[]> {
  const response = await apiFetch("/api/fleet/resources")
  if (!response.ok) throw new Error("Failed to load fleet resources")
  const payload = await response.json()
  return payload.data || []
}

async function fetchFleetBookings(): Promise<{ bookings: FleetBooking[]; schedule: FleetSchedule[] }> {
  const response = await apiFetch("/api/fleet/bookings")
  if (!response.ok) throw new Error("Failed to load fleet bookings")
  const payload = await response.json()
  return { bookings: payload.data || [], schedule: payload.resource_schedule || [] }
}

export function FleetContent() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [resourceId, setResourceId] = useState("")
  const [startAt, setStartAt] = useState("")
  const [endAt, setEndAt] = useState("")
  const [reason, setReason] = useState("")
  const [files, setFiles] = useState<File[]>([])

  const hasInvalidWindow = useMemo(() => {
    if (!startAt || !endAt) return false
    const start = new Date(startAt).getTime()
    const end = new Date(endAt).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) return false
    return end <= start
  }, [startAt, endAt])

  const canSubmit = resourceId && startAt && endAt && reason.trim().length >= 10 && !hasInvalidWindow

  const { data: resources = [] } = useQuery({
    queryKey: QUERY_KEYS.fleetResources(),
    queryFn: fetchFleetResources,
  })

  const {
    data: bookingsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.fleetBookings(),
    queryFn: fetchFleetBookings,
  })

  const bookings = useMemo(() => bookingsData?.bookings ?? [], [bookingsData?.bookings])

  const selectedResourceSchedule = useMemo(() => {
    if (!resourceId) return []
    return (bookingsData?.schedule ?? []).filter((slot) => slot.resource_id === resourceId)
  }, [resourceId, bookingsData?.schedule])

  const currentWindowConflicts = useMemo(() => {
    if (!resourceId || !startAt || !endAt) return []
    const start = new Date(startAt).getTime()
    const end = new Date(endAt).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) return []
    return selectedResourceSchedule.filter((slot) => {
      const slotStart = new Date(slot.start_at).getTime()
      const slotEnd = new Date(slot.end_at).getTime()
      return slotStart < end && slotEnd > start
    })
  }, [resourceId, startAt, endAt, selectedResourceSchedule])

  const { mutate: submitBooking, isPending: submitting } = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await apiFetch("/api/fleet/bookings", { method: "POST", body: formData })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to submit booking")
      return payload
    },
    onSuccess: () => {
      toast.success("Booking application submitted")
      setOpen(false)
      setResourceId("")
      setStartAt("")
      setEndAt("")
      setReason("")
      setFiles([])
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleetBookings() })
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : "Failed to submit booking")
    },
  })

  function handleSubmit() {
    if (!canSubmit) {
      if (hasInvalidWindow) {
        toast.error("End date and time must be after the start date and time.")
        return
      }
      toast.error("Please complete all required fields. Reason must be at least 10 characters.")
      return
    }
    const formData = new FormData()
    formData.append("resource_id", resourceId)
    formData.append("start_at", new Date(startAt).toISOString())
    formData.append("end_at", new Date(endAt).toISOString())
    formData.append("reason", reason.trim())
    files.forEach((file) => formData.append("attachments", file))
    submitBooking(formData)
  }

  async function handleCancel(bookingId: string) {
    setCancelingId(bookingId)
    try {
      const response = await apiFetch(`/api/fleet/bookings/${bookingId}/cancel`, { method: "PATCH" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to cancel booking")
      toast.success("Booking cancelled")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleetBookings() })
    } catch (cancelError) {
      toast.error(cancelError instanceof Error ? cancelError.message : "Failed to cancel booking")
    } finally {
      setCancelingId(null)
    }
  }

  const rows = useMemo<FleetBookingRow[]>(
    () =>
      bookings.map((booking) => ({
        ...booking,
        resourceName: booking.resource?.name || "Resource",
        timeRange: `${formatDateTime(booking.start_at)} - ${formatDateTime(booking.end_at)}`,
      })),
    [bookings]
  )

  const columns = useMemo<DataTableColumn<FleetBookingRow>[]>(
    () => [
      {
        key: "resource",
        label: "Resource",
        sortable: true,
        accessor: (row) => row.resourceName,
        render: (row) => <span className="font-medium">{row.resourceName}</span>,
      },
      {
        key: "timeRange",
        label: "Schedule",
        sortable: true,
        accessor: (row) => row.timeRange,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => row.status,
        render: (row) => (
          <Badge
            variant={
              row.status === "approved"
                ? "default"
                : row.status === "pending"
                  ? "secondary"
                  : row.status === "rejected"
                    ? "destructive"
                    : "outline"
            }
          >
            {row.status}
          </Badge>
        ),
      },
      {
        key: "attachments",
        label: "Files",
        sortable: true,
        accessor: (row) => row.attachments?.length || 0,
        render: (row) => (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-3.5 w-3.5" />
            {(row.attachments || []).length}
          </span>
        ),
        hideOnMobile: true,
      },
      {
        key: "created_at",
        label: "Submitted",
        sortable: true,
        accessor: (row) => row.created_at,
        render: (row) => formatDateTime(row.created_at),
        hideOnMobile: true,
      },
      {
        key: "reviewer",
        label: "Approver",
        sortable: true,
        accessor: (row) => row.reviewer?.full_name || "-",
        render: (row) => row.reviewer?.full_name || "-",
        hideOnMobile: true,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<FleetBookingRow>[]>(
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
        key: "resource",
        label: "Resource",
        mode: "custom",
        options: Array.from(new Set(rows.map((row) => row.resourceName))).map((name) => ({ value: name, label: name })),
        filterFn: (row, selected) => selected.includes(row.resourceName),
      },
    ],
    [rows]
  )

  const stats = useMemo(
    () => ({
      total: rows.length,
      pending: rows.filter((row) => row.status === "pending").length,
      approved: rows.filter((row) => row.status === "approved").length,
      occupiedSlots: selectedResourceSchedule.length,
    }),
    [rows, selectedResourceSchedule.length]
  )

  return (
    <DataTablePage
      title="Shared Resource Booking Center"
      description="Book shared resources like transport and spaces without time clashes."
      icon={Car}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      actions={
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Application
        </Button>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Applications"
            value={stats.total}
            icon={Car}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={CalendarClock}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Approved"
            value={stats.approved}
            icon={CalendarClock}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Occupied Slots"
            value={stats.occupiedSlots}
            icon={CalendarClock}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<FleetBookingRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search resource, reason, or schedule..."
        searchFn={(row, query) => `${row.resourceName} ${row.reason} ${row.timeRange}`.toLowerCase().includes(query)}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        rowActions={[
          {
            label: "Cancel",
            onClick: (row) => {
              void handleCancel(row.id)
            },
            hidden: (row) =>
              !(row.status === "pending" && new Date(row.start_at).getTime() > Date.now()) || cancelingId === row.id,
          },
        ]}
        expandable={{
          render: (row) => (
            <div className="space-y-3">
              <div>
                <p className="text-muted-foreground text-xs uppercase">Reason</p>
                <p className="text-sm">{row.reason}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase">Admin Note</p>
                <p className="text-sm">{row.admin_note || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase">Approver</p>
                <p className="text-sm">{row.reviewer?.full_name || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase">Attachments</p>
                <p className="text-sm">{(row.attachments || []).length} file(s)</p>
              </div>
            </div>
          ),
        }}
        emptyTitle="No resource booking applications"
        emptyDescription="You have not submitted any resource booking applications yet."
        emptyIcon={Car}
        skeletonRows={5}
        urlSync
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resource Booking Application</DialogTitle>
            <DialogDescription>Provide date/time, reason, and optional files (PDF/images).</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Resource</Label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select resource" />
                </SelectTrigger>
                <SelectContent>
                  {resources.map((resource) => (
                    <SelectItem key={resource.id} value={resource.id}>
                      {resource.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Start Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={toLocalDateTimeInput(startAt)}
                  onChange={(event) => setStartAt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={toLocalDateTimeInput(endAt)}
                  min={startAt || undefined}
                  onChange={(event) => setEndAt(event.target.value)}
                />
              </div>
            </div>

            {hasInvalidWindow ? (
              <div className="border-destructive/40 bg-destructive/5 rounded border p-3 text-sm">
                <p className="font-medium">Invalid time window</p>
                <p className="text-muted-foreground">End date and time must be after start date and time.</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Reason (required)</Label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="State the business reason for this booking"
                rows={4}
              />
              <p className="text-muted-foreground text-xs">Minimum 10 characters</p>
            </div>

            <div className="space-y-2">
              <Label>Attachments (optional)</Label>
              <Input
                type="file"
                accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
              <p className="text-muted-foreground text-xs">Accepted: PDF, JPG, JPEG, PNG, WEBP (max 10MB each).</p>
            </div>

            {currentWindowConflicts.length > 0 ? (
              <div className="border-destructive/40 bg-destructive/5 rounded border p-3 text-sm">
                <p className="font-medium">Time clash detected</p>
                <p className="text-muted-foreground">This slot overlaps an existing pending/approved booking.</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || currentWindowConflicts.length > 0 || hasInvalidWindow}
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
