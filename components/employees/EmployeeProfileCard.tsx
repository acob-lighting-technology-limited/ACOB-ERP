import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { User, Mail, Phone, Building2, MapPin, Shield, Calendar } from "lucide-react"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { formatWATDate } from "@/lib/utils/date"
import type { UserRole } from "@/types/database"
import type { UserProfile } from "./employee-detail-types"

interface EmployeeProfileCardProps {
  profile: UserProfile
  fullName: string
  initials: string
}

export function EmployeeProfileCard({ profile, fullName, initials }: EmployeeProfileCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Profile Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary text-primary-foreground">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-muted-foreground text-sm">Full Name</p>
              <p className="font-medium">{fullName}</p>
              {profile.other_names && <p className="text-muted-foreground text-xs">({profile.other_names})</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Mail className="text-muted-foreground h-5 w-5" />
            <div>
              <p className="text-muted-foreground text-sm">Email</p>
              <p className="font-medium">{profile.company_email}</p>
            </div>
          </div>

          {profile.personal_email && (
            <div className="flex items-center gap-3">
              <Mail className="text-muted-foreground h-5 w-5" />
              <div>
                <p className="text-muted-foreground text-sm">Personal Email</p>
                <p className="font-medium">{profile.personal_email}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Building2 className="text-muted-foreground h-5 w-5" />
            <div>
              <p className="text-muted-foreground text-sm">Department</p>
              <p className="font-medium">{profile.department || "N/A"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Shield className="text-muted-foreground h-5 w-5" />
            <div>
              <p className="text-muted-foreground text-sm">Role</p>
              <div className="mt-1 flex gap-2">
                <Badge className={getRoleBadgeColor(profile.role as UserRole)}>
                  {getRoleDisplayName(profile.role as UserRole)}
                </Badge>
                {profile.is_department_lead && <Badge variant="outline">Department Lead</Badge>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <User className="text-muted-foreground h-5 w-5" />
            <div>
              <p className="text-muted-foreground text-sm">Designation</p>
              <p className="font-medium">{profile.designation || "N/A"}</p>
            </div>
          </div>

          {profile.phone_number && (
            <div className="flex items-center gap-3">
              <Phone className="text-muted-foreground h-5 w-5" />
              <div>
                <p className="text-muted-foreground text-sm">Phone</p>
                <p className="font-medium">{profile.phone_number}</p>
                {profile.additional_phone && (
                  <p className="text-muted-foreground text-xs">{profile.additional_phone}</p>
                )}
              </div>
            </div>
          )}

          {profile.residential_address && (
            <div className="flex items-center gap-3">
              <MapPin className="text-muted-foreground h-5 w-5" />
              <div>
                <p className="text-muted-foreground text-sm">Address</p>
                <p className="font-medium">{profile.residential_address}</p>
              </div>
            </div>
          )}

          {profile.office_location && (
            <div className="flex items-center gap-3">
              <MapPin className="text-muted-foreground h-5 w-5" />
              <div>
                <p className="text-muted-foreground text-sm">Office / Room</p>
                <p className="font-medium">{profile.office_location}</p>
              </div>
            </div>
          )}

          {profile.lead_departments && profile.lead_departments.length > 0 && (
            <div className="flex items-center gap-3">
              <Building2 className="text-muted-foreground h-5 w-5" />
              <div>
                <p className="text-muted-foreground text-sm">Leading Departments</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {profile.lead_departments.map((dept) => (
                    <Badge key={dept} variant="outline">
                      {dept}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Calendar className="text-muted-foreground h-5 w-5" />
            <div>
              <p className="text-muted-foreground text-sm">Member Since</p>
              <p className="font-medium">{formatWATDate(profile.created_at)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
