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
import { FormPageSkeleton } from "@/components/skeletons"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const router = useRouter()

  // Check if user has a valid session from the reset link
  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        toast.error("Invalid or expired reset link. Please request a new one.")
        router.push("/auth/forgot-password")
        return
      }
      setIsChecking(false)
    }

    checkSession()
  }, [router])

  if (isChecking) {
    return <FormPageSkeleton sections={2} fieldsPerSection={3} showSidebar={false} />
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate passwords match
    if (password !== confirmPassword) {
      setError("Passwords do not match")
      toast.error("Passwords do not match")
      return
    }

    // Validate password strength
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
      toast.success("Password reset successful!")

      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push("/auth/login")
      }, 2000)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to reset password"
      setError(message)
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
              <CardTitle className="text-2xl font-bold tracking-tight">
                {isSuccess ? "Password reset" : "Create new password"}
              </CardTitle>
              <CardDescription className="text-sm">
                {isSuccess ? "You can now sign in with your new password" : "Choose a strong password for your account"}
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
              ) : (
                <form onSubmit={handleResetPassword}>
                  <div className="flex flex-col gap-5">
                    <div className="grid gap-3">
                      <Label htmlFor="password" className="text-sm font-medium">
                        New Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Enter new password"
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
                        Confirm New Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirm new password"
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

                    {error && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                        <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                      </div>
                    )}

                    <Button type="submit" className="h-11 w-full text-base font-semibold" loading={isLoading}>
                      Reset Password
                    </Button>

                    <Link href="/auth/login" className="block">
                      <Button variant="ghost" className="h-11 w-full">
                        Cancel
                      </Button>
                    </Link>
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
