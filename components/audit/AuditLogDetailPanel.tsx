"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Calendar, ChevronDown, ChevronRight, Copy, Globe, MapPin, Route, User } from "lucide-react"
import { toast } from "sonner"
import { getAuditActionColor } from "@/lib/audit/action-colors"
import { getNormalizedEntityTypeDisplay } from "@/lib/audit/entity-type-display"
import {
  formatAuditDate,
  formatAuditFieldLabel,
  formatAuditValue,
  getActionDisplay,
  getAuditFieldDiffs,
  getAuditIpAddress,
  getAuditRequestId,
  getAuditRoute,
  getAuditSiteId,
  getAuditSource,
  getAuditUserAgent,
  getObjectIdentifier,
  getDepartmentLocation,
  getPerformedBy,
  getTargetDescription,
} from "@/lib/audit/audit-log-display"
import { formatName } from "@/lib/utils"
import type { AuditLog } from "@/app/admin/audit-logs/types"

interface AuditLogDetailPanelProps {
  log: AuditLog | null
  open: boolean
  onClose: () => void
}

/** Inline section label */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-muted-foreground mb-2 text-[10px] font-black tracking-widest uppercase">{children}</h4>
}

/** A single key→value row inside a detail block */
function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground shrink-0 font-medium">{label}</span>
      <span className={mono ? "font-mono text-xs break-all" : ""}>{value}</span>
    </div>
  )
}

