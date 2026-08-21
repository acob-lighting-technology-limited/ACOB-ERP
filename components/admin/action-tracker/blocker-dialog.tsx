"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, FileText, Loader2, Paperclip, Play, Save, Trash2, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { formatWATDateTime } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"
import { logger } from "@/lib/logger"

const log = logger("action-tracker-blocker-dialog")

export interface BlockerTarget {
  id: string
  title: string
  blocker_note?: string
  blocker_reported_at?: string
  blocker_reported_by_name?: string
}

interface BlockerDialogProps {
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
  target: BlockerTarget | null
  /** Read-only viewers still see the note and the evidence, they just cannot change either. */
  canEdit: boolean
}

interface EvidenceRow {
  id: string
  file_name: string
  mime_type: string
  file_size: number
  caption: string | null
  created_at: string
  signed_url: string | null
}

const MAX_FILE_BYTES = 50 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function BlockerDialog({ isOpen, onClose, onComplete, target, canEdit }: BlockerDialogProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  const targetId = target?.id || ""

  useEffect(() => {
    if (!isOpen) return
    setNote(target?.blocker_note || "")
    setPendingFiles([])
  }, [isOpen, target?.blocker_note])

  const {
    data: evidence = [],
    isLoading: isLoadingEvidence,
    refetch: refetchEvidence,
  } = useQuery({
    queryKey: ["action-tracker", "evidence", targetId],
    enabled: isOpen && Boolean(targetId),
    queryFn: async (): Promise<EvidenceRow[]> => {
      const response = await apiFetch(`/api/reports/action-tracker/${targetId}/evidence`, { cache: "no-store" })
      const payload = (await response.json().catch(() => null)) as { data?: EvidenceRow[]; error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to load evidence")
      return payload?.data || []
    },
  })

  const addPendingFiles = (fileList: FileList | null) => {
    if (!fileList) return
    const accepted: File[] = []
    Array.from(fileList).forEach((file) => {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is larger than 50MB`)
        return
      }
      accepted.push(file)
    })
    if (accepted.length > 0) setPendingFiles((previous) => [...previous, ...accepted])
  }

  const uploadPendingFiles = async () => {
    if (pendingFiles.length === 0 || !targetId) return true
    setIsUploading(true)
    try {
      const formData = new FormData()
      pendingFiles.forEach((file) => formData.append("files", file))
      const response = await apiFetch(`/api/reports/action-tracker/${targetId}/evidence`, {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to upload evidence")
      setPendingFiles([])
      await refetchEvidence()
      return true
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : "Failed to upload evidence")
      return false
    } finally {
      setIsUploading(false)
    }
  }

  const handleSave = async () => {
    if (!targetId) return
    setIsSaving(true)
    try {
      const response = await apiFetch(`/api/reports/action-tracker/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocker_note: note.trim() || null }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to save the hindrance note")

      const uploaded = await uploadPendingFiles()
      queryClient.invalidateQueries({ queryKey: ["action-tracker", "evidence", targetId] })
      toast.success(note.trim() ? "Hindrance recorded" : "Hindrance cleared")
      onComplete()
      if (uploaded) onClose()
    } catch (saveError) {
      log.error({ err: String(saveError) }, "Failed to save blocker note")
      toast.error(saveError instanceof Error ? saveError.message : "Failed to save the hindrance note")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteEvidence = async (row: EvidenceRow) => {
    if (!window.confirm(`Remove ${row.file_name}?`)) return
    try {
      const response = await apiFetch(
        `/api/reports/action-tracker/${targetId}/evidence?evidence_id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" }
      )
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to remove evidence")
      toast.success("Evidence removed")
      await refetchEvidence()
      onComplete()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Failed to remove evidence")
    }
  }

  const busy = isSaving || isUploading

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Hindrance to Completion
          </DialogTitle>
          <DialogDescription>
            Record what is preventing this action point from being completed. Supporting evidence — a photo, a video or
            a document — is optional and only worth attaching when it settles the question.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="bg-muted/30 rounded-lg border p-3">
            <p className="text-muted-foreground text-[10px] font-bold uppercase">Action Point</p>
            <p className="text-sm font-medium">{target?.title}</p>
          </div>

          <div className="space-y-2">
            <Label>What is holding this back?</Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!canEdit}
              placeholder="e.g. Site access was denied by the community; escalated to the Stakeholder Engagement Team on Wednesday."
              className="h-28"
            />
            {target?.blocker_reported_at ? (
              <p className="text-muted-foreground text-xs">
                Last reported{" "}
                {formatWATDateTime(new Date(target.blocker_reported_at), {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
                {target.blocker_reported_by_name ? ` by ${target.blocker_reported_by_name}` : ""}
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                Supporting Evidence
                <span className="text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              {canEdit ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Attach
                </Button>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,application/pdf"
              className="hidden"
              onChange={(event) => {
                addPendingFiles(event.target.files)
                event.target.value = ""
              }}
            />

            {pendingFiles.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <p className="text-muted-foreground text-xs font-semibold uppercase">Ready to upload</p>
                {pendingFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{file.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">{formatSize(file.size)}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive h-6 w-6"
                        onClick={() => setPendingFiles((previous) => previous.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {isLoadingEvidence ? (
              <p className="text-muted-foreground text-sm">Loading evidence…</p>
            ) : evidence.length === 0 && pendingFiles.length === 0 ? (
              <p className="text-muted-foreground text-sm italic">No evidence attached.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {evidence.map((row) => (
                  <div key={row.id} className="space-y-2 rounded-lg border p-2">
                    {row.signed_url && row.mime_type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.signed_url}
                        alt={row.file_name}
                        className="h-32 w-full rounded object-cover"
                        loading="lazy"
                      />
                    ) : row.signed_url && row.mime_type.startsWith("video/") ? (
                      <video src={row.signed_url} controls className="h-32 w-full rounded bg-black object-contain" />
                    ) : (
                      <div className="bg-muted/40 flex h-32 w-full items-center justify-center rounded">
                        {row.mime_type.startsWith("video/") ? (
                          <Play className="text-muted-foreground h-6 w-6" />
                        ) : (
                          <FileText className="text-muted-foreground h-6 w-6" />
                        )}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{row.file_name}</p>
                        <p className="text-muted-foreground text-[11px]">
                          {formatSize(row.file_size)} ·{" "}
                          {formatWATDateTime(new Date(row.created_at), { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                      {canEdit ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive h-6 w-6 shrink-0"
                          onClick={() => void handleDeleteEvidence(row)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      ) : null}
                    </div>
                    {row.signed_url ? (
                      <a
                        href={row.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary text-[11px] underline"
                      >
                        Open original
                      </a>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        Link unavailable
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit ? (
            <Button onClick={() => void handleSave()} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isUploading ? "Uploading…" : "Save"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
