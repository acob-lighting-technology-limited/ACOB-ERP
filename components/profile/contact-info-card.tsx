import { formatWATDate, formatBirthdayLabel } from "@/lib/utils/date"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getRoleBadgeColor, getRoleDisplayName } from "@/lib/permissions"
import type { UserRole } from "@/types/database"
import { BriefcaseBusiness, Building2, CalendarDays, Cake, Home, Mail, MapPin, Phone, ShieldCheck } from "lucide-react"

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

interface DetailItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}

function DetailItem({ icon: Icon, label, children }: DetailItemProps) {
  return (
    <div className="group bg-background/60 hover:bg-muted/40 flex min-w-0 gap-3 rounded-md border p-3 transition-colors">
      <div className="bg-primary/10 text-primary mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 space-y-1">
        <dt className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{label}</dt>
        <dd className="text-sm leading-5 font-medium break-words">{children}</dd>
      </div>
    </div>
  )
}

export function ContactInfoCard({ profile }: ContactInfoCardProps) {
  const employmentDate = profile.employment_date ? new Date(profile.employment_date) : null
  const daysAtAcob = employmentDate ? Math.floor((Date.now() - employmentDate.getTime()) / (1000 * 60 * 60 * 24)) : null

  const birthdayLabel = formatBirthdayLabel(profile.birthday)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/30 border-b px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Profile Details</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">Role, contact, workplace and personal information.</p>
          </div>
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
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <dl className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {profile.designation && (
            <DetailItem icon={BriefcaseBusiness} label="Designation">
              {profile.designation}
            </DetailItem>
          )}
          {profile.department && (
            <DetailItem icon={Building2} label="Department">
              {profile.department}
            </DetailItem>
          )}
          <DetailItem icon={ShieldCheck} label="Access Level">
            <span>{getRoleDisplayName(profile.role as UserRole)}</span>
            {profile.is_department_lead && (
              <span className="text-muted-foreground ml-1.5 text-xs">Department Lead</span>
            )}
          </DetailItem>
          {profile.company_email && (
            <DetailItem icon={Mail} label="Email">
              <a className="hover:text-primary break-all transition-colors" href={`mailto:${profile.company_email}`}>
                {profile.company_email}
              </a>
              {profile.additional_email && (
                <span className="text-muted-foreground block text-xs break-all">{profile.additional_email}</span>
              )}
            </DetailItem>
          )}
          {profile.phone_number && (
            <DetailItem icon={Phone} label="Phone">
              <a className="hover:text-primary transition-colors" href={`tel:${profile.phone_number}`}>
                {profile.phone_number}
              </a>
              {profile.additional_phone && (
                <span className="text-muted-foreground block text-xs">{profile.additional_phone}</span>
              )}
            </DetailItem>
          )}
          {birthdayLabel && (
            <DetailItem icon={Cake} label="Birthday">
              {birthdayLabel}
            </DetailItem>
          )}
          {profile.office_location && (
            <DetailItem icon={MapPin} label="Office">
              {profile.office_location}
            </DetailItem>
          )}
          {profile.residential_address && (
            <DetailItem icon={Home} label="Address">
              {profile.residential_address}
            </DetailItem>
          )}
          {employmentDate && (
            <DetailItem icon={CalendarDays} label="Joined">
              {formatWATDate(employmentDate, { month: "long", day: "numeric", year: "numeric" })}
            </DetailItem>
          )}
          {daysAtAcob !== null && (
            <DetailItem icon={CalendarDays} label="Tenure">
              {daysAtAcob.toLocaleString()} days
            </DetailItem>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}
