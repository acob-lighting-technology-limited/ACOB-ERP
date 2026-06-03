"use client"

import { useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { FileText, Plus, Eye, Edit2, Trash2 } from "lucide-react"
import { formatWATDateTime } from "@/lib/utils/date"
import { Badge } from "@/components/ui/badge"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { DocViewDialog } from "@/components/documentation/doc-view-dialog"
import { DocFormDialog, type DocFormData } from "@/components/documentation/doc-form-dialog"
import { DocDeleteDialog } from "@/components/documentation/doc-delete-dialog"
import type { DocumentationAttachment } from "@/lib/documentation/sharepoint"
import { logger } from "@/lib/logger"

const log = logger("internal-documentation-content")

interface Documentation {
  id: string
  title: string
  content: string
  category?: string
  tags?: string[]
  is_draft: boolean
  sharepoint_folder_path?: string | null
  sharepoint_text_file_path?: string | null
  sharepoint_attachments?: DocumentationAttachment[]
  created_at: string
  updated_at: string
}

interface InternalDocumentationContentProps {
  initialDocs: Documentation[]
  userId: string
}

function formatDate(dateString: string) {
  return formatWATDateTime(dateString)
}

function getStatusColor(isDraft: boolean) {
  return isDraft
    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
}

export function InternalDocumentationContent({ initialDocs, userId }: InternalDocumentationContentProps) {
  const [docs, setDocs] = useState<Documentation[]>(initialDocs)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<Documentation | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState<DocFormData>({
    title: "",
    content: "",
    category: "",
    tags: "",
    is_draft: false,
    attachments: [],
  })
  const supabase = createClient()

  const stats = useMemo(
    () => ({
      total: docs.length,
      published: docs.filter((doc) => !doc.is_draft).length,
      draft: docs.filter((doc) => doc.is_draft).length,
    }),
    [docs]
  )

  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(docs.map((doc) => doc.category).filter(Boolean))).map((category) => ({
        value: String(category),
        label: String(category),
      })),
    [docs]
  )

  const columns: DataTableColumn<Documentation>[] = useMemo(
    () => [
      {
        key: "title",
        label: "Title",
        sortable: true,
        accessor: (row) => row.title,
        resizable: true,
        initialWidth: 320,
        render: (row) => <span className="font-medium">{row.title}</span>,
      },
      {
        key: "category",
        label: "Category",
        sortable: true,
        accessor: (row) => row.category || "-",
        render: (row) => <span>{row.category || "-"}</span>,
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => (row.is_draft ? "draft" : "published"),
        render: (row) => <Badge className={getStatusColor(row.is_draft)}>{row.is_draft ? "Draft" : "Published"}</Badge>,
      },
      {
        key: "updated_at",
        label: "Updated",
        sortable: true,
        accessor: (row) => row.updated_at,
        render: (row) => <span className="text-muted-foreground text-xs">{formatDate(row.updated_at)}</span>,
        hideOnMobile: true,
      },
    ],
    []
  )

  const filters: DataTableFilter<Documentation>[] = useMemo(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "draft", label: "Draft" },
          { value: "published", label: "Published" },
        ],
        mode: "custom",
        filterFn: (row, selected) => selected.includes(row.is_draft ? "draft" : "published"),
      },
      {
        key: "category",
        label: "Category",
        options: categoryOptions,
      },
    ],
    [categoryOptions]
  )

  async function loadDocumentation() {
    try {
      const { data, error } = await supabase
        .from("user_documentation")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })

      if (error) throw error
      setDocs((data || []) as Documentation[])
    } catch (error) {
      log.error("Error loading documentation:", error)
      toast.error("Failed to load documentation")
    }
  }

  function openCreateDialog() {
    setSelectedDoc(null)
    setFormData({ title: "", content: "", category: "", tags: "", is_draft: false, attachments: [] })
    setIsDialogOpen(true)
  }

  function openEditDialog(doc: Documentation) {
    setSelectedDoc(doc)
    setFormData({
      title: doc.title,
      content: doc.content,
      category: doc.category || "",
      tags: doc.tags?.join(", ") || "",
      is_draft: doc.is_draft,
      attachments: [],
    })
    setIsDialogOpen(true)
  }

  async function handleSave(isDraft: boolean) {
    if (!formData.title.trim() || !formData.category.trim() || !formData.content.trim()) {
      toast.error("Title, category, and content are required")
      return
    }

    setIsSaving(true)
    try {
      const payload = new FormData()
      payload.append("title", formData.title)
      payload.append("content", formData.content)
      payload.append("category", formData.category)
      payload.append("tags", formData.tags)
      payload.append("is_draft", String(isDraft))
      for (const file of formData.attachments) {
        payload.append("attachments", file)
      }

      const response = await fetch(
        selectedDoc ? `/api/documentation/internal/${selectedDoc.id}` : "/api/documentation/internal",
        {
          method: selectedDoc ? "PUT" : "POST",
          body: payload,
        }
      )

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || "Failed to save documentation")
      }

      toast.success(selectedDoc ? "Documentation updated" : "Documentation created")
      setIsDialogOpen(false)
      await loadDocumentation()
    } catch (error) {
      log.error("Error saving documentation:", error)
      toast.error("Failed to save documentation")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedDoc) return

    setIsSaving(true)
    try {
      const response = await fetch(`/api/documentation/internal/${selectedDoc.id}`, { method: "DELETE" })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || "Failed to delete documentation")
      }

      toast.success("Documentation deleted")
      setIsDeleteDialogOpen(false)
      setSelectedDoc(null)
      await loadDocumentation()
    } catch (error) {
      log.error("Error deleting documentation:", error)
      toast.error("Failed to delete documentation")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <DataTablePage
      title="Internal Documentation"
      description="Create and manage your work documentation."
      icon={FileText}
      backLink={{ href: "/documentation", label: "Back to Documentation" }}
      actions={
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          New Document
        </Button>
      }
      stats={
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            title="Total"
            value={stats.total}
            icon={FileText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Published"
            value={stats.published}
            icon={FileText}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Draft"
            value={stats.draft}
            icon={FileText}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
        </div>
      }
    >
      <DataTable<Documentation>
        data={docs}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search title, content, tags, or category..."
        searchFn={(row, query) =>
          `${row.title} ${row.content} ${(row.tags || []).join(" ")} ${row.category || ""}`
            .toLowerCase()
            .includes(query)
        }
        rowActions={[
          {
            label: "View",
            icon: Eye,
            onClick: (doc) => {
              setSelectedDoc(doc)
              setIsViewDialogOpen(true)
            },
          },
          { label: "Edit", icon: Edit2, onClick: openEditDialog },
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            onClick: (doc) => {
              setSelectedDoc(doc)
              setIsDeleteDialogOpen(true)
            },
          },
        ]}
        expandable={{
          render: (doc) => (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs uppercase">Preview</p>
              <div className="bg-muted/30 rounded-lg border p-4">
                <MarkdownContent content={doc.content || "No content."} />
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(doc) => (
          <div
            className="bg-card hover:border-primary cursor-pointer rounded-xl border-2 p-4 transition-all"
            onClick={() => {
              setSelectedDoc(doc)
              setIsViewDialogOpen(true)
            }}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <h4 className="line-clamp-1 text-sm font-semibold">{doc.title}</h4>
              <Badge className={getStatusColor(doc.is_draft)}>{doc.is_draft ? "Draft" : "Published"}</Badge>
            </div>
            <p className="text-muted-foreground text-[11px]">{doc.category || "-"}</p>
            <p className="text-muted-foreground mt-2 line-clamp-3 text-xs">{doc.content}</p>
          </div>
        )}
        urlSync
      />

      <DocViewDialog
        open={isViewDialogOpen}
        onOpenChange={setIsViewDialogOpen}
        doc={selectedDoc}
        getStatusColor={getStatusColor}
        formatDate={formatDate}
      />

      <DocFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        isEditing={!!selectedDoc}
        formData={formData}
        onFormChange={setFormData}
        existingAttachments={selectedDoc?.sharepoint_attachments || []}
        onSave={handleSave}
        isSaving={isSaving}
      />

      <DocDeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        docTitle={selectedDoc?.title}
        onConfirm={handleDelete}
        isSaving={isSaving}
      />
    </DataTablePage>
  )
}
