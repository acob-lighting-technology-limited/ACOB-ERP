"use client"

import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { UserPlus, History, ArrowUpDown, AlertCircle, CheckCircle2, Calendar, FileText } from "lucide-react"
import type { Asset } from "@/app/admin/assets/admin-assets-content"
import { formatWATDateTime } from "@/lib/utils/date"

interface AssetActivity {
  id: string
  timestamp: string
  type: "assignment" | "unassignment" | "status_change" | "issue_reported" | "issue_resolved"
  title: string
  description?: string
  user_name?: string
  performed_by_name?: string
  details?: {
    assigned_to?: string
    department?: string
    office_location?: string
    assignment_type?: string
    notes?: string
    status?: string
    old_status?: string
  }
}

interface AssetHistoryDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedAsset: Asset | null
  assetHistory: AssetActivity[]
}

function getStatusColor(status: string) {
  switch (status) {
    case "assigned":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "available":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "maintenance":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "retired":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
    case "archived":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function formatDate(dateString?: string | null) {
  if (!dateString) return "-"
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return "-"
  return formatWATDateTime(date)
}

export function AssetHistoryDialog({ isOpen, onOpenChange, selectedAsset, assetHistory }: AssetHistoryDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="text-primary h-5 w-5" />
            Complete Asset Activity Timeline
          </DialogTitle>
          <DialogDescription>
            Chronological history of assignments, status changes, and issues for {selectedAsset?.unique_code}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          {assetHistory.length === 0 ? (
            <div className="text-muted-foreground py-12 text-center">No activity history found for this asset.</div>
          ) : (
            assetHistory.map((activity, index) => (
              <div
                key={activity.id}
                className={`rounded-lg border-2 p-4 transition-all hover:shadow-md ${
                  index === 0 ? "bg-primary/5 border-primary/30" : "bg-muted/30 border-muted"
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {activity.type === "assignment" && <UserPlus className="h-4 w-4 text-blue-500" />}
                    {activity.type === "unassignment" && <History className="h-4 w-4 text-orange-500" />}
                    {activity.type === "status_change" && <ArrowUpDown className="h-4 w-4 text-purple-500" />}
                    {activity.type === "issue_reported" && <AlertCircle className="h-4 w-4 text-red-500" />}
                    {activity.type === "issue_resolved" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    <span className="text-sm font-bold tracking-wide uppercase">{activity.title}</span>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Calendar className="h-3 w-3" />
                    {formatDate(activity.timestamp)}
                  </div>
                </div>

                <div className="space-y-2">
                  {activity.user_name && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">User/Location:</span>{" "}
                      <span className="text-foreground font-semibold">{activity.user_name}</span>
                    </p>
                  )}

                  {activity.performed_by_name && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Performed by:</span>{" "}
                      <span className="text-foreground font-medium">{activity.performed_by_name}</span>
                    </p>
                  )}

                  {activity.description && (
                    <div className="bg-background/50 mt-2 rounded border p-3">
                      <p className="text-muted-foreground text-sm italic">&quot;{activity.description}&quot;</p>
                    </div>
                  )}

                  {activity.details?.notes && (
                    <div className="bg-background/50 mt-2 rounded border p-3">
                      <p className="text-foreground mb-1 flex items-center gap-1 text-xs font-semibold">
                        <FileText className="h-3 w-3" />
                        Notes:
                      </p>
                      <p className="text-muted-foreground text-sm">{activity.details.notes}</p>
                    </div>
                  )}

                  {activity.details?.old_status && (
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="opacity-70">
                        {activity.details.old_status}
                      </Badge>
                      <ArrowUpDown className="text-muted-foreground h-3 w-3" />
                      <Badge className={getStatusColor(activity.details.status || "")}>{activity.details.status}</Badge>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
