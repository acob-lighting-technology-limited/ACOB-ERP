import { formatBirthdayLabel } from "@/lib/utils/date"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Cake, Home, Mail, Phone, ShieldCheck } from "lucide-react"
import { getRoleDisplayName } from "@/lib/permissions"
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

interface InlineItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}

function InlineItem({ icon: Icon, label, children }: InlineItemProps) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 text-sm">
      <div className="text-muted-foreground mt-0.5 shrink-0">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <span className="text-muted-foreground mb-0.5 block text-[11px] leading-none font-semibold tracking-wide uppercase">
          {label}
        </span>
        <span className="leading-snug font-medium break-words">{children}</span>
      </div>
    </div>
  )
}

export function ContactInfoCard({ profile }: ContactInfoCardProps) {
  const birthdayLabel = formatBirthdayLabel(profile.birthday)

  // Collect only the "secondary" details not already shown in the hero
  const hasSecondaryInfo = !!(
    profile.additional_email ||
    profile.additional_phone ||
    birthdayLabel ||
    profile.residential_address
  )

  if (!hasSecondaryInfo) return null

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-2 sm:px-5">
        <CardTitle className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          Additional Details
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-5">
        <div className="divide-y">
          {profile.additional_email && (
            <InlineItem icon={Mail} label="Secondary Email">
              <a className="hover:text-primary break-all transition-colors" href={`mailto:${profile.additional_email}`}>
                {profile.additional_email}
              </a>
            </InlineItem>
          )}
          {profile.additional_phone && (
            <InlineItem icon={Phone} label="Secondary Phone">
              <a className="hover:text-primary transition-colors" href={`tel:${profile.additional_phone}`}>
                {profile.additional_phone}
              </a>
            </InlineItem>
          )}
          {birthdayLabel && (
            <InlineItem icon={Cake} label="Birthday">
              {birthdayLabel}
            </InlineItem>
          )}
          {profile.residential_address && (
            <InlineItem icon={Home} label="Residential Address">
              {profile.residential_address}
            </InlineItem>
          )}
          <InlineItem icon={ShieldCheck} label="Access Level">
            {getRoleDisplayName(profile.role as UserRole)}
            {profile.is_department_lead && (
              <span className="text-muted-foreground ml-2 text-xs">· Department Lead</span>
            )}
          </InlineItem>
        </div>
      </CardContent>
    </Card>
  )
}
