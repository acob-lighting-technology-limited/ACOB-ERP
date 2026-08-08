"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { FileText, Plus, Eye, Edit2, Trash2 } from "lucide-react"
import { formatWATDateTime } from "@/lib/utils/date"
import { Badge } from "@/components/ui/badge"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { DocViewDialog } from "@/components/documentation/doc-view-dialog"
import { DocFormDialog, type DocFormData } from "@/components/documentation/doc-form-dialog"
import { DocDeleteDialog } from "@/components/documentation/doc-delete-dialog"
import type { DocumentationAttachment } from "@/lib/documentation/sharepoint"
import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("internal-documentation-content")

interface Documentation {
  id: string
  title: string
  content: string
  category?: string
  tags?: string[]
  is_draft: boolean
  visibility?: "private" | "general"
  user_id?: string
  author_name?: string | null
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
    visibility: "private",
    attachments: [],
  })
  // "mine" = documents you authored. "general" = documents anyone published to
  // the whole company (RLS exposes only visibility = 'general' rows here).
  const [activeTab, setActiveTab] = useState<string>("mine")
  const [generalDocs, setGeneralDocs] = useState<Documentation[]>([])
  const [isLoadingGeneral, setIsLoadingGeneral] = useState(false)
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
        key: "visibility",
        label: "Visibility",
        sortable: true,
        accessor: (row) => row.visibility ?? "private",
        render: (row) =>
          (row.visibility ?? "private") === "general" ? (
            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">General</Badge>
          ) : (
            <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300">Private</Badge>
          ),
        hideOnMobile: true,
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

  const generalColumns: DataTableColumn<Documentation>[] = useMemo(
    () => [
      ...columns.filter((column) => column.key !== "visibility" && column.key !== "status"),
      {
        key: "author_name",
        label: "Author",
        sortable: true,
        accessor: (row) => row.author_name || "Unknown",
        render: (row) => <span>{row.author_name || "Unknown"}</span>,
      },
    ],
    [columns]
  )

  const tabs: DataTableTab[] = useMemo(
    () => [
      { key: "mine", label: "My Documents" },
      { key: "general", label: "General" },
    ],
    []
  )

  const isGeneralTab = activeTab === "general"
  const tableData = isGeneralTab ? generalDocs : docs

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
        key: "visibility",
        label: "Visibility",
        options: [
          { value: "private", label: "Private" },
          { value: "general", label: "General" },
        ],
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

  const loadGeneralDocumentation = useCallback(async () => {
    setIsLoadingGeneral(true)
    try {
      const { data, error } = await supabase
        .from("user_documentation")
        .select("*, profiles(first_name, last_name)")
        .eq("visibility", "general")
        .eq("is_draft", false)
        .order("updated_at", { ascending: false })

      if (error) throw error
      setGeneralDocs(
        (data || []).map((row: Record<string, unknown>) => {
          const author = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
          const named = author as { first_name?: string; last_name?: string } | null
          return {
            ...(row as unknown as Documentation),
            author_name: named ? `${named.first_name ?? ""} ${named.last_name ?? ""}`.trim() : null,
          }
        })
      )
    } catch (error) {
      log.error("Error loading general documentation:", error)
      toast.error("Failed to load general documentation")
    } finally {
      setIsLoadingGeneral(false)
    }
  }, [supabase])

  useEffect(() => {
    if (activeTab === "general") void loadGeneralDocumentation()
  }, [activeTab, loadGeneralDocumentation])

  function openCreateDialog() {
    setSelectedDoc(null)
    setFormData({
      title: "",
      content: "",
      category: "",
      tags: "",
      is_draft: false,
      visibility: "private",
      attachments: [],
    })
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
      visibility: doc.visibility ?? "private",
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
      payload.append("visibility", formData.visibility)
      for (const file of formData.attachments) {
        payload.append("attachments", file)
      }

      const response = await apiFetch(
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
      const response = await apiFetch(`/api/documentation/internal/${selectedDoc.id}`, { method: "DELETE" })
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
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
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
        data={tableData}
        columns={isGeneralTab ? generalColumns : columns}
        filters={isGeneralTab ? filters.filter((f) => f.key === "category") : filters}
        isLoading={isGeneralTab && isLoadingGeneral}
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
          // Editing and deleting stay with the author — on the General tab the
          // rows belong to other people, and the API scopes writes by user_id.
          { label: "Edit", icon: Edit2, onClick: openEditDialog, hidden: (doc) => doc.user_id !== userId },
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            hidden: (doc) => doc.user_id !== userId,
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
