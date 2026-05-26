"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { AlertCircle, CheckCircle2, Calendar, Package, Plus, X } from "lucide-react"
import type { Asset } from "@/app/admin/assets/admin-assets-content"
import { formatWATDate } from "@/lib/utils/date"

interface AssetIssue {
  id: string
  asset_id: string
  description: string
  resolved: boolean
  created_at: string
  resolved_at?: string
  resolved_by?: string
  created_by: string
}

const issueSchema = z.object({
  newIssueDescription: z.string(),
})

type IssueFormValues = z.infer<typeof issueSchema>

interface AssetIssuesDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedAsset: Asset | null
  assetIssues: AssetIssue[]
  newIssueDescription: string
  setNewIssueDescription: (value: string) => void
  onAddIssue: () => void
  onToggleIssue: (issue: AssetIssue) => void
  onDeleteIssue: (issueId: string) => void
  isAddingIssue: boolean
}

export function AssetIssuesDialog({
  isOpen,
  onOpenChange,
  selectedAsset,
  assetIssues,
  newIssueDescription,
  setNewIssueDescription,
  onAddIssue,
  onToggleIssue,
  onDeleteIssue,
  isAddingIssue,
}: AssetIssuesDialogProps) {
  const form = useForm<IssueFormValues>({
    resolver: zodResolver(issueSchema),
    defaultValues: {
      newIssueDescription: newIssueDescription,
    },
  })

  const { register, watch } = form

  // Sync form state back to parent whenever values change
  useEffect(() => {
    const subscription = watch((values) => {
      setNewIssueDescription(values.newIssueDescription ?? "")
    })
    return () => subscription.unsubscribe()
  }, [watch, setNewIssueDescription])

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      form.reset({ newIssueDescription })
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const descriptionValue = watch("newIssueDescription")

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-orange-500" />
            <div>
              <DialogTitle>Asset Issues Tracker</DialogTitle>
              <DialogDescription>
                {selectedAsset?.unique_code} - Track and manage asset issues, faults, or maintenance needs
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Package className="text-muted-foreground h-4 w-4" />
              <span className="text-foreground text-sm font-medium">{selectedAsset?.unique_code}</span>
              <Badge variant="outline" className="text-xs">
                {ASSET_TYPE_MAP[selectedAsset?.asset_type || ""]?.label || selectedAsset?.asset_type}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {assetIssues.filter((i) => !i.resolved).length} unresolved
              </span>
              <span className="text-muted-foreground text-xs">•</span>
              <span className="text-muted-foreground text-xs">{assetIssues.length} total</span>
            </div>
          </div>

          {/* Add new issue */}
          <div className="space-y-2">
            <Label>Add New Issue</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Describe issue (e.g., RAM not working, screen cracked)..."
                {...register("newIssueDescription")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    onAddIssue()
                  }
                }}
              />
              <Button onClick={onAddIssue} loading={isAddingIssue} disabled={!descriptionValue.trim()} size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
          </div>

          {/* Issues list */}
          <div className="space-y-2">
            <Label>Issues ({assetIssues.length})</Label>
            <div className="max-h-[400px] space-y-2 overflow-y-auto rounded-lg border p-3">
              {assetIssues.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="text-muted-foreground mb-2 h-12 w-12" />
                  <p className="text-muted-foreground text-sm font-medium">No issues tracked</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Add an issue above if there&apos;s a problem with this asset
                  </p>
                </div>
              ) : (
                assetIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      issue.resolved
                        ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20"
                        : "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20"
                    }`}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onToggleIssue(issue)}
                      className="mt-0.5 h-6 w-6 p-0 hover:bg-transparent"
                      title={issue.resolved ? "Mark as unresolved" : "Mark as resolved"}
                    >
                      {issue.resolved ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-orange-500" />
                      )}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm ${
                          issue.resolved ? "text-muted-foreground line-through" : "text-foreground font-medium"
                        }`}
                      >
                        {issue.description}
                      </p>
                      <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatWATDate(issue.created_at)}
                        </div>
                        {issue.resolved && issue.resolved_at && (
                          <>
                            <span>•</span>
                            <div className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Resolved {formatWATDate(issue.resolved_at)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteIssue(issue.id)}
                      className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                      title="Delete issue"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg border p-3">
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>
                Track hardware issues, faults, or maintenance needs. Click the checkbox to mark issues as resolved when
                fixed.
              </span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