/** Collapsible raw JSON block */
function CollapsibleJson({ label, value }: { label: string; value: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const json = JSON.stringify(value, null, 2)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Failed to copy")
    }
  }, [json, label])

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {label}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation()
            void handleCopy()
          }}
        >
          <Copy className="h-3 w-3" />
        </Button>
      </button>
      {open && (
        <div className="bg-muted/40 max-h-64 overflow-auto border-t px-4 py-3">
          <pre className="font-mono text-xs whitespace-pre-wrap">{json}</pre>
        </div>
      )}
    </div>
  )
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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Audit Log Details</DialogTitle>
          <DialogDescription>Complete compliance evidence for this audit event</DialogDescription>
        </DialogHeader>

        {log && (
          <div className="space-y-6">
            {/* ── 1. Event identity ── */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Action</Label>
                <div>
                  <Badge className={getAuditActionColor(log.action)}>{getActionDisplay(log)}</Badge>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Module</Label>
                <div className="text-sm font-medium">{getNormalizedEntityTypeDisplay(log.entity_type)}</div>
              </div>
            </div>

            {/* ── 2. Timestamp ── */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Date &amp; Time</Label>
              <div className="bg-muted/50 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Calendar className="text-muted-foreground h-4 w-4" />
                  <span className="text-sm">{formatAuditDate(log.created_at)}</span>
                </div>
              </div>
            </div>

            {/* ── 3. Who did it ── */}
            <div className="space-y-1.5">
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
                      onClick={() => void handleCopy(log.user!.company_email, "Email copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {log.user?.employee_number && (
                  <p className="text-muted-foreground mt-0.5 text-xs">Emp #: {log.user.employee_number}</p>
                )}
                {log.user?.department && (
                  <p className="text-muted-foreground mt-0.5 text-xs">Dept: {log.user.department}</p>
                )}
              </div>
            </div>

            {/* ── 4. Object ── */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Object</Label>
              <div className="bg-muted/50 rounded-lg border p-3">
                <p className="text-sm font-medium">{getObjectIdentifier(log)}</p>
                {log.entity_id && (
                  <div className="mt-1 flex items-center gap-1">
                    <code className="text-muted-foreground font-mono text-xs break-all">{log.entity_id}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => void handleCopy(log.entity_id!, "Entity ID copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* ── 5. Target ── */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Target / Affected</Label>
              <div className="bg-muted/50 space-y-1 rounded-lg border p-3">
                <p className="text-sm font-medium">{getTargetDescription(log)}</p>
                {log.target_user && (
                  <div className="flex items-center gap-1">
                    <p className="text-muted-foreground text-xs">{log.target_user.company_email}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => void handleCopy(log.target_user!.company_email, "Email copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {log.target_user?.employee_number && (
                  <p className="text-muted-foreground text-xs">Emp #: {log.target_user.employee_number}</p>
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

            {/* ── 6. Department / Location ── */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Department / Location</Label>
              <div className="bg-muted/50 flex items-center gap-2 rounded-lg border p-3">
                <MapPin className="text-muted-foreground h-4 w-4 shrink-0" />
                <span className="text-sm">{getDepartmentLocation(log)}</span>
              </div>
            </div>

            {/* ── 7. Changed fields — primary diff view ── */}
            {(() => {
              const diffs = getAuditFieldDiffs(log)
              if (diffs.length === 0) {
                return (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold">Changed Fields</Label>
                    <div className="bg-muted/50 rounded-lg border p-3">
                      <p className="text-muted-foreground text-sm italic">No field diff captured</p>
                    </div>
                  </div>
                )
              }
              return (
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold">Changed Fields ({diffs.length})</Label>
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/80 border-b">
                          <th className="w-1/3 px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">
                            Field
                          </th>
                          <th className="w-1/3 px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">
                            Before
                          </th>
                          <th className="w-1/3 px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">
                            After
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffs.map((d, i) => (
                          <tr key={d.field} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                            <td className="px-3 py-2 text-xs font-medium">{formatAuditFieldLabel(d.field)}</td>
                            <td className="text-muted-foreground px-3 py-2 font-mono text-xs break-all">
                              {formatAuditValue(d.before === "Empty" ? undefined : d.before)}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs break-all">
                              {formatAuditValue(d.after === "Empty" ? undefined : d.after)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}

            {/* ── 8. Request metadata ── */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Request Metadata</Label>
              <div className="bg-muted/50 space-y-2 rounded-lg border p-3">
                <SectionLabel>Origin</SectionLabel>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <Globe className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <DetailRow label="Source" value={getAuditSource(log)} />
                  </div>
                  <div className="flex items-start gap-2">
                    <Route className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <DetailRow label="Route" value={getAuditRoute(log)} mono />
                  </div>
                </div>

                <div className="mt-2 border-t pt-2">
                  <SectionLabel>Identifiers</SectionLabel>
                  <div className="space-y-1.5">
                    <DetailRow label="Request ID" value={getAuditRequestId(log)} mono />
                    <DetailRow label="IP Address" value={getAuditIpAddress(log)} mono />
                    {getAuditSiteId(log) !== "Not captured" && (
                      <DetailRow label="Site ID" value={getAuditSiteId(log)} mono />
                    )}
                  </div>
                </div>

                {getAuditUserAgent(log) !== "Not captured" && (
                  <div className="mt-2 border-t pt-2">
                    <SectionLabel>User Agent</SectionLabel>
                    <p className="text-muted-foreground font-mono text-xs break-all">{getAuditUserAgent(log)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── 9. Raw JSON evidence (collapsible) ── */}
            {(log.old_values && Object.keys(log.old_values).length > 0) ||
            (log.new_values && Object.keys(log.new_values).length > 0) ||
            (log.metadata && Object.keys(log.metadata).length > 0) ? (
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Raw Evidence (JSON)</Label>
                <div className="space-y-2">
                  {log.old_values && Object.keys(log.old_values).length > 0 && (
                    <CollapsibleJson label="Old Values" value={log.old_values} />
                  )}
                  {log.new_values && Object.keys(log.new_values).length > 0 && (
                    <CollapsibleJson label="New Values" value={log.new_values} />
                  )}
                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <CollapsibleJson label="Metadata" value={log.metadata} />
                  )}
                </div>
              </div>
            ) : null}

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
