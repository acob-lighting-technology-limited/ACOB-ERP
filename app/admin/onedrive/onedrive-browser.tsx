/**
 * OneDrive Browser Client Component
 * File explorer UI for browsing OneDrive folders
 */

"use client"

import { useState, useEffect, useCallback } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Search,
  Grid3X3,
  List,
  Download,
  Eye,
  ExternalLink,
  MoreHorizontal,
  RefreshCw,
  Loader2,
  FolderOpen,
  AlertCircle,
  Cloud,
} from "lucide-react"
import { BreadcrumbNav } from "@/components/onedrive/breadcrumb-nav"
import { FileIcon, getExtensionColor } from "@/components/onedrive/file-icon"
import { FilePreview } from "@/components/onedrive/file-preview"
import type { FileItem, FileCategory } from "@/lib/onedrive"
import { getFileCategory } from "@/lib/onedrive"

interface OneDriveBrowserProps {
  initialPath?: string
  rootLabel?: string
  showProjectsOnly?: boolean
}

export function OneDriveBrowser({
  initialPath = "/",
  rootLabel = "OneDrive",
  showProjectsOnly = false,
}: OneDriveBrowserProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const pathFromUrl = searchParams.get("path") || initialPath
  const [currentPath, setCurrentPath] = useState(pathFromUrl)
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"list" | "grid">("list")

  // Preview state
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [previewCategory, setPreviewCategory] = useState<FileCategory>("unknown")
  const [previewOpen, setPreviewOpen] = useState(false)

  const fetchFiles = useCallback(async (path: string, search?: string) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set("path", path)
      if (search) {
        params.set("search", search)
      }

      const response = await fetch(`/api/onedrive?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to load files")
      }

      setFiles(data.data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load files")
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles(currentPath)
  }, [currentPath, fetchFiles])

  // Update URL when path changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("path", currentPath)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [currentPath, router, searchParams])

  const navigateToFolder = (path: string) => {
    setCurrentPath(path)
    setSearchQuery("")
  }

  const handleFileClick = (file: FileItem) => {
    if (file.isFolder) {
      navigateToFolder(file.path)
    } else {
      // Open preview
      const category = getFileCategory(file.mimeType, file.name)
      setPreviewFile(file)
      setPreviewCategory(category)
      setPreviewOpen(true)
    }
  }

  const handleDownload = (file: FileItem) => {
    window.open(`/api/onedrive/download?path=${encodeURIComponent(file.path)}&redirect=true`, "_blank")
  }

  const handleOpenInOneDrive = (file: FileItem) => {
    if (file.webUrl) {
      window.open(file.webUrl, "_blank")
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      fetchFiles(currentPath, searchQuery.trim())
    } else {
      fetchFiles(currentPath)
    }
  }

  const handleRefresh = () => {
    fetchFiles(currentPath, searchQuery || undefined)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "-"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
  }

  const formatDate = (dateString: string): string => {
    if (Number.isNaN(Date.parse(dateString))) {
      return "-"
    }

    return formatWATDate(dateString, { year: "numeric", month: "short", day: "numeric" })
  }

  const getFileExtension = (fileName: string): string => {
    const parts = fileName.split(".")
    return parts.length > 1 ? parts.pop()?.toUpperCase() || "" : ""
  }

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FolderOpen className="text-muted-foreground/50 mb-4 h-16 w-16" />
      <h3 className="text-lg font-medium">This folder is empty</h3>
      <p className="text-muted-foreground mt-1 text-sm">No files or folders found in this location.</p>
    </div>
  )

  const renderErrorState = () => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertCircle className="mb-4 h-16 w-16 text-red-500/50" />
      <h3 className="text-lg font-medium text-red-600">Error Loading Files</h3>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">{error}</p>
      <Button onClick={handleRefresh} variant="outline" className="mt-4">
        <RefreshCw className="mr-2 h-4 w-4" />
        Try Again
      </Button>
    </div>
  )

  const renderListView = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[400px]">Name</TableHead>
          <TableHead className="w-[100px]">Type</TableHead>
          <TableHead className="w-[100px]">Size</TableHead>
          <TableHead className="w-[120px]">Modified</TableHead>
          <TableHead className="w-[80px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const category = getFileCategory(file.mimeType, file.name)
          const extension = file.isFolder ? "" : getFileExtension(file.name)

          return (
            <TableRow key={file.id} className="group cursor-pointer" onClick={() => handleFileClick(file)}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <FileIcon category={file.isFolder ? "folder" : category} size={20} />
                  <span className="max-w-[320px] truncate font-medium">{file.name}</span>
                </div>
              </TableCell>
              <TableCell>
                {file.isFolder ? (
                  <span className="text-muted-foreground text-xs">Folder</span>
                ) : extension ? (
                  <span className={`rounded px-2 py-0.5 text-xs ${getExtensionColor(extension)}`}>{extension}</span>
                ) : (
                  <span className="text-muted-foreground text-xs">File</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {file.isFolder ? `${file.childCount ?? 0} items` : formatFileSize(file.size)}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">{formatDate(file.lastModified)}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!file.isFolder && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            handleFileClick(file)
                          }}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Preview
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownload(file)
                          }}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenInOneDrive(file)
                      }}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open in OneDrive
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  const renderGridView = () => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {files.map((file) => {
        const category = getFileCategory(file.mimeType, file.name)

        return (
          <div
            key={file.id}
            className="group bg-card hover:bg-accent/50 relative flex cursor-pointer flex-col items-center rounded-lg border p-4 transition-colors"
            onClick={() => handleFileClick(file)}
          >
            <FileIcon category={file.isFolder ? "folder" : category} size={48} className="mb-3" />
            <span className="line-clamp-2 w-full text-center text-sm font-medium">{file.name}</span>
            <span className="text-muted-foreground mt-1 text-xs">
              {file.isFolder ? `${file.childCount ?? 0} items` : formatFileSize(file.size)}
            </span>

            {/* Action button on hover */}
            <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="secondary" size="icon" className="h-7 w-7">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!file.isFolder && (
                    <>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          handleFileClick(file)
                        }}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Preview
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownload(file)
                        }}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenInOneDrive(file)
                    }}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in OneDrive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Cloud className="h-6 w-6 text-blue-500" />
              <div>
                <CardTitle>{showProjectsOnly ? "Project Files" : "OneDrive Browser"}</CardTitle>
                <CardDescription>Browse files from the company OneDrive</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "grid")}>
                <TabsList className="h-9">
                  <TabsTrigger value="list" className="px-3">
                    <List className="h-4 w-4" />
                  </TabsTrigger>
                  <TabsTrigger value="grid" className="px-3">
                    <Grid3X3 className="h-4 w-4" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="icon" onClick={handleRefresh} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Search and Breadcrumb */}
          <div className="mb-4 flex flex-col gap-4 sm:flex-row">
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
                <Input
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </form>
          </div>

          <div className="mb-4 border-b pb-4">
            <BreadcrumbNav path={currentPath} onNavigate={navigateToFolder} rootLabel={rootLabel} />
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            </div>
          ) : error ? (
            renderErrorState()
          ) : files.length === 0 ? (
            renderEmptyState()
          ) : viewMode === "list" ? (
            renderListView()
          ) : (
            renderGridView()
          )}
        </CardContent>
      </Card>

      {/* File Preview Modal */}
      <FilePreview
        file={previewFile}
        category={previewCategory}
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  )
}
