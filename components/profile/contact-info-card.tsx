import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Briefcase, Building2, Calendar, Clock, Mail, MapPin, Phone, ShieldCheck } from "lucide-react"
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

export function ContactInfoCard({ profile }: ContactInfoCardProps) {
  const employmentDate = profile.employment_date ? new Date(profile.employment_date) : null
  const daysAtAcob = employmentDate ? Math.floor((Date.now() - employmentDate.getTime()) / (1000 * 60 * 60 * 24)) : null

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Contact Information</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <Briefcase className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Designation</p>
              <p className="truncate text-xs font-medium sm:text-sm">{profile.designation || "Employee Member"}</p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <Building2 className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Department</p>
              <p className="truncate text-xs font-medium sm:text-sm">{profile.department || "Unassigned Department"}</p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <ShieldCheck className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Role</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={getRoleBadgeColor(profile.role as UserRole)}>
                  {getRoleDisplayName(profile.role as UserRole)}
                </Badge>
                {profile.is_department_lead && (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                    Department Lead
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <Mail className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Email</p>
              <p className="truncate text-xs font-medium sm:text-sm">{profile.company_email}</p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <Phone className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Phone</p>
              <p className="truncate text-xs font-medium sm:text-sm">{profile.phone_number || "Not set"}</p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <MapPin className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Office Location</p>
              <p className="truncate text-xs font-medium sm:text-sm">{profile.office_location || "Not set"}</p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <MapPin className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Residential Address</p>
              <p className="truncate text-xs font-medium sm:text-sm">{profile.residential_address || "Not set"}</p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <Calendar className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Joined ACOB</p>
              <p className="truncate text-xs font-medium sm:text-sm">
                {employmentDate
                  ? employmentDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                  : "Not set - Edit profile to add"}
              </p>
            </div>
          </div>

          <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
            <Clock className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] sm:text-xs">Tenure</p>
              <p className="truncate text-xs font-medium sm:text-sm">
                {daysAtAcob !== null ? `${daysAtAcob} days at ACOB` : "Set join date"}
              </p>
            </div>
          </div>

          {profile.additional_phone && (
            <div className="bg-muted/50 flex items-center gap-2 rounded-lg p-2.5 sm:gap-3 sm:p-3">
              <Phone className="text-muted-foreground h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
              <div className="min-w-0">
                <p className="text-muted-foreground text-[10px] sm:text-xs">Additional Phone</p>
                <p className="truncate text-xs font-medium sm:text-sm">{profile.additional_phone}</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
