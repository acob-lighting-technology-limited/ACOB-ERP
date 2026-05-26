"use client"

import { useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Calendar, Copy, User } from "lucide-react"
import { toast } from "sonner"
import { getAuditActionColor } from "@/lib/audit/action-colors"
import { getNormalizedEntityTypeDisplay } from "@/lib/audit/entity-type-display"
import { getActionDisplay, formatAuditDate, getPerformedBy, getTargetDescription } from "@/lib/audit/audit-log-display"
import { formatName } from "@/lib/utils"
import type { AuditLog } from "@/app/admin/audit-logs/types"

interface AuditLogDetailPanelProps {
  log: AuditLog | null
  open: boolean
  onClose: () => void
}

export function AuditLogDetailPanel({ log, open, onClose }: AuditLogDetailPanelProps) {
  const handleCopy = useCallback(async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(label)
    } catch {
      toast.error("Failed to copy")
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Audit Log Details</DialogTitle>
          <DialogDescription>Complete information about this audit event</DialogDescription>
        </DialogHeader>

        {log && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Action</Label>
                <div>
                  <Badge className={getAuditActionColor(log.action)}>{getActionDisplay(log)}</Badge>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Entity Type</Label>
                <div className="text-sm font-medium">{getNormalizedEntityTypeDisplay(log.entity_type)}</div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Target/Affected</Label>
              <div className="bg-muted/50 rounded-lg border p-3">
                <p className="text-sm font-medium">{getTargetDescription(log)}</p>
                {log.target_user && (
                  <div className="mt-1 flex items-center gap-1">
                    <p className="text-muted-foreground text-xs">{log.target_user.company_email}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => handleCopy(log.target_user!.company_email, "Email copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {log.task_info && (
                  <div className="mt-2 border-t pt-2">
                    <p className="text-muted-foreground text-xs">Task: {log.task_info.title}</p>
                    {log.task_info.assigned_to_user && (
                      <p className="text-muted-foreground text-xs">
                        Assigned to: {formatName(log.task_info.assigned_to_user.first_name)}{" "}
                        {formatName(log.task_info.assigned_to_user.last_name)}
                      </p>
                    )}
                  </div>
                )}
                {log.device_info && (
                  <div className="mt-2 border-t pt-2">
                    <p className="text-muted-foreground text-xs">Device: {log.device_info.device_name}</p>
                    {log.device_info.assigned_to_user && (
                      <p className="text-muted-foreground text-xs">
                        Assigned to: {formatName(log.device_info.assigned_to_user.first_name)}{" "}
                        {formatName(log.device_info.assigned_to_user.last_name)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Performed By</Label>
              <div className="bg-muted/50 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <User className="text-muted-foreground h-4 w-4" />
                  <span
                    className={`text-sm font-medium ${log.entity_type === "feedback" && log.new_values?.is_anonymous ? "text-muted-foreground italic" : ""}`}
                  >
                    {getPerformedBy(log)}
                  </span>
                </div>
                {!(log.entity_type === "feedback" && log.new_values?.is_anonymous) && log.user?.company_email && (
                  <div className="mt-1 flex items-center gap-1">
                    <p className="text-muted-foreground text-xs">{log.user.company_email}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => handleCopy(log.user!.company_email, "Email copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Date &amp; Time</Label>
              <div className="bg-muted/50 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Calendar className="text-muted-foreground h-4 w-4" />
                  <span className="text-sm">{formatAuditDate(log.created_at)}</span>
                </div>
              </div>
            </div>

            {log.old_values && Object.keys(log.old_values).length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Old Values</Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleCopy(JSON.stringify(log.old_values, null, 2), "Old values copied")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="bg-muted/50 max-h-60 overflow-auto rounded-lg border p-4">
                  <pre className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(log.old_values, null, 2)}</pre>
                </div>
              </div>
            )}

            {log.new_values && Object.keys(log.new_values).length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">New Values</Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleCopy(JSON.stringify(log.new_values, null, 2), "New values copied")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="bg-muted/50 max-h-60 overflow-auto rounded-lg border p-4">
                  <pre className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(log.new_values, null, 2)}</pre>
                </div>
              </div>
            )}

            {log.entity_id && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Entity ID</Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleCopy(log.entity_id!, "Entity ID copied")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="bg-muted/50 rounded-lg border p-3">
                  <code className="font-mono text-xs break-all">{log.entity_id}</code>
                </div>
              </div>
            )}

            <div className="flex gap-2 border-t pt-4">
              <Button onClick={onClose} variant="outline" className="flex-1">
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
