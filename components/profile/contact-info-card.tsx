import { formatWATDate } from "@/lib/utils/date"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getRoleBadgeColor, getRoleDisplayName } from "@/lib/permissions"
import type { UserRole } from "@/types/database"

interface ContactInfoCardProps {
  profile: {
    first_name?: string | null
    last_name?: string | null
    other_names?: string | null
    company_email?: string | null
    additional_email?: string | null
    phone_number?: string | null
    office_location?: string | null
    residential_address?: string | null
    employment_date?: string | null
    birthday?: string | null
    additional_phone?: string | null
    designation?: string | null
    department?: string | null
    role: string
    is_department_lead?: boolean | null
  }
}

interface FieldProps {
  label: string
  children: React.ReactNode
  full?: boolean
}

function Field({ label, children, full }: FieldProps) {
  return (
    <div className={`space-y-1 ${full ? "sm:col-span-2" : ""}`}>
      <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  )
}

export function ContactInfoCard({ profile }: ContactInfoCardProps) {
  const employmentDate = profile.employment_date ? new Date(profile.employment_date) : null
  const daysAtAcob = employmentDate ? Math.floor((Date.now() - employmentDate.getTime()) / (1000 * 60 * 60 * 24)) : null

  // birthday is stored as MM-DD (no year) — format to "Month Day"
  let birthdayLabel: string | null = null
  if (profile.birthday) {
    const [mm, dd] = profile.birthday.split("-").map((n) => parseInt(n, 10))
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      birthdayLabel = formatWATDate(new Date(2000, mm - 1, dd), { month: "long", day: "numeric" })
    }
  }

  return (
    <Card>
      <CardHeader className="pt-4 pb-1">
        <CardTitle className="text-sm">Contact Information</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {profile.designation && <Field label="Designation">{profile.designation}</Field>}
          {profile.department && <Field label="Department">{profile.department}</Field>}
          <Field label="Role">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className={getRoleBadgeColor(profile.role as UserRole)}>
                {getRoleDisplayName(profile.role as UserRole)}
              </Badge>
              {profile.is_department_lead && (
                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                  Dept Lead
                </Badge>
              )}
            </div>
          </Field>
          {profile.company_email && (
            <Field label="Email" full>
              <span className="break-all">{profile.company_email}</span>
              {profile.additional_email && (
                <span className="text-muted-foreground ml-1.5 text-xs break-all">({profile.additional_email})</span>
              )}
            </Field>
          )}
          {profile.phone_number && (
            <Field label="Phone">
              {profile.phone_number}
              {profile.additional_phone && (
                <span className="text-muted-foreground ml-1.5 text-xs">({profile.additional_phone})</span>
              )}
            </Field>
          )}
          {birthdayLabel && <Field label="Birthday">{birthdayLabel}</Field>}
          {profile.office_location && <Field label="Office">{profile.office_location}</Field>}
          {profile.residential_address && (
            <Field label="Address" full>
              {profile.residential_address}
            </Field>
          )}
          {employmentDate && (
            <Field label="Joined">
              {formatWATDate(employmentDate, { month: "long", day: "numeric", year: "numeric" })}
            </Field>
          )}
          {daysAtAcob !== null && <Field label="Tenure">{daysAtAcob} days</Field>}
        </dl>
      </CardContent>
    </Card>
  )
}
