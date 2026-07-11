"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Package } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import { toast } from "sonner"
import { FormFieldGroup } from "@/components/ui/patterns"
import type { QueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api-client"

interface Category {
  id: string
  name: string
}

export interface ProductValues {
  id?: string
  sku: string
  name: string
  description: string
  category_id: string
  unit_cost: number
  selling_price: number
  quantity_on_hand: number
  reorder_level: number
  status: string
}

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queryClient?: QueryClient
  product?: ProductValues | null
}

async function fetchProductCategories(): Promise<Category[]> {
  const res = await apiFetch("/api/admin/inventory/categories/options", { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load categories")
  const json = await res.json()
  return json.data || []
}

const defaultFormData: ProductValues = {
  sku: "",
  name: "",
  description: "",
  category_id: "",
  unit_cost: 0,
  selling_price: 0,
  quantity_on_hand: 0,
  reorder_level: 10,
  status: "active",
}

export function ProductFormDialog({ open, onOpenChange, queryClient, product = null }: ProductFormDialogProps) {
  const router = useRouter()
  const isEditing = Boolean(product?.id)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState<ProductValues>(defaultFormData)

  const { data: categories = [] } = useQuery({
    queryKey: QUERY_KEYS.adminProductCategories(),
    queryFn: fetchProductCategories,
  })

  useEffect(() => {
    if (!open) return
    setFormData(product ? { ...product } : defaultFormData)
  }, [open, product])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.sku || !formData.name) return toast.error("SKU and Name are required")

    setSaving(true)
    try {
      const payload = {
        sku: formData.sku,
        name: formData.name,
        description: formData.description || null,
        category_id: formData.category_id || null,
        unit_cost: formData.unit_cost,
        selling_price: formData.selling_price,
        quantity_on_hand: formData.quantity_on_hand,
        reorder_level: formData.reorder_level,
        status: formData.status,
      }

      if (isEditing && product?.id) {
        const res = await apiFetch(`/api/admin/inventory/products/${product.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to update product")
        toast.success("Product updated")
        await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminProductDetail(product.id) })
      } else {
        const res = await apiFetch("/api/admin/inventory/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to create product")
        toast.success("Product created successfully!")
      }

      await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminProducts() })
      onOpenChange(false)
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save product")
    } finally {
      setSaving(false)
    }
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(amount)
  }

  const margin = formData.selling_price - formData.unit_cost
  const marginPercent = formData.unit_cost > 0 ? (margin / formData.unit_cost) * 100 : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {isEditing ? "Edit Product" : "Add Product"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this product without leaving the current page."
              : "Create a new product in your catalog without leaving the current page."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="SKU *">
                      <Input
                        value={formData.sku}
                        onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                        placeholder="e.g., PROD-001"
                        required
                      />
                    </FormFieldGroup>
                    <FormFieldGroup label="Product Name *">
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Product name"
                        required
                      />
                    </FormFieldGroup>
                  </div>
                  <FormFieldGroup label="Description">
                    <Textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Product description..."
                      rows={3}
                    />
                  </FormFieldGroup>
                  <FormFieldGroup label="Category">
                    <Select
                      value={formData.category_id}
                      onValueChange={(value) => setFormData({ ...formData, category_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormFieldGroup>
                  <FormFieldGroup label="Status">
                    <Select
                      value={formData.status}
                      onValueChange={(value) => setFormData({ ...formData, status: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="discontinued">Discontinued</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormFieldGroup>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pricing & Inventory</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="Unit Cost (NGN)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.unit_cost}
                        onChange={(e) => setFormData({ ...formData, unit_cost: parseFloat(e.target.value) || 0 })}
                      />
                    </FormFieldGroup>
                    <FormFieldGroup label="Selling Price (NGN)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.selling_price}
                        onChange={(e) => setFormData({ ...formData, selling_price: parseFloat(e.target.value) || 0 })}
                      />
                    </FormFieldGroup>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="Quantity on Hand">
                      <Input
                        type="number"
                        min="0"
                        value={formData.quantity_on_hand}
                        onChange={(e) =>
                          setFormData({ ...formData, quantity_on_hand: parseInt(e.target.value, 10) || 0 })
                        }
                      />
                    </FormFieldGroup>
                    <FormFieldGroup label="Reorder Level">
                      <Input
                        type="number"
                        min="0"
                        value={formData.reorder_level}
                        onChange={(e) => setFormData({ ...formData, reorder_level: parseInt(e.target.value, 10) || 0 })}
                      />
                    </FormFieldGroup>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <StatCard title="Unit Cost" value={formatCurrency(formData.unit_cost)} icon={Package} />
              <StatCard title="Selling Price" value={formatCurrency(formData.selling_price)} icon={Package} />
              <StatCard title="Margin" value={`${marginPercent.toFixed(1)}%`} icon={Package} />
              <StatCard
                title="Stock Value"
                value={formatCurrency(formData.unit_cost * formData.quantity_on_hand)}
                icon={Package}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {isEditing ? "Save Changes" : "Create Product"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
