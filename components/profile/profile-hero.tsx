"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Edit, Briefcase, Building2, Clock } from "lucide-react"
import { formatName } from "@/lib/utils"
import { getRoleBadgeColor, getRoleDisplayName } from "@/lib/permissions"
import type { UserRole } from "@/types/database"

interface ProfileHeroProps {
  profile: {
    id: string
    first_name?: string | null
    last_name?: string | null
    other_names?: string | null
    designation?: string | null
    department?: string | null
    role: string
    is_department_lead?: boolean | null
    employment_date?: string | null
  }
  onEdit: () => void
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase()
}

export function ProfileHero({ profile, onEdit }: ProfileHeroProps) {
  const employmentDate = profile.employment_date ? new Date(profile.employment_date) : null
  const daysAtAcob = employmentDate ? Math.floor((Date.now() - employmentDate.getTime()) / (1000 * 60 * 60 * 24)) : null

  return (
    <Card className="relative overflow-hidden">
      <Button
        onClick={onEdit}
        variant="outline"
        size="sm"
        className="bg-background/80 absolute top-3 right-3 z-10 gap-2 backdrop-blur-sm sm:top-4 sm:right-4"
      >
        <Edit className="h-4 w-4" />
        <span className="hidden sm:inline">Edit Profile</span>
      </Button>

      <div className="bg-primary/10 h-20 sm:h-28 md:h-36 lg:h-44" />

      <CardContent className="relative px-4 pb-4 sm:px-6 sm:pb-6">
        <div className="-mt-10 flex items-end gap-3 sm:-mt-14 sm:gap-4 md:-mt-16 lg:-mt-20 lg:gap-6">
          <Avatar className="border-background h-20 w-20 border-4 shadow-lg sm:h-28 sm:w-28 md:h-32 md:w-32 lg:h-40 lg:w-40">
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold sm:text-3xl md:text-4xl lg:text-5xl">
              {getInitials(profile.first_name, profile.last_name)}
            </AvatarFallback>
          </Avatar>
          <div className="pb-1 sm:pb-2 lg:pb-4">
            <h1 className="text-lg font-bold sm:text-xl md:text-2xl lg:text-3xl">
              {formatName(profile.first_name)}
              {profile.other_names && ` ${formatName(profile.other_names)}`}
              {` ${formatName(profile.last_name)}`}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:gap-x-4">
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs sm:text-sm md:text-base lg:text-lg">
                <Briefcase className="h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
                {profile.designation || "employee Member"}
              </p>
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs sm:text-sm md:text-base lg:text-lg">
                <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
                {profile.department || "Unassigned Department"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={getRoleBadgeColor(profile.role as UserRole)}>
            {getRoleDisplayName(profile.role as UserRole)}
          </Badge>

          {profile.is_department_lead && (
            <div className="flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5">
              <div className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Department Lead</span>
            </div>
          )}

          <Badge variant="outline" className="text-muted-foreground">
            <Clock className="mr-1 h-3 w-3" />
            {daysAtAcob !== null ? `${daysAtAcob} days at ACOB` : "Set join date"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
