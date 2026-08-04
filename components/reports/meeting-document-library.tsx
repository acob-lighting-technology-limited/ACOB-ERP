"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { PageWrapper, PageHeader } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { REPORT_DOC_MAX_SIZE_BYTES, formatLimitMb } from "@/lib/reports/document-upload-limits"
import { BookOpen, CalendarDays, Loader2, Presentation, Upload } from "lucide-react"
import { apiFetch } from "@/lib/api-client"

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

type Employee = {
  id: string
  full_name: string
  department: string | null
}

type KssRosterEntry = {
  id: string
  meeting_week: number
  meeting_year: number
  department: string
  presenter_id: string | null
  notes: string | null
}

type MeetingWeekDocument = {
  id: string
  document_type: "knowledge_sharing_session" | "minutes"
  department: string | null
  file_name: string
  version_no: number
  signed_url: string | null
}

interface Props {
  employees: Employee[]
  backHref: string
  backLabel: string
  title?: string
}

export function MeetingDocumentLibrary({ employees, backHref, backLabel, title = "Meeting Documents" }: Props) {
  const currentOfficeWeek = getCurrentOfficeWeek()
  const [weekNumber, setWeekNumber] = useState(currentOfficeWeek.week)
  const [yearNumber, setYearNumber] = useState(currentOfficeWeek.year)

  const [kssDepartment, setKssDepartment] = useState("none")
  const [kssPresenterId, setKssPresenterId] = useState("none")
  const [kssNotes, setKssNotes] = useState("")
  const [kssFile, setKssFile] = useState<File | null>(null)
  const [minutesFile, setMinutesFile] = useState<File | null>(null)

  const [savingRoster, setSavingRoster] = useState(false)
  const [uploadingDocType, setUploadingDocType] = useState<"knowledge_sharing_session" | "minutes" | null>(null)

  const weekOptions = Array.from({ length: 53 }, (_, i) => i + 1)
  const yearOptions = [currentOfficeWeek.year - 1, currentOfficeWeek.year, currentOfficeWeek.year + 1]

  const departmentOptions = useMemo(() => {
    return Array.from(new Set(employees.map((e) => e.department).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b)
    )
  }, [employees])

  const kssPresenterOptions = useMemo(() => {
    if (kssDepartment === "none") return []
    return employees
      .filter((e) => e.department === kssDepartment)
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""))
  }, [employees, kssDepartment])

  const { data: kssRosterForWeek, refetch: refetchRoster } = useQuery({
    queryKey: ["kss-roster-page", weekNumber, yearNumber],
    queryFn: async (): Promise<KssRosterEntry | null> => {
      const res = await apiFetch(`/api/reports/kss-roster?week=${weekNumber}&year=${yearNumber}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to fetch KSS roster")
      return (payload.data || [])[0] || null
    },
  })

  const { data: meetingDocuments = [], refetch: refetchMeetingDocuments } = useQuery({
    queryKey: ["meeting-week-documents-page", weekNumber, yearNumber],
    queryFn: async (): Promise<MeetingWeekDocument[]> => {
      const res = await apiFetch(
        `/api/reports/meeting-week-documents?week=${weekNumber}&year=${yearNumber}&currentOnly=true`
      )
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to fetch meeting documents")
      return payload.data || []
    },
  })

  useEffect(() => {
    if (!kssRosterForWeek) {
      setKssDepartment("none")
      setKssPresenterId("none")
      setKssNotes("")
      return
    }
    setKssDepartment(kssRosterForWeek.department || "none")
    setKssPresenterId(kssRosterForWeek.presenter_id || "none")
    setKssNotes(kssRosterForWeek.notes || "")
  }, [kssRosterForWeek])

  const saveKssRoster = async () => {
    if (kssDepartment === "none") {
      toast.error("Please select the presenting department")
      return
    }

    setSavingRoster(true)
    try {
      const res = await apiFetch("/api/reports/kss-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingWeek: weekNumber,
          meetingYear: yearNumber,
          department: kssDepartment,
          presenterId: kssPresenterId === "none" ? null : kssPresenterId,
          notes: kssNotes || null,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save KSS roster")
      toast.success("KSS roster saved for selected week")
      void refetchRoster()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save KSS roster")
    } finally {
      setSavingRoster(false)
    }
  }

  const uploadMeetingDocument = async (kind: "knowledge_sharing_session" | "minutes") => {
    const file = kind === "knowledge_sharing_session" ? kssFile : minutesFile
    if (!file) {
      toast.error("Please choose a file first")
      return
    }
    if (kind === "knowledge_sharing_session" && kssDepartment === "none") {
      toast.error("Please select KSS department before uploading")
      return
    }
    if (kind === "knowledge_sharing_session" && kssPresenterId === "none") {
      toast.error("Please select KSS presenter before uploading")
      return
    }

    setUploadingDocType(kind)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("meetingWeek", String(weekNumber))
      fd.append("meetingYear", String(yearNumber))
      fd.append("documentType", kind)
      if (kind === "knowledge_sharing_session") {
        fd.append("department", kssDepartment)
        fd.append("presenterId", kssPresenterId)
        if (kssNotes.trim()) fd.append("notes", kssNotes.trim())
      }

      const res = await apiFetch("/api/reports/meeting-week-documents", {
        method: "POST",
        body: fd,
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to upload document")

      if (kind === "knowledge_sharing_session") setKssFile(null)
      if (kind === "minutes") setMinutesFile(null)

      toast.success(
        payload?.converted ? "Document uploaded and converted to PDF" : "Document uploaded and saved for this week"
      )
      void refetchMeetingDocuments()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to upload document")
    } finally {
      setUploadingDocType(null)
    }
  }

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title={title}
        description="Upload and store Knowledge Sharing Session, Minutes of Meeting, and Action Points by week."
        icon={Presentation}
        backLink={{ href: backHref, label: backLabel }}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarDays className="h-5 w-5 text-green-600" /> Meeting Week
            </CardTitle>
            <CardDescription>Select week and year for roster + uploads</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label>Week</Label>
                <Select value={String(weekNumber)} onValueChange={(v) => setWeekNumber(Number(v))}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {weekOptions.map((w) => (
                      <SelectItem key={w} value={String(w)}>
                        Week {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Year</Label>
                <Select value={String(yearNumber)} onValueChange={(v) => setYearNumber(Number(v))}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="h-5 w-5 text-emerald-600" /> KSS Weekly Roster
            </CardTitle>
            <CardDescription>Set department and optional presenter for the selected week.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Presenting Department</Label>
                <Select
                  value={kssDepartment}
                  onValueChange={(value) => {
                    setKssDepartment(value)
                    setKssPresenterId("none")
                  }}
                >
                  <SelectTrigger>
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
                <Label>Presenter</Label>
                <Select value={kssPresenterId} onValueChange={setKssPresenterId} disabled={kssDepartment === "none"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select presenter (required for upload)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not selected</SelectItem>
                    {kssPresenterOptions.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Roster Notes</Label>
                <Input value={kssNotes} onChange={(e) => setKssNotes(e.target.value)} placeholder="Optional note" />
              </div>
            </div>
            <Button onClick={saveKssRoster} disabled={savingRoster}>
              {savingRoster ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Weekly Roster
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Presentation className="h-5 w-5 text-indigo-600" /> Weekly Document Repository
            </CardTitle>
            <CardDescription>Upload weekly files and keep them for reference.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Knowledge Sharing Session (PDF/PPTX/DOCX)</Label>
                <Input
                  type="file"
                  accept=".pdf,.pptx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] || null
                    if (selected && selected.size > REPORT_DOC_MAX_SIZE_BYTES) {
                      toast.error(`File exceeds max size of ${formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}`)
                      e.currentTarget.value = ""
                      setKssFile(null)
                      return
                    }
                    if (selected?.type === PPTX_MIME || selected?.type === DOCX_MIME) {
                      toast.info("This file will be converted to PDF before it is stored.")
                    }
                    setKssFile(selected)
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Accepted: PDF, PPTX, DOCX. PPTX and DOCX uploads are converted to PDF before storage. Max file size:{" "}
                  {formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => uploadMeetingDocument("knowledge_sharing_session")}
                  disabled={
                    uploadingDocType === "knowledge_sharing_session" ||
                    kssDepartment === "none" ||
                    kssPresenterId === "none"
                  }
                >
                  {uploadingDocType === "knowledge_sharing_session" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Upload Knowledge Sharing Session
                </Button>
              </div>
              <div className="space-y-2">
                <Label>Minutes of Meeting (PDF/DOCX)</Label>
                <Input
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => {
                    const selected = e.target.files?.[0] || null
                    if (selected && selected.size > REPORT_DOC_MAX_SIZE_BYTES) {
                      toast.error(`File exceeds max size of ${formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}`)
                      e.currentTarget.value = ""
                      setMinutesFile(null)
                      return
                    }
                    if (selected?.type === DOCX_MIME) {
                      toast.info("This DOCX file will be converted to PDF before it is stored.")
                    }
                    setMinutesFile(selected)
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Accepted: PDF, DOCX. DOCX uploads are converted to PDF before storage. Max file size:{" "}
                  {formatLimitMb(REPORT_DOC_MAX_SIZE_BYTES)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => uploadMeetingDocument("minutes")}
                  disabled={uploadingDocType === "minutes"}
                >
                  {uploadingDocType === "minutes" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Upload Minutes of Meeting
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Current Week Files
              </div>
              <div className="space-y-2">
                {meetingDocuments.length === 0 ? (
                  <div className="text-muted-foreground rounded border px-3 py-2 text-sm">
                    No documents uploaded for Week {weekNumber}, {yearNumber}.
                  </div>
                ) : (
                  meetingDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{doc.file_name}</div>
                        <div className="text-muted-foreground text-xs">
                          {doc.document_type.replaceAll("_", " ").toUpperCase()}
                          {doc.department ? ` • ${doc.department}` : ""} • v{doc.version_no}
                        </div>
                      </div>
                      {doc.signed_url ? (
                        <a href={doc.signed_url} target="_blank" rel="noreferrer" className="text-green-700 underline">
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">No link</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  )
}
