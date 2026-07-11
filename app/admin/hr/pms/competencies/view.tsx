"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookOpen, Pencil, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { apiFetch } from "@/lib/api-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type CompetencyCategory = "behaviour" | "leadership" | "core"

type Competency = {
  id: string
  key: string
  label: string
  description: string | null
  category: CompetencyCategory
  is_active: boolean
  sort_order: number
  created_at: string
}

const CATEGORY_LABELS: Record<CompetencyCategory, string> = {
  behaviour: "Behaviour",
  leadership: "Leadership",
  core: "Core",
}

const CATEGORY_VARIANTS: Record<CompetencyCategory, "default" | "secondary" | "outline"> = {
  behaviour: "default",
  leadership: "secondary",
  core: "outline",
}

function formatDate(date: string) {
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

function CompetencyStatusBadge({ isActive }: { isActive: boolean }) {
  return <Badge variant={isActive ? "default" : "outline"}>{isActive ? "Active" : "Inactive"}</Badge>
}

function CompetencyCard({
  competency,
  onEdit,
  onToggle,
  onDelete,
}: {
  competency: Competency
  onEdit: (competency: Competency) => void
  onToggle: (competency: Competency) => void
  onDelete: (competency: Competency) => void
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{competency.label}</p>
            <CompetencyStatusBadge isActive={competency.is_active} />
          </div>
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{competency.key}</code>
        </div>
        <Badge variant={CATEGORY_VARIANTS[competency.category]}>{CATEGORY_LABELS[competency.category]}</Badge>
      </div>
      <p className="text-muted-foreground text-sm">{competency.description || "No description provided."}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">Sort Order</p>
          <p>{competency.sort_order}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Created</p>
          <p>{formatDate(competency.created_at)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(competency)}>
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={() => onToggle(competency)}>
          {competency.is_active ? "Deactivate" : "Activate"}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => onDelete(competency)}>
          Delete
        </Button>
      </div>
    </div>
  )
}

