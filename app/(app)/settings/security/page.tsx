import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ChangePasswordForm } from "@/components/change-password-form"

export default async function SettingsSecurityPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  return (
    <div className="space-y-6">
      <ChangePasswordForm />
    </div>
  )
}
