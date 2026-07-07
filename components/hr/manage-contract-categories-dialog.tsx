"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Pencil, Layers } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"

interface ManageContractCategoriesDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

interface ContractCategory {
  id: string
  name: string
  code: string
  is_active: boolean
  sort_order: number
}

export function ManageContractCategoriesDialog({ isOpen, onOpenChange }: ManageContractCategoriesDialogProps) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [supabase] = useState(() => createClient())

  // Form states
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [sortOrder, setSortOrder] = useState<number>(0)
  const [isActive, setIsActive] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const { data: categories = [], isLoading } = useQuery<ContractCategory[]>({
    queryKey: ["contract-categories-all"],
    queryFn: async () => {
      const response = await fetch("/api/admin/hr/employment-categories?include_inactive=true")
      if (!response.ok) throw new Error("Failed to fetch contract categories")
      const result = await response.json()
      return result.data || []
    },
    enabled: isOpen,
  })

  const resetForm = () => {
    setName("")
    setCode("")
    setSortOrder(0)
    setIsActive(true)
    setEditingId(null)
  }

  const handleEditInit = (cat: ContractCategory) => {
    setEditingId(cat.id)
    setName(cat.name)
    setCode(cat.code)
    setSortOrder(cat.sort_order)
    setIsActive(cat.is_active)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !code.trim()) {
      toast.error("Name and Code are required")
      return
    }

    setIsSaving(true)
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        sort_order: sortOrder,
        is_active: isActive,
      }

      let res
      if (editingId) {
        res = await fetch("/api/admin/hr/employment-categories", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...payload }),
        })
      } else {
        res = await fetch("/api/admin/hr/employment-categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      }

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Failed to save category")

      toast.success(editingId ? "Category updated successfully" : "Category created successfully")
      resetForm()
      queryClient.invalidateQueries({ queryKey: ["contract-categories-all"] })
      queryClient.invalidateQueries({ queryKey: ["contract-categories"] })
    } catch (err: any) {
      toast.error(err.message || "An error occurred")
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleActive = async (cat: ContractCategory) => {
    try {
      const res = await fetch("/api/admin/hr/employment-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cat.id,
          name: cat.name,
          code: cat.code,
          sort_order: cat.sort_order,
          is_active: !cat.is_active,
        }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Failed to toggle status")

      toast.success(`Category is now ${!cat.is_active ? "active" : "inactive"}`)
      queryClient.invalidateQueries({ queryKey: ["contract-categories-all"] })
      queryClient.invalidateQueries({ queryKey: ["contract-categories"] })
    } catch (err: any) {
      toast.error(err.message || "Failed to update status")
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
              <Layers className="text-primary h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl">Manage Contract Categories</DialogTitle>
              <DialogDescription className="mt-1">
                Configure sub-categories for contract employees (e.g. SIWES, NYSC) to customize their staff ID series.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-6 py-4 md:grid-cols-5">
          {/* Left panel: Form */}
          <form onSubmit={handleSave} className="space-y-4 border-r pr-6 md:col-span-2">
            <h4 className="text-sm font-semibold">{editingId ? "Edit Category" : "Add New Category"}</h4>

            <div className="space-y-1.5">
              <Label htmlFor="cat_name">Category Name</Label>
              <Input
                id="cat_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. SIWES IT Student"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat_code">Prefix Code</Label>
              <Input
                id="cat_code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. SIWES"
                maxLength={10}
                required
                disabled={!!editingId}
              />
              <p className="text-muted-foreground text-[10px]">Must be letters/numbers (unique prefix code).</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat_sort">Sort Order</Label>
              <Input
                id="cat_sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="cat_active"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="border-primary h-4 w-4 rounded-sm"
              />
              <Label htmlFor="cat_active" className="cursor-pointer">
                Is Active
              </Label>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1" loading={isSaving}>
                {editingId ? "Update" : "Create"}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </form>

          {/* Right panel: Table list */}
          <div className="space-y-2 md:col-span-3">
            <h4 className="text-sm font-semibold">Existing Categories</h4>
            <div className="max-h-[320px] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0">
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Sort</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                        Loading categories...
                      </TableCell>
                    </TableRow>
                  ) : categories.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                        No categories found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    categories.map((cat) => (
                      <TableRow key={cat.id}>
                        <TableCell className="font-mono text-xs font-bold">{cat.code}</TableCell>
                        <TableCell className="max-w-[120px] truncate text-xs" title={cat.name}>
                          {cat.name}
                        </TableCell>
                        <TableCell className="text-xs">{cat.sort_order}</TableCell>
                        <TableCell>
                          <Badge
                            variant={cat.is_active ? "default" : "secondary"}
                            className="cursor-pointer select-none"
                            onClick={() => handleToggleActive(cat)}
                          >
                            {cat.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditInit(cat)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
