"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { formatWATDateTime } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { PageWrapper, PageHeader } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Megaphone, Users, Calendar, Clock } from "lucide-react"
import { writeAuditLogClient } from "@/lib/audit/client"
import { logger } from "@/lib/logger"
import {
  DEFAULT_TEAMS_LINK,
  DEFAULT_AGENDA,
  LEGACY_DEFAULT_AGENDA,
  formatDateNice,
  capitalize,
  stripHtmlToText,
} from "./composer-utils"
import { QUERY_KEYS } from "@/lib/query-keys"
import { createClient } from "@/lib/supabase/client"
import { MeetingReminderForm } from "./MeetingReminderForm"
import { KnowledgeSessionForm } from "./KnowledgeSessionForm"
import { BroadcastForm } from "./BroadcastForm"
import { RecipientSelector } from "./RecipientSelector"
import { SchedulingOptions } from "./SchedulingOptions"
import { SendSummary } from "./SendSummary"
import { ReminderTypeSelector } from "./ReminderTypeSelector"
import { getCurrentOfficeWeek, getOfficeWeekFromDate } from "@/lib/meeting-week"
import { fetchWeeklyReportLockState, getDefaultMeetingDateIso } from "@/lib/weekly-report-lock"

const log = logger("communications-composer")

function normalizeAgendaText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

function parseAgendaItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+[\s.)-]*/, "").trim())
    .filter(Boolean)
}

type Employee = {
  id: string
  full_name: string
  company_email: string | null
  additional_email: string | null
  department: string | null
  designation: string | null
  employment_status: string | null
  is_department_lead: boolean | null
  gender: string | null
}

type RecipientMode = "all" | "select" | "manual" | "all_plus" | "leads_only" | "males_only" | "females_only"
type ReminderType = "meeting" | "knowledge_sharing" | "admin_broadcast"
type SendTiming = "now" | "scheduled" | "recurring"
type BroadcastAttachmentPayload = {
  filename: string
  content: string
}

interface Props {
  employees: Employee[]
  mode?: "meetings" | "communications"
  currentUser?: {
    id: string
    full_name: string | null
    department: string | null
    email?: string | null
  }
}

