"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Edit } from "lucide-react"
import { formatName } from "@/lib/utils"

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

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good Morning"
  if (hour < 17) return "Good Afternoon"
  return "Good Evening"
}

export function ProfileHero({ profile, onEdit }: ProfileHeroProps) {
  const firstName = formatName(profile.first_name) || "there"

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="border-background h-24 w-24 border-4 shadow-md sm:h-28 sm:w-28 lg:h-32 lg:w-32">
              <AvatarFallback className="bg-primary text-primary-foreground text-3xl font-bold sm:text-4xl">
                {getInitials(profile.first_name, profile.last_name)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 space-y-3">
              <div>
                <h1 className="text-2xl leading-tight font-bold sm:text-3xl lg:text-4xl">
                  {getGreeting()}, {firstName}
                </h1>
                <p className="text-muted-foreground mt-2 text-sm sm:text-base">Welcome back to your workspace.</p>
              </div>
            </div>
          </div>

          <Button onClick={onEdit} variant="outline" size="sm" className="w-full gap-2 sm:w-auto">
            <Edit className="h-4 w-4" />
            Edit Profile
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
