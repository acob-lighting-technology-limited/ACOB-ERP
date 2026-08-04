"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { Plus, Trash2, Receipt } from "lucide-react"
import { toast } from "sonner"
import { FormFieldGroup } from "@/components/ui/patterns"
import { QUERY_KEYS } from "@/lib/query-keys"
import { logger } from "@/lib/logger"
import type { QueryClient } from "@tanstack/react-query"
import { toLocalISODate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

const log = logger("finance-bill-dialog")

interface BillItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  amount: number
}

interface BillFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queryClient?: QueryClient
}

export function BillFormDialog({ open, onOpenChange, queryClient }: BillFormDialogProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    supplier_name: "",
    supplier_email: "",
    bill_date: toLocalISODate(),
    due_date: toLocalISODate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    currency: "NGN",
    notes: "",
  })
  const [items, setItems] = useState<BillItem[]>([
    { id: crypto.randomUUID(), description: "", quantity: 1, unit_price: 0, amount: 0 },
  ])

  function resetForm() {
    setFormData({
      supplier_name: "",
      supplier_email: "",
      bill_date: toLocalISODate(),
      due_date: toLocalISODate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
      currency: "NGN",
      notes: "",
    })
    setItems([{ id: crypto.randomUUID(), description: "", quantity: 1, unit_price: 0, amount: 0 }])
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !saving) resetForm()
    onOpenChange(nextOpen)
  }

  function addItem() {
    setItems([...items, { id: crypto.randomUUID(), description: "", quantity: 1, unit_price: 0, amount: 0 }])
  }

  function removeItem(id: string) {
    if (items.length > 1) setItems(items.filter((item) => item.id !== id))
  }

  function updateItem(id: string, field: keyof BillItem, value: string | number) {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value }
          updated.amount = updated.quantity * updated.unit_price
          return updated
        }
        return item
      })
    )
  }

  function calculateTotals() {
    return { total: items.reduce((sum, item) => sum + item.amount, 0) }
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: formData.currency }).format(amount)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.supplier_name) return toast.error("Supplier name is required")
    if (items.some((item) => !item.description)) return toast.error("All items must have a description")

    setSaving(true)
    try {
      const res = await apiFetch("/api/admin/finance/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_name: formData.supplier_name,
          supplier_email: formData.supplier_email || null,
          bill_date: formData.bill_date,
          due_date: formData.due_date,
          currency: formData.currency,
          notes: formData.notes || null,
          items: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            amount: item.amount,
          })),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || "Failed to create bill")

      toast.success(`Bill ${json?.bill_number ?? ""} created successfully!`)
      await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminBills() })
      handleOpenChange(false)
      router.refresh()
    } catch (error: unknown) {
      log.error("Error creating bill:", error)
      toast.error(error instanceof Error ? error.message : "Failed to create bill")
    } finally {
      setSaving(false)
    }
  }

  const totals = calculateTotals()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Add Bill
          </DialogTitle>
          <DialogDescription>Record a new vendor bill without leaving this page.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Supplier Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="Supplier Name *">
                      <Input
                        id="supplier_name"
                        value={formData.supplier_name}
                        onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                        placeholder="Supplier or vendor name"
                        required
                      />
                    </FormFieldGroup>
                    <div className="space-y-2">
                      <Label htmlFor="supplier_email">Email</Label>
                      <Input
                        id="supplier_email"
                        type="email"
                        value={formData.supplier_email}
                        onChange={(e) => setFormData({ ...formData, supplier_email: e.target.value })}
                        placeholder="supplier@example.com"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Bill Items</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="grid items-end gap-4 border-b pb-4 last:border-0 sm:grid-cols-12">
                      <div className="space-y-2 sm:col-span-5">
                        <Label>Description</Label>
                        <Input
                          value={item.description}
                          onChange={(e) => updateItem(item.id, "description", e.target.value)}
                          placeholder="Item description"
                          required
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Qty</Label>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, "quantity", parseFloat(e.target.value) || 0)}
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

              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Optional notes about this bill..."
                    rows={4}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Bill Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormFieldGroup label="Bill Date">
                    <Input
                      type="date"
                      value={formData.bill_date}
                      onChange={(e) => setFormData({ ...formData, bill_date: e.target.value })}
                    />
                  </FormFieldGroup>
                  <FormFieldGroup label="Due Date">
                    <Input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    />
                  </FormFieldGroup>
                  <FormFieldGroup label="Currency">
                    <Select
                      value={formData.currency}
                      onValueChange={(value) => setFormData({ ...formData, currency: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NGN">NGN</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormFieldGroup>
                </CardContent>
              </Card>

              <StatCard title="Total" value={formatCurrency(totals.total)} icon={Receipt} />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Create Bill
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
