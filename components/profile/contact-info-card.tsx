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
    phone_number?: string | null
    office_location?: string | null
    residential_address?: string | null
    employment_date?: string | null
    additional_phone?: string | null
    designation?: string | null
    department?: string | null
    role: string
    is_department_lead?: boolean | null
  }
}

interface RowProps {
  label: string
  children: React.ReactNode
}

function Row({ label, children }: RowProps) {
  return (
    <div className="flex items-start px-4 py-2.5">
      <dt className="text-muted-foreground w-32 shrink-0 border-r pt-px pr-3 text-xs">{label}</dt>
      <dd className="min-w-0 flex-1 pl-3 text-sm font-medium">{children}</dd>
    </div>
  )
}

export function ContactInfoCard({ profile }: ContactInfoCardProps) {
  const employmentDate = profile.employment_date ? new Date(profile.employment_date) : null
  const daysAtAcob = employmentDate ? Math.floor((Date.now() - employmentDate.getTime()) / (1000 * 60 * 60 * 24)) : null

  return (
    <Card>
      <CardHeader className="pt-4 pb-1">
        <CardTitle className="text-sm">Contact Information</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <dl className="divide-y">
          {profile.designation && (
            <Row label="Designation">
              <span className="block truncate">{profile.designation}</span>
            </Row>
          )}
          {profile.department && (
            <Row label="Department">
              <span className="block truncate">{profile.department}</span>
            </Row>
          )}
          <Row label="Role">
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
          </Row>
          {profile.company_email && (
            <Row label="Email">
              <span className="text-xs break-all sm:text-sm">{profile.company_email}</span>
            </Row>
          )}
          {profile.phone_number && <Row label="Phone">{profile.phone_number}</Row>}
          {profile.additional_phone && <Row label="Alt. Phone">{profile.additional_phone}</Row>}
          {profile.office_location && (
            <Row label="Office">
              <span className="block truncate">{profile.office_location}</span>
            </Row>
          )}
          {profile.residential_address && (
            <Row label="Address">
              <span className="block truncate">{profile.residential_address}</span>
            </Row>
          )}
          {employmentDate && (
            <Row label="Joined">
              {formatWATDate(employmentDate, { month: "long", day: "numeric", year: "numeric" })}
            </Row>
          )}
          {daysAtAcob !== null && <Row label="Tenure">{daysAtAcob} days</Row>}
        </dl>
      </CardContent>
    </Card>
  )
}
