"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFieldGroup } from "@/components/ui/patterns"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useState, useRef, useEffect } from "react"
import { toast } from "sonner"
import { KeyRound, Mail, ArrowLeft, Eye, EyeOff } from "lucide-react"
import Image from "next/image"
import { useTheme } from "next-themes"

import { logger } from "@/lib/logger"

const log = logger("auth-login")

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""])
  const [loginMethod, setLoginMethod] = useState<"password" | "otp">("password")
  const [step, setStep] = useState<"credentials" | "otp">("credentials")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const searchParams = useSearchParams()
  const { resolvedTheme } = useTheme()
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  // Default to light logo for SSR to prevent hydration mismatch
  const logoSrc = !mounted
    ? "/images/acob-logo-light.webp"
    : resolvedTheme === "dark"
      ? "/images/acob-logo-dark.webp"
      : "/images/acob-logo-light.webp"

  useEffect(() => {
    setMounted(true)
  }, [])

  // Auto-focus first OTP box when entering OTP step
  useEffect(() => {
    if (step === "otp") {
      otpRefs.current[0]?.focus()
    }
  }, [step])

  // Force canonical host for auth landing flows while preserving hash tokens.
  useEffect(() => {
    const currentHost = window.location.hostname.toLowerCase()
    if (currentHost !== "acob-erp.vercel.app") return
    const target = `https://erp.acoblighting.com${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.replace(target)
  }, [])

  // Handle hash-based auth handoff (e.g. developer impersonation magic links)
  // after middleware redirects unauthenticated requests back to /auth/login.
  useEffect(() => {
    const hash = window.location.hash || ""
    if (!hash.includes("access_token=") || !hash.includes("refresh_token=")) return

    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash)
    const accessToken = params.get("access_token")
    const refreshToken = params.get("refresh_token")
    const hashError = params.get("error_description") || params.get("error")

    if (hashError) {
      const message = decodeURIComponent(hashError)
      setError(message)
      toast.error(message)
      return
    }

    if (!accessToken || !refreshToken) return

    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      setIsLoading(true)
      setError(null)

      const trySetSession = async () => {
        const result = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (!result.error) return result
        await new Promise((resolve) => setTimeout(resolve, 150))
        return supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
      }

      try {
        const { error } = await trySetSession()
        if (error) throw error

        await fetch("/api/dev/login-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authMethod: "otp" }),
          keepalive: true,
        }).catch((err) => log.warn("dev login log failed (hash handoff)", err))

        const nextPath = getSafeNextPath(searchParams.get("next"))
        // Remove sensitive fragment and force navigation after session handoff.
        window.history.replaceState(null, "", window.location.pathname + window.location.search)
        window.location.assign(nextPath)
      } catch (sessionError: unknown) {
        const message = sessionError instanceof Error ? sessionError.message : "Failed to complete sign-in"
        setError(`${message}. Click the copied link again to retry.`)
        toast.error("Magic link sign-in failed. Please retry with a fresh link.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [searchParams])

  const handleOtpChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, "").slice(-1)
    const newDigits = [...otpDigits]
    newDigits[index] = digit
    setOtpDigits(newDigits)

    // Auto-advance to next input
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all 6 digits are filled
    if (digit && index === 5 && newDigits.every((d) => d !== "")) {
      handleVerifyOTP(undefined, newDigits.join(""))
    }
  }

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    if (paste.length === 0) return
    const newDigits = [...otpDigits]
    for (let i = 0; i < paste.length && i < 6; i++) {
      newDigits[i] = paste[i]
    }
    setOtpDigits(newDigits)
    // Focus the next empty box or the last one
    const nextEmpty = newDigits.findIndex((d) => d === "")
    otpRefs.current[nextEmpty === -1 ? 5 : nextEmpty]?.focus()

    // Auto-submit if all filled
    if (newDigits.every((d) => d !== "")) {
      handleVerifyOTP(undefined, newDigits.join(""))
    }
  }

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault()

    // Domain restriction check
    const allowedDomains = ["acoblighting.com", "org.acoblighting.com"]
    const domain = email.split("@")[1]?.toLowerCase()
    if (!domain || !allowedDomains.includes(domain)) {
      const msg = "Only @acoblighting.com and @org.acoblighting.com emails are allowed."
      setError(msg)
      toast.error(msg)
      return
    }

    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false, // Only allow existing users
          emailRedirectTo: undefined, // No redirect → OTP code only
        },
      })
      if (error) throw error
      toast.success("A 6-digit code has been sent to your email")
      setStep("otp")
    } catch (error: unknown) {
      log.error("OTP Request Error:", error)
      let displayMessage = error instanceof Error ? error.message : "An error occurred"
      if (displayMessage.includes("Signups not allowed")) {
        displayMessage = "This email is not registered. Please contact your administrator."
      }
      setError(displayMessage)
      toast.error(displayMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    // Domain restriction check
    const allowedDomains = ["acoblighting.com", "org.acoblighting.com"]
    const domain = email.split("@")[1]?.toLowerCase()
    if (!domain || !allowedDomains.includes(domain)) {
      const msg = "Only @acoblighting.com and @org.acoblighting.com emails are allowed."
      setError(msg)
      toast.error(msg)
      return
    }

    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error
      await fetch("/api/dev/login-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authMethod: "password" }),
        keepalive: true,
      }).catch((err) => log.warn("dev login log failed (password)", err))
      toast.success("Login successful!")
      const nextPath = getSafeNextPath(searchParams.get("next"))
      window.location.href = nextPath
    } catch (error: unknown) {
      log.error("Password Login Error:", error)
      const message = error instanceof Error ? error.message : "Invalid email or password"
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyOTP = async (e?: React.FormEvent, code?: string) => {
    if (e) e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    const otpCode = code || otpDigits.join("")
    if (otpCode.length !== 6) {
      setError("Please enter all 6 digits")
      setIsLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: "email",
      })
      if (error) throw error
      await fetch("/api/dev/login-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authMethod: "otp" }),
        keepalive: true,
      }).catch((err) => log.warn("dev login log failed (otp)", err))
      toast.success("Login successful!")
      const nextPath = getSafeNextPath(searchParams.get("next"))
      window.location.href = nextPath
    } catch (error: unknown) {
      log.error("OTP Verification Error:", error)
      const message = error instanceof Error ? error.message : "Invalid OTP"
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="from-background via-background to-muted/20 flex min-h-screen w-full items-center justify-center bg-gradient-to-br p-4 md:p-6">
      <div className="w-full max-w-6xl">
        <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:gap-8">
          <Card className="border-2 shadow-xl">
            <CardHeader className="space-y-3 pb-6">
              <div className="mb-2 flex justify-center lg:hidden">
                <Image src={logoSrc} alt="ACOB Lighting" width={170} height={52} priority className="h-10 w-auto" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">Welcome Back</h1>
              <p className="text-muted-foreground text-base lg:text-lg">
                Sign in to continue to the ACOB employee portal
              </p>
              <CardTitle className="text-2xl font-semibold">
                {step === "credentials" ? "Sign In" : "Verify Your Code"}
              </CardTitle>
              <CardDescription className="text-base">
                {step === "credentials"
                  ? "Choose your preferred login method"
                  : `Enter the 6-digit code sent to ${email}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-8">
              {step === "credentials" ? (
                <div className="space-y-4">
                  {/* Login Method Tabs */}
                  <div className="bg-muted flex gap-2 rounded-lg p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setLoginMethod("password")
                        setError(null)
                      }}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-md px-6 py-3 text-sm font-semibold transition-all ${
                        loginMethod === "password"
                          ? "bg-background ring-primary/20 shadow-md ring-2"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      }`}
                    >
                      <KeyRound className="h-4 w-4" />
                      Password
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLoginMethod("otp")
                        setError(null)
                      }}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-md px-6 py-3 text-sm font-semibold transition-all ${
                        loginMethod === "otp"
                          ? "bg-background ring-primary/20 shadow-md ring-2"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      }`}
                    >
                      <Mail className="h-4 w-4" />
                      One-Time Code
                    </button>
                  </div>

                  {/* Password Login Form */}
                  {loginMethod === "password" ? (
                    <form onSubmit={handlePasswordLogin}>
                      <div className="flex flex-col gap-5">
                        <FormFieldGroup label="Company Email" className="grid gap-3">
                          <Input
                            id="email"
                            name="email"
                            type="email"
                            placeholder="a.john@org.acoblighting.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="h-11 text-base"
                            autoComplete="username"
                          />
                        </FormFieldGroup>
                        <div className="grid gap-3">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="password" className="text-sm font-medium">
                              Password
                            </Label>
                            <Link
                              href="/auth/forgot-password"
                              className="text-primary text-xs underline-offset-4 hover:underline"
                            >
                              Forgot password?
                            </Link>
                          </div>
                          <div className="relative">
                            <Input
                              id="password"
                              name="password"
                              type={showPassword ? "text" : "password"}
                              placeholder="Enter your password"
                              required
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="h-11 pr-12 text-base"
                              autoComplete="current-password"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                              <button
                                type="button"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                aria-pressed={showPassword}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => setShowPassword((current) => !current)}
                                className="text-muted-foreground hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                              >
                                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                          </div>
                        </div>
                        {error && (
                          <p className="rounded-md bg-red-50 p-3 text-sm text-red-500 dark:bg-red-950/30">{error}</p>
                        )}
                        <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                          Login with Password
                        </Button>
                      </div>
                    </form>
                  ) : (
                    /* OTP Login Form */
                    <form onSubmit={handleRequestOTP}>
                      <div className="flex flex-col gap-5">
                        <div className="grid gap-3">
                          <Label htmlFor="email-otp" className="text-sm font-medium">
                            Company Email
                          </Label>
                          <Input
                            id="email-otp"
                            type="email"
                            placeholder="a.john@org.acoblighting.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="h-11 text-base"
                          />
                        </div>
                        {error && (
                          <p className="rounded-md bg-red-50 p-3 text-sm text-red-500 dark:bg-red-950/30">{error}</p>
                        )}
                        <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                          Send One-Time Code
                        </Button>
                      </div>
                    </form>
                  )}

                  {/* First Time Setup Link */}
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-center dark:border-blue-900 dark:bg-blue-950/30">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <span className="font-semibold">First time logging in?</span>{" "}
                      <Link
                        href="/auth/setup-account"
                        className="font-bold text-blue-600 underline underline-offset-4 hover:text-blue-700 dark:text-blue-400"
                      >
                        Set up your account here →
                      </Link>
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Enter your company email to receive a link to create your password
                    </p>
                  </div>
                </div>
              ) : (
                /* OTP Verification Form */
                <form onSubmit={(e) => handleVerifyOTP(e)}>
                  <div className="flex flex-col gap-6">
                    {/* 6 Individual OTP Boxes */}
                    <div>
                      <Label className="mb-3 block text-sm font-medium">One-Time Password</Label>
                      <div className="flex justify-center gap-3">
                        {otpDigits.map((digit, index) => (
                          <input
                            key={index}
                            ref={(el) => {
                              otpRefs.current[index] = el
                            }}
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleOtpChange(index, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(index, e)}
                            onPaste={index === 0 ? handleOtpPaste : undefined}
                            className="border-input bg-background ring-offset-background focus-visible:ring-ring h-14 w-12 rounded-lg border-2 text-center font-mono text-2xl font-bold transition-all focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                          />
                        ))}
                      </div>
                      <p className="text-muted-foreground mt-3 text-center text-xs">
                        Check your email inbox for the 6-digit code
                      </p>
                    </div>

                    {error && (
                      <p className="rounded-md bg-red-50 p-3 text-sm text-red-500 dark:bg-red-950/30">{error}</p>
                    )}
                    <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                      Verify &amp; Sign In
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setStep("credentials")
                        setOtpDigits(["", "", "", "", "", ""])
                        setError(null)
                      }}
                      className="h-11 w-full text-base"
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back to Login
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          <aside className="hidden rounded-2xl border bg-zinc-950 p-8 text-zinc-100 shadow-xl lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-8">
              <Image
                src="/images/acob-logo-dark.webp"
                alt="ACOB Lighting"
                width={220}
                height={64}
                className="h-12 w-auto"
              />
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight">ACOB Internal Workspace</h2>
                <p className="text-sm leading-6 text-zinc-300">
                  Secure access for authorized employees across operations, reporting, and administrative workflows.
                </p>
              </div>
              <div className="space-y-3 text-sm text-zinc-200">
                <p className="border-l-2 border-emerald-400/70 pl-3">Use your company email domain to sign in.</p>
                <p className="border-l-2 border-emerald-400/70 pl-3">
                  Choose password or one-time code based on your access setup.
                </p>
                <p className="border-l-2 border-emerald-400/70 pl-3">
                  Contact Admin & HR if your account has not been provisioned.
                </p>
              </div>
            </div>
            <p className="text-xs text-zinc-400">ACOB Lighting Technology Limited</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

function getSafeNextPath(next: string | null): string {
  if (!next) return "/profile"

  if (
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes(":") &&
    !/https?:\/\//i.test(next) &&
    !/[\r\n]/.test(next)
  ) {
    return next
  }

  return "/profile"
}
