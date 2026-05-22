"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, MapPin, Pencil, Plus, Trash2, Warehouse, WarehouseIcon, XCircle } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { StatCard } from "@/components/ui/stat-card"
import { FormFieldGroup } from "@/components/ui/patterns"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"

interface WarehouseData {
  id: string
  name: string
  code: string
  address: string | null
  is_active: boolean
  created_at: string
}

async function fetchWarehousesList(): Promise<WarehouseData[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from("warehouses").select("*").order("name")

  if (error && error.code !== "42P01") {
    throw new Error(error.message)
  }

  return data || []
}

function getRegionFromAddress(address: string | null) {
  if (!address) return "Unspecified"
  const segments = address
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
  return segments.at(-1) || address
}

export default function WarehousesPage() {
  const queryClient = useQueryClient()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WarehouseData | null>(null)
  const [formData, setFormData] = useState({ name: "", code: "", address: "", is_active: true })
  const [pendingDelete, setPendingDelete] = useState<WarehouseData | null>(null)

  const {
    data: warehouses = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminWarehouses(),
    queryFn: fetchWarehousesList,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      const supabase = createClient()

      if (editing) {
        const { error: updateError } = await supabase
          .from("warehouses")
          .update({
            name: formData.name,
            code: formData.code,
            address: formData.address || null,
            is_active: formData.is_active,
          })
          .eq("id", editing.id)

        if (updateError) throw updateError
        toast.success("Warehouse updated")
      } else {
        const { error: insertError } = await supabase.from("warehouses").insert({
          name: formData.name,
          code: formData.code,
          address: formData.address || null,
          is_active: formData.is_active,
        })

        if (insertError) throw insertError
        toast.success("Warehouse created")
      }

      setIsDialogOpen(false)
      setEditing(null)
      setFormData({ name: "", code: "", address: "", is_active: true })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminWarehouses() })
    } catch (submitError: unknown) {
      toast.error(submitError instanceof Error ? submitError.message : "Failed to save warehouse")
    }
  }

  async function handleDelete(warehouse: WarehouseData) {
    try {
      const supabase = createClient()
      const { error: deleteError } = await supabase.from("warehouses").delete().eq("id", warehouse.id)

      if (deleteError) throw deleteError

      toast.success("Warehouse deleted")
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminWarehouses() })
    } catch (deleteError: unknown) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Failed to delete warehouse")
    }
  }

  function openEdit(warehouse: WarehouseData) {
    setEditing(warehouse)
    setFormData({
      name: warehouse.name,
      code: warehouse.code,
      address: warehouse.address || "",
      is_active: warehouse.is_active,
    })
    setIsDialogOpen(true)
  }

  function openCreate() {
    setEditing(null)
    setFormData({ name: "", code: "", address: "", is_active: true })
    setIsDialogOpen(true)
  }

  const regionOptions = useMemo(
    () =>
      Array.from(new Set(warehouses.map((warehouse) => getRegionFromAddress(warehouse.address)).filter(Boolean)))
        .sort()
        .map((region) => ({
          value: region,
          label: region,
        })),
    [warehouses]
  )

  const statusOptions = useMemo(
    () => [
      { value: "Active", label: "Active" },
      { value: "Inactive", label: "Inactive" },
    ],
    []
  )

  const stats = useMemo(() => {
    const total = warehouses.length
    const active = warehouses.filter((warehouse) => warehouse.is_active).length
    const inactive = warehouses.filter((warehouse) => !warehouse.is_active).length
    const configuredAddresses = warehouses.filter((warehouse) => Boolean(warehouse.address?.trim())).length

    return { total, active, inactive, configuredAddresses }
  }, [warehouses])

  const columns = useMemo<DataTableColumn<WarehouseData>[]>(
    () => [
      {
        key: "code",
        label: "Code",
        sortable: true,
        hideOnMobile: true,
        accessor: (warehouse) => warehouse.code,
        render: (warehouse) => <span className="font-mono text-sm">{warehouse.code}</span>,
      },
      {
        key: "name",
        label: "Warehouse",
        sortable: true,
        accessor: (warehouse) => warehouse.name,
        resizable: true,
        initialWidth: 220,
        render: (warehouse) => (
          <div className="space-y-1">
            <p className="font-medium">{warehouse.name}</p>
            <p className="text-muted-foreground text-xs">
              Created {new Date(warehouse.created_at).toLocaleDateString()}
            </p>
          </div>
        ),
      },
      {
        key: "address",
        label: "Address",
        accessor: (warehouse) => warehouse.address || "",
        resizable: true,
        initialWidth: 280,
        hideOnMobile: true,
        render: (warehouse) => (
          <span className="text-muted-foreground line-clamp-2 text-sm">
            {warehouse.address || "No address provided"}
          </span>
        ),
      },
      {
        key: "region",
        label: "Region",
        accessor: (warehouse) => getRegionFromAddress(warehouse.address),
        hideOnMobile: true,
        render: (warehouse) => <Badge variant="outline">{getRegionFromAddress(warehouse.address)}</Badge>,
      },
      {
        key: "status",
        label: "Status",
        accessor: (warehouse) => (warehouse.is_active ? "Active" : "Inactive"),
        render: (warehouse) => (
          <Badge variant={warehouse.is_active ? "default" : "secondary"}>
            {warehouse.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<WarehouseData>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: statusOptions,
      },
      {
        key: "region",
        label: "Region",
        options: regionOptions,
      },
    ],
    [regionOptions, statusOptions]
  )

  const rowActions = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: (warehouse: WarehouseData) => openEdit(warehouse),
    },
    {
      label: "Delete",
      icon: Trash2,
      variant: "destructive" as const,
      onClick: (warehouse: WarehouseData) => setPendingDelete(warehouse),
    },
  ]

  return (
    <DataTablePage
      title="Warehouses"
      description="Manage storage locations, operating status, and warehouse coverage."
      icon={WarehouseIcon}
      backLink={{ href: "/admin/inventory", label: "Back to Inventory" }}
      actions={
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Warehouse
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit" : "Create"} Warehouse</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormFieldGroup label="Name">
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                      required
                    />
                  </FormFieldGroup>
                  <FormFieldGroup label="Code">
                    <Input
                      id="code"
                      value={formData.code}
                      onChange={(event) => setFormData({ ...formData, code: event.target.value })}
                      placeholder="e.g. WH-001"
                      required
                    />
                  </FormFieldGroup>
                </div>
                <FormFieldGroup label="Address">
                  <Textarea
                    id="address"
                    value={formData.address}
                    onChange={(event) => setFormData({ ...formData, address: event.target.value })}
                    rows={3}
                  />
                </FormFieldGroup>
                <FormFieldGroup label="Active">
                  <div className="flex items-center justify-end">
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                    />
                  </div>
                </FormFieldGroup>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editing ? "Update" : "Create"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Warehouses"
            value={stats.total}
            icon={Warehouse}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Active"
            value={stats.active}
            icon={BadgeCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Inactive"
            value={stats.inactive}
            icon={XCircle}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="With Address"
            value={stats.configuredAddresses}
            icon={MapPin}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<WarehouseData>
        data={warehouses}
        columns={columns}
        filters={filters}
        getRowId={(warehouse) => warehouse.id}
        searchPlaceholder="Search warehouse name, code, or address..."
        searchFn={(warehouse, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            warehouse.name.toLowerCase().includes(normalizedQuery) ||
            warehouse.code.toLowerCase().includes(normalizedQuery) ||
            (warehouse.address || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        rowActions={rowActions}
        expandable={{
          render: (warehouse) => (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Address</p>
                <p className="mt-2 text-sm">{warehouse.address || "No warehouse address on file."}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Region</p>
                <p className="mt-2 text-sm font-medium">{getRegionFromAddress(warehouse.address)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Status</p>
                <p className="mt-2 text-sm font-medium">
                  {warehouse.is_active ? "Currently active" : "Currently inactive"}
                </p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(warehouse) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{warehouse.name}</p>
                <p className="text-muted-foreground text-sm">{warehouse.code}</p>
              </div>
              <Badge variant={warehouse.is_active ? "default" : "secondary"}>
                {warehouse.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{warehouse.address || "No address provided"}</p>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Region</span>
                <span>{getRegionFromAddress(warehouse.address)}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No warehouses yet"
        emptyDescription="Add your first warehouse to start managing storage locations."
        emptyIcon={Warehouse}
        skeletonRows={5}
        urlSync
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Warehouse</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `Delete warehouse ${pendingDelete.name}?` : "Are you sure?"} This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) {
                  void handleDelete(pendingDelete)
                }
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
