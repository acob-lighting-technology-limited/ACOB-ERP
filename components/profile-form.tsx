"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useDepartments } from "@/hooks/use-departments"
import { useOfficeLocations } from "@/hooks/use-office-locations"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { BirthdayInput } from "@/components/ui/birthday-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import Link from "next/link"
import { Switch } from "@/components/ui/switch"
import type { Database } from "@/types/database"

type ProfileRecord = Database["public"]["Tables"]["profiles"]["Row"] & {
  email_notifications?: boolean | null
}

interface ProfileFormProps {
  user: {
    id: string
  }
  profile: ProfileRecord | null
  hideBackButton?: boolean
  onSaved?: () => void
}

const ProfileFormSchema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    otherNames: z.string().optional(),
    department: z.string().optional(),
    companyRole: z.string().optional(),
    phoneNumber: z.string().optional(),
    additionalPhone: z.string().optional(),
    residentialAddress: z.string().optional(),
    officeLocation: z.string().optional(),
    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankAccountName: z.string().optional(),
    birthday: z.string().optional(),
    birthYear: z.string().optional(),
    employmentDate: z.string().optional(),
    emailNotifications: z.boolean(),
  })
  .refine((data) => !data.additionalPhone || data.additionalPhone !== data.phoneNumber, {
    path: ["additionalPhone"],
    message: "Additional phone number must be different from main phone number",
  })

type ProfileFormValues = z.infer<typeof ProfileFormSchema>

