"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { FormFieldGroup } from "@/components/ui/patterns"
import { QUERY_KEYS } from "@/lib/query-keys"
import { toast } from "sonner"
import type { QueryClient } from "@tanstack/react-query"

export interface SupplierFormValues {
  id?: string
  name: string
  code: string
  email: string
  phone: string
  address: string
  contact_person: string
  is_active: boolean
}

interface SupplierFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queryClient?: QueryClient
  supplier?: SupplierFormValues | null
}

const defaultValues: SupplierFormValues = {
  name: "",
  code: "",
  email: "",
  phone: "",
  address: "",
  contact_person: "",
  is_active: true,
}

export function SupplierFormDialog({ open, onOpenChange, queryClient, supplier = null }: SupplierFormDialogProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState<SupplierFormValues>(defaultValues)

  useEffect(() => {
    if (!open) return
    setFormData(supplier ? { ...supplier } : defaultValues)
  }, [open, supplier])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: formData.name,
        code: formData.code,
        email: formData.email || null,
        phone: formData.phone || null,
        address: formData.address || null,
        contact_person: formData.contact_person || null,
        is_active: formData.is_active,
      }

      if (supplier?.id) {
        const res = await fetch(`/api/admin/purchasing/suppliers/${supplier.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to update supplier")
        toast.success("Supplier updated")
        await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminSupplierDetail(supplier.id) })
      } else {
        const res = await fetch("/api/admin/purchasing/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to create supplier")
        toast.success("Supplier created")
      }

      await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminSuppliers() })
      onOpenChange(false)
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{supplier?.id ? "Edit" : "Add"} Supplier</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormFieldGroup label="Name *">
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </FormFieldGroup>
              <FormFieldGroup label="Code *">
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g., SUP-001"
                  required
                />
              </FormFieldGroup>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormFieldGroup label="Email">
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </FormFieldGroup>
              <FormFieldGroup label="Phone">
                <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </FormFieldGroup>
            </div>
            <FormFieldGroup label="Contact Person">
              <Input
                value={formData.contact_person}
                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
              />
            </FormFieldGroup>
            <FormFieldGroup label="Address">
              <Textarea
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                rows={2}
              />
            </FormFieldGroup>
            <FormFieldGroup label="Active">
              <div className="flex items-center justify-end">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                />
              </div>
            </FormFieldGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {supplier?.id ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
