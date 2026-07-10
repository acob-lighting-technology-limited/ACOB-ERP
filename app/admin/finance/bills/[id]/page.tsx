"use client"

import { useParams } from "next/navigation"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Printer, CheckCircle } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout/page-header"
import { PageLoader } from "@/components/ui/query-states"

interface Bill {
  id: string
  bill_number: string
  supplier_name: string
  supplier_email: string | null
  bill_date: string
  due_date: string | null
  status: "pending" | "approved" | "paid" | "overdue"
  subtotal: number
  tax_amount: number
  total_amount: number
  notes: string | null
  items: BillItem[]
}

interface BillItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  amount: number
}

type BillStatusVariant = "default" | "destructive" | "secondary" | "outline"

async function fetchBill(id: string): Promise<Bill> {
  const res = await fetch(`/api/admin/finance/bills/${id}`, { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load bill")
  const json = await res.json()
  return json.data as Bill
}

export default function BillDetailPage() {
  const params = useParams()
  const id = params.id as string
  const queryClient = useQueryClient()

  const { data: bill, isLoading } = useQuery({
    queryKey: QUERY_KEYS.adminBillDetail(id),
    queryFn: () => fetchBill(id),
  })

  async function markAsPaid() {
    try {
      const res = await fetch(`/api/admin/finance/bills/${id}`, { method: "PATCH" })
      if (!res.ok) throw new Error()
      toast.success("Marked as paid")
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminBillDetail(id) })
    } catch {
      toast.error("Failed to update")
    }
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(amount)
  }

  function formatDate(date: string) {
    return formatWATDate(date, { year: "numeric", month: "long", day: "numeric" })
  }

  if (isLoading) return <PageLoader />
  if (!bill) return null

  const statusColors: Record<Bill["status"], BillStatusVariant> = {
    pending: "secondary",
    approved: "default",
    paid: "default",
    overdue: "destructive",
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      <PageHeader
        title={`Bill ${bill.bill_number}`}
        description={`Current status: ${bill.status}`}
        backLink={{ href: "/admin/finance/bills", label: "Back to Bills" }}
        actions={
          <>
            <Badge variant={statusColors[bill.status]} className="capitalize">
              {bill.status}
            </Badge>
            {bill.status !== "paid" && (
              <Button onClick={markAsPaid}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Mark as Paid
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
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Bill Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-sm">Supplier</p>
                  <p className="font-medium">{bill.supplier_name}</p>
                  {bill.supplier_email && <p className="text-muted-foreground text-sm">{bill.supplier_email}</p>}
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground text-sm">Bill Date</p>
                  <p className="font-medium">{formatDate(bill.bill_date)}</p>
                  {bill.due_date && (
                    <>
                      <p className="text-muted-foreground mt-2 text-sm">Due Date</p>
                      <p className="font-medium">{formatDate(bill.due_date)}</p>
                    </>
                  )}
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bill.items?.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unit_price)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="space-y-2 border-t pt-4">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(bill.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>{formatCurrency(bill.tax_amount)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>{formatCurrency(bill.total_amount)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          {bill.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{bill.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
