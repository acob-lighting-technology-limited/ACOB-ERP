"use client"

import { useParams } from "next/navigation"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Printer, CheckCircle, Package } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout/page-header"
import { PageLoader } from "@/components/ui/query-states"
import { apiFetch } from "@/lib/api-client"

interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  supplier_name?: string
  order_date: string
  expected_date: string | null
  status: "draft" | "pending" | "approved" | "received" | "cancelled"
  total_amount: number
  currency: string
  notes: string | null
  items: POItem[]
}

interface POItem {
  id: string
  product_id: string
  product_name?: string
  product?: {
    name?: string | null
  } | null
  quantity: number
  unit_price: number
  amount: number
}

type BadgeVariant = "default" | "destructive" | "secondary" | "outline"

async function fetchPurchaseOrderDetail(id: string): Promise<PurchaseOrder> {
  const res = await apiFetch(`/api/admin/purchasing/orders/${id}`, { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load purchase order")
  const json = await res.json()
  return json.data as PurchaseOrder
}

function formatCurrency(amount: number, currency: string = "NGN") {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount)
}

function formatDate(date: string) {
  return formatWATDate(date, { year: "numeric", month: "long", day: "numeric" })
}

export default function PurchaseOrderDetailPage() {
  const params = useParams()
  const queryClient = useQueryClient()
  const id = params.id as string

  const { data: order, isLoading } = useQuery({
    queryKey: QUERY_KEYS.adminPurchaseOrderDetail(id),
    queryFn: () => fetchPurchaseOrderDetail(id),
  })

  async function updateStatus(status: string) {
    try {
      const res = await apiFetch(`/api/admin/purchasing/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      toast.success(`Status updated to ${status}`)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminPurchaseOrderDetail(id) })
    } catch {
      toast.error("Failed to update")
    }
  }

  if (isLoading) return <PageLoader />
  if (!order) return null

  const statusColors: Record<PurchaseOrder["status"], BadgeVariant> = {
    draft: "secondary",
    pending: "default",
    approved: "default",
    received: "default",
    cancelled: "destructive",
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      <PageHeader
        title={order.po_number}
        description={order.supplier_name || "Purchase order details"}
        backLink={{ href: "/admin/purchasing/orders", label: "Back to Orders" }}
        actions={
          <>
            <Badge variant={statusColors[order.status]} className="capitalize">
              {order.status}
            </Badge>
            {order.status === "draft" && <Button onClick={() => updateStatus("pending")}>Submit for Approval</Button>}
            {order.status === "pending" && (
              <Button onClick={() => updateStatus("approved")}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Approve
              </Button>
            )}
            {order.status === "approved" && (
              <Button onClick={() => updateStatus("received")}>
                <Package className="mr-2 h-4 w-4" />
                Mark as Received
              </Button>
            )}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground text-sm">Order Date</p>
                <p className="font-medium">{formatDate(order.order_date)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Expected Delivery</p>
                <p className="font-medium">{order.expected_date ? formatDate(order.expected_date) : "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Currency</p>
                <p className="font-medium">{order.currency}</p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.product_name || "Unknown"}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.unit_price, order.currency)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.amount, order.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-end border-t pt-4">
              <div className="text-right">
                <p className="text-muted-foreground text-sm">Total Amount</p>
                <p className="text-2xl font-bold">{formatCurrency(order.total_amount, order.currency)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div>
          {order.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{order.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
