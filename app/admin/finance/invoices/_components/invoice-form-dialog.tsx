"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2, FileText } from "lucide-react"
import { toast } from "sonner"
import { FormFieldGroup } from "@/components/ui/patterns"
import { QUERY_KEYS } from "@/lib/query-keys"
import { logger } from "@/lib/logger"
import type { QueryClient } from "@tanstack/react-query"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("finance-invoice-dialog")

export interface InvoiceItemFormValue {
  id: string
  description: string
  quantity: number
  unit_price: number
  tax_rate: number
  amount: number
}

export interface InvoiceFormValue {
  id?: string
  customer_name: string
  customer_email: string | null
  customer_address: string | null
  issue_date: string
  due_date: string
  currency: string
  notes: string | null
  terms: string | null
}

interface InvoiceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queryClient?: QueryClient
  invoice?: InvoiceFormValue | null
  initialItems?: InvoiceItemFormValue[]
}

function createDefaultItem(): InvoiceItemFormValue {
  return { id: crypto.randomUUID(), description: "", quantity: 1, unit_price: 0, tax_rate: 0, amount: 0 }
}

export function InvoiceFormDialog({
  open,
  onOpenChange,
  queryClient,
  invoice = null,
  initialItems = [],
}: InvoiceFormDialogProps) {
  const router = useRouter()
  const isEditing = Boolean(invoice?.id)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_email: "",
    customer_address: "",
    issue_date: toLocalISODate(),
    due_date: toLocalISODate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    currency: "NGN",
    notes: "",
    terms: "Payment is due within 30 days of invoice date.",
  })
  const [items, setItems] = useState<InvoiceItemFormValue[]>([createDefaultItem()])

  useEffect(() => {
    if (!open) return
    if (invoice) {
      setFormData({
        customer_name: invoice.customer_name,
        customer_email: invoice.customer_email || "",
        customer_address: invoice.customer_address || "",
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        currency: invoice.currency,
        notes: invoice.notes || "",
        terms: invoice.terms || "Payment is due within 30 days of invoice date.",
      })
      setItems(initialItems.length > 0 ? initialItems : [createDefaultItem()])
      return
    }

    setFormData({
      customer_name: "",
      customer_email: "",
      customer_address: "",
      issue_date: toLocalISODate(),
      due_date: toLocalISODate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
      currency: "NGN",
      notes: "",
      terms: "Payment is due within 30 days of invoice date.",
    })
    setItems([createDefaultItem()])
  }, [initialItems, invoice, open])

  function addItem() {
    setItems([...items, createDefaultItem()])
  }

  function removeItem(id: string) {
    if (items.length > 1) setItems(items.filter((item) => item.id !== id))
  }

  function updateItem(id: string, field: keyof InvoiceItemFormValue, value: string | number) {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value }
          const subtotal = updated.quantity * updated.unit_price
          const tax = subtotal * (updated.tax_rate / 100)
          updated.amount = subtotal + tax
          return updated
        }
        return item
      })
    )
  }

  function calculateTotals() {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
    const taxAmount = items.reduce((sum, item) => {
      const itemSubtotal = item.quantity * item.unit_price
      return sum + itemSubtotal * (item.tax_rate / 100)
    }, 0)
    return { subtotal, taxAmount, total: subtotal + taxAmount }
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: formData.currency }).format(amount)
  }

  async function handleSubmit(e: React.FormEvent, status: "draft" | "sent" = "draft") {
    e.preventDefault()
    if (!formData.customer_name) return toast.error("Customer name is required")
    if (items.some((item) => !item.description)) return toast.error("All items must have a description")

    setSaving(true)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return toast.error("You must be logged in")

      const { subtotal, taxAmount, total } = calculateTotals()
      if (invoice?.id) {
        const { error: invoiceError } = await supabase
          .from("invoices")
          .update({
            customer_name: formData.customer_name,
            customer_email: formData.customer_email || null,
            customer_address: formData.customer_address || null,
            issue_date: formData.issue_date,
            due_date: formData.due_date,
            subtotal,
            tax_amount: taxAmount,
            total_amount: total,
            balance_due: total,
            currency: formData.currency,
            notes: formData.notes || null,
            terms: formData.terms || null,
          })
          .eq("id", invoice.id)
        if (invoiceError) throw invoiceError

        const { error: deleteItemsError } = await supabase.from("invoice_items").delete().eq("invoice_id", invoice.id)
        if (deleteItemsError) throw deleteItemsError
        const { error: insertItemsError } = await supabase.from("invoice_items").insert(
          items.map((item) => ({
            invoice_id: invoice.id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate,
            amount: item.amount,
          }))
        )
        if (insertItemsError) throw insertItemsError

        toast.success("Invoice updated successfully!")
        await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminInvoiceDetail(invoice.id) })
      } else {
        const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`
        const { data: createdInvoice, error: invoiceError } = await supabase
          .from("invoices")
          .insert({
            invoice_number: invoiceNumber,
            customer_name: formData.customer_name,
            customer_email: formData.customer_email || null,
            customer_address: formData.customer_address || null,
            issue_date: formData.issue_date,
            due_date: formData.due_date,
            subtotal,
            tax_amount: taxAmount,
            discount_amount: 0,
            total_amount: total,
            amount_paid: 0,
            balance_due: total,
            currency: formData.currency,
            status,
            notes: formData.notes || null,
            terms: formData.terms || null,
            created_by: user.id,
          })
          .select()
          .single()
        if (invoiceError) throw invoiceError

        const { error: itemsError } = await supabase.from("invoice_items").insert(
          items.map((item) => ({
            invoice_id: createdInvoice.id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate,
            amount: item.amount,
          }))
        )
        if (itemsError) throw itemsError
        toast.success(`Invoice ${invoiceNumber} created successfully!`)
      }

      await queryClient?.invalidateQueries({ queryKey: QUERY_KEYS.adminInvoices() })
      onOpenChange(false)
      router.refresh()
    } catch (error: unknown) {
      log.error("Error saving invoice:", error)
      toast.error(error instanceof Error ? error.message : "Failed to save invoice")
    } finally {
      setSaving(false)
    }
  }

  const totals = calculateTotals()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {isEditing ? "Edit Invoice" : "Create Invoice"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update this invoice without leaving the current page."
              : "Create a new invoice without leaving this page."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e, "draft")} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Customer Details</CardTitle>
                  <CardDescription>Enter the customer information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormFieldGroup label="Customer Name *">
                      <Input
                        value={formData.customer_name}
                        onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                        placeholder="Company or individual name"
                        required
                      />
                    </FormFieldGroup>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={formData.customer_email}
                        onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                        placeholder="customer@example.com"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Textarea
                      value={formData.customer_address}
                      onChange={(e) => setFormData({ ...formData, customer_address: e.target.value })}
                      placeholder="Customer billing address"
                      rows={2}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Invoice Items</CardTitle>
                  <CardDescription>Add the products or services</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="grid items-end gap-4 border-b pb-4 last:border-0 sm:grid-cols-12">
                      <div className="space-y-2 sm:col-span-4">
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
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Tax %</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={item.tax_rate}
                          onChange={(e) => updateItem(item.id, "tax_rate", parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-2 text-right sm:col-span-1">
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
                  <CardTitle>Notes & Terms</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Additional notes for the customer..."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Terms</Label>
                    <Textarea
                      value={formData.terms}
                      onChange={(e) => setFormData({ ...formData, terms: e.target.value })}
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Invoice Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormFieldGroup label="Issue Date">
                    <Input
                      type="date"
                      value={formData.issue_date}
                      onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
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
                    <Input
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    />
                  </FormFieldGroup>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatCurrency(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>{formatCurrency(totals.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(totals.total)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            {!isEditing && (
              <Button type="button" variant="outline" onClick={(e) => void handleSubmit(e, "sent")} disabled={saving}>
                Create & Mark Sent
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {isEditing ? "Save Changes" : "Create Invoice"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
