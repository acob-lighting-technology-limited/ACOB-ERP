"use client"

import type React from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useState, useEffect } from "react"

import { toast } from "sonner"
import { ArrowLeft, Mail } from "lucide-react"
import Image from "next/image"
import { useTheme } from "next-themes"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme } = useTheme()

  // Default to light logo for SSR to prevent hydration mismatch
  const logoSrc = !mounted
    ? getSeasonalLogoPaths("light").navbar
    : getSeasonalLogoPaths(resolvedTheme === "dark" ? "dark" : "light").navbar

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)

    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matrix.acoblighting.com"
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/auth/callback?next=/auth/reset-password`,
      })

      if (error) throw error

      setEmailSent(true)
      toast.success("Password reset email sent! Check your inbox.")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to send reset email"
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="from-background via-background to-muted/20 flex min-h-screen w-full items-center justify-center bg-gradient-to-br p-4 md:p-6">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6">
          <Card className="border-2 shadow-xl">
            <CardHeader className="pb-4">
              <div className="mb-4 flex justify-center">
                <Image src={logoSrc} alt="ACOB Lighting" width={220} height={56} priority className="h-14 w-auto" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                {emailSent ? "Check your email" : "Forgot password?"}
              </CardTitle>
              <CardDescription className="text-sm">
                {emailSent
                  ? "We've sent a password reset link to your inbox"
                  : "Enter your company email and we'll send you a reset link"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-8">
              {emailSent ? (
                <div className="space-y-6">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
                    <p className="text-sm text-green-800 dark:text-green-200">
                      Check your email inbox for a password reset link. If you don&apos;t see it, check your spam
                      folder.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <Button onClick={() => setEmailSent(false)} variant="outline" className="h-11 w-full">
                      Send Another Email
                    </Button>
                    <Link href="/auth/login" className="block">
                      <Button variant="ghost" className="h-11 w-full">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Login
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleResetPassword}>
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-3">
                      <Label htmlFor="email" className="text-sm font-medium">
                        Company Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="a.john@org.acoblighting.com"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-11 text-base"
                        autoFocus
                        autoComplete="email"
                      />
                      <p className="text-muted-foreground text-xs">
                        Enter the email address associated with your account
                      </p>
                    </div>

                    <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                      Send Reset Link
                    </Button>

                    <Link href="/auth/login" className="block">
                      <Button variant="ghost" className="h-11 w-full">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Login
                      </Button>
                    </Link>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-center text-xs">
            Having trouble? Contact your system administrator or IT support.
          </p>
        </div>
      </div>
    </div>
  )
}
