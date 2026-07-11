"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, ShoppingCart } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import { toast } from "sonner"
import { FormFieldGroup } from "@/components/ui/patterns"
import type { QueryClient } from "@tanstack/react-query"
import { toLocalISODate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

interface Supplier {
  id: string
  name: string
  code: string
}

interface Product {
  id: string
  name: string
  sku: string
  unit_cost: number
}

interface POItem {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  amount: number
}

interface NewPOFormData {
  suppliers: Supplier[]
  products: Product[]
}

interface PurchaseOrderFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queryClient?: QueryClient
}

async function fetchNewPOFormData(): Promise<NewPOFormData> {
  const res = await apiFetch("/api/admin/purchasing/orders/form-data", { cache: "no-store" })
  if (!res.ok) return { suppliers: [], products: [] }
  const json = await res.json()
  return { suppliers: json.suppliers || [], products: json.products || [] }
}

export function PurchaseOrderFormDialog({ open, onOpenChange, queryClient }: PurchaseOrderFormDialogProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    supplier_id: "",
    order_date: toLocalISODate(),
    expected_date: toLocalISODate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
    currency: "NGN",
    notes: "",
  })
  const [items, setItems] = useState<POItem[]>([
    { id: crypto.randomUUID(), product_id: "", product_name: "", quantity: 1, unit_price: 0, amount: 0 },
  ])

  const { data: formOptions } = useQuery({
    queryKey: QUERY_KEYS.adminNewPurchaseOrderForm(),
    queryFn: fetchNewPOFormData,
    enabled: open,
  })

  const suppliers = formOptions?.suppliers ?? []
  const products = formOptions?.products ?? []

  function addItem() {
    setItems([
      ...items,
      { id: crypto.randomUUID(), product_id: "", product_name: "", quantity: 1, unit_price: 0, amount: 0 },
    ])
  }

  function removeItem(id: string) {
    if (items.length > 1) setItems(items.filter((i) => i.id !== id))
  }

  function updateItem(id: string, field: keyof POItem, value: string | number) {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value }
          if (field === "product_id") {
            const prod = products.find((p) => p.id === value)
            if (prod) {
              updated.product_name = prod.name
              updated.unit_price = prod.unit_cost
            }
          }
          updated.amount = updated.quantity * updated.unit_price
          return updated
        }
        return item
      })
    )
  }

  function calculateTotal() {
    return items.reduce((sum, i) => sum + i.amount, 0)
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: formData.currency }).format(amount)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.supplier_id) return toast.error("Select a supplier")
    if (items.some((i) => !i.product_id)) return toast.error("Select products for all items")

    setSaving(true)
    try {
      const res = await apiFetch("/api/admin/purchasing/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: formData.supplier_id,
          order_date: formData.order_date,
          expected_date: formData.expected_date || null,
          currency: formData.currency,
          notes: formData.notes || null,
          items: items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            unit_price: i.unit_price,
            amount: i.amount,
          })),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "Failed to create")

      toast.success(`PO ${json?.po_number ?? ""} created!`)
      await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminPurchaseOrders() })
      onOpenChange(false)
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to create")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Create Purchase Order
          </DialogTitle>
          <DialogDescription>Create a new supplier purchase order without leaving this page.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Order Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="Supplier *">
                      <Select
                        value={formData.supplier_id}
                        onValueChange={(v) => setFormData({ ...formData, supplier_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select supplier" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} ({s.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormFieldGroup>
                    <div className="space-y-2">
                      <Label>Currency</Label>
                      <Select
                        value={formData.currency}
                        onValueChange={(v) => setFormData({ ...formData, currency: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NGN">NGN</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="Order Date">
                      <Input
                        type="date"
                        value={formData.order_date}
                        onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
                      />
                    </FormFieldGroup>
                    <FormFieldGroup label="Expected Date">
                      <Input
                        type="date"
                        value={formData.expected_date}
                        onChange={(e) => setFormData({ ...formData, expected_date: e.target.value })}
                      />
                    </FormFieldGroup>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Order Items</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="grid items-end gap-4 border-b pb-4 last:border-0 sm:grid-cols-12">
                      <div className="space-y-2 sm:col-span-5">
                        <Label>Product</Label>
                        <Select
                          value={item.product_id}
                          onValueChange={(value) => updateItem(item.id, "product_id", value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select product" />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name} ({product.sku})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Qty</Label>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, "quantity", parseInt(e.target.value, 10) || 0)}
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Unit Price</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price}
                          onChange={(e) => updateItem(item.id, "unit_price", parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-2 text-right sm:col-span-2">
                        <Label>Amount</Label>
                        <p className="py-2 font-medium">{formatCurrency(item.amount)}</p>
                      </div>
                      <div className="sm:col-span-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.id)}
                          disabled={items.length === 1}
                        >
                          <Trash2 className="text-destructive h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={addItem}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Item
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <StatCard title="Total Amount" value={formatCurrency(calculateTotal())} icon={ShoppingCart} />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Create PO
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
