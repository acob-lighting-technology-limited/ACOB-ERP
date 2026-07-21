"use client"

import type React from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFieldGroup } from "@/components/ui/patterns"
import Link from "next/link"
import { useState, useEffect, useRef, useCallback, Suspense } from "react"

import { ArrowLeft, UserPlus, CheckCircle2, Lock, Eye, EyeOff, CheckCircle, KeyRound } from "lucide-react"
import Image from "next/image"
import { useTheme } from "next-themes"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"
import { formValidation } from "@/lib/validation"
import { useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { AuthPageSkeleton } from "@/components/skeletons"

import { logger } from "@/lib/logger"
import { apiFetch } from "@/lib/api-client"

const log = logger("auth-setup-account")

function SetupAccountContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams?.get("token")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""])
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const { resolvedTheme } = useTheme()

  // Default to light logo for SSR to prevent hydration mismatch
  const logoSrc = !mounted
    ? getSeasonalLogoPaths("light").navbar
    : getSeasonalLogoPaths(resolvedTheme === "dark" ? "dark" : "light").navbar

  useEffect(() => {
    setMounted(true)

    const supabase = createClient()

    // Check if we already have a session (came via /auth/callback)
    const checkExistingSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session) {
        // We have a valid session from the callback code exchange
        setIsRecoveryMode(true)
      }
    }
    checkExistingSession()

    // Also listen for PASSWORD_RECOVERY event (hash fragment / implicit flow)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, _session) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const handleSetupAccount = async (e: React.FormEvent) => {
    e.preventDefault()

    // Domain restriction check
    if (!formValidation.isCompanyEmail(email)) {
      toast.error("Only @acoblighting.com and @org.acoblighting.com emails are allowed.")
      return
    }

    const supabase = createClient()
    setIsLoading(true)

    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matrix.acoblighting.com"
      // Use the callback route for proper PKCE code exchange, then redirect to setup-account
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/auth/callback?next=/auth/setup-account`,
      })

      if (error) throw error

      setEmailSent(true)
      toast.success("Setup link sent! Check your inbox.")
    } catch (error: unknown) {
      log.error("Setup Account Error:", error)
      const message = error instanceof Error ? error.message : "Failed to send setup email"
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  // OTP digit handlers
  const handleOtpChange = useCallback(
    (index: number, value: string) => {
      if (!/^\d*$/.test(value)) return // only digits
      const newDigits = [...otpDigits]
      newDigits[index] = value.slice(-1)
      setOtpDigits(newDigits)
      // Auto-focus next input
      if (value && index < 5) {
        otpRefs.current[index + 1]?.focus()
      }
    },
    [otpDigits]
  )

  const handleOtpKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
        otpRefs.current[index - 1]?.focus()
      }
    },
    [otpDigits]
  )

  const handleOtpPaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
      if (pasted.length > 0) {
        const newDigits = [...otpDigits]
        for (let i = 0; i < pasted.length; i++) {
          newDigits[i] = pasted[i]
        }
        setOtpDigits(newDigits)
        const focusIndex = Math.min(pasted.length, 5)
        otpRefs.current[focusIndex]?.focus()
      }
    },
    [otpDigits]
  )

  const handleVerifyOtp = async () => {
    const code = otpDigits.join("")
    if (code.length !== 6) {
      toast.error("Please enter all 6 digits")
      return
    }

    setIsVerifyingOtp(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "recovery",
      })

      if (error) throw error

      // OTP verified — session is now established, show password form
      setIsRecoveryMode(true)
      toast.success("Code verified! Now create your password.")
    } catch (err: unknown) {
      log.error("OTP Verification Error:", err)
      toast.error(err instanceof Error ? err.message : "Invalid or expired code. Please try again.")
      setOtpDigits(["", "", "", "", "", ""])
      otpRefs.current[0]?.focus()
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleCreatePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters")
      return
    }

    setIsLoading(true)
    try {
      const supabase = createClient()

      if (isRecoveryMode) {
        // Standard Supabase Recovery Flow
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
      } else {
        // Custom Initial Setup Flow
        const response = await apiFetch("/api/auth/setup-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        })

        const data = await response.json()
        if (!response.ok) throw new Error(data.error || data.message || "Failed to activate account")
      }

      setIsSuccess(true)
      toast.success(isRecoveryMode ? "Password reset successfully!" : "Account activated successfully!")

      setTimeout(() => {
        router.push("/auth/login")
      }, 2000)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to process request")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="from-background via-background to-muted/20 flex min-h-screen w-full items-center justify-center bg-gradient-to-br p-4 md:p-6">
      <div className="w-full max-w-6xl">
        <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:gap-8">
          <Card className="border-2 shadow-xl">
            <CardHeader className="pb-4">
              <div className="mb-4 flex justify-center lg:hidden">
                <Image src={logoSrc} alt="ACOB Lighting" width={220} height={56} priority className="h-14 w-auto" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight lg:text-3xl">
                {isSuccess
                  ? "Account activated"
                  : token || isRecoveryMode
                    ? isRecoveryMode
                      ? "Reset your password"
                      : "Create your password"
                    : emailSent
                      ? "Check your email"
                      : "Set up your account"}
              </CardTitle>
              <CardDescription className="text-sm">
                {isSuccess
                  ? "Your account is now active. Redirecting to login..."
                  : token || isRecoveryMode
                    ? isRecoveryMode
                      ? "Enter a new password to continue."
                      : "Create a secure password to activate your account."
                    : emailSent
                      ? `We sent a setup link to ${email}`
                      : "Enter your company email to get started."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-8">
              {isSuccess ? (
                <div className="space-y-6">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
                    <p className="text-sm text-green-800 dark:text-green-200">
                      You can now log in with your new password. Redirecting to login page...
                    </p>
                  </div>
                  <Link href="/auth/login" className="block">
                    <Button className="h-11 w-full">Go to Login</Button>
                  </Link>
                </div>
              ) : token || isRecoveryMode ? (
                <form onSubmit={handleCreatePassword}>
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-3">
                      <Label htmlFor="password">New Password</Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="h-11 pr-10"
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
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          className="h-11 pr-10"
                          minLength={6}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                          aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                        >
                          {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                      Activate Account
                    </Button>
                  </div>
                </form>
              ) : emailSent ? (
                <div className="space-y-6">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
                    <div className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                      <div className="space-y-1 text-sm text-green-800 dark:text-green-200">
                        <p className="font-medium">Setup code sent to {email}</p>
                        <p>
                          We sent a 6-digit verification code to your email. Enter it below, or click the link in the
                          email.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* OTP Input */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm font-medium">
                        <KeyRound className="h-4 w-4" />
                        Verification Code
                      </Label>
                      <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                        {otpDigits.map((digit, i) => (
                          <input
                            key={i}
                            ref={(el) => {
                              otpRefs.current[i] = el
                            }}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleOtpChange(i, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(i, e)}
                            className="border-input bg-background focus:ring-primary/20 h-14 w-12 rounded-lg border-2 text-center text-2xl font-bold transition-all focus:border-green-500 focus:ring-2 focus:outline-none"
                            autoFocus={i === 0}
                          />
                        ))}
                      </div>
                      <p className="text-muted-foreground text-center text-xs">
                        Check your inbox (and spam folder) for the code
                      </p>
                    </div>

                    <Button
                      onClick={handleVerifyOtp}
                      className="h-11 w-full text-base font-semibold"
                      disabled={otpDigits.join("").length !== 6 || isVerifyingOtp}
                    >
                      {isVerifyingOtp ? "Verifying..." : "Verify & Continue"}
                    </Button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background text-muted-foreground px-2">or click the link in the email</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Button
                      onClick={() => {
                        setEmailSent(false)
                        setOtpDigits(["", "", "", "", "", ""])
                      }}
                      variant="outline"
                      className="h-11 w-full"
                    >
                      Didn&apos;t receive it? Send again
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
                <form onSubmit={handleSetupAccount}>
                  <div className="flex flex-col gap-5">
                    <FormFieldGroup label="Company Email" className="grid gap-3">
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
                    </FormFieldGroup>

                    <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                      Send Setup Link
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
              <p className="text-muted-foreground mt-4 text-center text-sm">
                Already have a password?{" "}
                <Link href="/auth/login" className="text-primary font-medium underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </p>
            </CardContent>
          </Card>

          <aside className="bg-card text-card-foreground hidden rounded-2xl border p-8 shadow-xl lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-8">
              <Image src={logoSrc} alt="ACOB Lighting" width={260} height={66} className="h-14 w-auto" />
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight">Matrix</h2>
                <p className="text-muted-foreground text-sm leading-6">
                  Secure onboarding for authorized employees to access operations, reporting, and administrative tools.
                </p>
              </div>
              <div className="text-muted-foreground space-y-3 text-sm">
                <p className="border-primary/70 text-foreground border-l-2 pl-3">Use your registered company email.</p>
                <p className="border-primary/70 border-l-2 pl-3">Complete OTP or setup-link verification first.</p>
                <p className="border-primary/70 border-l-2 pl-3">Create a strong password to activate your account.</p>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">ACOB Lighting Technology Limited</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default function SetupAccountPage() {
  return (
    <Suspense fallback={<AuthPageSkeleton />}>
      <SetupAccountContent />
    </Suspense>
  )
}
