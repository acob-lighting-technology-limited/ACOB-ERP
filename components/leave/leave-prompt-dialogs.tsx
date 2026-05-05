"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PromptDialog } from "@/components/ui/prompt-dialog"

function prettyDocName(name: string) {
  return name.replaceAll("_", " ")
}

interface LeaveRejectPromptDialogProps {
  rejectPrompt: { requestId: string } | null
  onOpenChange: (open: boolean) => void
  onConfirm: (requestId: string, reason: string) => void
}

interface LeaveApprovePromptDialogProps {
  approvePrompt: { requestId: string } | null
  onOpenChange: (open: boolean) => void
  onConfirm: (requestId: string, feedback: string) => void
}

export function LeaveApprovePromptDialog({ approvePrompt, onOpenChange, onConfirm }: LeaveApprovePromptDialogProps) {
  return (
    <PromptDialog
      open={!!approvePrompt}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
      title="Approval Feedback"
      description="Provide feedback for this approval decision."
      label="Feedback"
      placeholder="Enter approval feedback..."
      inputType="textarea"
      required
      confirmLabel="Approve Leave"
      onConfirm={(feedback) => {
        if (approvePrompt) onConfirm(approvePrompt.requestId, feedback)
      }}
    />
  )
}

export function LeaveRejectPromptDialog({ rejectPrompt, onOpenChange, onConfirm }: LeaveRejectPromptDialogProps) {
  return (
    <PromptDialog
      open={!!rejectPrompt}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}
      title="Rejection Reason"
      description="Please provide a reason for rejecting this leave request."
      label="Reason"
      placeholder="Enter rejection reason..."
      inputType="textarea"
      required
      confirmLabel="Reject Leave"
      confirmVariant="destructive"
      onConfirm={(reason) => {
        if (rejectPrompt) onConfirm(rejectPrompt.requestId, reason)
      }}
    />
  )
}

interface LeaveEvidencePromptDialogProps {
  evidencePrompt: { requestId: string; documentType: string } | null
  onOpenChange: (open: boolean) => void
  onConfirm: (requestId: string, documentType: string, file: File) => void | Promise<void>
}

export function LeaveEvidencePromptDialog({ evidencePrompt, onOpenChange, onConfirm }: LeaveEvidencePromptDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!evidencePrompt) return
    setFile(null)
    setSubmitting(false)
    const timer = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [evidencePrompt])

  async function handleConfirm() {
    if (!evidencePrompt || !file) return
    setSubmitting(true)
    try {
      await Promise.resolve(onConfirm(evidencePrompt.requestId, evidencePrompt.documentType, file))
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={Boolean(evidencePrompt)}
      onOpenChange={(open) => {
        if (submitting) return
        if (!open) {
          setFile(null)
          onOpenChange(false)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Evidence: {evidencePrompt ? prettyDocName(evidencePrompt.documentType) : ""}</DialogTitle>
          <DialogDescription>
            Select the document file. It will be uploaded to SharePoint automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="leave-evidence-file">Document File</Label>
          <Input
            id="leave-evidence-file"
            ref={inputRef}
            type="file"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] || null
              setFile(nextFile)
            }}
            disabled={submitting}
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
          />
          <p className="text-muted-foreground text-xs">
            {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : "No file selected"}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              if (submitting) return
              setFile(null)
              onOpenChange(false)
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting || !file}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
