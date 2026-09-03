"use client"

import { useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { formatWATDate } from "@/lib/utils/date"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatCard } from "@/components/ui/stat-card"
import { UserCheck, Upload, Trash2, Camera, CheckCircle2, XCircle, AlertCircle, Users } from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

interface EmployeeRemoteAccess {
  user_id: string
  employee_number: string
  user_name: string
  department: string
  remote_checkin_enabled: boolean
  face_photo_set: boolean
  last_remote_checkin: string | null
}

function formatDate(d: string | null) {
  if (!d) return "Never"
  return formatWATDate(d, { month: "short", day: "numeric", year: "numeric" })
}

async function fetchEmployees(dept: string): Promise<{ data: EmployeeRemoteAccess[]; departments: string[] }> {
  const params = dept && dept !== "all" ? `?department=${encodeURIComponent(dept)}` : ""
  const res = await apiFetch(`/api/admin/hr/attendance/remote-access${params}`)
  if (!res.ok) throw new Error("Failed to load employees")
  return res.json()
}

export default function RemoteAccessPage() {
  const queryClient = useQueryClient()
  const [deptFilter, setDeptFilter] = useState("all")
  const [uploadUserId, setUploadUserId] = useState<string | null>(null)
  const [uploadUserName, setUploadUserName] = useState("")
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["admin-remote-access", deptFilter],
    queryFn: () => fetchEmployees(deptFilter),
  })

  const employees = data?.data ?? []
  const departments = data?.departments ?? []

  const toggleMutation = useMutation({
    mutationFn: async ({ userId, enabled }: { userId: string; enabled: boolean }) => {
      const res = await apiFetch(`/api/admin/hr/attendance/remote-access/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remote_checkin_enabled: enabled }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to update")
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-remote-access"] }),
    onError: (err: Error) => toast.error(err.message),
  })

  const removePhotoMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiFetch(`/api/admin/hr/attendance/remote-access/${userId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to remove photo")
    },
    onSuccess: () => {
      toast.success("Reference photo removed")
      queryClient.invalidateQueries({ queryKey: ["admin-remote-access"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function openUploadDialog(emp: EmployeeRemoteAccess) {
    setUploadUserId(emp.user_id)
    setUploadUserName(emp.user_name)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !uploadUserId) return

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("photo", file)
      const res = await apiFetch(`/api/admin/hr/attendance/remote-access/${uploadUserId}`, {
        method: "POST",
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Upload failed")
      }
      toast.success(`Reference photo updated for ${uploadUserName}`)
      queryClient.invalidateQueries({ queryKey: ["admin-remote-access"] })
      setUploadUserId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const columns: DataTableColumn<EmployeeRemoteAccess>[] = [
    {
      key: "user_name",
      label: "Employee",
      sortable: true,
      accessor: (e) => e.user_name,
      render: (e) => (
        <div>
          <p className="font-medium">{e.user_name}</p>
          <p className="text-muted-foreground text-xs">{e.employee_number || "—"}</p>
        </div>
      ),
    },
    {
      key: "department",
      label: "Department",
      sortable: true,
      accessor: (e) => e.department,
      hideOnMobile: true,
      render: (e) => <span className="text-sm">{e.department || "—"}</span>,
    },
    {
      key: "remote_checkin_enabled",
      label: "Remote Check-In",
      sortable: true,
      accessor: (e) => (e.remote_checkin_enabled ? 1 : 0),
      render: (e) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={e.remote_checkin_enabled}
            onCheckedChange={(val) => toggleMutation.mutate({ userId: e.user_id, enabled: val })}
          />
          <span
            className={`text-xs font-medium ${e.remote_checkin_enabled ? "text-green-600" : "text-muted-foreground"}`}
          >
            {e.remote_checkin_enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      ),
    },
    {
      key: "face_photo",
      label: "Face Photo",
      sortable: true,
      accessor: (e) => (e.face_photo_set ? 1 : 0),
      render: (e) =>
        e.face_photo_set ? (
          <Badge className="gap-1 bg-green-100 text-green-800">
            <CheckCircle2 className="h-3 w-3" />
            Set
          </Badge>
        ) : (
          <Badge className="gap-1 bg-amber-100 text-amber-800">
            <AlertCircle className="h-3 w-3" />
            Missing
          </Badge>
        ),
      align: "center",
    },
    {
      key: "last_remote_checkin",
      label: "Last Remote Check-In",
      sortable: true,
      accessor: (e) => e.last_remote_checkin ?? "",
      hideOnMobile: true,
      render: (e) => (
        <span className={`text-sm ${!e.last_remote_checkin ? "text-muted-foreground" : ""}`}>
          {formatDate(e.last_remote_checkin)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      accessor: () => "",
      render: (e) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => openUploadDialog(e)}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {e.face_photo_set ? "Replace Photo" : "Upload Photo"}
          </Button>
          {e.face_photo_set && (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-600"
              onClick={() => removePhotoMutation.mutate(e.user_id)}
              disabled={removePhotoMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
      align: "right",
    },
  ]

  const tableFilters: DataTableFilter<EmployeeRemoteAccess>[] = [
    {
      key: "remote_checkin_enabled",
      label: "Status",
      mode: "custom",
      options: [
        { value: "1", label: "Enabled" },
        { value: "0", label: "Disabled" },
      ],
      placeholder: "All Statuses",
      filterFn: (emp, selected) => selected.includes(String(emp.remote_checkin_enabled ? 1 : 0)),
    },
    {
      key: "face_photo",
      label: "Face Photo",
      mode: "custom",
      options: [
        { value: "set", label: "Photo Set" },
        { value: "missing", label: "Photo Missing" },
      ],
      placeholder: "All",
      filterFn: (emp, selected) => selected.includes(emp.face_photo_set ? "set" : "missing"),
    },
  ]

  if (departments.length > 0) {
    tableFilters.push({
      key: "department",
      label: "Department",
      mode: "column",
      options: departments.map((d) => ({ value: d, label: d })),
      placeholder: "All Departments",
    })
  }

  const enabledCount = employees.filter((e) => e.remote_checkin_enabled).length
  const photoSetCount = employees.filter((e) => e.face_photo_set).length

  return (
    <>
      <DataTablePage
        title="Remote Check-In Access"
        description="Enable or disable remote check-in per employee and manage their reference face photos."
        icon={UserCheck}
        backLink={{ href: "/admin/hr/attendance", label: "Back to Attendance" }}
        stats={
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
            <StatCard
              variant="compact"
              title="Total Employees"
              value={employees.length}
              icon={Users}
              iconBgColor="bg-blue-500/10"
              iconColor="text-blue-500"
            />
            <StatCard
              variant="compact"
              title="Remote Enabled"
              value={enabledCount}
              icon={UserCheck}
              iconBgColor="bg-emerald-500/10"
              iconColor="text-emerald-500"
            />
            <StatCard
              variant="compact"
              title="Face Photo Set"
              value={photoSetCount}
              icon={Camera}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
            <StatCard
              variant="compact"
              title="Ready for Remote"
              value={employees.filter((e) => e.remote_checkin_enabled && e.face_photo_set).length}
              icon={CheckCircle2}
              iconBgColor="bg-purple-500/10"
              iconColor="text-purple-500"
              className="hidden sm:block"
            />
          </div>
        }
      >
        <DataTable<EmployeeRemoteAccess>
          data={employees}
          columns={columns}
          filters={tableFilters}
          getRowId={(e) => e.user_id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search by name or employee number…"
          searchFn={(e, q) =>
            [e.user_name, e.employee_number, e.department].join(" ").toLowerCase().includes(q.toLowerCase())
          }
          isLoading={isLoading}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (e) => (e.remote_checkin_enabled ? "bg-emerald-500" : "bg-slate-400"),
            title: (e) => `${e.user_name} · ${e.employee_number}`,
            subtitle: (e) =>
              `${e.department} · Photo: ${e.face_photo_set ? "Set" : "Missing"} · Last: ${formatDate(e.last_remote_checkin)}`,
            trailing: (e) => (
              <Badge
                className={`text-[10px] ${e.remote_checkin_enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-800"}`}
              >
                {e.remote_checkin_enabled ? "Enabled" : "Disabled"}
              </Badge>
            ),
            onSelect: (e) => openUploadDialog(e),
          }}
          cardRenderer={(e) => (
            <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{e.user_name}</p>
                  <p className="text-muted-foreground text-xs">
                    {e.department} · {e.employee_number}
                  </p>
                </div>
                <Badge
                  className={`text-[10px] ${e.remote_checkin_enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-800"}`}
                >
                  {e.remote_checkin_enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-t pt-2 text-[10px]">
                <span>Photo: {e.face_photo_set ? "Set" : "Missing"}</span>
                <span>Last: {formatDate(e.last_remote_checkin)}</span>
              </div>
            </div>
          )}
          emptyTitle="No employees found"
          emptyDescription="No employees match the current filters."
          emptyIcon={UserCheck}
          skeletonRows={6}
        />
      </DataTablePage>

      {/* Hidden file input for photo upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handlePhotoUpload}
      />

      {/* Upload confirmation dialog */}
      <Dialog
        open={Boolean(uploadUserId)}
        onOpenChange={(open) => {
          if (!open && !uploading) setUploadUserId(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Upload Reference Photo
            </DialogTitle>
            <DialogDescription>
              Upload a clear, front-facing photo of <strong>{uploadUserName}</strong>. This photo is used to verify
              their identity during remote check-in. Only admins can view or change this photo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <ul className="text-muted-foreground space-y-1 text-xs">
              <li>• Good lighting, face clearly visible</li>
              <li>• No sunglasses, hat or face covering</li>
              <li>• JPEG, PNG, or WebP — max 10MB</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadUserId(null)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading…" : "Choose Photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
