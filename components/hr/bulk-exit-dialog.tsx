"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Loader2, Mail, UserMinus } from "lucide-react"
import { toast } from "sonner"
import { toLocalISODate } from "@/lib/utils/date"
import { useRouter } from "next/navigation"

interface SelectedEmployee {
  id: string
  first_name: string
  last_name: string
  department: string
  employment_status: string
}

interface BulkExitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employees: SelectedEmployee[]
  onSuccess?: () => void
}

const exitReasonOptions = [
  { value: "resignation", label: "Resignation" },
  { value: "mutual_separation", label: "Mutual Separation" },
  { value: "contract_completed", label: "Contract Completed" },
  { value: "retirement", label: "Retirement" },
  { value: "workforce_reduction", label: "Workforce Reduction" },
  { value: "disciplinary_dismissal", label: "Disciplinary Dismissal" },
]

interface PerPersonEntry {
  exitDate: string
  reasonCode: string
}

export function BulkExitDialog({ open, onOpenChange, employees, onSuccess }: BulkExitDialogProps) {
  const router = useRouter()
  const today = toLocalISODate()

  // Shared defaults
  const [sharedReason, setSharedReason] = useState("")
  const [sharedDate, setSharedDate] = useState(today)

  // Per-person overrides (keyed by employee id)
  const [overrides, setOverrides] = useState<Record<string, Partial<PerPersonEntry>>>({})

  const [isLoading, setIsLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [isSendingNotification, setIsSendingNotification] = useState(false)
  const [succeededIds, setSucceededIds] = useState<string[]>([])

  const getEntry = (id: string): PerPersonEntry => ({
    exitDate: overrides[id]?.exitDate ?? sharedDate,
    reasonCode: overrides[id]?.reasonCode ?? sharedReason,
  })

  const setOverride = (id: string, field: keyof PerPersonEntry, value: string) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const allValid = employees.every((e) => {
    const entry = getEntry(e.id)
    return entry.reasonCode && entry.exitDate
  })

  const handleSubmit = async (sendNotification: boolean) => {
    setIsLoading(true)

    try {
      const payload = {
        employees: employees.map((e) => ({
          employeeId: e.id,
          ...getEntry(e.id),
          reasonLabel: exitReasonOptions.find((o) => o.value === getEntry(e.id).reasonCode)?.label,
        })),
        sendNotification,
      }

      const res = await fetch("/api/v1/hr/employees/bulk-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const result = await res.json()

      if (!res.ok) throw new Error(result.error || "Failed to exit employees")

      const { succeeded, failed, results } = result as {
        succeeded: number
        failed: number
        results: { id: string; success: boolean; error?: string }[]
      }

      if (succeeded > 0) {
        const ids = results.filter((r) => r.success).map((r) => r.id)
        setSucceededIds(ids)
        toast.success(
          `${succeeded} employee${succeeded > 1 ? "s" : ""} exited successfully${failed > 0 ? ` (${failed} failed)` : ""}`
        )
        router.refresh()
        onSuccess?.()

        setConfirmOpen(false)
        if (!sendNotification) {
          setNotifyOpen(true)
          return
        }
      } else {
        const blockedNames = results
          .filter((r) => !r.success)
          .map((r) => employees.find((e) => e.id === r.id)?.first_name)
          .filter(Boolean)
          .join(", ")
        toast.error(`All exits failed. Check blockers for: ${blockedNames}`)
        setConfirmOpen(false)
      }

      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to exit employees")
      setConfirmOpen(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendNotification = async () => {
    if (!succeededIds.length) return
    setIsSendingNotification(true)
    try {
      const res = await fetch("/api/v1/hr/employees/bulk-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employees: succeededIds.map((id) => ({
            employeeId: id,
            ...getEntry(id),
          })),
          sendNotification: true,
        }),
      })
      if (res.ok) {
        toast.success("Exit notification sent to all staff")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to send notification")
      }
    } catch {
      toast.error("Failed to send notification")
    } finally {
      setIsSendingNotification(false)
      setNotifyOpen(false)
      onOpenChange(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!isLoading) onOpenChange(v)
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserMinus className="h-5 w-5" />
              Bulk Exit — {employees.length} employee{employees.length > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              Set exit dates and reasons. Shared values apply to all; override per person where needed.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1 pr-2">
            <div className="space-y-6 py-2">
              {/* Shared defaults */}
              <div className="bg-muted/40 space-y-3 rounded-lg border p-4">
                <p className="text-sm font-semibold">Shared defaults</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Exit Date</Label>
                    <Input type="date" value={sharedDate} onChange={(e) => setSharedDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Exit Reason</Label>
                    <Select value={sharedReason} onValueChange={setSharedReason}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {exitReasonOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Per-person rows */}
              <div className="space-y-3">
                <p className="text-sm font-semibold">Per-employee overrides</p>
                {employees.map((emp) => {
                  const entry = getEntry(emp.id)
                  const hasOverride = overrides[emp.id]?.exitDate || overrides[emp.id]?.reasonCode
                  return (
                    <div key={emp.id} className="space-y-3 rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold">
                            {emp.first_name} {emp.last_name}
                          </span>
                          <span className="text-muted-foreground ml-2 text-xs">{emp.department}</span>
                        </div>
                        {hasOverride && (
                          <Badge variant="outline" className="text-[10px]">
                            Custom
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-muted-foreground text-xs">Exit Date</Label>
                          <Input
                            type="date"
                            value={entry.exitDate}
                            onChange={(e) => setOverride(emp.id, "exitDate", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-muted-foreground text-xs">Exit Reason</Label>
                          <Select value={entry.reasonCode} onValueChange={(v) => setOverride(emp.id, "reasonCode", v)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select reason" />
                            </SelectTrigger>
                            <SelectContent>
                              {exitReasonOptions.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Warning */}
              <div className="bg-destructive/10 border-destructive/20 flex items-start gap-2 rounded-lg border p-3">
                <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="text-destructive text-xs">
                  This will immediately revoke system access for all selected employees. Employees with active blockers
                  (assigned assets, tasks, or lead roles) will be skipped.
                </p>
              </div>
            </div>
          </ScrollArea>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isLoading || !allValid}
              onClick={() => setConfirmOpen(true)}
              className="min-w-[140px]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <UserMinus className="mr-2 h-4 w-4" />
                  Exit {employees.length} Employee{employees.length > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm bulk exit</AlertDialogTitle>
            <AlertDialogDescription>
              This will exit{" "}
              <strong>
                {employees.length} employee{employees.length > 1 ? "s" : ""}
              </strong>{" "}
              and immediately revoke their system access. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-w-[130px]"
              disabled={isLoading}
              onClick={(e) => {
                e.preventDefault()
                void handleSubmit(false)
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                "Confirm Exit"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send notification dialog */}
      <AlertDialog
        open={notifyOpen}
        onOpenChange={(v) => {
          if (!isSendingNotification) setNotifyOpen(v)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Send Exit Notification?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Do you want to send an all-staff notification email and in-app alert informing everyone that{" "}
              <strong>
                {employees.length === 1
                  ? `${employees[0].first_name} ${employees[0].last_name}`
                  : `${employees.length} employees`}
              </strong>{" "}
              {employees.length === 1 ? "has" : "have"} exited the organisation?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isSendingNotification}
              onClick={() => {
                setNotifyOpen(false)
                onOpenChange(false)
              }}
            >
              No, skip
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSendingNotification}
              onClick={(e) => {
                e.preventDefault()
                void handleSendNotification()
              }}
            >
              {isSendingNotification ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Yes, send notification"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
