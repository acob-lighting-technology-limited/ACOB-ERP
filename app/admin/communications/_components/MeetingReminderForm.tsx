"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Employee = {
  id: string
  full_name: string
  company_email: string | null
  additional_email: string | null
  department: string | null
  employment_status: string | null
}

interface MeetingReminderFormProps {
  meetingWeek: number
  meetingYear: number
  weekOptions: number[]
  yearOptions: number[]
  setMeetingWeek: (value: number) => void
  setMeetingYear: (value: number) => void
  meetingDate: string
  meetingTime: string
  teamsLink: string
  setTeamsLink: (v: string) => void
  agendaText: string
  setAgendaText: (v: string) => void
  onSaveDraft: () => void
  savingDraft: boolean
  knowledgeDepartment: string
  knowledgePresenterId: string
  knowledgePresenterName: string
  meetingPreparedById: string
  setMeetingPreparedById: (v: string) => void
  departmentOptions: string[]
  presenterOptions: Employee[]
  meetingPreparedByOptions: Employee[]
}

export function MeetingReminderForm({
  meetingWeek,
  meetingYear,
  weekOptions,
  yearOptions,
  setMeetingWeek,
  setMeetingYear,
  meetingDate,
  meetingTime,
  teamsLink,
  setTeamsLink,
  agendaText,
  setAgendaText,
  onSaveDraft,
  savingDraft,
  knowledgeDepartment,
  knowledgePresenterId,
  knowledgePresenterName,
  meetingPreparedById,
  setMeetingPreparedById,
  departmentOptions,
  presenterOptions,
  meetingPreparedByOptions,
}: MeetingReminderFormProps) {
  const VISITOR_ITEM_VALUE = "__visitor_presenter__"
  const presenterSelectValue =
    knowledgePresenterId !== "none" ? knowledgePresenterId : knowledgePresenterName.trim() ? VISITOR_ITEM_VALUE : "none"

  return (
    <>
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label htmlFor="meeting-week">Week</Label>
          <Select value={String(meetingWeek)} onValueChange={(value) => setMeetingWeek(Number(value))}>
            <SelectTrigger id="meeting-week" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((week) => (
                <SelectItem key={week} value={String(week)}>
                  Week {week}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="meeting-year">Year</Label>
          <Select value={String(meetingYear)} onValueChange={(value) => setMeetingYear(Number(value))}>
            <SelectTrigger id="meeting-year" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="meet-date">Meeting Date</Label>
          <Input id="meet-date" type="date" value={meetingDate} className="w-[180px]" disabled readOnly />
          <p className="text-muted-foreground text-xs">
            The date updates automatically from the selected week&apos;s Admin Reports setup. This value is read-only
            here.
          </p>
          <Button variant="outline" size="sm" asChild className="h-7 px-2 text-[11px]">
            <Link href="/admin/reports/general-meeting">Manage Meeting Date</Link>
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="meet-time">Meeting Time</Label>
          <Input id="meet-time" type="time" value={meetingTime} className="w-[140px]" disabled readOnly />
          <p className="text-muted-foreground text-xs">
            Managed from Admin Reports week setup. This value is read-only here.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="teams-link">Microsoft Teams Link</Label>
        <Input
          id="teams-link"
          placeholder="Paste Microsoft Teams meeting link..."
          value={teamsLink}
          onChange={(e) => setTeamsLink(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="agenda">Agenda (one item per line)</Label>
        <Textarea
          id="agenda"
          value={agendaText}
          onChange={(e) => setAgendaText(e.target.value)}
          rows={8}
          placeholder={"Enter each agenda item on a new line"}
        />
        <p className="text-muted-foreground text-xs">Each line becomes one agenda item. Numbering is automatic.</p>
        <Button variant="outline" size="sm" className="h-8" onClick={onSaveDraft} disabled={savingDraft}>
          {savingDraft ? "Saving..." : "Save Agenda"}
        </Button>
      </div>
      <div className="space-y-3 rounded-lg border border-dashed p-3">
        <div>
          <Label className="text-sm">Knowledge Sharing Presenter (Optional)</Label>
          <p className="text-muted-foreground mt-1 text-xs">
            This updates the agenda line &quot;Knowledge Sharing Session (30 minutes)&quot; with department and
            presenter.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="space-y-2">
            <Label htmlFor="ks-department">Department</Label>
            <Select value={knowledgeDepartment} disabled>
              <SelectTrigger id="ks-department" className="w-[220px]">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not selected</SelectItem>
                {departmentOptions.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ks-presenter">Presenter</Label>
            <Select value={presenterSelectValue} disabled>
              <SelectTrigger id="ks-presenter" className="w-[260px]">
                <SelectValue placeholder="Select presenter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not selected</SelectItem>
                {knowledgePresenterName.trim() ? (
                  <SelectItem value={VISITOR_ITEM_VALUE}>{knowledgePresenterName.trim()} (Visitor)</SelectItem>
                ) : null}
                {presenterOptions.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Department and presenter are managed from Admin Reports week setup so the reminder and KSS stay in sync.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="meeting-prepared-by">Prepared by</Label>
        <Select value={meetingPreparedById} onValueChange={setMeetingPreparedById}>
          <SelectTrigger id="meeting-prepared-by" className="w-[320px]">
            <SelectValue placeholder="Select person" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Select person</SelectItem>
            {meetingPreparedByOptions.map((emp) => (
              <SelectItem key={emp.id} value={emp.id}>
                {emp.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Admin &amp; HR only. This appears as &quot;Prepared by&quot; in the footer.
        </p>
      </div>
    </>
  )
}
