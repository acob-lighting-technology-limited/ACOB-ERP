"use client"

import { formatWATDate } from "@/lib/utils/date"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eye, User, Building2, Briefcase, Calendar } from "lucide-react"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { formatName } from "@/lib/utils"
import type { UserRole } from "@/types/database"

interface Profile {
  id: string
  first_name: string
  last_name: string
  company_email: string
  department: string
  designation: string | null
  phone_number: string | null
  role: UserRole
  job_description: string | null
  job_description_updated_at: string | null
  created_at: string
}

function getCompletionColor(hasDescription: boolean): string {
  return hasDescription
    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "Never"
  return formatWATDate(dateString, { month: "short", day: "numeric", year: "numeric" })
}

interface JobDescriptionCardViewProps {
  profiles: Profile[]
  onView: (profile: Profile) => void
}

export function JobDescriptionCardView({ profiles, onView }: JobDescriptionCardViewProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {profiles.map((profile) => (
        <Card key={profile.id} className="border-2 transition-shadow hover:shadow-lg">
          <CardHeader className="from-primary/5 to-background border-b bg-gradient-to-r">
            <div className="flex items-start justify-between">
              <div className="flex flex-1 items-start gap-3">
                <div className="bg-primary/10 rounded-lg p-2">
                  <User className="text-primary h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-lg">
                    {formatName(profile.last_name)}, {formatName(profile.first_name)}
                  </CardTitle>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge className={getCompletionColor(!!profile.job_description)}>
                      {profile.job_description ? "Completed" : "Pending"}
                    </Badge>
                    <Badge className={getRoleBadgeColor(profile.role)}>{getRoleDisplayName(profile.role)}</Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4" />
              <span>{profile.department}</span>
            </div>

            {profile.designation && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Briefcase className="h-4 w-4" />
                <span>{profile.designation}</span>
              </div>
            )}

            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4" />
              <span>Updated: {formatDate(profile.job_description_updated_at)}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onView(profile)}
              className="w-full gap-2"
              disabled={!profile.job_description}
            >
              <Eye className="h-4 w-4" />
              {profile.job_description ? "View Description" : "No Description"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
