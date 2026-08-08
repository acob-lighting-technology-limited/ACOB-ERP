"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Loader2, Paperclip, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { apiFetch } from "@/lib/api-client"
import { formatWATDateTime } from "@/lib/utils/date"
import { logger } from "@/lib/logger"

const log = logger("ticket-attachments-panel")

interface TicketAttachment {
  id: string
  file_name: string
  mime_type: string
  file_size: number
  uploaded_by: string
  created_at: string
  signed_url: string | null
}

interface TicketAttachmentsPanelProps {
  ticketId: string | null
  /** Used to decide whose files show a remove button. */
  currentUserId: string
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Files on a help desk ticket. Anyone who can see the ticket can see and
 * download its attachments; only the uploader can remove their own.
 */
export function TicketAttachmentsPanel({ ticketId, currentUserId }: TicketAttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    if (!ticketId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}/attachments`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to load attachments")
      setAttachments(payload?.data || [])
    } catch (error) {
      log.error({ err: String(error) }, "load attachments failed")
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleUpload(fileList: FileList | null) {
    if (!ticketId || !fileList || fileList.length === 0) return
    setUploading(true)
    try {
      const body = new FormData()
      for (const file of Array.from(fileList)) body.append("files", file)

      const res = await apiFetch(`/api/help-desk/tickets/${ticketId}/attachments`, { method: "POST", body })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to attach the file")

      toast.success(fileList.length === 1 ? "File attached" : `${fileList.length} files attached`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to attach the file")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function handleRemove(attachmentId: string) {
    if (!ticketId) return
    try {
      const res = await apiFetch(
        `/api/help-desk/tickets/${ticketId}/attachments?attachment_id=${encodeURIComponent(attachmentId)}`,
        { method: "DELETE" }
      )
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || "Failed to remove the attachment")
      toast.success("Attachment removed")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove the attachment")
    }
  }

  if (!ticketId) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <Paperclip className="h-4 w-4" />
          Attachments
        </Label>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Attach file
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp,.docx,.xlsx"
        className="hidden"
        onChange={(event) => void handleUpload(event.target.files)}
      />

      {loading ? (
        <p className="text-muted-foreground text-xs">Loading attachments…</p>
      ) : attachments.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No files yet. Attach a screenshot, invoice or document to help whoever picks this up.
        </p>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="bg-card flex items-center justify-between gap-2 rounded border p-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{attachment.file_name}</p>
                <p className="text-muted-foreground text-[11px]">
                  {formatSize(attachment.file_size)} · {formatWATDateTime(attachment.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {attachment.signed_url && (
                  <Button variant="ghost" size="icon" asChild aria-label={`Download ${attachment.file_name}`}>
                    <a href={attachment.signed_url} target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                {attachment.uploaded_by === currentUserId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${attachment.file_name}`}
                    onClick={() => void handleRemove(attachment.id)}
                  >
                    <Trash2 className="text-destructive h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
