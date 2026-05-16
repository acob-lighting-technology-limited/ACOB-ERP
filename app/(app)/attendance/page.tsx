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
  waiver_reason?: string | null
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

  // Fetch today's record
  const { data: todayData } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("user_id", user.id)
    .eq("date", today)
    .single()

  // Fetch month-to-date records (1st -> today)
  const monthStart = new Date()
  monthStart.setDate(1)
  const monthStartIso = toLocalISODate(monthStart)

  const { data: recentData } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("user_id", user.id)
    .gte("date", monthStartIso)
    .lte("date", today)
    .order("date", { ascending: false })

  return {
    todayRecord: todayData as AttendanceRecord | null,
    recentRecords: (recentData || []) as AttendanceRecord[],
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
  }

  return (
    <AttendanceContent
      initialTodayRecord={attendanceData.todayRecord}
      initialRecentRecords={attendanceData.recentRecords}
    />
  )
}
