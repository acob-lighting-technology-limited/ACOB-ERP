"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Gavel, Loader2, Save, Users } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { createClient } from "@/lib/supabase/client"
import { getCurrentOfficeWeek, getOfficeWeekMonday } from "@/lib/meeting-week"
import { toLocalISODate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

export interface EditableDirective {
  id: string
  title: string
  description?: string | null
  status?: string | null
  department: string
  week_number: number
  year: number
  meeting_date?: string | null
  timeline_text?: string | null
  assignees: { id: string; name: string }[]
}

interface DirectiveFormDialogProps {
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
  departments: string[]
  editingDirective?: EditableDirective | null
  defaultWeek?: number
  defaultYear?: number
  /** Meeting date for the selected week, when the week setup records one. */
  defaultMeetingDate?: string
}

type DirectoryRow = { id: string; full_name: string | null; department: string | null }

/**
 * Timelines are minuted as free text ("Weekly", "Same Week", "Within 24 hours of
 * unresolved issues"), so the field stays a text input — these are suggestions,
 * not an enum.
 */
const TIMELINE_SUGGESTIONS = ["Same Week", "Weekly", "Immediate", "Within 24 hours", "In line with deliverables"]

export function DirectiveFormDialog({
  isOpen,
  onClose,
  onComplete,
  departments,
  editingDirective,
  defaultWeek,
  defaultYear,
  defaultMeetingDate,
}: DirectiveFormDialogProps) {
  const currentOfficeWeek = getCurrentOfficeWeek()
  const [isSaving, setIsSaving] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [department, setDepartment] = useState("")
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [timeline, setTimeline] = useState("")
  const [status, setStatus] = useState("not_started")
  const [week, setWeek] = useState(defaultWeek || currentOfficeWeek.week)
  const [year, setYear] = useState(defaultYear || currentOfficeWeek.year)
  const [meetingDate, setMeetingDate] = useState("")

  const { data: staff = [] } = useQuery({
    queryKey: ["action-tracker", "directive-staff-options"],
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // staff_directory, not profiles: profiles RLS shows a plain employee only
      // their own row, which would collapse the picker to one name.
      const supabase = createClient()
      const { data, error } = await supabase
        .from("staff_directory")
        .select("id, full_name, department, employment_status")
        .order("full_name")
      if (error) throw new Error(error.message)
      return ((data || []) as (DirectoryRow & { employment_status?: string | null })[]).filter(
        (row) => String(row.employment_status || "").toLowerCase() !== "exited"
      )
    },
  })

  const staffOptions = useMemo(
    () =>
      staff
        .filter((person) => Boolean(person.full_name))
        .map((person) => ({
          value: person.id,
          label: person.department ? `${person.full_name} — ${person.department}` : String(person.full_name),
        })),
    [staff]
  )

  const defaultMeetingDateForWeek = useMemo(() => {
    if (defaultMeetingDate) return defaultMeetingDate.slice(0, 10)
    return toLocalISODate(getOfficeWeekMonday(week, year))
  }, [defaultMeetingDate, week, year])

  useEffect(() => {
    if (!isOpen) return
    if (editingDirective) {
      setTitle(editingDirective.title)
      setDescription(editingDirective.description || "")
      setDepartment(editingDirective.department)
      setAssigneeIds(editingDirective.assignees.map((person) => person.id))
      setTimeline(editingDirective.timeline_text || "")
      setStatus(editingDirective.status || "not_started")
      setWeek(editingDirective.week_number)
      setYear(editingDirective.year)
      setMeetingDate(editingDirective.meeting_date ? editingDirective.meeting_date.slice(0, 10) : "")
      return
    }
    setTitle("")
    setDescription("")
    setDepartment(departments[0] || "")
    setAssigneeIds([])
    setTimeline("")
    setStatus("not_started")
    setWeek(defaultWeek || currentOfficeWeek.week)
    setYear(defaultYear || currentOfficeWeek.year)
    setMeetingDate(defaultMeetingDateForWeek)
    // defaultMeetingDateForWeek is derived from week/year, which this effect also
    // sets — including it would re-run the reset on every week change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingDirective, departments, defaultWeek, defaultYear])

  const resetForNextEntry = () => {
    setTitle("")
    setDescription("")
    setAssigneeIds([])
    setTimeline("")
  }

  const save = async (keepOpen: boolean) => {
    if (!title.trim()) {
      toast.error("Directive text is required")
      return
    }
    if (!department) {
      toast.error("Select the responsible department")
      return
    }

    setIsSaving(true)
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        department,
        week_number: week,
        year,
        origin: "management_directive" as const,
        meeting_date: meetingDate || null,
        timeline_text: timeline.trim() || null,
        assignee_ids: assigneeIds,
      }

      const response = editingDirective
        ? await apiFetch(`/api/reports/action-tracker/${editingDirective.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, status }),
          })
        : await apiFetch("/api/reports/action-tracker", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to save directive")

      toast.success(editingDirective ? "Directive updated" : "Directive added")
      onComplete()
      if (keepOpen && !editingDirective) {
        resetForNextEntry()
      } else {
        onClose()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save directive")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-4 w-4" />
            {editingDirective ? "Edit Management Directive" : "Add Management Directive"}
          </DialogTitle>
          <DialogDescription>
            Directives raised by management at the general meeting. They are tracked alongside the department&apos;s
            weekly action points but kept in their own category, and are never overwritten when a weekly report is
            re-submitted.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="bg-muted/30 grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase">Meeting Date</Label>
              <Input
                type="date"
                value={meetingDate}
                onChange={(event) => setMeetingDate(event.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase">Week</Label>
              <Input
                type="number"
                min={1}
                max={53}
                value={week}
                onChange={(event) => setWeek(parseInt(event.target.value, 10) || currentOfficeWeek.week)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-[10px] font-bold uppercase">Year</Label>
              <Input
                type="number"
                value={year}
                onChange={(event) => setYear(parseInt(event.target.value, 10) || currentOfficeWeek.year)}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Directive / Action Point</Label>
            <Textarea
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Capture and regularize the phone numbers of all customers with meters in the Company's database."
              className="h-24"
            />
          </div>

          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Context, background or clarification recorded in the minutes."
              className="h-16"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Responsible Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timeline</Label>
              <Input
                value={timeline}
                onChange={(event) => setTimeline(event.target.value)}
                placeholder="e.g. Same Week"
                list="directive-timeline-suggestions"
              />
              <datalist id="directive-timeline-suggestions">
                {TIMELINE_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Responsible Staff (Optional)</Label>
            <SearchableMultiSelect
              label="Responsible Staff"
              icon={<Users className="h-4 w-4" />}
              values={assigneeIds}
              options={staffOptions}
              onChange={setAssigneeIds}
              placeholder="Name the staff held accountable..."
              searchPlaceholder="Search staff..."
            />
            <p className="text-muted-foreground text-xs">
              A directive can name several staff across departments. Leave empty when the whole department is
              responsible.
            </p>
          </div>

          {editingDirective ? (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="not_started">Not Started</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          {editingDirective ? null : (
            <Button variant="secondary" onClick={() => void save(true)} disabled={isSaving}>
              Save &amp; Add Another
            </Button>
          )}
          <Button onClick={() => void save(false)} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingDirective ? "Save Changes" : "Save Directive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