export function ProfileForm({ user, profile, hideBackButton = false, onSaved }: ProfileFormProps) {
  const { departments: DEPARTMENTS } = useDepartments()
  const { officeLocations } = useOfficeLocations()
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(ProfileFormSchema),
    defaultValues: {
      firstName: profile?.first_name || "",
      lastName: profile?.last_name || "",
      otherNames: profile?.other_names || "",
      department: profile?.department || "",
      companyRole: profile?.designation || "",
      phoneNumber: profile?.phone_number || "",
      additionalPhone: profile?.additional_phone || "",
      residentialAddress: profile?.residential_address || "",
      officeLocation: profile?.office_location || "",
      bankName: profile?.bank_name || "",
      bankAccountNumber: profile?.bank_account_number || "",
      bankAccountName: profile?.bank_account_name || "",
      birthday: profile?.birthday || "",
      birthYear: profile?.birth_year != null ? String(profile.birth_year) : "",
      employmentDate: profile?.employment_date ? profile.employment_date.substring(0, 10) : "",
      emailNotifications: profile?.email_notifications ?? true,
    },
  })

  const [isLoading, setIsLoading] = useState(false)

  const onSubmit = form.handleSubmit(async (data) => {
    const supabase = createClient()
    setIsLoading(true)

    // Clean phone numbers - only digits and + allowed
    const phoneNumber = (data.phoneNumber || "").replace(/[^0-9+]/g, "")
    const additionalPhone = (data.additionalPhone || "").replace(/[^0-9+]/g, "")

    const updatePayload: Record<string, unknown> = {
      first_name: data.firstName,
      last_name: data.lastName,
      other_names: data.otherNames,
      department: data.department,
      designation: data.companyRole,
      phone_number: phoneNumber,
      additional_phone: additionalPhone,
      residential_address: data.residentialAddress,
      office_location: data.officeLocation,
      bank_name: data.bankName,
      bank_account_number: data.bankAccountNumber,
      bank_account_name: data.bankAccountName,
      employment_date: data.employmentDate || null,
      email_notifications: data.emailNotifications,
      updated_at: new Date().toISOString(),
    }

    // `birthday` (MM-DD) is the canonical month/day and the source of the
    // automated birthday email; `birth_year` stays null until the person adds
    // it. The DB trigger derives `date_of_birth` from these two. Only write
    // `birthday` when fully set so a save never clears an HR-populated value.
    if (/^\d{2}-\d{2}$/.test(data.birthday || "")) {
      updatePayload.birthday = data.birthday
      updatePayload.birth_year = data.birthYear ? Number(data.birthYear) : null
    }

    try {
      const { error } = await supabase.from("profiles").update(updatePayload).eq("id", user.id)

      if (error) throw error
      toast.success("Profile updated successfully!")
      onSaved?.()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update profile"
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>Your basic personal details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Personal Details */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input id="firstName" {...form.register("firstName")} />
                {form.formState.errors.firstName && (
                  <p className="text-destructive text-sm">{form.formState.errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input id="lastName" {...form.register("lastName")} />
                {form.formState.errors.lastName && (
                  <p className="text-destructive text-sm">{form.formState.errors.lastName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="otherNames">Other Names</Label>
                <Input id="otherNames" {...form.register("otherNames")} />
              </div>
            </div>

            {/* Company Information */}
            <div className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">Company Information</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Select
                    value={form.watch("department")}
                    onValueChange={(value) => form.setValue("department", value)}
                  >
                    <SelectTrigger id="department">
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
                <div className="space-y-2">
                  <Label htmlFor="companyRole">Designation</Label>
                  <Input id="companyRole" {...form.register("companyRole")} />
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">Contact Information</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">Phone Number</Label>
                  <Input
                    id="phoneNumber"
                    type="tel"
                    value={form.watch("phoneNumber")}
                    onChange={(e) => {
                      // Only allow numbers and + symbol
                      const value = e.target.value.replace(/[^0-9+]/g, "")
                      form.setValue("phoneNumber", value)
                    }}
                    placeholder="e.g., +2348012345678"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="additionalPhone">Additional Phone Number (Optional)</Label>
                  <Input
                    id="additionalPhone"
                    type="tel"
                    value={form.watch("additionalPhone")}
                    onChange={(e) => {
                      // Only allow numbers and + symbol
                      const value = e.target.value.replace(/[^0-9+]/g, "")
                      form.setValue("additionalPhone", value)
                    }}
                    placeholder="Must be different from main phone"
                  />
                  {form.formState.errors.additionalPhone && (
                    <p className="text-destructive text-sm">{form.formState.errors.additionalPhone.message}</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="residentialAddress">Residential Address</Label>
                <Textarea id="residentialAddress" {...form.register("residentialAddress")} rows={3} />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="emailNotifications"
                  checked={form.watch("emailNotifications")}
                  onCheckedChange={(checked) => form.setValue("emailNotifications", checked)}
                />
                <Label htmlFor="emailNotifications">Receive email notifications for updates and tasks</Label>
              </div>
            </div>

            {/* Office / Room */}
            <div className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">Office / Room</h3>
              <div className="space-y-2">
                <Label htmlFor="officeLocation">Assigned Office / Room</Label>
                <Select
                  value={form.watch("officeLocation")}
                  onValueChange={(value) => form.setValue("officeLocation", value)}
                >
                  <SelectTrigger id="officeLocation">
                    <SelectValue placeholder="Select office or room" />
                  </SelectTrigger>
                  <SelectContent>
                    {officeLocations.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Banking Information */}
            <div className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">Banking Information</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="bankName">Bank Name</Label>
                  <Input id="bankName" {...form.register("bankName")} placeholder="e.g., First Bank" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bankAccountNumber">Account Number</Label>
                  <Input
                    id="bankAccountNumber"
                    type="text"
                    value={form.watch("bankAccountNumber")}
                    onChange={(e) => {
                      // Only allow numbers
                      const value = e.target.value.replace(/[^0-9]/g, "")
                      form.setValue("bankAccountNumber", value)
                    }}
                    placeholder="e.g., 1234567890"
                    maxLength={10}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bankAccountName">Account Name</Label>
                  <Input id="bankAccountName" {...form.register("bankAccountName")} placeholder="e.g., John Doe" />
                </div>
              </div>
            </div>

            {/* Personal Dates */}
            <div className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">Personal Information</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dob-month">Date of Birth</Label>
                  <BirthdayInput
                    birthday={form.watch("birthday") || ""}
                    birthYear={form.watch("birthYear") || ""}
                    onChange={({ birthday, birthYear }) => {
                      form.setValue("birthday", birthday)
                      form.setValue("birthYear", birthYear)
                    }}
                  />
                  <p className="text-muted-foreground text-xs">Year is optional — leave it blank if you prefer.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employmentDate">Employment Date</Label>
                  <Input id="employmentDate" type="date" {...form.register("employmentDate")} />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 border-t pt-6">
              <Button type="submit" loading={isLoading}>
                Save Changes
              </Button>
              {!hideBackButton && (
                <Link href="/profile">
                  <Button variant="outline">Back to Home</Button>
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
