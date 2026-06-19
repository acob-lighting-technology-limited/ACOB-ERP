"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Edit, Building2, MapPin, CalendarDays, Mail, Phone } from "lucide-react"
import { formatName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
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
    office_location?: string | null
    company_email?: string | null
    phone_number?: string | null
    employment_date?: string | null
    role: string
    is_department_lead?: boolean | null
  }
  onEdit: () => void
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase()
}

function getTenureLabel(employmentDate?: string | null): string | null {
  if (!employmentDate) return null
  const ms = Date.now() - new Date(employmentDate).getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  return months > 0 ? `${years}y ${months}mo` : `${years}y`
}

export function ProfileHero({ profile, onEdit }: ProfileHeroProps) {
  const fullName = [formatName(profile.first_name), formatName(profile.other_names), formatName(profile.last_name)]
    .filter(Boolean)
    .join(" ")

  const tenure = getTenureLabel(profile.employment_date)
  const joinedDate = profile.employment_date
    ? formatWATDate(new Date(profile.employment_date), { month: "short", year: "numeric" })
    : null

  return (
    <Card className="overflow-hidden">
      {/* Gradient banner */}
      <div className="from-primary/20 via-primary/10 h-16 bg-gradient-to-r to-transparent sm:h-20" />

      <CardContent className="px-4 pb-4 sm:px-6 sm:pb-5">
        {/* Avatar row */}
        <div className="-mt-10 mb-3 flex items-end justify-between sm:-mt-12">
          <Avatar className="border-background ring-primary/20 h-20 w-20 border-4 shadow-md ring-2 sm:h-24 sm:w-24">
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold sm:text-3xl">
              {getInitials(profile.first_name, profile.last_name)}
            </AvatarFallback>
          </Avatar>

          <Button onClick={onEdit} variant="outline" size="sm" className="shrink-0 gap-1.5">
            <Edit className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>

        {/* Name & Title */}
        <div className="mb-3 space-y-1">
          <h1 className="text-xl leading-tight font-bold sm:text-2xl">{fullName || "—"}</h1>
          {profile.designation && <p className="text-muted-foreground text-sm font-medium">{profile.designation}</p>}

          {/* Role badges */}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Badge variant="outline" className={`text-xs ${getRoleBadgeColor(profile.role as UserRole)}`}>
              {getRoleDisplayName(profile.role as UserRole)}
            </Badge>
            {profile.is_department_lead && (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-xs text-amber-600">
                Dept Lead
              </Badge>
            )}
          </div>
        </div>

        {/* Compact meta row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {profile.department && (
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              {profile.department}
            </span>
          )}
          {profile.office_location && (
            <span className="text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {profile.office_location}
            </span>
          )}
          {joinedDate && (
            <span className="text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              Joined {joinedDate}
              {tenure && <span className="text-xs opacity-60">({tenure})</span>}
            </span>
          )}
          {profile.company_email && (
            <a
              href={`mailto:${profile.company_email}`}
              className="text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              {profile.company_email}
            </a>
          )}
          {profile.phone_number && (
            <a
              href={`tel:${profile.phone_number}`}
              className="text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors"
            >
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {profile.phone_number}
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
