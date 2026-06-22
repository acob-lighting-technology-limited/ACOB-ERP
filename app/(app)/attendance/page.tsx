import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AttendanceContent } from "./attendance-content"
import { toLocalISODate } from "@/lib/utils/date"

export interface AttendanceRecord {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source?: string | null
  waived?: boolean | null
}

async function getAttendanceData() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const today = toLocalISODate()

  // Fetch today's record + profile remote check-in eligibility in parallel
  const [{ data: todayData }, { data: recentData }, { data: profileData }] = await Promise.all([
    supabase.from("attendance_records").select("*").eq("user_id", user.id).eq("date", today).maybeSingle(),
    supabase
      .from("attendance_records")
      .select("*")
      .eq("user_id", user.id)
      .gte(
        "date",
        (() => {
          const d = new Date()
          d.setDate(1)
          return toLocalISODate(d)
        })()
      )
      .lte("date", today)
      .order("date", { ascending: false }),
    supabase.from("profiles").select("remote_checkin_enabled").eq("id", user.id).maybeSingle(),
  ])

  return {
    todayRecord: todayData as AttendanceRecord | null,
    recentRecords: (recentData || []) as AttendanceRecord[],
    remoteCheckinEnabled: Boolean(profileData?.remote_checkin_enabled),
  }
}

export default async function AttendancePage() {
  const data = await getAttendanceData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const attendanceData = data as {
    todayRecord: AttendanceRecord | null
    recentRecords: AttendanceRecord[]
    remoteCheckinEnabled: boolean
  }

  return (
    <AttendanceContent
      initialTodayRecord={attendanceData.todayRecord}
      initialRecentRecords={attendanceData.recentRecords}
      remoteCheckinEnabled={attendanceData.remoteCheckinEnabled}
    />
  )
}
