"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarClock, Loader2, Mail, MailX, Pencil, Plus, RefreshCw, Send, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { MeetingSourceDialog, type MeetingSource } from "./meeting-source-dialog"
import { apiFetch } from "@/lib/api-client"

type SourceRow = MeetingSource & {
  last_synced_at: string | null
  last_error: string | null
}

type DocRow = {
  meeting_week: number
  meeting_year: number
  meeting_date: string | null
  document_type: string
  source_label: string | null
}

type Occurrence = { week: number; year: number; date: string | null; hasAttendance: boolean; hasTranscript: boolean }

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatSynced(value: string | null): string {
  if (!value) return "Never synced"
  return `Last synced ${formatWATDateTime(value, { day: "2-digit", month: "short", year: "numeric" })}`
}

function formatOccurrence(o: Occurrence): string {
  const label = o.date
    ? formatWATDate(new Date(`${o.date}T00:00:00`), { day: "2-digit", month: "short", year: "numeric" })
    : `${o.year}`
  return `${label} · W${o.week}`
}

function occurrencesFor(docs: DocRow[], label: string): Occurrence[] {
  const map = new Map<string, Occurrence>()
  for (const d of docs) {
    if (d.source_label !== label) continue
    const key = `${d.meeting_year}-${d.meeting_week}`
    const existing = map.get(key) || {
      week: d.meeting_week,
      year: d.meeting_year,
      date: d.meeting_date,
      hasAttendance: false,
      hasTranscript: false,
    }
    if (d.document_type === "attendance") existing.hasAttendance = true
    if (d.document_type === "transcript") existing.hasTranscript = true
    if (!existing.date && d.meeting_date) existing.date = d.meeting_date
    map.set(key, existing)
  }
  return Array.from(map.values()).sort((a, b) => b.year - a.year || b.week - a.week)
}

