"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EyeOff, Loader2, Paperclip, Save, Upload } from "lucide-react"
import { toast } from "sonner"
import type { DocumentationAttachment } from "@/lib/documentation/sharepoint"

const CATEGORIES = [
  "Project Documentation",
  "Meeting Notes",
  "Process Documentation",
  "Technical Guides",
  "Reports",
  "Training Materials",
  "Other",
]

export interface DocFormData {
  title: string
  content: string
  category: string
  tags: string
  is_draft: boolean
  /** private = you, your lead and admins. general = everyone in the company. */
  visibility: "private" | "general"
  attachments: File[]
}

interface DocFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isEditing: boolean
  formData: DocFormData
  onFormChange: (data: DocFormData) => void
  existingAttachments: DocumentationAttachment[]
  onSave: (isDraft: boolean) => void
  isSaving: boolean
}

export function DocFormDialog({
  open,
  onOpenChange,
  isEditing,
  formData,
  onFormChange,
  existingAttachments,
  onSave,
  isSaving,
}: DocFormDialogProps) {
  const formatFileSize = (size: number) => {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Document" : "Create New Document"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update your documentation" : "Create a new work document"}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Title *</label>
            <Input
              value={formData.title}
              onChange={(e) => onFormChange({ ...formData, title: e.target.value })}
              placeholder="Document title..."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Category *</label>
              <Select
                value={formData.category}
                onValueChange={(value) => onFormChange({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tags (comma separated)</label>
              <Input
                value={formData.tags}
                onChange={(e) => onFormChange({ ...formData, tags: e.target.value })}
                placeholder="tag1, tag2, tag3"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Who can see this</label>
            <Select
              value={formData.visibility}
              onValueChange={(value) => onFormChange({ ...formData, visibility: value as DocFormData["visibility"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private — you, your lead and admins</SelectItem>
                <SelectItem value="general">General — everyone in the company</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {formData.visibility === "general"
                ? "This will appear in the General tab for all staff."
                : "Only you, your department lead and admins can open this."}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Content *</label>
            <Textarea
              value={formData.content}
              onChange={(e) => onFormChange({ ...formData, content: e.target.value })}
              placeholder="Write your documentation here..."
              className="min-h-[300px] text-base"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Attachments</label>
            <div className="space-y-3">
              <label className="border-border bg-muted/20 hover:bg-muted/40 block cursor-pointer rounded-lg border border-dashed p-4 transition-colors">
                <input
                  type="file"
                  multiple
                  disabled={isSaving}
                  className="hidden"
                  onChange={(e) => {
                    const attachments = e.target.files ? Array.from(e.target.files) : []
                    onFormChange({
                      ...formData,
                      attachments,
                    })

                    if (attachments.length > 0) {
                      const totalSize = attachments.reduce((total, file) => total + file.size, 0)
                      toast.info(`${attachments.length} file${attachments.length === 1 ? "" : "s"} selected`, {
                        description: `Total size: ${formatFileSize(totalSize)}`,
                      })
                    }
                  }}
                />
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary rounded-md p-2">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {formData.attachments.length > 0
                        ? `${formData.attachments.length} file${formData.attachments.length === 1 ? "" : "s"} attached`
                        : "Choose files to attach"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formData.attachments.length > 0
                        ? "Click here if you want to replace the current file selection before saving."
                        : "Files are uploaded to SharePoint when you save this document."}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Supabase keeps the document record and attachment metadata only.
                    </p>
                  </div>
                </div>
              </label>
            </div>

            {existingAttachments.length > 0 && (
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                  Existing Attachments
                </p>
                <div className="space-y-1">
                  {existingAttachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center gap-2 text-sm">
                      <Paperclip className="text-muted-foreground h-3.5 w-3.5" />
                      <span>{attachment.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => onSave(true)} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
            {isSaving ? "Saving..." : "Save as Draft"}
          </Button>
          <Button onClick={() => onSave(false)} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? "Uploading..." : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
