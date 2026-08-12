"use client"

import { useMemo, useState } from "react"
import { formatWATDateTime, toLocalISODate } from "@/lib/utils/date"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { CalendarClock, Car, Paperclip, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Calendar } from "@/components/ui/calendar"
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
  requester_id: string
  start_at: string
  end_at: string
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  admin_note?: string | null
  created_at: string
  /** When the approver decided (approved or rejected). */
  reviewed_at?: string | null
  resource?: FleetResource | null
  requester?: {
    id: string
    full_name?: string | null
    department?: string | null
  } | null
  reviewer?: {
    id: string
    full_name?: string | null
    department?: string | null
    designation?: string | null
  } | null
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

async function fetchFleetBookings(scope: string = "all"): Promise<{ bookings: FleetBooking[]; schedule: FleetSchedule[] }> {
  const response = await apiFetch(`/api/fleet/bookings?scope=${scope}`)
  if (!response.ok) throw new Error("Failed to load fleet bookings")
  const payload = await response.json()
  return { bookings: payload.data || [], schedule: payload.resource_schedule || [] }
}

const FLEET_TABS = [
  { key: "all", label: "General Bookings" },
  { key: "my", label: "My Requests" },
]

export function FleetContent() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<"all" | "my">("all")
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [resourceId, setResourceId] = useState("")
  const [startAt, setStartAt] = useState("")
  const [endAt, setEndAt] = useState("")
  const [reason, setReason] = useState("")
  const [files, setFiles] = useState<File[]>([])

  const resetModalState = () => {
    setOpen(false)
    setEditingId(null)
    setResourceId("")
    setStartAt("")
    setEndAt("")
    setReason("")
    setFiles([])
  }

  const handleOpenEdit = (row: FleetBookingRow) => {
    setEditingId(row.id)
    setResourceId(row.resource_id)
    setStartAt(toLocalDateTimeInput(row.start_at))
    setEndAt(toLocalDateTimeInput(row.end_at))
    setReason(row.reason)
    setFiles([])
    setOpen(true)
  }

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
    queryKey: [...QUERY_KEYS.fleetBookings(), activeTab],
    queryFn: () => fetchFleetBookings(activeTab),
  })

  const bookings = useMemo(() => bookingsData?.bookings ?? [], [bookingsData?.bookings])

  const selectedResourceSchedule = useMemo(() => {
    if (!resourceId) return []
    return (bookingsData?.schedule ?? []).filter(
      (slot) => slot.resource_id === resourceId && (editingId ? slot.id !== editingId : true)
    )
  }, [resourceId, bookingsData?.schedule, editingId])

  /**
   * Days the selected resource is already taken, so the picker can grey them
   * out the way the leave calendar marks department-booked days. A slot can
   * span several days, so every day it touches counts.
   */
  const bookedDayKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const slot of selectedResourceSchedule) {
      const start = new Date(slot.start_at)
      const end = new Date(slot.end_at)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
      for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        keys.add(toLocalISODate(cursor))
      }
    }
    return keys
  }, [selectedResourceSchedule])

  const selectedRange = useMemo(() => {
    const from = startAt ? new Date(startAt) : undefined
    const to = endAt ? new Date(endAt) : undefined
    if (!from || Number.isNaN(from.getTime())) return undefined
    return { from, to: to && !Number.isNaN(to.getTime()) ? to : undefined }
  }, [startAt, endAt])

  /** Keeps the time part when the calendar changes only the day. */
  const withDate = (existing: string, day: Date, fallbackTime: string) => {
    const time = existing.includes("T") ? existing.slice(11, 16) : fallbackTime
    return `${toLocalISODate(day)}T${time}`
  }

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
      resetModalState()
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleetBookings() })
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : "Failed to submit booking")
    },
  })

  const { mutate: updateBooking, isPending: updating } = useMutation({
    mutationFn: async (payload: { resource_id: string; start_at: string; end_at: string; reason: string }) => {
      const response = await apiFetch(`/api/fleet/bookings/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const resPayload = await response.json()
      if (!response.ok) throw new Error(resPayload.error || "Failed to update booking")
      return resPayload
    },
    onSuccess: () => {
      toast.success("Booking updated")
      resetModalState()
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleetBookings() })
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : "Failed to update booking")
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

    if (editingId) {
      updateBooking({
        resource_id: resourceId,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        reason: reason.trim(),
      })
    } else {
      const formData = new FormData()
      formData.append("resource_id", resourceId)
      formData.append("start_at", new Date(startAt).toISOString())
      formData.append("end_at", new Date(endAt).toISOString())
      formData.append("reason", reason.trim())
      files.forEach((file) => formData.append("attachments", file))
      submitBooking(formData)
    }
  }

  async function handleDelete(bookingId: string) {
    setCancelingId(bookingId)
    try {
      const response = await apiFetch(`/api/fleet/bookings/${bookingId}`, { method: "DELETE" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete booking")
      }
      toast.success("Booking deleted successfully")
      setDeleteConfirmId(null)
      await refetch()
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.fleetBookings() })
    } catch (cancelError) {
      toast.error(cancelError instanceof Error ? cancelError.message : "Failed to delete booking")
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
        key: "requester",
        label: "Requested By",
        sortable: true,
        accessor: (row) => row.requester?.full_name || "Self",
        render: (row) => (
          <div className="text-xs">
            <p className="font-medium">{row.requester?.full_name || "Self"}</p>
            {row.requester?.department ? <p className="text-muted-foreground">{row.requester.department}</p> : null}
          </div>
        ),
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
        label: "Decision By",
        sortable: true,
        accessor: (row) => row.reviewer?.full_name || "-",
        render: (row) =>
          row.reviewer?.full_name ? (
            <div className="text-xs">
              <p className="font-medium">{row.reviewer.full_name}</p>
              {row.reviewer.department ? <p className="text-muted-foreground">{row.reviewer.department}</p> : null}
              {row.reviewed_at ? <p className="text-muted-foreground">{formatDateTime(row.reviewed_at)}</p> : null}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">Not yet reviewed</span>
          ),
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
      tabs={FLEET_TABS}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as "all" | "my")}
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
        forceRowActionsDropdown
        rowActions={[
          {
            label: "Edit",
            icon: Pencil,
            onClick: (row) => handleOpenEdit(row),
            hidden: (row) => row.status !== "pending",
          },
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            onClick: (row) => setDeleteConfirmId(row.id),
            hidden: (row) => row.status !== "pending" || cancelingId === row.id,
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
                <p className="text-muted-foreground text-xs uppercase">
                  {row.status === "rejected" ? "Rejected By" : "Approved By"}
                </p>
                {row.reviewer?.full_name ? (
                  <>
                    <p className="text-sm">
                      {row.reviewer.full_name}
                      {row.reviewer.department ? ` — ${row.reviewer.department}` : ""}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {row.reviewed_at ? formatDateTime(row.reviewed_at) : "Time not recorded"}
                    </p>
                  </>
                ) : (
                  <p className="text-sm">Not yet reviewed</p>
                )}
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

      <Dialog open={open} onOpenChange={resetModalState}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Resource Booking" : "Resource Booking Application"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update your pending resource booking request."
                : "Provide date/time, reason, and optional files (PDF/images)."}
            </DialogDescription>
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

            {resourceId ? (
              <div className="space-y-2">
                <Label>Pick Dates (Calendar)</Label>
                <div className="rounded-md border p-3">
                  <Calendar
                    mode="range"
                    selected={selectedRange}
                    onSelect={(range) => {
                      if (!range?.from) {
                        setStartAt("")
                        setEndAt("")
                        return
                      }
                      setStartAt(withDate(startAt, range.from, "09:00"))
                      if (range.to) setEndAt(withDate(endAt, range.to, "17:00"))
                    }}
                    showOutsideDays
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    modifiers={{ resource_busy: (date) => bookedDayKeys.has(toLocalISODate(date)) }}
                    modifiersClassNames={{ resource_busy: "bg-amber-100 text-amber-900 font-medium" }}
                    className="mx-auto"
                  />
                  <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-4 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-3 w-3 rounded bg-amber-100" />
                      Already booked
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="bg-muted h-3 w-3 rounded" />
                      Past dates unavailable
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
                Select a resource to see which dates are already taken.
              </div>
            )}

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

            {!editingId && (
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
            )}

            {currentWindowConflicts.length > 0 ? (
              <div className="border-destructive/40 bg-destructive/5 rounded border p-3 text-sm">
                <p className="font-medium">Time clash detected</p>
                <p className="text-muted-foreground">This slot overlaps an existing pending/approved booking.</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetModalState}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || updating || currentWindowConflicts.length > 0 || hasInvalidWindow}
            >
              {submitting || updating
                ? editingId
                  ? "Updating..."
                  : "Submitting..."
                : editingId
                  ? "Update Booking"
                  : "Submit Application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(isOpen) => !isOpen && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Resource Booking Request?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this pending resource booking request? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={cancelingId !== null}
              onClick={(e) => {
                e.preventDefault()
                if (deleteConfirmId) void handleDelete(deleteConfirmId)
              }}
            >
              {cancelingId !== null ? "Deleting..." : "Delete Booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
