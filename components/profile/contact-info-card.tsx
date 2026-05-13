import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Mail, Phone, MapPin, Calendar } from "lucide-react"

interface ContactInfoCardProps {
  profile: {
    company_email?: string | null
    phone_number?: string | null
    office_location?: string | null
    residential_address?: string | null
    employment_date?: string | null
    additional_phone?: string | null
  }
}

export function ContactInfoCard({ profile }: ContactInfoCardProps) {
  const employmentDate = profile.employment_date ? new Date(profile.employment_date) : null

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Contact Information</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
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
