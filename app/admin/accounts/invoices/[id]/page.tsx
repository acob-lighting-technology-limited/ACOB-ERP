"use client"

import { useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { AdminTablePage } from "@/components/admin/admin-table-page"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Download, Send, Printer, CheckCircle, Pencil, FileText } from "lucide-react"
import { toast } from "sonner"
import { PageLoader } from "@/components/ui/query-states"
import { InvoiceFormDialog } from "../_components/invoice-form-dialog"

import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("finance-invoices")

interface Invoice {
  id: string
  invoice_number: string
  customer_name: string
  customer_email: string | null
  customer_address: string | null
  issue_date: string
  due_date: string
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  amount_paid: number
  balance_due: number
  currency: string
  status: string
  notes: string | null
  terms: string | null
  created_at: string
}

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  tax_rate: number
  amount: number
}

type InvoiceStatusVariant = "default" | "destructive" | "secondary" | "outline"

const statusColors: Record<Invoice["status"], InvoiceStatusVariant> = {
  draft: "secondary",
  sent: "default",
  paid: "default",
  overdue: "destructive",
  cancelled: "secondary",
}

interface InvoicePageData {
  invoice: Invoice
  items: InvoiceItem[]
}

async function fetchInvoiceDetail(id: string): Promise<InvoicePageData> {
  const res = await apiFetch(`/api/admin/finance/invoices/${id}`, { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load invoice")
  const json = await res.json()
  return json.data as InvoicePageData
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const id = params.id as string
  const queryClient = useQueryClient()
  const [isEditOpen, setIsEditOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEYS.adminInvoiceDetail(id),
    queryFn: () => fetchInvoiceDetail(id),
  })

  const invoice = data?.invoice
  const items = data?.items ?? []

  async function markAsSent() {
    if (!invoice) return
    try {
      const res = await apiFetch(`/api/admin/finance/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "status", status: "sent" }),
      })
      if (!res.ok) throw new Error()
      toast.success("Invoice marked as sent")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminInvoiceDetail(id) })
    } catch (error) {
      log.error("Error updating invoice:", error)
      toast.error("Failed to update invoice")
    }
  }

  async function markAsPaid() {
    if (!invoice) return
    try {
      const res = await apiFetch(`/api/admin/finance/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "status", status: "paid" }),
      })
      if (!res.ok) throw new Error()
      toast.success("Invoice marked as paid")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminInvoiceDetail(id) })
    } catch (error) {
      log.error("Error updating invoice:", error)
      toast.error("Failed to update invoice")
    }
  }

  function formatCurrency(amount: number, currency: string = "NGN") {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount)
  }

  function formatDate(date: string) {
    return formatWATDate(date, { year: "numeric", month: "long", day: "numeric" })
  }

  if (isLoading) return <PageLoader />
  if (!invoice) return null

  return (
    <AdminTablePage
      title={invoice.invoice_number}
      description={`Created on ${formatDate(invoice.created_at)}`}
      icon={FileText}
      backLinkHref="/admin/accounts/invoices"
      backLinkLabel="Back to Invoices"
      actions={
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusColors[invoice.status]} className="capitalize">
            {invoice.status}
          </Badge>
          {invoice.status === "draft" && (
            <>
              <Button variant="outline" onClick={() => setIsEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button onClick={markAsSent}>
                <Send className="mr-2 h-4 w-4" />
                Mark as Sent
              </Button>
            </>
          )}
          {invoice.status === "sent" && (
            <Button onClick={markAsPaid} variant="default">
              <CheckCircle className="mr-2 h-4 w-4" />
              Mark as Paid
            </Button>
          )}
          <Button variant="outline">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
        </div>
      }
    >
      <InvoiceFormDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        queryClient={queryClient}
        invoice={{
          id: invoice.id,
          customer_name: invoice.customer_name,
          customer_email: invoice.customer_email,
          customer_address: invoice.customer_address,
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          currency: invoice.currency,
          notes: invoice.notes,
          terms: invoice.terms,
        }}
        initialItems={items.map((item) => ({ ...item }))}
      />
      {/* Invoice Preview */}
      <Card>
        <CardContent className="p-8">
          {/* Header Section */}
          <div className="mb-8 flex justify-between">
            <div>
              <h2 className="mb-2 text-2xl font-bold">INVOICE</h2>
              <p className="text-muted-foreground">{invoice.invoice_number}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold">ACOB Lighting Technology</p>
              <p className="text-muted-foreground text-sm">Lagos, Nigeria</p>
            </div>
          </div>

          {/* Bill To & Details */}
          <div className="mb-8 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="text-muted-foreground mb-2 text-sm font-semibold">BILL TO</h3>
              <p className="font-semibold">{invoice.customer_name}</p>
              {invoice.customer_email && <p className="text-sm">{invoice.customer_email}</p>}
              {invoice.customer_address && (
                <p className="text-muted-foreground text-sm whitespace-pre-line">{invoice.customer_address}</p>
              )}
            </div>
            <div className="text-right">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Issue Date:</span>
                <span>{formatDate(invoice.issue_date)}</span>
                <span className="text-muted-foreground">Due Date:</span>
                <span>{formatDate(invoice.due_date)}</span>
                <span className="text-muted-foreground">Status:</span>
                <span className="font-semibold capitalize">{invoice.status}</span>
              </div>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Items Table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unit_price, invoice.currency)}</TableCell>
                  <TableCell className="text-right">{item.tax_rate}%</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.amount, invoice.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Separator className="my-6" />

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(invoice.tax_amount, invoice.currency)}</span>
              </div>
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span>-{formatCurrency(invoice.discount_amount, invoice.currency)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span>{formatCurrency(invoice.total_amount, invoice.currency)}</span>
              </div>
              {invoice.amount_paid > 0 && (
                <>
                  <div className="flex justify-between text-green-600">
                    <span>Paid</span>
                    <span>-{formatCurrency(invoice.amount_paid, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Balance Due</span>
                    <span>{formatCurrency(invoice.balance_due, invoice.currency)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Notes & Terms */}
          {(invoice.notes || invoice.terms) && (
            <>
              <Separator className="my-6" />
              <div className="grid gap-6 md:grid-cols-2">
                {invoice.notes && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Notes</h3>
                    <p className="text-muted-foreground text-sm">{invoice.notes}</p>
                  </div>
                )}
                {invoice.terms && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Terms & Conditions</h3>
                    <p className="text-muted-foreground text-sm">{invoice.terms}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AdminTablePage>
  )
}
