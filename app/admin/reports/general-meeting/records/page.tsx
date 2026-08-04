import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { MeetingRecordsContent } from "./_components/meeting-records-content"

export default async function AdminMeetingRecordsPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) redirect("/auth/login")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  const role = String(profile?.role || "").toLowerCase()
  if (!["developer", "super_admin", "admin"].includes(role)) redirect("/admin/reports/general-meeting")

  return <MeetingRecordsContent />
}
