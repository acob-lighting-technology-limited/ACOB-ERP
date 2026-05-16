"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Search,
  Grid3X3,
  List,
  Download,
  Eye,
  MoreHorizontal,
  RefreshCw,
  Loader2,
  FolderOpen,
  AlertCircle,
  Cloud,
  FolderPlus,
  Upload,
  Pencil,
  Trash2,
  FolderUp,
} from "lucide-react"
import { BreadcrumbNav } from "@/components/onedrive/breadcrumb-nav"
import { FileIcon, getExtensionColor } from "@/components/onedrive/file-icon"
import { FilePreview } from "@/components/onedrive/file-preview"
import type { FileItem, FileCategory } from "@/lib/onedrive"
import { getFileCategory } from "@/lib/onedrive"
import { toast } from "sonner"
import JSZip from "jszip"
import { saveAs } from "file-saver"
import { toLocalISODate } from "@/lib/utils/date"

interface DepartmentDocumentsBrowserProps {
  initialPath?: string
  rootLabel?: string
  lockToInitialPath?: boolean
  accessMode?: "self" | "admin"
}

interface UploadQueueItem {
  id: string
  label: string
  progress: number
  status: "queued" | "uploading" | "complete" | "error"
  error?: string
}

interface UploadCandidate {
  id: string
  file: File
  label: string
  targetPath: string
}

interface UploadPlan {
  files: UploadCandidate[]
  folderPaths: string[]
}

interface FileSystemEntryBase {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
}

interface FileSystemFileEntry extends FileSystemEntryBase {
  isFile: true
  file: (success: (file: File) => void, error?: (err: DOMException) => void) => void
}

interface FileSystemDirectoryReader {
  readEntries: (success: (entries: FileSystemEntryBase[]) => void, error?: (err: DOMException) => void) => void
}

interface FileSystemDirectoryEntry extends FileSystemEntryBase {
  isDirectory: true
  createReader: () => FileSystemDirectoryReader
}

interface UploadSourceFile {
  file: File
  relativePath: string
}

function normalizePath(path: string): string {
  const normalized = `/${path || ""}`.replace(/\/+/g, "/")
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

function joinPath(basePath: string, childPath: string): string {
  return normalizePath(`${basePath}/${childPath}`)
}

function dirname(path: string): string {
  const normalized = normalizePath(path)
  return normalized.substring(0, normalized.lastIndexOf("/")) || "/"
}

function basename(path: string): string {
  const normalized = normalizePath(path)
  return normalized.split("/").filter(Boolean).pop() || ""
}

function createUploadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function toTitleCase(value?: string): string {
  return value || "-"
}

function isModifiedAfterCreate(file: FileItem): boolean {
  return Boolean(file.lastModifiedBy)
}

async function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

async function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntryBase[]> {
  const allEntries: FileSystemEntryBase[] = []

  while (true) {
    const chunk = await new Promise<FileSystemEntryBase[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })

    if (chunk.length === 0) {
      break
    }

    allEntries.push(...chunk)
  }

  return allEntries
}

async function collectEntryUploadData(
  entry: FileSystemEntryBase,
  prefix = ""
): Promise<{ files: UploadSourceFile[]; folders: string[] }> {
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry)
    const relativePath = prefix ? `${prefix}/${file.name}` : file.name
    return { files: [{ file, relativePath }], folders: [] }
  }

  if (!entry.isDirectory) {
    return { files: [], folders: [] }
  }

  const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const entries = await readDirectoryEntries(reader)

  const files: UploadSourceFile[] = []
  const folders: string[] = [nextPrefix]

  for (const child of entries) {
    const childResult = await collectEntryUploadData(child, nextPrefix)
    files.push(...childResult.files)
    folders.push(...childResult.folders)
  }

  return { files, folders }
}

