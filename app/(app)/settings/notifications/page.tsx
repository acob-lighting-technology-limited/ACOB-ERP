import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { NotificationPreferencesForm } from "@/components/notification-preferences-form"

export default async function SettingsNotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  const { data: profile } = await supabase.from("profiles").select("email_notifications").eq("id", user.id).single()

  return (
    <NotificationPreferencesForm userId={user.id} initialEmailNotifications={profile?.email_notifications ?? true} />
  )
}