export function CommunicationsComposer({ employees, mode = "meetings", currentUser }: Props) {
  const currentOfficeWeek = getCurrentOfficeWeek()
  const currentOfficeWeekWeek = currentOfficeWeek.week
  const currentOfficeWeekYear = currentOfficeWeek.year
  const nextOfficeWeek = useMemo(() => {
    const next = new Date()
    next.setDate(next.getDate() + 7)
    return getCurrentOfficeWeek(next)
  }, [])
  const nextOfficeWeekWeek = nextOfficeWeek.week
  const nextOfficeWeekYear = nextOfficeWeek.year
  const defaultMeetingDate = getDefaultMeetingDateIso(currentOfficeWeekWeek, currentOfficeWeekYear)

  // ── State ──────────────────────────────────────────────────────────────────
  const [reminderType, setReminderType] = useState<ReminderType>(
    mode === "communications" ? "admin_broadcast" : "meeting"
  )
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("select")
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set())
  const [manualEmails, setManualEmails] = useState<string[]>([])
  const [manualInput, setManualInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  // Meeting fields
  const [meetingDate, setMeetingDate] = useState("")
  const [meetingTime, setMeetingTime] = useState("08:30")
  const [teamsLink, setTeamsLink] = useState(DEFAULT_TEAMS_LINK)
  const [agendaText, setAgendaText] = useState(DEFAULT_AGENDA.join("\n"))
  // On Sunday (last day of office week), default to next week since the user
  // is preparing for the upcoming meeting — avoids a visible flash from W13→W14.
  const [activeMeetingWeek, setActiveMeetingWeek] = useState(() =>
    new Date().getDay() === 0 ? nextOfficeWeek : currentOfficeWeek
  )
  const [hasManualMeetingWeekOverride, setHasManualMeetingWeekOverride] = useState(false)
  const [savingMeetingDraft, setSavingMeetingDraft] = useState(false)

  // Knowledge sharing fields
  const [sessionDate, setSessionDate] = useState(defaultMeetingDate)
  const [sessionTime, setSessionTime] = useState("08:30")
  const [duration, setDuration] = useState("30 minutes")
  const [knowledgeDepartment, setKnowledgeDepartment] = useState("none")
  const [knowledgePresenterId, setKnowledgePresenterId] = useState("none")
  const [knowledgePresenterName, setKnowledgePresenterName] = useState("")
  const [meetingPreparedById, setMeetingPreparedById] = useState("none")

  // Broadcast fields
  const [broadcastSubject, setBroadcastSubject] = useState("Administrative Notice")
  const [broadcastBodyHtml, setBroadcastBodyHtml] = useState("<p>Type your message here...</p>")
  const [broadcastDepartment, setBroadcastDepartment] = useState(currentUser?.department || "Admin & HR")
  const [broadcastPreparedById, setBroadcastPreparedById] = useState("none")
  const [broadcastAttachments, setBroadcastAttachments] = useState<File[]>([])

  // Delivery timing
  const [sendTiming, setSendTiming] = useState<SendTiming>("now")
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("09:00")
  const [recurringDay, setRecurringDay] = useState("sunday")
  const [recurringTime, setRecurringTime] = useState("18:00")

  const [isSending, setIsSending] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sendResult, setSendResult] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [activeSchedules, setActiveSchedules] = useState<any[]>([])
  const meetingWeekOptions = useMemo(() => Array.from({ length: 53 }, (_, index) => index + 1), [])
  const meetingYearOptions = useMemo(
    () => [currentOfficeWeekYear - 1, currentOfficeWeekYear, currentOfficeWeekYear + 1, currentOfficeWeekYear + 2],
    [currentOfficeWeekYear]
  )

  const [supabase] = useState(() => createClient())
  const queryClient = useQueryClient()
  const currentUserDept = (currentUser?.department || "").trim()
  const currentUserName = (currentUser?.full_name || "").trim()
  const isCurrentUserAdminHr =
    currentUserDept.toLowerCase().includes("admin") && currentUserDept.toLowerCase().includes("hr")

  const { data: canonicalMeetingSetup } = useQuery({
    queryKey: ["canonical-meeting-date", activeMeetingWeek.week, activeMeetingWeek.year],
    enabled: mode !== "communications",
    queryFn: async (): Promise<{ meetingDate: string; meetingTime: string }> => {
      const res = await fetch(`/api/reports/meeting-date?week=${activeMeetingWeek.week}&year=${activeMeetingWeek.year}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to resolve meeting date")
      return {
        meetingDate: String(
          payload?.data?.meetingDate || getDefaultMeetingDateIso(activeMeetingWeek.week, activeMeetingWeek.year)
        ),
        meetingTime: String(payload?.data?.meetingTime || "08:30"),
      }
    },
  })

  const { data: defaultAgendaData } = useQuery({
    queryKey: ["meeting-reminder-default-agenda"],
    enabled: mode !== "communications",
    queryFn: async (): Promise<{ agenda: string[] }> => {
      const res = await fetch("/api/reports/meeting-agenda-default")
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load meeting agenda")
      const agenda = Array.isArray(payload?.data?.agenda)
        ? payload.data.agenda.filter(
            (item: unknown): item is string => typeof item === "string" && Boolean(item.trim())
          )
        : DEFAULT_AGENDA
      return { agenda: agenda.length > 0 ? agenda : DEFAULT_AGENDA }
    },
  })

  // ── Derived options ────────────────────────────────────────────────────────
  const departmentOptions = useMemo(() => {
    const set = new Set<string>(["Admin & HR"])
    for (const dept of employees.map((e) => e.department).filter(Boolean) as string[]) set.add(dept)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [employees])

  const presenterOptions = useMemo(
    () =>
      knowledgeDepartment === "none"
        ? []
        : employees
            .filter((e) => e.department === knowledgeDepartment)
            .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "")),
    [employees, knowledgeDepartment]
  )

  const selectedPresenter = useMemo(
    () => (knowledgePresenterId === "none" ? null : employees.find((e) => e.id === knowledgePresenterId) || null),
    [employees, knowledgePresenterId]
  )

  const selectedKnowledgePresenter = useMemo(() => {
    if (selectedPresenter) {
      return {
        id: selectedPresenter.id,
        full_name: selectedPresenter.full_name,
        department: selectedPresenter.department,
      }
    }

    const visitorName = knowledgePresenterName.trim()
    if (!visitorName) return null

    return {
      full_name: visitorName,
      department: knowledgeDepartment !== "none" ? knowledgeDepartment : null,
    }
  }, [knowledgeDepartment, knowledgePresenterName, selectedPresenter])

  const meetingPreparedByOptions = useMemo(
    () =>
      employees
        .filter((e) => {
          const dept = (e.department || "").toLowerCase()
          return dept.includes("admin") && dept.includes("hr")
        })
        .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "")),
    [employees]
  )

  const selectedMeetingPreparedBy = useMemo(
    () => (meetingPreparedById === "none" ? null : employees.find((e) => e.id === meetingPreparedById) || null),
    [employees, meetingPreparedById]
  )

  const broadcastPreparedByOptions = useMemo(
    () =>
      employees
        .filter((e) => (e.department || "").trim() === broadcastDepartment)
        .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "")),
    [employees, broadcastDepartment]
  )

  const selectedBroadcastPreparedBy = useMemo(
    () => (broadcastPreparedById === "none" ? null : employees.find((e) => e.id === broadcastPreparedById) || null),
    [employees, broadcastPreparedById]
  )

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode === "communications") return
    if (hasManualMeetingWeekOverride) return

    let cancelled = false
    const resolveActiveMeetingWeek = async () => {
      try {
        const currentLock = await fetchWeeklyReportLockState(supabase, currentOfficeWeekWeek, currentOfficeWeekYear)
        if (cancelled) return

        // Advance to next week if:
        // 1. The current week's report is already locked, OR
        // 2. The current week's meeting date has already passed (e.g. meeting was
        //    Mon/Tue and today is later in the week — the user wants to prepare
        //    next week's reminder, not re-send for a meeting that already happened).
        let shouldAdvance = currentLock.isLocked
        if (!shouldAdvance && currentLock.meetingDate) {
          const today = new Date()
          const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
          shouldAdvance = todayIso > currentLock.meetingDate
        }

        setActiveMeetingWeek(
          shouldAdvance
            ? { week: nextOfficeWeekWeek, year: nextOfficeWeekYear }
            : { week: currentOfficeWeekWeek, year: currentOfficeWeekYear }
        )
      } catch {
        if (!cancelled) setActiveMeetingWeek({ week: currentOfficeWeekWeek, year: currentOfficeWeekYear })
      }
    }

    void resolveActiveMeetingWeek()
    return () => {
      cancelled = true
    }
  }, [
    currentOfficeWeekWeek,
    currentOfficeWeekYear,
    hasManualMeetingWeekOverride,
    mode,
    nextOfficeWeekWeek,
    nextOfficeWeekYear,
    supabase,
  ])

  useEffect(() => {
    if (mode === "communications" && reminderType !== "admin_broadcast") setReminderType("admin_broadcast")
  }, [mode, reminderType])

  useEffect(() => {
    if (meetingPreparedByOptions.length > 0 && !meetingPreparedByOptions.some((p) => p.id === meetingPreparedById)) {
      const rafiatPreferred = meetingPreparedByOptions.find((p) => (p.full_name || "").toLowerCase().includes("rafiat"))
      const preferred =
        rafiatPreferred?.id ||
        (isCurrentUserAdminHr &&
        currentUserName &&
        meetingPreparedByOptions.some((p) => p.full_name === currentUserName)
          ? meetingPreparedByOptions.find((p) => p.full_name === currentUserName)?.id
          : meetingPreparedByOptions[0].id)
      setMeetingPreparedById(preferred || meetingPreparedByOptions[0].id)
    }
  }, [currentUserName, isCurrentUserAdminHr, meetingPreparedById, meetingPreparedByOptions])

  useEffect(() => {
    if (broadcastPreparedByOptions.length === 0) return
    if (!broadcastPreparedByOptions.some((p) => p.id === broadcastPreparedById)) {
      const preferred =
        currentUserName && broadcastPreparedByOptions.some((p) => p.full_name === currentUserName)
          ? broadcastPreparedByOptions.find((p) => p.full_name === currentUserName)?.id
          : broadcastPreparedByOptions[0].id
      setBroadcastPreparedById(preferred || broadcastPreparedByOptions[0].id)
    }
  }, [broadcastPreparedById, broadcastPreparedByOptions, currentUserName])

  useEffect(() => {
    if (reminderType !== "meeting") return
    if (!canonicalMeetingSetup) return
    setMeetingDate(canonicalMeetingSetup.meetingDate)
    setMeetingTime(canonicalMeetingSetup.meetingTime || "08:30")
  }, [canonicalMeetingSetup, reminderType])

  useEffect(() => {
    if (reminderType !== "meeting") return
    if (!defaultAgendaData) return
    setAgendaText(defaultAgendaData.agenda.join("\n"))
  }, [defaultAgendaData, reminderType])

  // Teams link is per-week (can change each meeting); agenda is global (rarely changes week to week).
  const meetingDraftStorageKey = useMemo(() => {
    return `meeting-reminder-draft:${activeMeetingWeek.year}:${activeMeetingWeek.week}`
  }, [activeMeetingWeek.week, activeMeetingWeek.year])
  const AGENDA_STORAGE_KEY = "meeting-reminder-agenda"

  useEffect(() => {
    if (reminderType !== "meeting") return
    if (typeof window === "undefined") return

    // Remove the old browser-local default so it cannot override the shared DB default.
    const savedAgenda = window.localStorage.getItem(AGENDA_STORAGE_KEY)
    if (savedAgenda?.trim() && normalizeAgendaText(savedAgenda) === LEGACY_DEFAULT_AGENDA.join("\n")) {
      window.localStorage.removeItem(AGENDA_STORAGE_KEY)
    }

    // Restore teams link per-week
    const savedDraftRaw = window.localStorage.getItem(meetingDraftStorageKey)
    if (!savedDraftRaw) return

    try {
      const savedDraft = JSON.parse(savedDraftRaw) as { teamsLink?: string }
      if (typeof savedDraft.teamsLink === "string" && savedDraft.teamsLink.trim()) {
        setTeamsLink(savedDraft.teamsLink)
      }
    } catch {
      // Ignore invalid local draft payloads.
    }
  }, [meetingDraftStorageKey, reminderType])

  useEffect(() => {
    if (reminderType !== "meeting") return
    if (!meetingDate) return

    const [year, month, day] = meetingDate.split("-").map((part) => Number(part))
    if (!year || !month || !day) return
    const officeWeek = getOfficeWeekFromDate(new Date(year, month - 1, day))

    let cancelled = false
    const autoFillFromRoster = async () => {
      try {
        const res = await fetch(`/api/reports/kss-roster?week=${officeWeek.week}&year=${officeWeek.year}`)
        const payload = await res.json()
        if (!res.ok) return

        const roster = Array.isArray(payload?.data) ? payload.data : []
        const picked = roster.find((entry: { is_active?: boolean }) => entry?.is_active !== false) ?? roster[0]
        if (!picked || cancelled) {
          setKnowledgeDepartment("none")
          setKnowledgePresenterId("none")
          setKnowledgePresenterName("")
          return
        }

        if (typeof picked.department === "string" && picked.department.trim()) {
          setKnowledgeDepartment(picked.department)
        } else {
          setKnowledgeDepartment("none")
        }

        const presenterId = typeof picked.presenter_id === "string" ? picked.presenter_id : null
        if (presenterId && employees.some((emp) => emp.id === presenterId)) {
          setKnowledgePresenterId(presenterId)
          setKnowledgePresenterName("")
        } else {
          setKnowledgePresenterId("none")
          setKnowledgePresenterName(
            typeof picked.presenter_name === "string" && picked.presenter_name.trim()
              ? picked.presenter_name.trim()
              : ""
          )
        }
      } catch {
        // Fail silently; form still works with manual selection.
      }
    }

    autoFillFromRoster()
    return () => {
      cancelled = true
    }
  }, [employees, meetingDate, reminderType])

  // ── Query: active schedules ───────────────────────────────────────────────
  const { data: schedulesData } = useQuery({
    queryKey: QUERY_KEYS.adminReminderSchedules(mode),
    queryFn: async () => {
      const allowedTypes =
        mode === "communications" ? (["admin_broadcast"] as const) : (["meeting", "knowledge_sharing"] as const)
      const { data, error } = await supabase
        .from("reminder_schedules")
        .select("*")
        .eq("is_active", true)
        .in("reminder_type", [...allowedTypes])
        .order("created_at", { ascending: false })
      if (error) throw new Error(error.message)
      return data || []
    },
  })

  useEffect(() => {
    if (schedulesData) setActiveSchedules(schedulesData)
  }, [schedulesData])

  // ── Computed ────────────────────────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees
    const q = searchQuery.toLowerCase()
    return employees.filter(
      (e) =>
        e.full_name?.toLowerCase().includes(q) ||
        e.company_email?.toLowerCase().includes(q) ||
        e.additional_email?.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q)
    )
  }, [employees, searchQuery])

  const resolvedRecipients = useMemo(() => {
    const emailSet = new Set<string>()
    if (recipientMode === "all" || recipientMode === "all_plus") {
      employees.forEach((e) => {
        if (e.company_email) emailSet.add(e.company_email.toLowerCase())
        if (e.additional_email) emailSet.add(e.additional_email.toLowerCase())
      })
    } else if (recipientMode === "leads_only") {
      employees.forEach((e) => {
        if (!e.is_department_lead) return
        if (e.company_email) emailSet.add(e.company_email.toLowerCase())
        if (e.additional_email) emailSet.add(e.additional_email.toLowerCase())
      })
    } else if (recipientMode === "males_only") {
      employees.forEach((e) => {
        if (String(e.gender || "").toLowerCase() !== "male") return
        if (e.company_email) emailSet.add(e.company_email.toLowerCase())
        if (e.additional_email) emailSet.add(e.additional_email.toLowerCase())
      })
    } else if (recipientMode === "females_only") {
      employees.forEach((e) => {
        if (String(e.gender || "").toLowerCase() !== "female") return
        if (e.company_email) emailSet.add(e.company_email.toLowerCase())
        if (e.additional_email) emailSet.add(e.additional_email.toLowerCase())
      })
    } else if (recipientMode === "select") {
      employees.forEach((e) => {
        if (selectedEmployeeIds.has(e.id)) {
          if (e.company_email) emailSet.add(e.company_email.toLowerCase())
          if (e.additional_email) emailSet.add(e.additional_email.toLowerCase())
        }
      })
    }
    if (recipientMode === "manual" || recipientMode === "all_plus") {
      manualEmails.forEach((m) => emailSet.add(m.toLowerCase()))
    }
    return Array.from(emailSet)
  }, [recipientMode, employees, selectedEmployeeIds, manualEmails])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const toggleEmployee = useCallback((id: string) => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => setSelectedEmployeeIds(new Set(employees.map((e) => e.id))), [employees])
  const deselectAll = useCallback(() => setSelectedEmployeeIds(new Set()), [])

  const addManualEmail = useCallback(() => {
    const email = manualInput.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Invalid email address")
      return
    }
    if (manualEmails.includes(email)) {
      toast.error("Email already added")
      return
    }
    setManualEmails((prev) => [...prev, email])
    setManualInput("")
  }, [manualInput, manualEmails])

  const removeManualEmail = useCallback((email: string) => {
    setManualEmails((prev) => prev.filter((e) => e !== email))
  }, [])

  const logMailAudit = useCallback(
    async (params: {
      action: string
      entityId: string
      department?: string | null
      metadata?: Record<string, unknown>
    }) => {
      try {
        await writeAuditLogClient(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase as any,
          {
            action: "send",
            entityType: "communications_mail",
            entityId: params.entityId,
            metadata: { ...(params.metadata || {}), event: params.action },
            context: {
              actorId: currentUser?.id || undefined,
              department: params.department || null,
              source: "ui",
              route: "/admin/communications",
            },
          },
          { failOpen: true }
        )
      } catch (error) {
        log.error({ err: String(error) }, "Failed to write audit log")
      }
    },
    [currentUser?.id, supabase]
  )

  const resolveMeetingContext = useCallback((dateValue: string, meetingWeek: number, meetingYear: number) => {
    const [year, month, day] = String(dateValue || "")
      .split("-")
      .map((part) => Number(part))

    if (!year || !month || !day) return null

    const date = new Date(year, month - 1, day)
    if (Number.isNaN(date.getTime())) return null

    return {
      meetingDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      meetingWeek,
      meetingYear,
    }
  }, [])

  const encodeFileToBase64 = useCallback((file: File): Promise<BroadcastAttachmentPayload> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result !== "string") {
          reject(new Error(`Failed to read attachment ${file.name}`))
          return
        }

        const base64Content = result.includes(",") ? result.split(",")[1] || "" : result
        if (!base64Content) {
          reject(new Error(`Attachment ${file.name} is empty or invalid`))
          return
        }

        resolve({
          filename: file.name,
          content: base64Content,
        })
      }
      reader.onerror = () => reject(new Error(`Failed to read attachment ${file.name}`))
      reader.readAsDataURL(file)
    })
  }, [])

  const handleSend = async () => {
    if (resolvedRecipients.length === 0) {
      toast.error("No recipients selected")
      return
    }

    if (reminderType === "admin_broadcast") {
      if (!broadcastSubject.trim()) {
        toast.error("Broadcast subject is required")
        return
      }
      if (!broadcastDepartment.trim()) {
        toast.error("Broadcast department is required")
        return
      }
      if (!stripHtmlToText(broadcastBodyHtml)) {
        toast.error("Broadcast body is required")
        return
      }
      if (!selectedBroadcastPreparedBy?.full_name) {
        toast.error("Prepared by is required")
        return
      }
    }

    if (reminderType === "meeting" && !selectedMeetingPreparedBy?.full_name) {
      toast.error("Prepared by is required")
      return
    }
    if (reminderType === "meeting") {
      const agendaItems = parseAgendaItems(agendaText)
      if (agendaItems.length === 0) {
        toast.error("Agenda is required before sending")
        return
      }
    }

    if (reminderType === "admin_broadcast" && broadcastAttachments.length > 0 && sendTiming !== "now") {
      toast.error("Attachments are currently supported only for Send Now broadcasts")
      return
    }

    let meetingContext: {
      meetingDate: string
      meetingWeek: number
      meetingYear: number
    } | null = null

    if (reminderType === "meeting") {
      meetingContext = resolveMeetingContext(meetingDate, activeMeetingWeek.week, activeMeetingWeek.year)
      if (!meetingContext) {
        toast.error("Meeting date is unavailable. Update it from Admin Reports first.")
        return
      }
    }

    // Scheduled / recurring → save to DB
    if (sendTiming === "scheduled" || sendTiming === "recurring") {
      const toastId = toast.loading("Saving schedule...")
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schedulePayload: any = {
          schedule_type: sendTiming === "scheduled" ? "one_time" : "recurring",
          reminder_type: reminderType,
          recipients: resolvedRecipients,
          is_active: true,
          send_day: sendTiming === "recurring" ? recurringDay : null,
          send_time: sendTiming === "recurring" ? recurringTime : scheduledTime,
          meeting_config: {
            type: reminderType,
            requestedByUserId: currentUser?.id || null,
            meetingDate: reminderType === "meeting" ? meetingContext?.meetingDate : undefined,
            meetingWeek: reminderType === "meeting" ? meetingContext?.meetingWeek : undefined,
            meetingYear: reminderType === "meeting" ? meetingContext?.meetingYear : undefined,
            meetingTime: reminderType === "meeting" ? meetingTime : undefined,
            teamsLink: reminderType === "meeting" ? teamsLink : undefined,
            agenda: reminderType === "meeting" ? parseAgendaItems(agendaText) : undefined,
            knowledgeSharingDepartment:
              reminderType === "meeting" && knowledgeDepartment !== "none" ? knowledgeDepartment : undefined,
            knowledgeSharingPresenter: reminderType === "meeting" ? selectedKnowledgePresenter || undefined : undefined,
            meetingPreparedByName:
              reminderType === "meeting" ? selectedMeetingPreparedBy?.full_name || "ACOB Team" : undefined,
            meetingPreparedByDesignation:
              reminderType === "meeting" ? selectedMeetingPreparedBy?.designation || null : undefined,
            meetingPreparedByDepartment:
              reminderType === "meeting" ? selectedMeetingPreparedBy?.department || "Admin & HR" : undefined,
            sessionDate: reminderType === "knowledge_sharing" ? sessionDate : undefined,
            sessionTime: reminderType === "knowledge_sharing" ? sessionTime : undefined,
            duration: reminderType === "knowledge_sharing" ? duration : undefined,
            broadcastSubject: reminderType === "admin_broadcast" ? broadcastSubject : undefined,
            broadcastBodyHtml: reminderType === "admin_broadcast" ? broadcastBodyHtml : undefined,
            broadcastDepartment: reminderType === "admin_broadcast" ? broadcastDepartment : undefined,
            broadcastPreparedByName:
              reminderType === "admin_broadcast" ? selectedBroadcastPreparedBy?.full_name || null : undefined,
            broadcastPreparedByDesignation:
              reminderType === "admin_broadcast" ? selectedBroadcastPreparedBy?.designation || null : undefined,
            broadcastPreparedByDepartment:
              reminderType === "admin_broadcast"
                ? selectedBroadcastPreparedBy?.department || broadcastDepartment
                : undefined,
            attachments:
              reminderType === "admin_broadcast" && broadcastAttachments.length > 0
                ? broadcastAttachments.map((file) => file.name)
                : undefined,
          },
        }

        if (sendTiming === "scheduled") {
          schedulePayload.next_run_at = new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
        } else {
          const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
          const targetDay = days.indexOf(recurringDay)
          const now = new Date()
          let daysUntil = targetDay - now.getDay()
          const [h, m] = recurringTime.split(":")
          const targetMinutes = parseInt(h, 10) * 60 + parseInt(m, 10)
          const nowMinutes = now.getHours() * 60 + now.getMinutes()
          if (daysUntil < 0 || (daysUntil === 0 && nowMinutes >= targetMinutes)) daysUntil += 7
          const nextRun = new Date(now)
          nextRun.setDate(now.getDate() + daysUntil)
          nextRun.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0)
          schedulePayload.next_run_at = nextRun.toISOString()
        }

        const { error } = await supabase.from("reminder_schedules").insert(schedulePayload)
        if (error) throw error

        toast.success(
          sendTiming === "scheduled"
            ? `✅ Scheduled for ${formatWATDateTime(`${scheduledDate}T${scheduledTime}`, { weekday: "short", day: "numeric", month: "short" })}`
            : `✅ Recurring every ${capitalize(recurringDay)} at ${recurringTime}`,
          { id: toastId }
        )
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminReminderSchedules(mode) })
      } catch (err: unknown) {
        log.error({ err: String(err) }, "Schedule error")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        toast.error((err as any).message || "Failed to save schedule", { id: toastId })
      }
      return
    }

    // Send immediately
    setIsSending(true)
    setSendResult(null)
    const label =
      reminderType === "meeting"
        ? "Meeting Reminder"
        : reminderType === "knowledge_sharing"
          ? "Knowledge Sharing Reminder"
          : "Admin Broadcast"
    const toastId = toast.loading(`Sending ${label} to ${resolvedRecipients.length} recipient(s)...`)

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        type: reminderType,
        recipients: resolvedRecipients,
        requestedByUserId: currentUser?.id || null,
      }

      if (reminderType === "meeting") {
        payload.meetingDate = meetingContext?.meetingDate
        payload.meetingWeek = meetingContext?.meetingWeek
        payload.meetingYear = meetingContext?.meetingYear
        payload.meetingTime = new Date(`2000-01-01T${meetingTime}`).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
        payload.teamsLink = teamsLink
        payload.agenda = parseAgendaItems(agendaText)
        if (knowledgeDepartment !== "none") payload.knowledgeSharingDepartment = knowledgeDepartment
        if (selectedKnowledgePresenter) payload.knowledgeSharingPresenter = selectedKnowledgePresenter
        payload.meetingPreparedByName = selectedMeetingPreparedBy?.full_name || "ACOB Team"
        payload.meetingPreparedByDesignation = selectedMeetingPreparedBy?.designation || null
        payload.meetingPreparedByDepartment = selectedMeetingPreparedBy?.department || "Admin & HR"
      } else if (reminderType === "knowledge_sharing") {
        payload.sessionDate = formatDateNice(sessionDate)
        payload.sessionTime = sessionTime
        payload.duration = duration
      } else {
        // Stable per-click id so a transport retry is deduped server-side
        // instead of sending the broadcast to everyone twice.
        payload.broadcastId = crypto.randomUUID()
        payload.broadcastSubject = broadcastSubject.trim()
        payload.broadcastBodyHtml = broadcastBodyHtml
        payload.broadcastDepartment = broadcastDepartment
        payload.broadcastPreparedByName = selectedBroadcastPreparedBy?.full_name || null
        payload.broadcastPreparedByDesignation = selectedBroadcastPreparedBy?.designation || null
        payload.broadcastPreparedByDepartment = selectedBroadcastPreparedBy?.department || broadcastDepartment
        if (broadcastAttachments.length > 0) {
          payload.attachments = await Promise.all(broadcastAttachments.map((file) => encodeFileToBase64(file)))
        }
      }

      const targetFunction = reminderType === "admin_broadcast" ? "send-communications-mail" : "send-meeting-reminder"
      const res = await fetch(`${supabaseUrl}/functions/v1/${targetFunction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to send")

      setSendResult(data)

      // Admin broadcasts are accepted and delivered in the background by the
      // edge function, which writes its own audit log with the final counts.
      if (reminderType === "admin_broadcast") {
        if (data.duplicate) {
          toast.info("This broadcast was already sent — duplicate ignored", { id: toastId })
        } else {
          toast.success(`✅ ${label} is sending to ${resolvedRecipients.length} recipient(s)`, { id: toastId })
        }
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const successCount = data.results?.filter((r: any) => r.success).length || 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const failCount = data.results?.filter((r: any) => !r.success).length || 0

      if (failCount === 0) {
        toast.success(`✅ ${label} sent to ${successCount} recipient(s)`, { id: toastId })
      } else {
        toast.warning(`Sent to ${successCount}, failed for ${failCount}`, { id: toastId })
      }

      await logMailAudit({
        action: "meeting_reminder_sent",
        entityId: crypto.randomUUID(),
        department: currentUserDept || "Admin & HR",
        metadata: {
          reminder_type: reminderType,
          success_count: successCount,
          failure_count: failCount,
          recipient_count: resolvedRecipients.length,
          subject: label,
          prepared_by: selectedMeetingPreparedBy?.full_name || null,
          attachment_count: 0,
        },
      })
    } catch (err: unknown) {
      log.error({ err: String(err) }, "Meeting reminder error")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any).message || "Failed to send", { id: toastId })
    } finally {
      setIsSending(false)
    }
  }

  const handleSaveMeetingDraft = useCallback(async () => {
    if (typeof window === "undefined") return
    const agendaItems = parseAgendaItems(agendaText)
    if (agendaItems.length === 0) {
      toast.error("Agenda is required before saving")
      return
    }

    setSavingMeetingDraft(true)
    try {
      const res = await fetch("/api/reports/meeting-agenda-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agenda: agendaItems }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save agenda")

      setAgendaText(agendaItems.join("\n"))
      window.localStorage.removeItem(AGENDA_STORAGE_KEY)
      // Teams link is per-week
      window.localStorage.setItem(meetingDraftStorageKey, JSON.stringify({ teamsLink }))
      queryClient.setQueryData(["meeting-reminder-default-agenda"], { agenda: agendaItems })
      toast.success("Agenda changes saved")
    } catch (error) {
      log.error({ err: String(error) }, "Failed to save meeting agenda")
      toast.error(error instanceof Error ? error.message : "Failed to save agenda")
    } finally {
      window.setTimeout(() => setSavingMeetingDraft(false), 300)
    }
  }, [agendaText, meetingDraftStorageKey, queryClient, teamsLink])

  const deactivateSchedule = async (id: string) => {
    const { error } = await supabase.from("reminder_schedules").update({ is_active: false }).eq("id", id)
    if (error) {
      toast.error("Failed to deactivate schedule")
      return
    }
    toast.success("Schedule deactivated")
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminReminderSchedules(mode) })
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title={mode === "communications" ? "Broadcast Communications" : "Meeting Reminders"}
        description={
          mode === "communications"
            ? "Send branded department-level broadcast emails to selected recipients."
            : "Send meeting reminders and knowledge-sharing alerts to selected recipients."
        }
        icon={Megaphone}
        backLink={{
          href: mode === "communications" ? "/admin/communications" : "/admin/communications/meetings",
          label: "Back",
        }}
      />

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start">
        {/* ── LEFT: Settings ────────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Reminder Type selector (meetings mode only) */}
          {mode !== "communications" && (
            <ReminderTypeSelector reminderType={reminderType} setReminderType={setReminderType} />
          )}

          {/* Details Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calendar className="h-5 w-5 text-blue-600" />
                {reminderType === "meeting" ? "Meeting Details" : "Session Details"}
              </CardTitle>
              <CardDescription>
                {reminderType === "meeting"
                  ? "Meeting date, time, and KSS presenter setup come from Admin Reports. Configure the Teams link and agenda here."
                  : reminderType === "knowledge_sharing"
                    ? "Configure the session date, time, and duration"
                    : "Write your custom subject and formatted message body"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {reminderType === "meeting" ? (
                <MeetingReminderForm
                  meetingWeek={activeMeetingWeek.week}
                  meetingYear={activeMeetingWeek.year}
                  weekOptions={meetingWeekOptions}
                  yearOptions={meetingYearOptions}
                  setMeetingWeek={(value) => {
                    setHasManualMeetingWeekOverride(true)
                    setActiveMeetingWeek((prev) => ({
                      ...prev,
                      week: value,
                    }))
                  }}
                  setMeetingYear={(value) => {
                    setHasManualMeetingWeekOverride(true)
                    setActiveMeetingWeek((prev) => ({
                      ...prev,
                      year: value,
                    }))
                  }}
                  meetingDate={meetingDate}
                  meetingTime={meetingTime}
                  teamsLink={teamsLink}
                  setTeamsLink={setTeamsLink}
                  agendaText={agendaText}
                  setAgendaText={setAgendaText}
                  onSaveDraft={handleSaveMeetingDraft}
                  savingDraft={savingMeetingDraft}
                  knowledgeDepartment={knowledgeDepartment}
                  knowledgePresenterId={knowledgePresenterId}
                  knowledgePresenterName={knowledgePresenterName}
                  meetingPreparedById={meetingPreparedById}
                  setMeetingPreparedById={setMeetingPreparedById}
                  departmentOptions={departmentOptions}
                  presenterOptions={presenterOptions}
                  meetingPreparedByOptions={meetingPreparedByOptions}
                />
              ) : reminderType === "knowledge_sharing" ? (
                <KnowledgeSessionForm
                  sessionDate={sessionDate}
                  setSessionDate={setSessionDate}
                  sessionTime={sessionTime}
                  setSessionTime={setSessionTime}
                  duration={duration}
                  setDuration={setDuration}
                />
              ) : (
                <BroadcastForm
                  broadcastDepartment={broadcastDepartment}
                  setBroadcastDepartment={setBroadcastDepartment}
                  broadcastPreparedById={broadcastPreparedById}
                  setBroadcastPreparedById={setBroadcastPreparedById}
                  broadcastSubject={broadcastSubject}
                  setBroadcastSubject={setBroadcastSubject}
                  broadcastBodyHtml={broadcastBodyHtml}
                  setBroadcastBodyHtml={setBroadcastBodyHtml}
                  broadcastPreparedByOptions={broadcastPreparedByOptions}
                  departmentOptions={departmentOptions}
                  attachments={broadcastAttachments}
                  setAttachments={setBroadcastAttachments}
                />
              )}
            </CardContent>
          </Card>

          {/* Recipients */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-purple-600" />
                Recipients
              </CardTitle>
              <CardDescription>Choose who receives the reminder</CardDescription>
            </CardHeader>
            <CardContent>
              <RecipientSelector
                employees={employees}
                recipientMode={recipientMode}
                setRecipientMode={setRecipientMode}
                selectedEmployeeIds={selectedEmployeeIds}
                toggleEmployee={toggleEmployee}
                selectAll={selectAll}
                deselectAll={deselectAll}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filteredEmployees={filteredEmployees}
                manualEmails={manualEmails}
                manualInput={manualInput}
                setManualInput={setManualInput}
                addManualEmail={addManualEmail}
                removeManualEmail={removeManualEmail}
              />
            </CardContent>
          </Card>

          {/* Delivery Timing */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-orange-600" />
                Delivery Timing
              </CardTitle>
              <CardDescription>Send now, schedule once, or set up recurring delivery</CardDescription>
            </CardHeader>
            <CardContent>
              <SchedulingOptions
                sendTiming={sendTiming}
                setSendTiming={setSendTiming}
                scheduledDate={scheduledDate}
                setScheduledDate={setScheduledDate}
                scheduledTime={scheduledTime}
                setScheduledTime={setScheduledTime}
                recurringDay={recurringDay}
                setRecurringDay={setRecurringDay}
                recurringTime={recurringTime}
                setRecurringTime={setRecurringTime}
                activeSchedules={activeSchedules}
                deactivateSchedule={deactivateSchedule}
              />
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: Summary & Send ─────────────────────────────────────── */}
        <SendSummary
          reminderType={reminderType}
          meetingDate={meetingDate}
          meetingTime={meetingTime}
          sessionDate={sessionDate}
          sessionTime={sessionTime}
          broadcastDepartment={broadcastDepartment}
          broadcastSubject={broadcastSubject}
          selectedMeetingPreparedByName={selectedMeetingPreparedBy?.full_name ?? null}
          selectedBroadcastPreparedByName={selectedBroadcastPreparedBy?.full_name ?? null}
          selectedPresenterName={selectedKnowledgePresenter?.full_name ?? null}
          knowledgeDepartment={knowledgeDepartment}
          broadcastAttachmentCount={broadcastAttachments.length}
          resolvedRecipients={resolvedRecipients}
          sendTiming={sendTiming}
          scheduledDate={scheduledDate}
          scheduledTime={scheduledTime}
          recurringDay={recurringDay}
          recurringTime={recurringTime}
          isSending={isSending}
          onSend={handleSend}
          sendResult={sendResult}
        />
      </div>
    </PageWrapper>
  )
}
