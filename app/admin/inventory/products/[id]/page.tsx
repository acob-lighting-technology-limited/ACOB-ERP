"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Pencil, Package } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"
import { PageLoader } from "@/components/ui/query-states"
import { ProductFormDialog } from "../_components/product-form-dialog"

interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  category_id: string | null
  category_name?: string
  unit_cost: number
  selling_price: number
  quantity_on_hand: number
  reorder_level: number
  status: string
  created_at: string
}

async function fetchProduct(id: string): Promise<Product> {
  const res = await fetch(`/api/admin/inventory/products/${id}`, { cache: "no-store" })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to load product")
  const json = await res.json()
  return json.data as Product
}

export default function ProductDetailPage() {
  const params = useParams()
  const id = params.id as string
  const queryClient = useQueryClient()
  const [isEditOpen, setIsEditOpen] = useState(false)

  const { data: product, isLoading } = useQuery({
    queryKey: QUERY_KEYS.adminProductDetail(id),
    queryFn: () => fetchProduct(id),
  })

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(amount)
  }

  if (isLoading) return <PageLoader />
  if (!product) return null

  const margin =
    product.selling_price > 0
      ? (((product.selling_price - product.unit_cost) / product.selling_price) * 100).toFixed(1)
      : "0"

  return (
    <div className="container mx-auto space-y-6 p-6">
      <PageHeader
        title={product.name}
        description={product.sku}
        backLink={{ href: "/admin/inventory/products", label: "Back to Products" }}
        actions={
          <Button onClick={() => setIsEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit Product
          </Button>
        }
      />
      <ProductFormDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        queryClient={queryClient}
        product={{
          id: product.id,
          sku: product.sku,
          name: product.name,
          description: product.description || "",
          category_id: product.category_id || "",
          unit_cost: product.unit_cost,
          selling_price: product.selling_price,
          quantity_on_hand: product.quantity_on_hand,
          reorder_level: product.reorder_level,
          status: product.status,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Product Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground text-sm">SKU</p>
                  <p className="font-mono font-medium">{product.sku}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Category</p>
                  <p className="font-medium">{product.category_name || "Uncategorized"}</p>
                </div>
              </div>
              {product.description && (
                <div>
                  <p className="text-muted-foreground text-sm">Description</p>
                  <p>{product.description}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-sm">Status</p>
                <Badge variant={product.status === "active" ? "default" : "secondary"} className="mt-1 capitalize">
                  {product.status}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground text-sm">Unit Cost</p>
                  <p className="text-xl font-semibold">{formatCurrency(product.unit_cost)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Selling Price</p>
                  <p className="text-xl font-semibold">{formatCurrency(product.selling_price)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Margin</p>
                  <p className="text-xl font-semibold text-green-600">{margin}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Inventory
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-muted-foreground text-sm">Quantity on Hand</p>
                <p className="text-3xl font-bold">{product.quantity_on_hand}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Reorder Level</p>
                <p className="text-lg font-medium">{product.reorder_level}</p>
              </div>
              {product.quantity_on_hand <= product.reorder_level && (
                <Badge variant="destructive" className="w-full justify-center py-2">
                  Low Stock Alert
                </Badge>
              )}
              <div>
                <p className="text-muted-foreground text-sm">Stock Value</p>
                <p className="text-lg font-semibold">{formatCurrency(product.quantity_on_hand * product.unit_cost)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
