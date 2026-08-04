"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmployeeRecipientPicker, type DirectoryEmployee } from "@/components/admin/employee-recipient-picker"

export type MeetingSource = {
  id: string
  label: string
  join_web_url: string
  organizer_email: string
  recipients: string[]
  email_enabled: boolean
  is_active: boolean
}

type CalendarMeeting = {
  subject: string
  joinUrl: string
  lastSeen: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: MeetingSource | null
  onSaved: () => void
}

export function MeetingSourceDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const [organizerEmail, setOrganizerEmail] = useState("")
  const [organizerToLoad, setOrganizerToLoad] = useState("")
  const [joinWebUrl, setJoinWebUrl] = useState("")
  const [label, setLabel] = useState("")
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([])
  // Recipient emails from before this dialog picked from the employee directory — kept
  // as removable badges so editing an existing meeting never silently drops them.
  const [externalEmails, setExternalEmails] = useState<string[]>([])
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (!open) return
    setOrganizerEmail(editing?.organizer_email || "")
    setOrganizerToLoad("")
    setJoinWebUrl(editing?.join_web_url || "")
    setLabel(editing?.label || "")
    setSelectedEmployeeIds([])
    setExternalEmails(editing?.recipients || [])
    setEmailEnabled(editing?.email_enabled ?? true)
    setIsActive(editing?.is_active ?? true)
  }, [open, editing])

  const handleEmployeesLoaded = (loaded: DirectoryEmployee[]) => {
    setEmployees(loaded)
    setExternalEmails((currentExternal) => {
      const matchedIds: string[] = []
      const stillExternal: string[] = []
      for (const email of currentExternal) {
        const match = loaded.find((e) => e.email?.toLowerCase() === email.toLowerCase())
        if (match) matchedIds.push(match.id)
        else stillExternal.push(email)
      }
      if (matchedIds.length > 0) {
        setSelectedEmployeeIds((prev) => Array.from(new Set([...prev, ...matchedIds])))
      }
      return stillExternal
    })
  }

  const recipients = useMemo(() => {
    const resolvedEmails = employees
      .filter((e) => selectedEmployeeIds.includes(e.id))
      .map((e) => e.email)
      .filter((email): email is string => Boolean(email))
    return Array.from(new Set([...resolvedEmails, ...externalEmails]))
  }, [employees, selectedEmployeeIds, externalEmails])

  const { data: meetings = [], isFetching: loadingMeetings } = useQuery({
    queryKey: ["meeting-artifact-calendar", organizerToLoad],
    enabled: Boolean(organizerToLoad),
    queryFn: async (): Promise<CalendarMeeting[]> => {
      const res = await fetch(`/api/reports/meeting-artifacts/calendar?organizer=${encodeURIComponent(organizerToLoad)}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load meetings")
      return payload.data || []
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const method = editing ? "PATCH" : "POST"
      const body = editing
        ? { id: editing.id, label, joinWebUrl, organizerEmail, recipients, emailEnabled, isActive }
        : { label, joinWebUrl, organizerEmail, recipients, emailEnabled, isActive }
      const res = await fetch("/api/reports/meeting-artifacts/sources", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save")
      return payload
    },
    onSuccess: () => {
      toast.success(editing ? "Meeting sync updated" : "Meeting sync added")
      onSaved()
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    },
  })

  const canSave = Boolean(label.trim() && joinWebUrl.trim() && EMAIL_RE.test(organizerEmail))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit meeting sync" : "Add meeting sync"}</DialogTitle>
          <DialogDescription>
            Pick a Teams meeting from the organizer&apos;s calendar and choose who receives its attendance and
            transcript.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Organizer email</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="ict@acoblighting.com"
                value={organizerEmail}
                onChange={(e) => setOrganizerEmail(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!EMAIL_RE.test(organizerEmail) || loadingMeetings}
                onClick={() => setOrganizerToLoad(organizerEmail.trim().toLowerCase())}
              >
                {loadingMeetings ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load meetings"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              The meeting organizer whose calendar is read to find Teams meetings.
            </p>
          </div>

          {organizerToLoad ? (
            <div className="space-y-2">
              <Label>Meeting</Label>
              <Select
                value={joinWebUrl}
                onValueChange={(value) => {
                  setJoinWebUrl(value)
                  const match = meetings.find((m) => m.joinUrl === value)
                  if (match && !label.trim()) setLabel(match.subject)
                }}
                disabled={loadingMeetings || meetings.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={meetings.length === 0 ? "No Teams meetings found" : "Select a meeting"} />
                </SelectTrigger>
                <SelectContent>
                  {meetings.map((m) => (
                    <SelectItem key={m.joinUrl} value={m.joinUrl}>
                      {m.subject}
                      {m.lastSeen ? ` — ${new Date(m.lastSeen).toLocaleDateString()}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Display name</Label>
            <Input placeholder="ACOB General Meeting" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Recipients</Label>
            <EmployeeRecipientPicker
              selectedIds={selectedEmployeeIds}
              onChange={setSelectedEmployeeIds}
              onEmployeesLoaded={handleEmployeesLoaded}
              extraBadges={externalEmails.map((email) => ({
                key: email,
                label: email,
                onRemove: () => setExternalEmails((prev) => prev.filter((e) => e !== email)),
              }))}
              emptyHint="No recipients — artifacts will be stored but not emailed."
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Send emails</p>
              <p className="text-muted-foreground text-xs">Email the recipients when new artifacts arrive.</p>
            </div>
            <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-muted-foreground text-xs">Watch this meeting on the schedule.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : editing ? (
              "Save changes"
            ) : (
              "Add meeting"
            )}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
