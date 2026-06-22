"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Edit, Building2, MapPin, CalendarDays, Mail, Phone, Cake, Home, ShieldCheck } from "lucide-react"
import { formatName } from "@/lib/utils"
import { formatWATDate, formatBirthdayLabel } from "@/lib/utils/date"
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
    additional_email?: string | null
    phone_number?: string | null
    additional_phone?: string | null
    birthday?: string | null
    residential_address?: string | null
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

  const birthdayLabel = formatBirthdayLabel(profile.birthday)

  return (
    <Card className="overflow-hidden border shadow-lg transition-all duration-300 dark:border-zinc-800">
      {/* Reverted to Old Green Gradient Banner & Moved Edit Button to Top Right of Banner */}
      <div className="from-primary/20 via-primary/10 relative h-24 bg-gradient-to-r to-transparent sm:h-32">
        <div className="absolute top-4 right-4 z-10 sm:top-6 sm:right-6">
          <Button
            onClick={onEdit}
            variant="outline"
            size="sm"
            className="border-primary/20 bg-background/80 hover:bg-background gap-1.5 shadow-sm backdrop-blur-sm"
          >
            <Edit className="text-primary h-3.5 w-3.5" />
            <span className="text-foreground">Edit Profile</span>
          </Button>
        </div>
      </div>

      <CardContent className="relative px-6 pb-6">
        {/* Responsive Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          {/* Column 1: Avatar, Name, Designation & Badges */}
          <div className="-mt-12 flex flex-col items-center text-center lg:-mt-16 lg:items-start lg:text-left">
            <Avatar className="border-background ring-primary/10 h-24 w-24 border-4 shadow-xl ring-2 sm:h-32 sm:w-32 lg:h-36 lg:w-36">
              <AvatarFallback className="bg-primary text-primary-foreground text-3xl font-bold lg:text-4xl">
                {getInitials(profile.first_name, profile.last_name)}
              </AvatarFallback>
            </Avatar>

            <div className="mt-4 space-y-2">
              <h1 className="text-foreground text-2xl leading-tight font-bold tracking-tight sm:text-3xl">
                {fullName || "—"}
              </h1>
              {profile.designation && (
                <p className="text-muted-foreground text-sm font-semibold sm:text-base">{profile.designation}</p>
              )}

              <div className="flex flex-wrap justify-center gap-1.5 pt-1 lg:justify-start">
                <Badge
                  variant="outline"
                  className={`px-2.5 py-0.5 text-xs font-semibold ${getRoleBadgeColor(profile.role as UserRole)}`}
                >
                  {getRoleDisplayName(profile.role as UserRole)}
                </Badge>
                {profile.is_department_lead && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400"
                  >
                    Dept Lead
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Columns 2 & 3: Info Grid */}
          <div className="lg:col-span-2 lg:pt-4">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {/* Professional details */}
              <div className="space-y-4">
                <h2 className="text-muted-foreground/80 border-b pb-2 text-xs font-bold tracking-wider uppercase">
                  Professional Details
                </h2>
                <div className="space-y-3">
                  {profile.department && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <Building2 className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                          Department
                        </span>
                        <span className="text-foreground font-medium">{profile.department}</span>
                      </div>
                    </div>
                  )}
                  {profile.office_location && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <MapPin className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                          Office Location
                        </span>
                        <span className="text-foreground font-medium">{profile.office_location}</span>
                      </div>
                    </div>
                  )}
                  {joinedDate && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <CalendarDays className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                          Joined Date
                        </span>
                        <span className="text-foreground font-medium">
                          {joinedDate}{" "}
                          {tenure && <span className="text-muted-foreground text-xs font-normal">({tenure})</span>}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-2.5 text-sm">
                    <ShieldCheck className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                        Access & Role
                      </span>
                      <span className="text-foreground font-medium">
                        {getRoleDisplayName(profile.role as UserRole)}
                        {profile.is_department_lead && (
                          <span className="text-muted-foreground font-normal"> · Dept Lead</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact & Personal details */}
              <div className="space-y-4">
                <h2 className="text-muted-foreground/80 border-b pb-2 text-xs font-bold tracking-wider uppercase">
                  Contact & Personal Details
                </h2>
                <div className="space-y-3">
                  {profile.company_email && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <Mail className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                          Email Address
                        </span>
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                          <a
                            href={`mailto:${profile.company_email}`}
                            className="text-foreground hover:text-primary font-medium break-all transition-colors"
                          >
                            {profile.company_email}
                          </a>
                          {profile.additional_email && (
                            <span className="text-muted-foreground text-xs font-normal break-all">
                              ({profile.additional_email})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {(profile.phone_number || profile.additional_phone) && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <Phone className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                          Phone Number
                        </span>
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                          {profile.phone_number ? (
                            <a
                              href={`tel:${profile.phone_number}`}
                              className="text-foreground hover:text-primary font-medium transition-colors"
                            >
                              {profile.phone_number}
                            </a>
                          ) : (
                            <span className="text-foreground font-medium">—</span>
                          )}
                          {profile.additional_phone && (
                            <span className="text-muted-foreground text-xs font-normal">
                              ({profile.additional_phone})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {birthdayLabel && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <Cake className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                          Birthday
                        </span>
                        <span className="text-foreground font-medium">{birthdayLabel}</span>
                      </div>
                    </div>
                  )}
                  {profile.residential_address && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <Home className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <span className="text-muted-foreground/70 block text-[11px] font-bold tracking-wide uppercase">
                          Residential Address
                        </span>
                        <span className="text-foreground block leading-tight font-medium break-words">
                          {profile.residential_address}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