export function AdminCompetenciesPage({ backLinkHref }: { backLinkHref?: string } = {}) {
  const [competencies, setCompetencies] = useState<Competency[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selected, setSelected] = useState<Competency | null>(null)

  const [key, setKey] = useState("")
  const [label, setLabel] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState<CompetencyCategory>("behaviour")
  const [sortOrder, setSortOrder] = useState("0")

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await apiFetch("/api/hr/performance/competencies")
      const data = (await res.json().catch(() => ({}))) as { data?: Competency[]; error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to load competencies")
      }
      setCompetencies(data.data || [])
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load competencies"
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setKey("")
    setLabel("")
    setDescription("")
    setCategory("behaviour")
    setSortOrder("0")
    setSelected(null)
  }

  function openCreate() {
    resetForm()
    setIsCreateOpen(true)
  }

  function openEdit(competency: Competency) {
    setSelected(competency)
    setKey(competency.key)
    setLabel(competency.label)
    setDescription(competency.description || "")
    setCategory(competency.category)
    setSortOrder(String(competency.sort_order))
    setIsEditOpen(true)
  }

  function openDelete(competency: Competency) {
    setSelected(competency)
    setIsDeleteOpen(true)
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!key || !label) {
      toast.error("Key and label are required")
      return
    }
    setIsSubmitting(true)
    try {
      const res = await apiFetch("/api/hr/performance/competencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          label,
          description: description || null,
          category,
          sort_order: Number(sortOrder) || 0,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to create competency")
      }
      toast.success(data.message || "Competency created")
      setIsCreateOpen(false)
      resetForm()
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create competency")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleEdit(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setIsSubmitting(true)
    try {
      const res = await apiFetch("/api/hr/performance/competencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          label,
          description: description || null,
          category,
          sort_order: Number(sortOrder) || 0,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to update competency")
      }
      toast.success(data.message || "Competency updated")
      setIsEditOpen(false)
      resetForm()
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update competency")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggleActive(competency: Competency) {
    try {
      const res = await apiFetch("/api/hr/performance/competencies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: competency.id, is_active: !competency.is_active }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to update competency")
      }
      toast.success(`Competency ${competency.is_active ? "deactivated" : "activated"}`)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update competency")
    }
  }

  async function handleDelete() {
    if (!selected) return
    setIsSubmitting(true)
    try {
      const res = await apiFetch(`/api/hr/performance/competencies?id=${selected.id}`, { method: "DELETE" })
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete competency")
      }
      toast.success(data.message || "Competency deleted")
      setIsDeleteOpen(false)
      resetForm()
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete competency")
    } finally {
      setIsSubmitting(false)
    }
  }

  const categoryOptions = useMemo(
    () =>
      Object.entries(CATEGORY_LABELS).map(([value, labelText]) => ({
        value,
        label: labelText,
      })),
    []
  )

  const columns: DataTableColumn<Competency>[] = useMemo(
    () => [
      {
        key: "label",
        label: "Label",
        sortable: true,
        accessor: (competency) => competency.label,
        render: (competency) => <span className="font-medium">{competency.label}</span>,
        resizable: true,
        initialWidth: 220,
      },
      {
        key: "key",
        label: "Key",
        sortable: true,
        accessor: (competency) => competency.key,
        render: (competency) => <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{competency.key}</code>,
        resizable: true,
        initialWidth: 180,
        hideOnMobile: true,
      },
      {
        key: "category",
        label: "Category",
        sortable: true,
        accessor: (competency) => competency.category,
        render: (competency) => (
          <Badge variant={CATEGORY_VARIANTS[competency.category]}>{CATEGORY_LABELS[competency.category]}</Badge>
        ),
      },
      {
        key: "sort_order",
        label: "Order",
        sortable: true,
        accessor: (competency) => competency.sort_order,
        align: "center",
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (competency) => (competency.is_active ? "active" : "inactive"),
        render: (competency) => <CompetencyStatusBadge isActive={competency.is_active} />,
      },
      {
        key: "description",
        label: "Description",
        accessor: (competency) => competency.description || "",
        render: (competency) => (
          <span className="text-muted-foreground block max-w-[260px] truncate text-sm">
            {competency.description || "-"}
          </span>
        ),
        hideOnMobile: true,
        resizable: true,
        initialWidth: 260,
      },
    ],
    []
  )

  const filters: DataTableFilter<Competency>[] = useMemo(
    () => [
      {
        key: "category",
        label: "Category",
        options: categoryOptions,
        placeholder: "All Categories",
      },
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
        placeholder: "All Statuses",
      },
    ],
    [categoryOptions]
  )

  const rowActions: RowAction<Competency>[] = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: (competency) => openEdit(competency),
    },
    {
      label: "Toggle Status",
      icon: ToggleRight,
      onClick: (competency) => void handleToggleActive(competency),
    },
    {
      label: "Delete",
      icon: Trash2,
      variant: "destructive",
      onClick: (competency) => openDelete(competency),
    },
  ]

  const activeCount = competencies.filter((competency) => competency.is_active).length
  const inactiveCount = competencies.length - activeCount
  const behaviourCount = competencies.filter((competency) => competency.category === "behaviour").length

  return (
    <DataTablePage
      title="Competency Frameworks"
      description="Manage the scoring competencies used across performance reviews."
      icon={BookOpen}
      backLink={{ href: backLinkHref ?? "/admin/hr/pms", label: "Back to PMS" }}
      actions={
        <Button onClick={openCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Competency
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Total"
            value={competencies.length}
            icon={BookOpen}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Active"
            value={activeCount}
            icon={ToggleRight}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Inactive"
            value={inactiveCount}
            icon={ToggleLeft}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Behaviour"
            value={behaviourCount}
            icon={BookOpen}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<Competency>
        data={competencies}
        columns={columns}
        filters={filters}
        getRowId={(competency) => competency.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search competency label, key, or description…"
        searchFn={(competency, query) => {
          return [competency.label, competency.key, competency.description || "", competency.category]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        rowActions={rowActions}
        expandable={{
          render: (competency) => (
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground text-xs">Description</p>
                <p className="mt-1">{competency.description || "No description provided."}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Category</p>
                <p className="mt-1">{CATEGORY_LABELS[competency.category]}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Created</p>
                <p className="mt-1">{formatDate(competency.created_at)}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(competency) => (
          <CompetencyCard
            competency={competency}
            onEdit={openEdit}
            onToggle={(item) => void handleToggleActive(item)}
            onDelete={openDelete}
          />
        )}
        emptyTitle="No competencies yet"
        emptyDescription="Add the first competency to start scoring reviews consistently."
        emptyIcon={BookOpen}
        skeletonRows={6}
      />

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Competency</DialogTitle>
            <DialogDescription>Define a new competency that appears as a scoring field on reviews.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleCreate(event)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Key *</Label>
                <Input
                  placeholder="e.g. problem_solving"
                  value={key}
                  onChange={(event) => setKey(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Label *</Label>
                <Input value={label} onChange={(event) => setLabel(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(value) => setCategory(value as CompetencyCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="behaviour">Behaviour</SelectItem>
                    <SelectItem value="leadership">Leadership</SelectItem>
                    <SelectItem value="core">Core</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input type="number" min={0} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                <Plus className="h-4 w-4" />
                {isSubmitting ? "Saving..." : "Add Competency"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Competency</DialogTitle>
            <DialogDescription>Update the label, category, and description for this scoring field.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void handleEdit(event)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Label *</Label>
                <Input value={label} onChange={(event) => setLabel(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(value) => setCategory(value as CompetencyCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="behaviour">Behaviour</SelectItem>
                    <SelectItem value="leadership">Leadership</SelectItem>
                    <SelectItem value="core">Core</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input type="number" min={0} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete competency?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <strong>{selected?.label}</strong>. Existing stored scores remain, but future
              reviews will no longer include this competency.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isSubmitting}
              onClick={async () => {
                await handleDelete()
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
