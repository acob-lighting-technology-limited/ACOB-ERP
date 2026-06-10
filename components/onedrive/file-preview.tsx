/**
 * File Preview Component
 * Modal for previewing different file types from OneDrive
 */

"use client"

import { useState, useEffect } from "react"
import { formatWATDate } from "@/lib/utils/date"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Download, ExternalLink, X, Loader2 } from "lucide-react"
import type { FileItem, FileCategory } from "@/lib/onedrive"
import { FileIcon } from "./file-icon"

interface FilePreviewProps {
  file: FileItem | null
  category: FileCategory
  isOpen: boolean
  onClose: () => void
  accessMode?: "self" | "admin"
  lockedDepartment?: string
}

interface PreviewData {
  previewUrl: string
  previewType: "embed" | "image" | "download"
}

export function FilePreview({
  file,
  category,
  isOpen,
  onClose,
  accessMode = "self",
  lockedDepartment,
}: FilePreviewProps) {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file || !isOpen) {
      setPreviewData(null)
      setError(null)
      return
    }
    let isCancelled = false

    const fetchPreview = async () => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ path: file.path, accessMode })
        if (lockedDepartment) params.set("department", lockedDepartment)
        const response = await fetch(`/api/onedrive/preview?${params.toString()}`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || "Failed to load preview")
        }

        if (!isCancelled) {
          setPreviewData({
            previewUrl: data.data.previewUrl,
            previewType: data.data.previewType,
          })
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "Failed to load preview")
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    fetchPreview()

    return () => {
      isCancelled = true
    }
  }, [accessMode, file, isOpen, lockedDepartment])

  const handleDownload = () => {
    if (!file) return
    const params = new URLSearchParams({ path: file.path, redirect: "true", accessMode })
    if (lockedDepartment) params.set("department", lockedDepartment)
    window.open(`/api/onedrive/download?${params.toString()}`, "_blank")
  }

  const handleOpenInOneDrive = () => {
    if (file?.webUrl) {
      window.open(file.webUrl, "_blank")
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
  }

  const renderPreviewContent = () => {
    if (loading) {
      return (
        <div className="flex h-96 flex-col items-center justify-center gap-4">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          <p className="text-muted-foreground text-sm">Loading preview...</p>
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex h-96 flex-col items-center justify-center gap-4">
          <FileIcon category={category} size={64} />
          <p className="text-muted-foreground text-sm">{error}</p>
          <Button onClick={handleDownload} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download Instead
          </Button>
        </div>
      )
    }

    if (!previewData) {
      return (
        <div className="flex h-96 flex-col items-center justify-center gap-4">
          <FileIcon category={category} size={64} />
          <p className="text-muted-foreground text-sm">Preview not available</p>
        </div>
      )
    }

    switch (previewData.previewType) {
      case "image":
        return (
          <div className="bg-muted/30 flex max-h-[70vh] min-h-96 items-center justify-center overflow-auto rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewData.previewUrl}
              alt={file?.name || "Preview"}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )

      case "embed":
        return (
          <div className="h-[70vh] w-full overflow-hidden rounded-lg border">
            <iframe
              src={previewData.previewUrl}
              className="h-full w-full"
              title={file?.name || "Document Preview"}
              allowFullScreen
            />
          </div>
        )

      default:
        return (
          <div className="flex h-96 flex-col items-center justify-center gap-4">
            <FileIcon category={category} size={64} />
            <p className="text-muted-foreground text-sm">This file type cannot be previewed in the browser.</p>
            <Button onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download File
            </Button>
          </div>
        )
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-5xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <FileIcon category={category} size={28} />
              <div className="min-w-0">
                <DialogTitle className="truncate">{file?.name}</DialogTitle>
                {file && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {formatFileSize(file.size)} • {formatWATDate(file.lastModified)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleOpenInOneDrive} title="Open in OneDrive">
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-4 flex-1 overflow-auto">{renderPreviewContent()}</div>
      </DialogContent>
    </Dialog>
  )
}
