"use client"

// Public self-registration is intentionally disabled.
//
// Previously this page called supabase.auth.signUp(), which created an auth.users
// row directly. Combined with the on_auth_user_created trigger (handle_new_user),
// that auto-provisioned an ACTIVE employee profile with no approval, bypassing the
// admin onboarding flow. Public sign-up is now disabled at the Supabase Auth level
// (disable_signup = true) and this page no longer offers account creation.
//
// Legitimate accounts are created by an administrator (approve-user / create-user /
// import-csv, via the service-role admin API). Prospective staff use the onboarding
// request form, which writes a pending_users record for administrator approval.

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import Image from "next/image"
import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"

export default function SignUpPage() {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  const logoSrc = !mounted
    ? getSeasonalLogoPaths("light").navbar
    : getSeasonalLogoPaths(resolvedTheme === "dark" ? "dark" : "light").navbar

  return (
    <div className="from-background via-background to-muted/20 flex min-h-screen w-full items-center justify-center bg-gradient-to-br p-4 md:p-6">
      <Card className="w-full max-w-md border-2 shadow-xl">
        <CardHeader className="pb-4 text-center">
          <div className="mb-4 flex justify-center">
            <Image src={logoSrc} alt="ACOB Lighting" width={220} height={56} className="h-14 w-auto" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Registration by invitation only</CardTitle>
          <CardDescription className="text-sm">
            Self-registration has been disabled. Company accounts are created by an administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          <p className="text-muted-foreground text-center text-sm leading-6">
            If you are a new employee, please contact HR or IT to have your account provisioned. Once created, you will
            receive an email to set up your password.
          </p>
          <Button asChild className="mt-6 h-12 w-full text-base font-semibold">
            <Link href="/auth/login">Go to Login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
