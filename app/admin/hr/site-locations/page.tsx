"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MapPin, Plus, Pencil, Locate } from "lucide-react"
import { toast } from "sonner"

interface Site {
  id: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  radius_metres: number
  is_active: boolean
}

type SiteForm = {
  name: string
  address: string
  latitude: string
  longitude: string
  radius_metres: string
  is_active: boolean
}

const defaultForm: SiteForm = {
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  radius_metres: "150",
  is_active: true,
}

async function fetchSites(includeInactive: boolean): Promise<Site[]> {
  const res = await fetch(`/api/admin/hr/site-locations?include_inactive=${includeInactive}`)
  if (!res.ok) throw new Error("Failed to load sites")
  const data = await res.json()
  return (data.data || []) as Site[]
}

export default function SiteLocationsPage() {
  const queryClient = useQueryClient()
  const [includeInactive, setIncludeInactive] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editSite, setEditSite] = useState<Site | null>(null)
  const [form, setForm] = useState<SiteForm>(defaultForm)
  const [locating, setLocating] = useState(false)

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["admin-sites", includeInactive],
    queryFn: () => fetchSites(includeInactive),
  })

  const saveMutation = useMutation({
    mutationFn: async (payload: SiteForm) => {
      const body = {
        name: payload.name.trim(),
        address: payload.address.trim() || null,
        latitude: parseFloat(payload.latitude),
        longitude: parseFloat(payload.longitude),
        radius_metres: parseInt(payload.radius_metres, 10),
        is_active: payload.is_active,
      }
      const url = editSite ? `/api/admin/hr/site-locations/${editSite.id}` : "/api/admin/hr/site-locations"
      const method = editSite ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to save site")
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(editSite ? "Site updated" : "Site created")
      queryClient.invalidateQueries({ queryKey: ["admin-sites"] })
      setDialogOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const res = await fetch(`/api/admin/hr/site-locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active }),
      })
      if (!res.ok) throw new Error("Failed to update site")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sites"] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function openCreate() {
    setEditSite(null)
    setForm(defaultForm)
    setDialogOpen(true)
  }

  function openEdit(site: Site) {
    setEditSite(site)
    setForm({
      name: site.name,
      address: site.address || "",
      latitude: String(site.latitude),
      longitude: String(site.longitude),
      radius_metres: String(site.radius_metres),
      is_active: site.is_active,
    })
    setDialogOpen(true)
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(7),
          longitude: pos.coords.longitude.toFixed(7),
        }))
        setLocating(false)
        toast.success("Location captured")
      },
      () => {
        toast.error("Location access denied")
        setLocating(false)
      },
      { timeout: 10_000, enableHighAccuracy: true }
    )
  }

  const columns: DataTableColumn<Site>[] = [
    {
      key: "name",
      label: "Site Name",
      sortable: true,
      accessor: (s) => s.name,
      render: (s) => (
        <span className="flex items-center gap-2 font-medium">
          <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
          {s.name}
        </span>
      ),
    },
    {
      key: "address",
      label: "Address",
      accessor: (s) => s.address ?? "",
      hideOnMobile: true,
      render: (s) => <span className="text-muted-foreground text-sm">{s.address || "—"}</span>,
    },
    {
      key: "coordinates",
      label: "GPS Coordinates",
      accessor: (s) => `${s.latitude},${s.longitude}`,
      hideOnMobile: true,
      render: (s) => (
        <span className="font-mono text-xs">
          {Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}
        </span>
      ),
    },
    {
      key: "radius_metres",
      label: "Radius",
      sortable: true,
      accessor: (s) => s.radius_metres,
      hideOnMobile: true,
      render: (s) => <span className="text-sm">{s.radius_metres}m</span>,
      align: "center",
    },
    {
      key: "is_active",
      label: "Status",
      sortable: true,
      accessor: (s) => (s.is_active ? 1 : 0),
      render: (s) => (
        <Badge className={s.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}>
          {s.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
      align: "center",
    },
    {
      key: "actions",
      label: "",
      accessor: () => "",
      render: (s) => (
        <div className="flex items-center justify-end gap-2">
          <Switch
            checked={s.is_active}
            onCheckedChange={(val) => toggleActiveMutation.mutate({ id: s.id, is_active: val })}
            aria-label={s.is_active ? "Deactivate site" : "Activate site"}
          />
          <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      ),
      align: "right",
    },
  ]

  const activeSites = sites.filter((s) => s.is_active).length

  return (
    <>
      <DataTablePage
        title="Site Locations"
        description="GPS-registered ACOB site locations used for remote check-in proximity verification."
        icon={MapPin}
        backLink={{ href: "/admin/hr", label: "Back to HR" }}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} />
              Show inactive
            </label>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Site
            </Button>
          </div>
        }
        stats={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs">Total Sites</p>
              <p className="text-2xl font-bold">{sites.length}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs">Active</p>
              <p className="text-2xl font-bold text-green-600">{activeSites}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs">Inactive</p>
              <p className="text-2xl font-bold text-gray-400">{sites.length - activeSites}</p>
            </div>
          </div>
        }
      >
        <DataTable<Site>
          data={sites}
          columns={columns}
          getRowId={(s) => s.id}
          pagination={{ pageSize: 20 }}
          searchPlaceholder="Search by name or address…"
          searchFn={(s, q) => [s.name, s.address ?? ""].join(" ").toLowerCase().includes(q.toLowerCase())}
          isLoading={isLoading}
          emptyTitle="No sites found"
          emptyDescription="Add your first site location to enable remote check-in."
          emptyIcon={MapPin}
          skeletonRows={4}
        />
      </DataTablePage>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editSite ? "Edit Site" : "Add Site Location"}</DialogTitle>
            <DialogDescription>
              Register an ACOB site with GPS coordinates. Employees checking in remotely must be within the specified
              radius.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="site-name">Site Name *</Label>
              <Input
                id="site-name"
                placeholder="e.g. Lagos Main Office"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="site-address">Address</Label>
              <Input
                id="site-address"
                placeholder="e.g. 14 Commerce Road, Lagos"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="site-lat">Latitude *</Label>
                <Input
                  id="site-lat"
                  placeholder="e.g. 6.5244"
                  value={form.latitude}
                  onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="site-lng">Longitude *</Label>
                <Input
                  id="site-lng"
                  placeholder="e.g. 3.3792"
                  value={form.longitude}
                  onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                />
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={useMyLocation} disabled={locating} className="w-fit">
              <Locate className="mr-2 h-4 w-4" />
              {locating ? "Getting location…" : "📍 Use My Current Location"}
            </Button>

            <div className="grid gap-1.5">
              <Label htmlFor="site-radius">Check-in Radius (metres)</Label>
              <Input
                id="site-radius"
                type="number"
                min={10}
                max={10000}
                placeholder="150"
                value={form.radius_metres}
                onChange={(e) => setForm((f) => ({ ...f, radius_metres: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">
                Employees must be within this distance to have location verified (default 150m).
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="site-active"
                checked={form.is_active}
                onCheckedChange={(val) => setForm((f) => ({ ...f, is_active: val }))}
              />
              <Label htmlFor="site-active">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || !form.name.trim() || !form.latitude || !form.longitude}
            >
              {saveMutation.isPending ? "Saving…" : editSite ? "Save Changes" : "Create Site"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
