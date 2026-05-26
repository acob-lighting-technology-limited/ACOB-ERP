"use client"

import { useMemo, useState } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Boxes, FolderOpen, Layers3, Pencil, Plus, Tag, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { QUERY_KEYS } from "@/lib/query-keys"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"

interface Category {
  id: string
  name: string
  description: string | null
  product_count?: number
  created_at: string
}

async function fetchCategoriesList(): Promise<Category[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from("product_categories").select("*").order("name")

  if (error) {
    if (error.code === "42P01") {
      return []
    }
    throw new Error(error.message)
  }

  const categoriesWithCounts = await Promise.all(
    (data || []).map(async (category) => {
      const { count } = await supabase
        .from("products")
        .select("*", { count: "exact", head: true })
        .eq("category_id", category.id)

      return { ...category, product_count: count || 0 }
    })
  )

  return categoriesWithCounts
}

function getProductBand(productCount: number) {
  if (productCount === 0) return "Empty"
  if (productCount <= 10) return "Light"
  if (productCount <= 25) return "Growing"
  return "Heavy"
}

export default function CategoriesPage() {
  const queryClient = useQueryClient()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [formData, setFormData] = useState({ name: "", description: "" })
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null)

  const {
    data: categories = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.adminCategories(),
    queryFn: fetchCategoriesList,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      const supabase = createClient()

      if (editingCategory) {
        const { error: updateError } = await supabase
          .from("product_categories")
          .update({ name: formData.name, description: formData.description || null })
          .eq("id", editingCategory.id)

        if (updateError) throw updateError
        toast.success("Category updated")
      } else {
        const { error: insertError } = await supabase
          .from("product_categories")
          .insert({ name: formData.name, description: formData.description || null })

        if (insertError) throw insertError
        toast.success("Category created")
      }

      setIsDialogOpen(false)
      setEditingCategory(null)
      setFormData({ name: "", description: "" })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminCategories() })
    } catch (submitError: unknown) {
      toast.error(submitError instanceof Error ? submitError.message : "Failed to save category")
    }
  }

  async function handleDelete(category: Category) {
    try {
      const supabase = createClient()
      const { error: deleteError } = await supabase.from("product_categories").delete().eq("id", category.id)

      if (deleteError) throw deleteError

      toast.success("Category deleted")
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminCategories() })
    } catch (deleteError: unknown) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Failed to delete category")
    }
  }

  function openEdit(category: Category) {
    setEditingCategory(category)
    setFormData({ name: category.name, description: category.description || "" })
    setIsDialogOpen(true)
  }

  function openCreate() {
    setEditingCategory(null)
    setFormData({ name: "", description: "" })
    setIsDialogOpen(true)
  }

  const stats = useMemo(() => {
    const totalCategories = categories.length
    const mappedProducts = categories.reduce((sum, category) => sum + (category.product_count || 0), 0)
    const emptyCategories = categories.filter((category) => (category.product_count || 0) === 0).length
    const activeCategories = categories.filter((category) => (category.product_count || 0) > 0).length

    return { totalCategories, mappedProducts, emptyCategories, activeCategories }
  }, [categories])

  const productBandOptions = useMemo(
    () =>
      ["Empty", "Light", "Growing", "Heavy"].map((band) => ({
        value: band,
        label: band,
      })),
    []
  )

  const descriptionOptions = useMemo(
    () => [
      { value: "with-description", label: "With Description" },
      { value: "without-description", label: "Without Description" },
    ],
    []
  )

  const columns = useMemo<DataTableColumn<Category>[]>(
    () => [
      {
        key: "name",
        label: "Category",
        sortable: true,
        resizable: true,
        initialWidth: 220,
        accessor: (category) => category.name,
        render: (category) => (
          <div className="space-y-1">
            <p className="font-medium">{category.name}</p>
            <p className="text-muted-foreground text-xs">Created {formatWATDate(category.created_at)}</p>
          </div>
        ),
      },
      {
        key: "description",
        label: "Description",
        accessor: (category) => category.description || "",
        resizable: true,
        initialWidth: 280,
        hideOnMobile: true,
        render: (category) => (
          <span className="text-muted-foreground line-clamp-2 text-sm">{category.description || "No description"}</span>
        ),
      },
      {
        key: "product_count",
        label: "Products",
        sortable: true,
        accessor: (category) => category.product_count || 0,
        align: "center",
        render: (category) => <Badge variant="secondary">{category.product_count || 0}</Badge>,
      },
      {
        key: "product_band",
        label: "Coverage",
        accessor: (category) => getProductBand(category.product_count || 0),
        hideOnMobile: true,
        render: (category) => <Badge variant="outline">{getProductBand(category.product_count || 0)}</Badge>,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<Category>[]>(
    () => [
      {
        key: "product_band",
        label: "Product Coverage",
        options: productBandOptions,
      },
      {
        key: "description_state",
        label: "Description",
        mode: "custom",
        options: descriptionOptions,
        filterFn: (category, value) => {
          const hasDescription = Boolean(category.description?.trim())
          if (Array.isArray(value)) {
            return value.some((entry) => {
              if (entry === "with-description") return hasDescription
              if (entry === "without-description") return !hasDescription
              return false
            })
          }
          if (value === "with-description") return hasDescription
          if (value === "without-description") return !hasDescription
          return true
        },
      },
    ],
    [descriptionOptions, productBandOptions]
  )

  const rowActions = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: (category: Category) => openEdit(category),
    },
    {
      label: "Delete",
      icon: Trash2,
      variant: "destructive" as const,
      onClick: (category: Category) => setPendingDelete(category),
    },
  ]

  return (
    <DataTablePage
      title="Categories"
      description="Organize products by category and track how each category is being used."
      icon={Boxes}
      backLink={{ href: "/admin/inventory", label: "Back to Inventory" }}
      actions={
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Category
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] w-[95vw] max-w-lg overflow-y-auto">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingCategory ? "Edit" : "Create"} Category</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">{editingCategory ? "Update" : "Create"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Categories"
            value={stats.totalCategories}
            icon={Boxes}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Mapped Products"
            value={stats.mappedProducts}
            icon={Layers3}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Active Categories"
            value={stats.activeCategories}
            icon={Tag}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Empty Categories"
            value={stats.emptyCategories}
            icon={FolderOpen}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <DataTable<Category>
        data={categories}
        columns={columns}
        filters={filters}
        getRowId={(category) => category.id}
        searchPlaceholder="Search category name or description..."
        searchFn={(category, query) => {
          const normalizedQuery = query.toLowerCase()
          return (
            category.name.toLowerCase().includes(normalizedQuery) ||
            (category.description || "").toLowerCase().includes(normalizedQuery)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        rowActions={rowActions}
        expandable={{
          render: (category) => (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Description</p>
                <p className="mt-2 text-sm">
                  {category.description || "This category does not have a description yet."}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Product Mapping</p>
                <p className="mt-2 text-sm font-medium">{category.product_count || 0} products linked</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Coverage Band</p>
                <p className="mt-2 text-sm font-medium">{getProductBand(category.product_count || 0)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(category) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{category.name}</p>
                <p className="text-muted-foreground text-sm">{category.description || "No description"}</p>
              </div>
              <Badge variant="secondary">{category.product_count || 0}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Coverage</span>
              <Badge variant="outline">{getProductBand(category.product_count || 0)}</Badge>
            </div>
          </div>
        )}
        emptyTitle="No categories yet"
        emptyDescription="Create your first category to start organizing the product catalog."
        emptyIcon={Boxes}
        skeletonRows={5}
        urlSync
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `Delete category ${pendingDelete.name}?` : "Are you sure?"} This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) {
                  void handleDelete(pendingDelete)
                }
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