function MeetingSendPanel({ source, occurrences }: { source: SourceRow; occurrences: Occurrence[] }) {
  const [occurrenceKey, setOccurrenceKey] = useState("latest")
  const [incAttendance, setIncAttendance] = useState(true)
  const [incTranscript, setIncTranscript] = useState(true)
  const [sending, setSending] = useState(false)

  const send = async () => {
    if (!incAttendance && !incTranscript) {
      toast.error("Select attendance and/or transcript")
      return
    }
    if (source.recipients.length === 0) {
      toast.error("No recipients configured — edit the meeting to add some")
      return
    }
    setSending(true)
    const toastId = toast.loading("Sending...")
    try {
      const body: Record<string, unknown> = {
        sourceId: source.id,
        includeAttendance: incAttendance,
        includeTranscript: incTranscript,
      }
      if (occurrenceKey !== "latest") {
        const [year, week] = occurrenceKey.split("-").map(Number)
        body.week = week
        body.year = year
      }
      const res = await apiFetch("/api/reports/meeting-artifacts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Send failed")
      const files: string[] = payload?.data?.files || []
      toast.success(`Sent ${files.length} file(s) to ${source.recipients.length} recipient(s)`, { id: toastId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed", { id: toastId })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-muted/40 mt-3 rounded-lg p-3">
      <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Send className="h-3.5 w-3.5" /> Send now
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-muted-foreground text-xs">Meeting occurrence</Label>
          <Select value={occurrenceKey} onValueChange={setOccurrenceKey}>
            <SelectTrigger className="bg-background h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">
                Latest{occurrences[0] ? ` (${formatOccurrence(occurrences[0])})` : ""}
              </SelectItem>
              {occurrences.map((o) => (
                <SelectItem key={`${o.year}-${o.week}`} value={`${o.year}-${o.week}`}>
                  {formatOccurrence(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-4 pb-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={incAttendance} onCheckedChange={(v) => setIncAttendance(Boolean(v))} />
            Attendance
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={incTranscript} onCheckedChange={(v) => setIncTranscript(Boolean(v))} />
            Transcript
          </label>
        </div>
        <Button size="sm" onClick={send} disabled={sending}>
          {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Send
        </Button>
      </div>
    </div>
  )
}

export function MeetingSyncModal({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<MeetingSource | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["meeting-artifact-sources"],
    enabled: open,
    queryFn: async (): Promise<SourceRow[]> => {
      const res = await apiFetch("/api/reports/meeting-artifacts/sources")
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load meeting sync config")
      return payload.data || []
    },
  })

  const { data: docs = [] } = useQuery({
    queryKey: ["meeting-artifact-occurrences"],
    enabled: open,
    queryFn: async (): Promise<DocRow[]> => {
      const [att, tr] = await Promise.all([
        apiFetch("/api/reports/meeting-week-documents?documentType=attendance&currentOnly=true").then((r) => r.json()),
        apiFetch("/api/reports/meeting-week-documents?documentType=transcript&currentOnly=true").then((r) => r.json()),
      ])
      return [...(att.data || []), ...(tr.data || [])]
    },
  })

  const occurrencesByLabel = useMemo(() => {
    const cache = new Map<string, Occurrence[]>()
    for (const row of rows) cache.set(row.label, occurrencesFor(docs, row.label))
    return cache
  }, [rows, docs])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["meeting-artifact-sources"] })

  const runSyncNow = async () => {
    setIsSyncing(true)
    const toastId = toast.loading("Running meeting sync...")
    try {
      const res = await apiFetch("/api/reports/meeting-artifacts/sync", { method: "POST" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Sync failed")
      const imported = (payload?.data?.results || []).reduce(
        (sum: number, r: { imported?: number }) => sum + (r.imported || 0),
        0
      )
      if (payload?.data?.skipped) toast.info("Sync ran — nothing new right now.", { id: toastId })
      else toast.success(`Sync complete — ${imported} new artifact(s).`, { id: toastId })
      invalidate()
      queryClient.invalidateQueries({ queryKey: ["meeting-artifact-occurrences"] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed", { id: toastId })
    } finally {
      setIsSyncing(false)
    }
  }

  const remove = async (row: SourceRow) => {
    if (!window.confirm(`Stop watching "${row.label}"? Stored history is kept.`)) return
    setDeletingId(row.id)
    try {
      const res = await apiFetch(`/api/reports/meeting-artifacts/sources?id=${row.id}`, { method: "DELETE" })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Delete failed")
      toast.success("Meeting sync removed")
      invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Meeting Sync (Teams)</DialogTitle>
            <DialogDescription>
              Choose which Teams meeting is auto-pulled, who receives it, and send attendance or transcript on demand.
            </DialogDescription>
          </DialogHeader>

          <div className="mb-3 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={runSyncNow} disabled={isSyncing}>
              {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sync now
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setEditorOpen(true)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add meeting
            </Button>
          </div>

          {isLoading ? (
            <div className="text-muted-foreground py-8 text-center text-sm">Loading…</div>
          ) : error ? (
            <div className="text-destructive py-8 text-center text-sm">
              {error instanceof Error ? error.message : "Failed to load"}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed py-8 text-center text-sm">
              No meeting configured yet. Click <span className="font-medium">Add meeting</span> to start.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div key={row.id} className="bg-card rounded-xl border p-4 shadow-sm">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                        <CalendarClock className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{row.label}</p>
                        <p className="text-muted-foreground truncate text-xs">{row.organizer_email}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant={row.is_active ? "outline" : "secondary"}>
                        {row.is_active ? "Active" : "Paused"}
                      </Badge>
                      <Badge variant={row.email_enabled ? "default" : "secondary"} className="gap-1">
                        {row.email_enabled ? <Mail className="h-3 w-3" /> : <MailX className="h-3 w-3" />}
                        {row.email_enabled ? "Email on" : "Email off"}
                      </Badge>
                    </div>
                  </div>

                  {/* Recipients */}
                  <div className="mt-3 flex items-start gap-2">
                    <Users className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    <div className="flex flex-wrap gap-1">
                      {row.recipients.length === 0 ? (
                        <span className="text-muted-foreground text-xs">
                          No recipients — add some to enable emailing
                        </span>
                      ) : (
                        row.recipients.map((email) => (
                          <Badge key={email} variant="secondary" className="text-xs font-normal">
                            {email}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  <MeetingSendPanel source={row} occurrences={occurrencesByLabel.get(row.label) || []} />

                  {row.last_error ? (
                    <p className="text-destructive mt-2 text-xs">Last error: {row.last_error}</p>
                  ) : null}

                  {/* Footer */}
                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <span className="text-muted-foreground text-xs">{formatSynced(row.last_synced_at)}</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(row)
                          setEditorOpen(true)
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deletingId === row.id}
                        onClick={() => remove(row)}
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                        )}
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MeetingSourceDialog open={editorOpen} onOpenChange={setEditorOpen} editing={editing} onSaved={invalidate} />
    </>
  )
}
