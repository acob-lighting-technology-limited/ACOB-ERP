"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormFieldGroup } from "@/components/ui/patterns"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { useDepartments } from "@/hooks/use-departments"
import { toast } from "sonner"
import Image from "next/image"
import { useTheme } from "next-themes"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"

export default function SignUpPage() {
  const { departments: DEPARTMENTS } = useDepartments()
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    otherNames: "",
    email: "",
    password: "",
    department: "",
    phoneNumber: "",
    residentialAddress: "",
  })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const { resolvedTheme } = useTheme()

  // Default to light logo for SSR to prevent hydration mismatch
  const logoSrc = !mounted
    ? getSeasonalLogoPaths("light").navbar
    : getSeasonalLogoPaths(resolvedTheme === "dark" ? "dark" : "light").navbar

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()

    // Domain restriction check
    const allowedDomains = ["acoblighting.com", "org.acoblighting.com"]
    const domain = formData.email.split("@")[1]?.toLowerCase()
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
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://erp.acoblighting.com"
      // Create user with password
      const { error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${appUrl}/auth/callback`,
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            other_names: formData.otherNames,
            department: formData.department,
            phone_number: formData.phoneNumber,
            residential_address: formData.residentialAddress,
          },
        },
      })
      if (signUpError) throw signUpError

      toast.success("Account created! Please check your email to confirm.")
      router.push("/auth/sign-up-success")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "An error occurred"
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
                <Image src={logoSrc} alt="ACOB Lighting" width={220} height={56} className="h-14 w-auto" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">Join ACOB</h1>
              <p className="text-muted-foreground text-base lg:text-lg">
                Create your account to access the employee portal
              </p>
              <CardTitle className="text-2xl font-semibold">Create Account</CardTitle>
              <CardDescription className="text-base">Fill in your details to get started</CardDescription>
            </CardHeader>
            <CardContent className="pb-8">
              <form onSubmit={handleSignUp}>
                <div className="flex flex-col gap-5">
                  {/* Name Fields */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <FormFieldGroup label="First Name *" className="grid gap-3">
                      <Input
                        id="firstName"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        required
                        className="h-11 text-base"
                        autoComplete="given-name"
                      />
                    </FormFieldGroup>
                    <div className="grid gap-3">
                      <Label htmlFor="lastName" className="text-sm font-medium">
                        Last Name *
                      </Label>
                      <Input
                        id="lastName"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        required
                        className="h-11 text-base"
                        autoComplete="family-name"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <Label htmlFor="otherNames" className="text-sm font-medium">
                      Other Names
                    </Label>
                    <Input
                      id="otherNames"
                      value={formData.otherNames}
                      onChange={(e) => setFormData({ ...formData, otherNames: e.target.value })}
                      className="h-11 text-base"
                      placeholder="Optional"
                      autoComplete="additional-name"
                    />
                  </div>

                  {/* Email and Password */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="grid gap-3">
                      <Label htmlFor="email" className="text-sm font-medium">
                        Email *
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="your.email@example.com"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                        className="h-11 text-base"
                        autoComplete="email"
                      />
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="password" className="text-sm font-medium">
                        Password *
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="Min. 6 characters"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required
                        minLength={6}
                        className="h-11 text-base"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  {/* Department and Phone */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="grid gap-3">
                      <Label htmlFor="department" className="text-sm font-medium">
                        Department
                      </Label>
                      <Select
                        value={formData.department}
                        onValueChange={(value) => setFormData({ ...formData, department: value })}
                      >
                        <SelectTrigger id="department" className="h-11 text-base">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent>
                          {DEPARTMENTS.map((dept) => (
                            <SelectItem key={dept} value={dept}>
                              {dept}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="phoneNumber" className="text-sm font-medium">
                        Phone Number
                      </Label>
                      <Input
                        id="phoneNumber"
                        type="tel"
                        value={formData.phoneNumber}
                        onChange={(e) => {
                          // Only allow numbers and + symbol
                          const value = e.target.value.replace(/[^0-9+]/g, "")
                          setFormData({ ...formData, phoneNumber: value })
                        }}
                        placeholder="+2348012345678"
                        className="h-11 text-base"
                        autoComplete="tel"
                      />
                    </div>
                  </div>

                  {/* Residential Address */}
                  <div className="grid gap-3">
                    <Label htmlFor="residentialAddress" className="text-sm font-medium">
                      Residential Address
                    </Label>
                    <Input
                      id="residentialAddress"
                      value={formData.residentialAddress}
                      onChange={(e) => setFormData({ ...formData, residentialAddress: e.target.value })}
                      className="h-11 text-base"
                      placeholder="Your home address"
                      autoComplete="street-address"
                    />
                  </div>

                  {error && (
                    <p
                      role="alert"
                      aria-live="polite"
                      className="rounded-md bg-red-50 p-3 text-sm text-red-500 dark:bg-red-950/30"
                    >
                      {error}
                    </p>
                  )}
                  <Button type="submit" className="mt-2 h-12 w-full text-base font-semibold" loading={isLoading}>
                    Create Account
                  </Button>
                </div>
                <div className="mt-6 text-center">
                  <p className="text-muted-foreground text-sm">
                    Already have an account?{" "}
                    <Link href="/auth/login" className="text-primary font-semibold underline-offset-4 hover:underline">
                      Login
                    </Link>
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>

          <aside className="bg-card text-card-foreground hidden rounded-2xl border p-8 shadow-xl lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-8">
              <Image src={logoSrc} alt="ACOB Lighting" width={260} height={66} className="h-14 w-auto" />
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold tracking-tight">Employee Onboarding</h2>
                <p className="text-muted-foreground text-sm leading-6">
                  Register with your official company details to activate internal access and complete account setup.
                </p>
              </div>
              <div className="text-muted-foreground space-y-3 text-sm">
                <p className="border-primary/70 text-foreground border-l-2 pl-3">
                  Use only your approved ACOB company email domain.
                </p>
                <p className="border-primary/70 border-l-2 pl-3">
                  Ensure your department and contact details are accurate.
                </p>
                <p className="border-primary/70 border-l-2 pl-3">
                  Confirm your email after sign-up to activate your account.
                </p>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">ACOB Lighting Technology Limited</p>
          </aside>
        </div>
      </div>
    </div>
  )
}
