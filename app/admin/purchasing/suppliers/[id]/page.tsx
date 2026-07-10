"use client"

import { useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pencil, Phone, Mail, MapPin, ShoppingCart } from "lucide-react"
import Link from "next/link"
import { PageHeader } from "@/components/layout/page-header"
import { EmptyState } from "@/components/ui/patterns"
import { PageLoader } from "@/components/ui/query-states"
import { SupplierFormDialog } from "../_components/supplier-form-dialog"

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

interface PurchaseOrder {
  id: string
  po_number: string
  order_date: string
  total_amount: number
  status: string
}

interface SupplierPageData {
  supplier: Supplier
  orders: PurchaseOrder[]
}

async function fetchSupplierDetail(id: string): Promise<SupplierPageData> {
  const res = await fetch(`/api/admin/purchasing/suppliers/${id}`, { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Supplier not found")
  const json = await res.json()
  return json.data as SupplierPageData
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(amount)
}

function formatDate(date: string) {
  return formatWATDate(date, { year: "numeric", month: "short", day: "numeric" })
}

export default function SupplierDetailPage() {
  const params = useParams()
  const id = params.id as string
  const queryClient = useQueryClient()
  const [isEditOpen, setIsEditOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEYS.adminSupplierDetail(id),
    queryFn: () => fetchSupplierDetail(id),
  })

  if (isLoading) return <PageLoader />
  if (!data) return null

  const { supplier, orders } = data
  const totalSpent = orders.reduce((sum, o) => sum + o.total_amount, 0)

  return (
    <div className="container mx-auto space-y-6 p-6">
      <PageHeader
        title={supplier.name}
        description={supplier.code}
        backLink={{ href: "/admin/purchasing/suppliers", label: "Back to Suppliers" }}
        actions={
          <>
            <Badge variant={supplier.is_active ? "default" : "secondary"}>
              {supplier.is_active ? "Active" : "Inactive"}
            </Badge>
            <Button onClick={() => setIsEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Supplier
            </Button>
          </>
        }
      />
      <SupplierFormDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        queryClient={queryClient}
        supplier={{
          id: supplier.id,
          name: supplier.name,
          code: supplier.code,
          email: supplier.email || "",
          phone: supplier.phone || "",
          address: supplier.address || "",
          contact_person: supplier.contact_person || "",
          is_active: supplier.is_active,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {supplier.contact_person && (
                  <div>
                    <p className="text-muted-foreground text-sm">Contact Person</p>
                    <p className="font-medium">{supplier.contact_person}</p>
                  </div>
                )}
                {supplier.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="text-muted-foreground h-4 w-4" />
                    <a href={`mailto:${supplier.email}`} className="hover:underline">
                      {supplier.email}
                    </a>
                  </div>
                )}
                {supplier.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="text-muted-foreground h-4 w-4" />
                    <a href={`tel:${supplier.phone}`} className="hover:underline">
                      {supplier.phone}
                    </a>
                  </div>
                )}
                {supplier.address && (
                  <div className="flex items-start gap-2 sm:col-span-2">
                    <MapPin className="text-muted-foreground mt-1 h-4 w-4" />
                    <p>{supplier.address}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Orders</CardTitle>
              <CardDescription>Last 10 purchase orders</CardDescription>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <EmptyState
                  title="No orders yet"
                  description="Recent purchase orders for this supplier will appear here."
                  icon={ShoppingCart}
                  className="border-0"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link href={`/admin/purchasing/orders/${order.id}`} className="font-mono hover:underline">
                            {order.po_number}
                          </Link>
                        </TableCell>
                        <TableCell>{formatDate(order.order_date)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize">
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(order.total_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-muted-foreground text-sm">Total Orders</p>
                <p className="text-2xl font-bold">{orders.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Total Spent</p>
                <p className="text-2xl font-bold">{formatCurrency(totalSpent)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Joined</p>
                <p className="font-medium">{formatDate(supplier.created_at)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
