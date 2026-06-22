"use client"

import { useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Ban, Building2, CheckCircle2, Eye, Mail, Pencil, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { SupplierFormDialog } from "./_components/supplier-form-dialog"

interface Supplier {
  id: string
  name: string
  code: string
  email: string | null
  phone: string | null
  address: string | null
  contact_person: string | null
  is_active: boolean
  created_at: string
}

async function fetchSuppliersList(): Promise<Supplier[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from("suppliers").select("*").order("name")

  if (error) {
    if (error.code === "42P01") {
      return []
    }
    throw new Error(error.message)
  }

  return data || []
}

function getContactState(supplier: Supplier) {
  if (supplier.email && supplier.phone) return "Complete"
  if (supplier.email || supplier.phone) return "Partial"
  return "Missing"
}

export default function SuppliersPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [isDialogOpen, setIsDialogOpen] = useState(searchParams.get("openCreate") === "1")
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Supplier | null>(null)
  const [isDeletingSupplier, setIsDeletingSupplier] = useState(false)

  const {
    data: suppliers = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminSuppliers(),
    queryFn: fetchSuppliersList,
  })

  async function handleDelete(supplier: Supplier) {
    try {
      const supabase = createClient()
      const { error: deleteError } = await supabase.from("suppliers").delete().eq("id", supplier.id)

      if (deleteError) throw deleteError

      toast.success("Supplier deleted")
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminSuppliers() })
    } catch (deleteError: unknown) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Failed to delete supplier")
    }
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier)
    setIsDialogOpen(true)
  }

  function openCreate() {
    setEditing(null)
    setIsDialogOpen(true)
  }

  const stats = useMemo(() => {
    const total = suppliers.length
    const active = suppliers.filter((supplier) => supplier.is_active).length
    const inactive = suppliers.filter((supplier) => !supplier.is_active).length
    const contactReady = suppliers.filter((supplier) => getContactState(supplier) === "Complete").length

    return { total, active, inactive, contactReady }
  }, [suppliers])

  const statusOptions = useMemo(
    () => [
      { value: "Active", label: "Active" },
      { value: "Inactive", label: "Inactive" },
    ],
    []
  )

  const contactOptions = useMemo(
    () => [
      { value: "Complete", label: "Complete" },
      { value: "Partial", label: "Partial" },
      { value: "Missing", label: "Missing" },
    ],
    []
  )

  const columns = useMemo<DataTableColumn<Supplier>[]>(
    () => [
      {
        key: "code",
        label: "Code",
        sortable: true,
        accessor: (supplier) => supplier.code,
        render: (supplier) => <span className="font-mono text-sm">{supplier.code}</span>,
        hideOnMobile: true,
      },
      {
        key: "name",
        label: "Supplier",
        sortable: true,
        accessor: (supplier) => supplier.name,
        resizable: true,
        initialWidth: 220,
        render: (supplier) => (
          <div className="space-y-1">
            <p className="font-medium">{supplier.name}</p>
            <p className="text-muted-foreground text-xs">Added {formatWATDate(supplier.created_at)}</p>
          </div>
        ),
      },
      {
        key: "contact_person",
        label: "Contact",
        accessor: (supplier) => supplier.contact_person || "",
        render: (supplier) => <span>{supplier.contact_person || "No contact person"}</span>,
        hideOnMobile: true,
      },
      {
        key: "email",
        label: "Email",
        accessor: (supplier) => supplier.email || "",
        resizable: true,
        initialWidth: 220,
        render: (supplier) => <span className="text-muted-foreground text-sm">{supplier.email || "No email"}</span>,
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        accessor: (supplier) => (supplier.is_active ? "Active" : "Inactive"),
        render: (supplier) => (
          <Badge variant={supplier.is_active ? "default" : "secondary"}>
            {supplier.is_active ? "Active" : "Inactive"}
          </Badge>
        ),
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<Supplier>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: statusOptions,
      },
      {
        key: "contact_state",
        label: "Contact Coverage",
        mode: "custom",
        options: contactOptions,
        filterFn: (supplier, value) => {
          if (Array.isArray(value)) {
            return value.includes(getContactState(supplier))
          }
          return getContactState(supplier) === value
        },
      },
    ],
    [contactOptions, statusOptions]
  )

  return (
    <DataTablePage
      title="Suppliers"
      description="Manage vendor records, contact readiness, and supplier status."
      icon={Users}
      backLink={{ href: "/admin/purchasing", label: "Back to Purchasing" }}
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Supplier
        </Button>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Suppliers"
            value={stats.total}
            icon={Building2}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Active"
            value={stats.active}
            icon={CheckCircle2}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Inactive"
            value={stats.inactive}
            icon={Ban}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
          <StatCard
            title="Contact Ready"
            value={stats.contactReady}
            icon={Mail}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<Supplier>
        data={suppliers}
        columns={columns}
        filters={filters}
        getRowId={(supplier) => supplier.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search supplier name, code, contact, or email..."
        searchFn={(supplier, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            supplier.name.toLowerCase().includes(normalizedQuery) ||
            supplier.code.toLowerCase().includes(normalizedQuery) ||
            (supplier.contact_person || "").toLowerCase().includes(normalizedQuery) ||
            (supplier.email || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        rowActions={[
          {
            label: "View Orders",
            icon: Eye,
            onClick: (supplier) => router.push(`/admin/purchasing/suppliers/${supplier.id}`),
          },
          {
            label: "Edit",
            icon: Pencil,
            onClick: (supplier) => openEdit(supplier),
          },
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            onClick: (supplier) => setPendingDelete(supplier),
          },
        ]}
        expandable={{
          render: (supplier) => (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Contact Person</p>
                <p className="mt-2 text-sm">{supplier.contact_person || "No contact person assigned"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Email</p>
                <p className="mt-2 text-sm">{supplier.email || "No email on file"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Phone</p>
                <p className="mt-2 text-sm">{supplier.phone || "No phone number on file"}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Address</p>
                <p className="mt-2 text-sm">{supplier.address || "No address on file"}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(supplier) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{supplier.name}</p>
                <p className="text-muted-foreground text-sm">{supplier.code}</p>
              </div>
              <Badge variant={supplier.is_active ? "default" : "secondary"}>
                {supplier.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="grid gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Contact</span>
                <span>{supplier.contact_person || "None"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{supplier.phone || "None"}</span>
              </div>
            </div>
          </div>
        )}
        emptyTitle="No suppliers yet"
        emptyDescription="Add your first supplier to start managing vendors."
        emptyIcon={Users}
        skeletonRows={5}
        urlSync
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `Delete supplier ${pendingDelete.name}?` : "Are you sure?"} This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingSupplier}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isDeletingSupplier}
              onClick={async () => {
                if (pendingDelete) {
                  setIsDeletingSupplier(true)
                  try {
                    await handleDelete(pendingDelete)
                    setPendingDelete(null)
                  } finally {
                    setIsDeletingSupplier(false)
                  }
                }
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SupplierFormDialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open)
          if (!open) {
            setEditing(null)
          }
        }}
        queryClient={queryClient}
        supplier={
          editing
            ? {
                id: editing.id,
                name: editing.name,
                code: editing.code,
                email: editing.email || "",
                phone: editing.phone || "",
                address: editing.address || "",
                contact_person: editing.contact_person || "",
                is_active: editing.is_active,
              }
            : null
        }
      />
    </DataTablePage>
  )
}
