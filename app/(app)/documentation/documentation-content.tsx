"use client"

import { useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Edit2, Eye, FileText, Plus, Trash2 } from "lucide-react"
import { formatWATDateTime } from "@/lib/utils/date"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Documentation } from "./page"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { DepartmentDocumentsBrowser } from "@/components/documentation/department-documents-browser"
import { DocViewDialog } from "@/components/documentation/doc-view-dialog"
import { DocFormDialog, type DocFormData } from "@/components/documentation/doc-form-dialog"
import { DocDeleteDialog } from "@/components/documentation/doc-delete-dialog"

import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("documentation-documentation-content")

interface DocumentationContentProps {
  initialDocs: Documentation[]
  userId: string
  departmentDocs: {
    initialPath: string
    rootLabel: string
    enabled: boolean
    lockToInitialPath: boolean
    accessMode: "self" | "admin"
  }
  defaultTab?: "knowledge-docs" | "department-documents"
  hideTabList?: boolean
  backLinkHref?: string
  backLinkLabel?: string
}

export function DocumentationContent({
  initialDocs,
  userId,
  departmentDocs,
  defaultTab,
  hideTabList = false,
  backLinkHref = "/profile",
  backLinkLabel = "Back to Dashboard",
}: DocumentationContentProps) {
  const searchParams = useSearchParams()
  const tabFromUrl = searchParams.get("tab")
  const initialTab = defaultTab || (tabFromUrl === "department-documents" ? "department-documents" : "knowledge-docs")
  const [activeTab, setActiveTab] = useState<"knowledge-docs" | "department-documents">(
    initialTab as "knowledge-docs" | "department-documents"
  )
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
  const supabase = createClient()

  const loadDocumentation = async () => {
    try {
      const { data, error } = await supabase
        .from("user_documentation")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })

      if (error) throw error
      setDocs(data || [])
    } catch (error) {
      log.error("Error loading documentation:", error)
      toast.error("Failed to load documentation")
    }
  }

  const openCreateDialog = () => {
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

  const openEditDialog = (doc: Documentation) => {
    setSelectedDoc(doc)
    setFormData({
      title: doc.title,
      content: doc.content,
      category: doc.category || "",
      tags: doc.tags?.join(", ") || "",
      is_draft: doc.is_draft,
      visibility: (doc as { visibility?: "private" | "general" }).visibility ?? "private",
      attachments: [],
    })
    setIsDialogOpen(true)
  }

  const handleSave = async (isDraft: boolean) => {
    if (!formData.title.trim() || !formData.category.trim() || !formData.content.trim()) {
      toast.error("Title, category, and content are required")
      return
    }

    setIsSaving(true)
    const attachmentCount = formData.attachments.length
    const uploadToastId =
      attachmentCount > 0
        ? toast.loading(`Uploading ${attachmentCount} file${attachmentCount === 1 ? "" : "s"} to SharePoint`, {
            description: "Please keep this dialog open until the save completes.",
          })
        : null

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

      toast.success(selectedDoc ? "Documentation updated" : "Documentation created", {
        id: uploadToastId || undefined,
      })

      setIsDialogOpen(false)
      await loadDocumentation()
    } catch (error) {
      log.error("Error saving documentation:", error)
      toast.error("Failed to save documentation", {
        id: uploadToastId || undefined,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
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

  const formatDate = (dateString: string) => formatWATDateTime(dateString)

  const stats = {
    total: docs.length,
    published: docs.filter((d) => !d.is_draft).length,
    draft: docs.filter((d) => d.is_draft).length,
  }

  const getStatusColor = (isDraft: boolean) =>
    isDraft
      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"

  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(docs.map((d) => d.category).filter(Boolean))).map((c) => ({
        value: String(c),
        label: String(c),
      })),
    [docs]
  )

  const columns = useMemo<DataTableColumn<Documentation>[]>(
    () => [
      {
        key: "title",
        label: "Title",
        sortable: true,
        accessor: (d) => d.title,
        resizable: true,
        initialWidth: 320,
        render: (d) => <span className="font-medium">{d.title}</span>,
      },
      {
        key: "category",
        label: "Category",
        sortable: true,
        accessor: (d) => d.category ?? "-",
        hideOnMobile: true,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (d) => (d.is_draft ? "draft" : "published"),
        render: (d) => <Badge className={getStatusColor(d.is_draft)}>{d.is_draft ? "Draft" : "Published"}</Badge>,
      },
      {
        key: "updated_at",
        label: "Updated",
        sortable: true,
        accessor: (d) => d.updated_at,
        render: (d) => <span className="text-muted-foreground text-xs">{formatDate(d.updated_at)}</span>,
        hideOnMobile: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const filters = useMemo<DataTableFilter<Documentation>[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "draft", label: "Draft" },
          { value: "published", label: "Published" },
        ],
        mode: "custom" as const,
        filterFn: (doc: Documentation, selected: string[]) => selected.includes(doc.is_draft ? "draft" : "published"),
      },
      {
        key: "category",
        label: "Category",
        options: categoryOptions,
      },
    ],
    [categoryOptions]
  )

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "knowledge-docs" | "department-documents")}>
      {!hideTabList && (
        <div className="mb-4">
          <TabsList className="grid w-full max-w-lg grid-cols-2">
            <TabsTrigger value="knowledge-docs">Internal Documentation</TabsTrigger>
            <TabsTrigger value="department-documents">Department Documents</TabsTrigger>
          </TabsList>
        </div>
      )}

      <TabsContent value="knowledge-docs" className="space-y-4">
        <DataTablePage
          title="My Documentation"
          description="Create and manage your work documentation"
          icon={FileText}
          backLink={{ href: backLinkHref, label: backLinkLabel }}
          spacing="tight"
          actionsPlacement="inline-always"
          actions={
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Document</span>
            </Button>
          }
          stats={
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
              <StatCard
                variant="compact"
                title="Total"
                value={stats.total}
                icon={FileText}
                iconBgColor="bg-blue-500/10"
                iconColor="text-blue-500"
              />
              <StatCard
                variant="compact"
                title="Published"
                value={stats.published}
                icon={FileText}
                iconBgColor="bg-emerald-500/10"
                iconColor="text-emerald-500"
              />
              <StatCard
                variant="compact"
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
            getRowId={(d) => d.id}
            searchPlaceholder="Search title, content, or tags..."
            searchFn={(d, q) => {
              const lq = q.toLowerCase()
              return (
                d.title.toLowerCase().includes(lq) ||
                d.content.toLowerCase().includes(lq) ||
                (d.tags ?? []).some((t) => t.toLowerCase().includes(lq))
              )
            }}
            rowActions={[
              {
                label: "View",
                icon: Eye,
                onClick: (d) => {
                  setSelectedDoc(d)
                  setIsViewDialogOpen(true)
                },
              },
              {
                label: "Edit",
                icon: Edit2,
                onClick: openEditDialog,
              },
              {
                label: "Delete",
                icon: Trash2,
                variant: "destructive",
                onClick: (d) => {
                  setSelectedDoc(d)
                  setIsDeleteDialogOpen(true)
                },
              },
            ]}
            expandable={{
              render: (d) => (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Content Preview</p>
                  <div className="bg-muted/30 rounded-lg border p-4">
                    <p className="line-clamp-6 text-sm whitespace-pre-line">{d.content || "No content."}</p>
                  </div>
                </div>
              ),
            }}
            stickyToolbar
            viewToggle
            contactsView
            defaultViewMode={{ mobile: "contacts", desktop: "list" }}
            mobileRow={{
              title: (d) => d.title,
              subtitle: (d) => d.category ?? (d.is_draft ? "Draft" : "Published"),
              trailing: (d) => (
                <Badge className={getStatusColor(d.is_draft)}>{d.is_draft ? "Draft" : "Published"}</Badge>
              ),
              detail: {
                title: (d) => d.title,
                fields: (d) => [
                  { label: "Category", value: d.category ?? null },
                  { label: "Status", value: d.is_draft ? "Draft" : "Published" },
                  { label: "Tags", value: d.tags?.join(", ") ?? null },
                  { label: "Updated", value: formatDate(d.updated_at) },
                ],
                actions: (d) => [
                  {
                    label: "View",
                    icon: Eye,
                    variant: "outline" as const,
                    onClick: () => {
                      setSelectedDoc(d)
                      setIsViewDialogOpen(true)
                    },
                  },
                ],
              },
            }}
            cardRenderer={(d) => (
              <div
                className="bg-card hover:border-primary cursor-pointer rounded-xl border-2 p-4 transition-all"
                onClick={() => {
                  setSelectedDoc(d)
                  setIsViewDialogOpen(true)
                }}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h4 className="line-clamp-1 text-sm font-semibold">{d.title}</h4>
                  <Badge className={getStatusColor(d.is_draft)}>{d.is_draft ? "Draft" : "Published"}</Badge>
                </div>
                <p className="text-muted-foreground text-[11px]">{d.category ?? "-"}</p>
                <p className="text-muted-foreground mt-2 line-clamp-3 text-xs">{d.content}</p>
              </div>
            )}
            emptyTitle="No documents found"
            emptyDescription="Create your first document to get started."
            emptyIcon={FileText}
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
      </TabsContent>

      <TabsContent value="department-documents" className="space-y-4">
        {departmentDocs.enabled ? (
          <DepartmentDocumentsBrowser
            initialPath={departmentDocs.initialPath}
            rootLabel={departmentDocs.rootLabel}
            lockToInitialPath={departmentDocs.lockToInitialPath}
            accessMode={departmentDocs.accessMode}
            backLink={{ href: backLinkHref, label: backLinkLabel }}
          />
        ) : (
          <Card className="border-2">
            <CardContent className="p-12 text-center">
              <h3 className="text-foreground mb-2 text-xl font-semibold">Department Documents Not Available</h3>
              <p className="text-muted-foreground">
                Your account is not assigned to a department yet. Contact HR or an administrator.
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  )
}
