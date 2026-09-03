import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getLeaveEntitlements } from "@/lib/hr/leave-entitlement"
import { toLocalISODate } from "@/lib/utils/date"

export interface UserHrSummary {
  profile: {
    id: string
    firstName: string
    lastName: string
    department: string | null
  } | null
  todayAttendance: {
    clockIn: string | null
    clockOut: string | null
    totalHours: number | null
    status: string | null
    isClockedIn: boolean
  }
  leave: {
    totalRemainingDays: number
    pendingRequestsCount: number
    annualRemainingDays: number
    casualRemainingDays: number
  }
  lunch: {
    hasMenuToday: boolean
    hasVoted: boolean
  }
  bookings: {
    activeCount: number
  }
}

export async function getCurrentUserHrData(): Promise<UserHrSummary> {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const today = toLocalISODate()
  const currentYear = new Date().getFullYear()

  const [
    { data: profile },
    { data: attendanceToday },
    { data: pendingLeaveRequests },
    entitlements,
    { data: todayMenu },
    { data: userBookings },
  ] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, department").eq("id", user.id).maybeSingle(),
    supabase
      .from("attendance_records")
      .select("id, clock_in, clock_out, total_hours, status")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle(),
    supabase.from("leave_requests").select("id").eq("user_id", user.id).eq("status", "pending"),
    getLeaveEntitlements(supabase, user.id, { year: currentYear }).catch(() => []),
    dataClient.from("lunch_menus").select("id").eq("date", today).is("archived_at", null).maybeSingle(),
    dataClient
      .from("fleet_bookings")
      .select("id")
      .eq("user_id", user.id)
      .gte("end_time", new Date().toISOString())
      .neq("status", "cancelled"),
  ])

  // Check if user has voted for today's lunch if a menu exists
  let hasVotedLunch = false
  if (todayMenu?.id) {
    const { data: vote } = await dataClient
      .from("lunch_votes")
      .select("id")
      .eq("user_id", user.id)
      .eq("menu_id", todayMenu.id)
      .maybeSingle()
    hasVotedLunch = Boolean(vote)
  }

  // Calculate remaining leave days from entitlements
  const annualEntitlement = entitlements.find(
    (e) => e.name.toLowerCase().includes("annual") || (e.code && e.code.toLowerCase().includes("annual"))
  )
  const casualEntitlement = entitlements.find(
    (e) => e.name.toLowerCase().includes("casual") || (e.code && e.code.toLowerCase().includes("casual"))
  )
  const totalRemainingDays = entitlements.reduce((sum, e) => sum + e.remainingDays, 0)

  const isClockedIn = Boolean(attendanceToday?.clock_in && !attendanceToday?.clock_out)

  return {
    profile: profile
      ? {
          id: profile.id,
          firstName: profile.first_name || "",
          lastName: profile.last_name || "",
          department: profile.department,
        }
      : null,
    todayAttendance: {
      clockIn: attendanceToday?.clock_in || null,
      clockOut: attendanceToday?.clock_out || null,
      totalHours: attendanceToday?.total_hours || null,
      status: attendanceToday?.status || null,
      isClockedIn,
    },
    leave: {
      totalRemainingDays,
      pendingRequestsCount: pendingLeaveRequests?.length || 0,
      annualRemainingDays: annualEntitlement?.remainingDays || 0,
      casualRemainingDays: casualEntitlement?.remainingDays || 0,
    },
    lunch: {
      hasMenuToday: Boolean(todayMenu),
      hasVoted: hasVotedLunch,
    },
    bookings: {
      activeCount: userBookings?.length || 0,
    },
  }
}
