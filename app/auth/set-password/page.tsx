"use client"

import type React from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Lock, CheckCircle, Eye, EyeOff } from "lucide-react"
import Image from "next/image"
import { useTheme } from "next-themes"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"
import { AuthPageSkeleton } from "@/components/skeletons"

export default function SetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const { resolvedTheme } = useTheme()

  // Default to light logo for SSR to prevent hydration mismatch
  const logoSrc = !mounted
    ? getSeasonalLogoPaths("light").navbar
    : getSeasonalLogoPaths(resolvedTheme === "dark" ? "dark" : "light").navbar

  useEffect(() => {
    setMounted(true)
  }, [])

  // Check if user has a valid session from the invite link
  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        toast.error("Invalid or expired invitation link. Please contact your administrator.")
        router.push("/auth/login")
        return
      }
      setIsChecking(false)
    }

    checkSession()
  }, [router])

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      toast.error("Passwords do not match")
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long")
      toast.error("Password must be at least 6 characters long")
      return
    }

    const supabase = createClient()
    setIsLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      })

      if (error) throw error

      setIsSuccess(true)
      toast.success("Password set successfully! Welcome to Matrix.")

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.replace("/profile")
      }, 2000)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to set password"
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  if (isChecking) {
    return <AuthPageSkeleton />
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
                {isSuccess ? "You're all set!" : "Set your password"}
              </CardTitle>
              <CardDescription className="text-sm">
                {isSuccess
                  ? "Redirecting to your dashboard..."
                  : "Create a secure password to activate your Matrix account"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-8">
              {isSuccess ? (
                <div className="space-y-6">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
                    <p className="text-sm text-green-800 dark:text-green-200">
                      Your password has been set successfully. You&apos;ll be redirected to your dashboard shortly.
                    </p>
                  </div>
                  <Link href="/profile" className="block">
                    <Button className="h-11 w-full">Go to Dashboard</Button>
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSetPassword}>
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-3">
                      <Label htmlFor="password" className="text-sm font-medium">
                        Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Create a strong password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="h-11 pr-10 text-base"
                          autoFocus
                          minLength={6}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                      <p className="text-muted-foreground text-xs">Must be at least 6 characters long</p>
                    </div>

                    <div className="grid gap-3">
                      <Label htmlFor="confirmPassword" className="text-sm font-medium">
                        Confirm Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirm your password"
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="h-11 pr-10 text-base"
                          minLength={6}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                          aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                        >
                          {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>

                    {/* Password strength indicator */}
                    {password.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex gap-1">
                          <div
                            className={`h-1.5 flex-1 rounded-full ${password.length >= 6 ? "bg-green-500" : "bg-red-300"}`}
                          />
                          <div
                            className={`h-1.5 flex-1 rounded-full ${password.length >= 8 ? "bg-green-500" : "bg-muted"}`}
                          />
                          <div
                            className={`h-1.5 flex-1 rounded-full ${/[A-Z]/.test(password) && /\d/.test(password) ? "bg-green-500" : "bg-muted"}`}
                          />
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {password.length < 6
                            ? "Too short"
                            : password.length < 8
                              ? "Okay"
                              : /[A-Z]/.test(password) && /\d/.test(password)
                                ? "Strong"
                                : "Good — add uppercase & numbers for stronger"}
                        </p>
                      </div>
                    )}

                    {error && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                        <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                      </div>
                    )}

                    <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                      Set Password &amp; Get Started
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
