"use client"

import { useState, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileText, List, Eye, User, FolderOpen, Calendar } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { DepartmentDocumentsBrowser } from "@/components/documentation/department-documents-browser"
import { AdminDocViewDialog } from "@/components/documentation/admin-doc-view-dialog"
import { MarkdownContent } from "@/components/ui/markdown-content"
import type { AdminDocumentation, UserProfile, employeeMember } from "@/components/documentation/admin-doc-types"

// Re-export types for consumers of this module
export type { UserProfile, employeeMember }
export type Documentation = AdminDocumentation

interface AdminDocumentationContentProps {
  initialDocumentation: AdminDocumentation[]
  initialemployee: employeeMember[]
  userProfile: UserProfile
  departmentDocs: {
    initialPath: string
    rootLabel: string
    enabled: boolean
    lockToInitialPath?: boolean
    accessMode?: "self" | "admin"
    lockedDepartment?: string
  }
  defaultTab?: "knowledge-docs" | "department-documents"
  hideTabList?: boolean
  backLinkHref?: string
  backLinkLabel?: string
}

const formatDate = (dateString: string) =>
  formatWATDate(dateString, { month: "short", day: "numeric", year: "numeric" })

const getStatusColor = (isDraft: boolean) =>
  isDraft
    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"

export function AdminDocumentationContent({
  initialDocumentation,
  initialemployee,
  departmentDocs,
  defaultTab,
  hideTabList = false,
  backLinkHref = "/admin",
  backLinkLabel = "Back to Admin",
}: AdminDocumentationContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabFromUrl = searchParams.get("tab")
  const initialTab = defaultTab || (tabFromUrl === "department-documents" ? "department-documents" : "knowledge-docs")
  const [activeTab, setActiveTab] = useState<string>(initialTab)

  const [documentation] = useState<AdminDocumentation[]>(initialDocumentation)
  const [employees] = useState<employeeMember[]>(initialemployee)
  const [selectedDoc, setSelectedDoc] = useState<AdminDocumentation | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)

  const handleViewDocument = (doc: AdminDocumentation) => {
    setSelectedDoc(doc)
    setIsViewDialogOpen(true)
  }

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", value)
    router.replace(`?${params.toString()}`)
  }

  const categories = Array.from(new Set(documentation.map((d) => d.category).filter(Boolean))) as string[]
  const departments = Array.from(new Set(documentation.map((d) => d.user?.department).filter(Boolean))) as string[]

  const stats = {
    total: documentation.length,
    published: documentation.filter((d) => !d.is_draft).length,
    drafts: documentation.filter((d) => d.is_draft).length,
    thisMonth: documentation.filter(
      (d) =>
        new Date(d.created_at).getMonth() === new Date().getMonth() &&
        new Date(d.created_at).getFullYear() === new Date().getFullYear()
    ).length,
  }

  const columns = useMemo<DataTableColumn<AdminDocumentation>[]>(
    () => [
      {
        key: "title",
        label: "Title",
        sortable: true,
        accessor: (row) => row.title,
        resizable: true,
        initialWidth: 300,
        render: (row) => (
          <div className="space-y-1">
            <p className="font-medium">{row.title}</p>
            <p className="text-muted-foreground text-xs">{formatDate(row.created_at)}</p>
          </div>
        ),
      },
      {
        key: "category",
        label: "Category",
        sortable: true,
        accessor: (row) => row.category || "",
        hideOnMobile: true,
        render: (row) => (
          <Badge variant="outline" className="text-xs">
            {row.category || "General"}
          </Badge>
        ),
      },
      {
        key: "author",
        label: "Author",
        sortable: true,
        accessor: (row) => `${row.user?.first_name || ""} ${row.user?.last_name || ""}`,
        hideOnMobile: true,
        render: (row) => (
          <div className="space-y-1">
            <p className="text-sm">
              {row.user?.first_name} {row.user?.last_name}
            </p>
            <p className="text-muted-foreground text-xs">{row.user?.department}</p>
          </div>
        ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        accessor: (row) => (row.is_draft ? "Draft" : "Published"),
        render: (row) => <Badge className={getStatusColor(row.is_draft)}>{row.is_draft ? "Draft" : "Published"}</Badge>,
      },
      {
        key: "updated_at",
        label: "Last Updated",
        sortable: true,
        accessor: (row) => row.updated_at,
        hideOnMobile: true,
        render: (row) => <span className="text-muted-foreground text-sm">{formatDate(row.updated_at)}</span>,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<AdminDocumentation>[]>(
    () => [
      {
        key: "category",
        label: "Category",
        options: categories.map((c) => ({ value: c, label: c })),
      },
      {
        key: "status",
        label: "Status",
        options: [
          { value: "Published", label: "Published" },
          { value: "Draft", label: "Draft" },
        ],
      },
      {
        key: "department",
        label: "Department",
        options: departments.map((d) => ({ value: d, label: d })),
        mode: "custom",
        filterFn: (row, value) => {
          if (!value || value.length === 0) return true
          return value.includes(row.user?.department || "")
        },
      },
      {
        key: "author",
        label: "Author",
        options: employees.map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` })),
        mode: "custom",
        filterFn: (row, value) => {
          if (!value || value.length === 0) return true
          return value.includes(row.user_id)
        },
      },
    ],
    [categories, departments, employees]
  )

  const TABS: DataTableTab[] = useMemo(
    () => [
      { key: "knowledge-docs", label: "Internal Documentation", icon: FileText },
      { key: "department-documents", label: "Department Documents", icon: List },
    ],
    []
  )

  return (
    <DataTablePage
      title="Employee Documentation"
      description="Manage and view all internal writeups, knowledge base articles, and departmental files."
      icon={FileText}
      backLink={{ href: backLinkHref, label: backLinkLabel }}
      tabs={hideTabList ? undefined : TABS}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      stats={
        activeTab === "knowledge-docs" ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <StatCard
              title="Total Docs"
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
              title="Drafts"
              value={stats.drafts}
              icon={FileText}
              iconBgColor="bg-amber-500/10"
              iconColor="text-amber-500"
            />
            <StatCard
              title="This Month"
              value={stats.thisMonth}
              icon={FileText}
              iconBgColor="bg-violet-500/10"
              iconColor="text-violet-500"
            />
          </div>
        ) : null
      }
    >
      {activeTab === "knowledge-docs" ? (
        <>
          <DataTable<AdminDocumentation>
            data={documentation}
            columns={columns}
            filters={filters}
            getRowId={(row) => row.id}
            pagination={{ pageSize: 50 }}
            searchPlaceholder="Search titles or content..."
            searchFn={(row, query) => {
              const q = query.toLowerCase()
              return (
                row.title.toLowerCase().includes(q) ||
                row.content.toLowerCase().includes(q) ||
                (row.user?.first_name || "").toLowerCase().includes(q) ||
                (row.user?.last_name || "").toLowerCase().includes(q)
              )
            }}
            rowActions={[
              {
                label: "View",
                icon: Eye,
                onClick: handleViewDocument,
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
              <Card key={doc.id} className="border-2 transition-shadow hover:shadow-lg">
                <CardHeader className="from-primary/5 to-background border-b bg-gradient-to-r p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="bg-primary/10 rounded-lg p-2">
                      <FileText className="text-primary h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="line-clamp-2 text-base">{doc.title}</CardTitle>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge className={getStatusColor(doc.is_draft)}>{doc.is_draft ? "Draft" : "Published"}</Badge>
                        {doc.category && (
                          <Badge variant="outline" className="text-xs">
                            {doc.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 p-4 pt-4">
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <User className="h-4 w-4" />
                    <span className="truncate">
                      {doc.user?.first_name} {doc.user?.last_name}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <FolderOpen className="h-4 w-4" />
                    <span className="truncate">{doc.user?.department || "No Department"}</span>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4" />
                    <span>{formatDate(doc.created_at)}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewDocument(doc)}
                    className="mt-2 w-full gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    View Document
                  </Button>
                </CardContent>
              </Card>
            )}
            emptyTitle="No Documentation Found"
            emptyDescription="No documentation has been created yet or matches your filters."
            urlSync
          />

          <AdminDocViewDialog
            open={isViewDialogOpen}
            onOpenChange={setIsViewDialogOpen}
            doc={selectedDoc}
            getStatusColor={getStatusColor}
            formatDate={formatDate}
          />
        </>
      ) : (
        <div className="space-y-4">
          {departmentDocs.enabled ? (
            <DepartmentDocumentsBrowser
              initialPath={departmentDocs.initialPath}
              rootLabel={departmentDocs.rootLabel}
              lockToInitialPath={Boolean(departmentDocs.lockToInitialPath)}
              accessMode={departmentDocs.accessMode ?? "admin"}
              lockedDepartment={departmentDocs.lockedDepartment}
              backLink={{ href: "/admin/documentation", label: "Back to Documentation" }}
            />
          ) : (
            <Card className="border-2">
              <CardContent className="p-12 text-center">
                <h3 className="text-foreground mb-2 text-xl font-semibold">Department Documents Not Available</h3>
                <p className="text-muted-foreground">No managed department folder is assigned to this account yet.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </DataTablePage>
  )
}