export function DepartmentDocumentsBrowser({
  initialPath = "/",
  rootLabel = "Department Libraries",
  lockToInitialPath = false,
  accessMode = "self",
}: DepartmentDocumentsBrowserProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const normalizedInitialPath = normalizePath(initialPath)

  const clampPath = useCallback(
    (path: string) => {
      const normalized = normalizePath(path)
      if (lockToInitialPath) {
        if (normalized === normalizedInitialPath || normalized.startsWith(`${normalizedInitialPath}/`)) {
          return normalized
        }
        return normalizedInitialPath
      }
      return normalized
    },
    [lockToInitialPath, normalizedInitialPath]
  )

  const pathFromUrl = clampPath(searchParams.get("path") || initialPath)
  const [currentPath, setCurrentPath] = useState(pathFromUrl)
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"list" | "grid">("list")
  const [isMutating, setIsMutating] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [uploadPanelOpen, setUploadPanelOpen] = useState(true)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [previewCategory, setPreviewCategory] = useState<FileCategory>("unknown")
  const [previewOpen, setPreviewOpen] = useState(false)
  const filesInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const isAdminMode = accessMode === "admin"
  const canManageCurrentFolder = isAdminMode && currentPath !== "/"
  const selectedCount = selectedPaths.size

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "")
    folderInputRef.current?.setAttribute("directory", "")
  }, [])

  const fetchFiles = useCallback(
    async (path: string, search?: string) => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        params.set("path", path)
        params.set("accessMode", accessMode)
        if (search) params.set("search", search)

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
    },
    [accessMode]
  )

  useEffect(() => {
    fetchFiles(currentPath)
  }, [currentPath, fetchFiles])

  useEffect(() => {
    setSelectedPaths((prev) => {
      const valid = new Set(files.map((file) => file.path))
      const next = new Set<string>()
      prev.forEach((path) => {
        if (valid.has(path)) next.add(path)
      })
      return next
    })
  }, [files])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("path", currentPath)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [currentPath, router, searchParams])

  const navigateToFolder = (path: string) => {
    setCurrentPath(clampPath(path))
    setSearchQuery("")
    setSelectedPaths(new Set())
  }

  const handleFileClick = (file: FileItem) => {
    if (file.isFolder) {
      navigateToFolder(file.path)
      return
    }

    const category = getFileCategory(file.mimeType, file.name)
    setPreviewFile(file)
    setPreviewCategory(category)
    setPreviewOpen(true)
  }

  const toggleSelectedPath = (path: string, checked: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (checked) next.add(path)
      else next.delete(path)
      return next
    })
  }

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedPaths(new Set())
      return
    }
    setSelectedPaths(new Set(files.map((file) => file.path)))
  }

  const fetchFolderContents = useCallback(
    async (path: string): Promise<FileItem[]> => {
      const params = new URLSearchParams()
      params.set("path", path)
      params.set("accessMode", accessMode)
      const response = await fetch(`/api/onedrive?${params.toString()}`)
      const payload = (await response.json().catch(() => null)) as { data?: FileItem[]; error?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load folder contents")
      }
      return payload?.data || []
    },
    [accessMode]
  )

  const collectDownloadableFiles = useCallback(
    async (item: FileItem): Promise<FileItem[]> => {
      if (!item.isFolder) return [item]
      const collected: FileItem[] = []
      const stack = [item.path]
      while (stack.length > 0) {
        const nextPath = stack.pop()
        if (!nextPath) continue
        const children = await fetchFolderContents(nextPath)
        for (const child of children) {
          if (child.isFolder) stack.push(child.path)
          else collected.push(child)
        }
      }
      return collected
    },
    [fetchFolderContents]
  )

  const triggerFileDownload = useCallback(
    async (path: string) => {
      const params = new URLSearchParams()
      params.set("path", path)
      params.set("accessMode", accessMode)
      const link = document.createElement("a")
      params.set("redirect", "true")
      link.href = `/api/onedrive/download?${params.toString()}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    },
    [accessMode]
  )

  const fetchFileBlob = useCallback(
    async (path: string): Promise<Blob> => {
      const params = new URLSearchParams()
      params.set("path", path)
      params.set("accessMode", accessMode)
      params.set("raw", "true")
      const blobResponse = await fetch(`/api/onedrive/download?${params.toString()}`)
      if (!blobResponse.ok) {
        throw new Error("Failed to download file content")
      }
      return blobResponse.blob()
    },
    [accessMode]
  )

  const downloadSelection = useCallback(
    async (items: FileItem[]) => {
      if (items.length === 0) {
        toast.error("No files selected for download")
        return
      }

      setIsMutating(true)
      try {
        const fileMap = new Map<string, FileItem>()
        for (const item of items) {
          const filesToDownload = await collectDownloadableFiles(item)
          for (const file of filesToDownload) {
            fileMap.set(file.path, file)
          }
        }

        const downloadQueue = Array.from(fileMap.values())
        if (downloadQueue.length === 0) {
          toast.error("No downloadable files found in selection")
          return
        }

        const shouldZip = items.length > 1 || items.some((item) => item.isFolder)
        if (shouldZip) {
          const zip = new JSZip()
          for (const file of downloadQueue) {
            const blob = await fetchFileBlob(file.path)
            const zipPath = file.path.replace(/^\/+/, "")
            zip.file(zipPath || file.name, blob)
          }
          const archiveBlob = await zip.generateAsync({ type: "blob" })
          const archiveName = `department-documents-${toLocalISODate()}.zip`
          saveAs(archiveBlob, archiveName)
        } else {
          await triggerFileDownload(downloadQueue[0].path)
        }
        toast.success(
          shouldZip
            ? `ZIP download ready (${downloadQueue.length} file${downloadQueue.length === 1 ? "" : "s"})`
            : `Downloading ${downloadQueue.length} file`
        )
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to download selected files")
      } finally {
        setIsMutating(false)
      }
    },
    [collectDownloadableFiles, fetchFileBlob, triggerFileDownload]
  )

  const handleDownloadSelected = async () => {
    const selectedItems = files.filter((file) => selectedPaths.has(file.path))
    await downloadSelection(selectedItems)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchFiles(currentPath, searchQuery.trim() || undefined)
  }

  const handleRefresh = () => {
    fetchFiles(currentPath, searchQuery.trim() || undefined)
  }

  const resetFileInputs = () => {
    if (filesInputRef.current) filesInputRef.current.value = ""
    if (folderInputRef.current) folderInputRef.current.value = ""
  }

  const updateUploadQueueItem = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    setUploadQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const overallUploadProgress = useMemo(() => {
    if (uploadQueue.length === 0) return 0
    return Math.round(uploadQueue.reduce((sum, item) => sum + item.progress, 0) / uploadQueue.length)
  }, [uploadQueue])

  const uploadWithProgress = useCallback(
    (candidate: UploadCandidate) =>
      new Promise<void>((resolve, reject) => {
        const formData = new FormData()
        formData.set("action", "upload")
        formData.set("path", candidate.targetPath)
        formData.set("accessMode", accessMode)
        formData.set("file", candidate.file)

        const xhr = new XMLHttpRequest()
        xhr.open("POST", "/api/onedrive")

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          const progress = Math.round((event.loaded / event.total) * 100)
          updateUploadQueueItem(candidate.id, { progress, status: "uploading" })
        }

        xhr.onload = () => {
          const response = xhr.responseText ? (JSON.parse(xhr.responseText) as { error?: string }) : {}
          if (xhr.status >= 200 && xhr.status < 300) {
            updateUploadQueueItem(candidate.id, { progress: 100, status: "complete" })
            resolve()
            return
          }

          const message = response.error || "Failed to upload file"
          updateUploadQueueItem(candidate.id, { status: "error", error: message })
          reject(new Error(message))
        }

        xhr.onerror = () => {
          const message = "Upload failed"
          updateUploadQueueItem(candidate.id, { status: "error", error: message })
          reject(new Error(message))
        }

        xhr.send(formData)
      }),
    [accessMode, updateUploadQueueItem]
  )

  const createFolderRequest = useCallback(
    async (folderPath: string) => {
      const formData = new FormData()
      formData.set("action", "create-folder")
      formData.set("path", dirname(folderPath))
      formData.set("accessMode", accessMode)
      formData.set("name", basename(folderPath))

      const response = await fetch("/api/onedrive", {
        method: "POST",
        body: formData,
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(data.error || "Failed to create folder")
      }
    },
    [accessMode]
  )

  const createFolder = async () => {
    const trimmedName = newFolderName.trim()
    if (!trimmedName) {
      toast.error("Folder name is required")
      return
    }

    setIsMutating(true)
    try {
      await createFolderRequest(joinPath(currentPath, trimmedName))
      toast.success("Folder created")
      setNewFolderOpen(false)
      setNewFolderName("")
      await fetchFiles(currentPath, searchQuery.trim() || undefined)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create folder")
    } finally {
      setIsMutating(false)
    }
  }

  const buildUploadPlan = useCallback(
    (sourceFiles: UploadSourceFile[], sourceFolders: string[] = []): UploadPlan => {
      const folderPaths = new Set<string>()

      sourceFolders
        .map((folder) => folder.replace(/^\/+/, ""))
        .filter(Boolean)
        .forEach((folder) => folderPaths.add(joinPath(currentPath, folder)))

      const plannedFiles = sourceFiles.map((source) => {
        const cleanedPath = source.relativePath.replace(/^\/+/, "")
        const segments = cleanedPath.split("/").filter(Boolean)
        const fileName = segments.pop() || source.file.name
        const relativeDir = segments.join("/")
        const targetPath = relativeDir ? joinPath(currentPath, relativeDir) : currentPath

        if (relativeDir) {
          folderPaths.add(targetPath)
        }

        return {
          id: createUploadId(),
          file: source.file,
          label: cleanedPath || fileName,
          targetPath,
        }
      })

      return {
        files: plannedFiles,
        folderPaths: Array.from(folderPaths).sort((a, b) => a.length - b.length),
      }
    },
    [currentPath]
  )

  const runUploadPlan = useCallback(
    async (plan: UploadPlan) => {
      if (!canManageCurrentFolder) {
        toast.error("Open a department library before uploading")
        return
      }

      if (plan.files.length === 0 && plan.folderPaths.length === 0) {
        return
      }

      setIsMutating(true)
      setUploadPanelOpen(true)
      setUploadQueue(plan.files.map((file) => ({ id: file.id, label: file.label, progress: 0, status: "queued" })))

      try {
        for (const folderPath of plan.folderPaths) {
          await createFolderRequest(folderPath)
        }

        for (const candidate of plan.files) {
          await uploadWithProgress(candidate)
        }

        toast.success(
          plan.files.length > 0
            ? `Uploaded ${plan.files.length} item${plan.files.length === 1 ? "" : "s"}`
            : "Folder structure created"
        )

        await fetchFiles(currentPath, searchQuery.trim() || undefined)
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Some uploads failed")
      } finally {
        setIsMutating(false)
        resetFileInputs()
      }
    },
    [canManageCurrentFolder, createFolderRequest, currentPath, fetchFiles, searchQuery, uploadWithProgress]
  )

  const handleFilesSelected = async (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) {
      resetFileInputs()
      return
    }

    const sourceFiles = Array.from(selectedFiles).map((file) => ({
      file,
      relativePath: file.name,
    }))

    await runUploadPlan(buildUploadPlan(sourceFiles))
  }

  const handleFolderSelected = async (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) {
      resetFileInputs()
      return
    }

    const sourceFiles = Array.from(selectedFiles).map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }))

    await runUploadPlan(buildUploadPlan(sourceFiles))
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragActive(false)

    if (!canManageCurrentFolder || isMutating) return

    const entryItems = Array.from(event.dataTransfer.items || []).filter((item) => item.kind === "file")

    if (entryItems.length === 0) return

    const sourceFiles: UploadSourceFile[] = []
    const sourceFolders: string[] = []

    for (const item of entryItems) {
      const entry = (
        item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryBase | null }
      ).webkitGetAsEntry?.()
      if (entry) {
        const collected = await collectEntryUploadData(entry)
        sourceFiles.push(...collected.files)
        sourceFolders.push(...collected.folders)
      } else {
        const file = item.getAsFile()
        if (file) {
          sourceFiles.push({ file, relativePath: file.webkitRelativePath || file.name })
        }
      }
    }

    await runUploadPlan(buildUploadPlan(sourceFiles, sourceFolders))
  }

  const renameItem = async () => {
    const trimmedName = renameValue.trim()
    if (!renameTarget || !trimmedName) {
      toast.error("Name is required")
      return
    }

    setIsMutating(true)
    try {
      const response = await fetch("/api/onedrive", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: renameTarget.path,
          newName: trimmedName,
          accessMode,
        }),
      })
      const data = (await response.json()) as { error?: string }

      if (!response.ok) {
        throw new Error(data.error || "Failed to rename item")
      }

      toast.success("Item renamed")
      setRenameOpen(false)
      setRenameTarget(null)
      setRenameValue("")
      await fetchFiles(currentPath, searchQuery.trim() || undefined)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to rename item")
    } finally {
      setIsMutating(false)
    }
  }

  const deleteItem = async () => {
    if (!deleteTarget) return

    setIsMutating(true)
    try {
      const params = new URLSearchParams()
      params.set("path", deleteTarget.path)
      params.set("accessMode", accessMode)

      const response = await fetch(`/api/onedrive?${params.toString()}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || "Failed to delete item")
      }

      toast.success(`${deleteTarget.isFolder ? "Folder" : "File"} deleted`)
      setDeleteTarget(null)
      await fetchFiles(currentPath, searchQuery.trim() || undefined)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete item")
    } finally {
      setIsMutating(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "-"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  const formatDate = (dateString: string): string =>
    Number.isNaN(Date.parse(dateString))
      ? "-"
      : new Date(dateString).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })

  const getFileExtension = (fileName: string): string => {
    const parts = fileName.split(".")
    return parts.length > 1 ? parts.pop()?.toUpperCase() || "" : ""
  }

  const openRenameDialog = (file: FileItem) => {
    setRenameTarget(file)
    setRenameValue(file.name)
    setRenameOpen(true)
  }

  const renderActivity = (file: FileItem) => (
    <div className="space-y-1">
      <div>Uploaded by: {toTitleCase(file.createdBy)}</div>
      {isModifiedAfterCreate(file) ? <div>Modified by: {toTitleCase(file.lastModifiedBy)}</div> : null}
    </div>
  )

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FolderOpen className="text-muted-foreground/50 mb-4 h-16 w-16" />
      <h3 className="text-lg font-medium">This folder is empty</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        {canManageCurrentFolder
          ? "No files or folders found yet. Use the upload tools above or drag items here."
          : "No files or folders found in this location."}
      </p>
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
          <TableHead className="w-[44px]">
            <Checkbox
              checked={files.length > 0 && selectedCount === files.length}
              onCheckedChange={(value) => toggleSelectAll(Boolean(value))}
              aria-label="Select all items"
            />
          </TableHead>
          <TableHead className="w-[320px]">Name</TableHead>
          <TableHead className="w-[100px]">Type</TableHead>
          <TableHead className="w-[100px]">Size</TableHead>
          <TableHead className="w-[120px]">Modified</TableHead>
          <TableHead className="w-[220px]">Activity</TableHead>
          <TableHead className="w-[80px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const category = getFileCategory(file.mimeType, file.name)
          const extension = file.isFolder ? "" : getFileExtension(file.name)

          return (
            <TableRow key={file.id} className="group cursor-pointer" onClick={() => handleFileClick(file)}>
              <TableCell onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  checked={selectedPaths.has(file.path)}
                  onCheckedChange={(value) => toggleSelectedPath(file.path, Boolean(value))}
                  aria-label={`Select ${file.name}`}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <FileIcon category={file.isFolder ? "folder" : category} size={20} />
                  <span className="max-w-[260px] truncate font-medium">{file.name}</span>
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
              <TableCell className="text-muted-foreground text-sm">{renderActivity(file)}</TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="More options"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canManageCurrentFolder && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            openRenameDialog(file)
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget(file)
                          }}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
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
                            void downloadSelection([file])
                          }}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </DropdownMenuItem>
                      </>
                    )}
                    {file.isFolder && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          void downloadSelection([file])
                        }}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download Folder
                      </DropdownMenuItem>
                    )}
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
            <div className="absolute top-2 left-2 z-10" onClick={(event) => event.stopPropagation()}>
              <Checkbox
                checked={selectedPaths.has(file.path)}
                onCheckedChange={(value) => toggleSelectedPath(file.path, Boolean(value))}
                aria-label={`Select ${file.name}`}
              />
            </div>
            <FileIcon category={file.isFolder ? "folder" : category} size={48} className="mb-3" />
            <span className="line-clamp-2 w-full text-center text-sm font-medium">{file.name}</span>
            <span className="text-muted-foreground mt-1 text-xs">
              {file.isFolder ? `${file.childCount ?? 0} items` : formatFileSize(file.size)}
            </span>
            <div className="text-muted-foreground mt-2 space-y-1 text-center text-[11px]">{renderActivity(file)}</div>

            <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="secondary" size="icon" aria-label="More options" className="h-7 w-7">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canManageCurrentFolder && (
                    <>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          openRenameDialog(file)
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTarget(file)
                        }}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
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
                          void downloadSelection([file])
                        }}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </DropdownMenuItem>
                    </>
                  )}
                  {file.isFolder && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation()
                        void downloadSelection([file])
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download Folder
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <Card
        className={isDragActive ? "border-primary bg-primary/5" : ""}
        onDragOver={(event) => {
          if (!canManageCurrentFolder || isMutating) return
          event.preventDefault()
          setIsDragActive(true)
        }}
        onDragEnter={(event) => {
          if (!canManageCurrentFolder || isMutating) return
          event.preventDefault()
          setIsDragActive(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setIsDragActive(false)
          }
        }}
        onDrop={(event) => {
          void handleDrop(event)
        }}
      >
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Cloud className="h-6 w-6 text-blue-500" />
              <div>
                <CardTitle>Department Documents</CardTitle>
                <CardDescription>Browse confidential department documents stored in OneDrive</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  void handleDownloadSelected()
                }}
                disabled={selectedCount === 0 || isMutating}
              >
                <Download className="h-4 w-4" />
                Download Selected ({selectedCount})
              </Button>
              {isAdminMode && (
                <>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => setNewFolderOpen(true)}
                    disabled={!canManageCurrentFolder || isMutating}
                  >
                    <FolderPlus className="h-4 w-4" />
                    New Folder
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => filesInputRef.current?.click()}
                    disabled={!canManageCurrentFolder || isMutating}
                  >
                    <Upload className="h-4 w-4" />
                    Upload Files
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => folderInputRef.current?.click()}
                    disabled={!canManageCurrentFolder || isMutating}
                  >
                    <FolderUp className="h-4 w-4" />
                    Upload Folder
                  </Button>
                </>
              )}
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
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh"
                onClick={handleRefresh}
                disabled={loading || isMutating}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <input
            ref={filesInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleFilesSelected(event.target.files)
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleFolderSelected(event.target.files)
            }}
          />

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

          {isAdminMode && !canManageCurrentFolder && (
            <div className="bg-muted/50 text-muted-foreground mb-4 rounded-md border px-3 py-2 text-sm">
              Open a department library first to create folders, upload files, upload folders, or drag and drop content.
            </div>
          )}

          {canManageCurrentFolder && (
            <div
              className={`mb-4 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors ${
                isDragActive ? "border-primary bg-primary/5 text-foreground" : "text-muted-foreground"
              }`}
            >
              Drag and drop files or folders here. You can upload multiple files and multiple folders at once.
            </div>
          )}

          <div className="mb-4 border-b pb-4">
            <BreadcrumbNav
              path={currentPath}
              onNavigate={navigateToFolder}
              rootLabel={rootLabel}
              rootPath={lockToInitialPath ? normalizedInitialPath : "/"}
              rootClickable
            />
          </div>

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

      <FilePreview
        file={previewFile}
        category={previewCategory}
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        accessMode={accessMode}
      />

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>Add a new folder inside the current department library.</DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)} disabled={isMutating}>
              Cancel
            </Button>
            <Button onClick={createFolder} disabled={isMutating}>
              {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Item</DialogTitle>
            <DialogDescription>Update the name for this file or folder.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="New name"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameOpen(false)
                setRenameTarget(null)
              }}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button onClick={renameItem} disabled={isMutating}>
              {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.isFolder ? "folder" : "file"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deleteTarget?.name ? `"${deleteTarget.name}"` : "this item"} from the
              department library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteItem} disabled={isMutating} className="bg-red-600 hover:bg-red-700">
              {isMutating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {uploadQueue.length > 0 && (
        <div className="fixed right-4 bottom-4 z-50 w-[min(380px,calc(100vw-2rem))]">
          <Card className="shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Uploads</CardTitle>
                  <CardDescription>
                    {uploadQueue.filter((item) => item.status === "complete").length} of {uploadQueue.length} completed
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {isMutating ? <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setUploadPanelOpen((open) => !open)}
                    aria-label={uploadPanelOpen ? "Collapse uploads" : "Expand uploads"}
                  >
                    {uploadPanelOpen ? "Hide" : "Show"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {uploadPanelOpen ? (
              <CardContent className="space-y-3">
                <Progress value={overallUploadProgress} />
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {uploadQueue.map((item) => (
                    <div key={item.id} className="rounded-md border px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium">{item.label}</span>
                        <span className="text-muted-foreground shrink-0">
                          {item.status === "error" ? "Error" : `${item.progress}%`}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {item.status === "error"
                          ? item.error || "Upload failed"
                          : item.status === "complete"
                            ? "Completed"
                            : item.status === "uploading"
                              ? "Uploading..."
                              : "Queued"}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  )
}
