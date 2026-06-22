"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { toast } from "sonner"
import { ProfileHero } from "@/components/profile/profile-hero"
import { ProfileEditDialog } from "@/components/profile/profile-edit-dialog"
import { ActivityTabs } from "@/components/profile/activity-tabs"
import {
  PersonalRecentActivityFeed,
  type PersonalRecentActivityItem,
} from "@/components/profile/personal-recent-activity-feed"
import type {
  UserProfile,
  Task,
  Asset,
  Documentation,
  Feedback,
  CorrespondenceItem,
  HelpDeskItem,
  PaymentItem,
  LeaveItem,
  AttendanceItem,
} from "./page"

interface ProfileContentProps {
  profile: UserProfile | null
  tasks: Task[]
  assets: Asset[]
  documentation: Documentation[]
  feedback: Feedback[]
  correspondence: CorrespondenceItem[]
  helpDesk: HelpDeskItem[]
  payments: PaymentItem[]
  leave: LeaveItem[]
  attendance: AttendanceItem[]
  recentActivity: PersonalRecentActivityItem[]
  initialError?: string | null
}

export function ProfileContent({
  profile,
  tasks,
  assets,
  documentation,
  feedback,
  correspondence,
  helpDesk,
  payments,
  leave,
  attendance,
  recentActivity,
  initialError,
}: ProfileContentProps) {
  const [isEditOpen, setIsEditOpen] = useState(false)

  useEffect(() => {
    if (initialError) {
      toast.error(initialError)
    }
  }, [initialError])

  if (!profile) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">Profile not found</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-full space-y-6 p-4 md:p-6 lg:p-8">
      <ProfileHero profile={profile} onEdit={() => setIsEditOpen(true)} />

      {/* 2-column equal-width dashboard layout on desktop */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ActivityTabs
          tasks={tasks}
          assets={assets}
          documentation={documentation}
          feedback={feedback}
          correspondence={correspondence}
          helpDesk={helpDesk}
          payments={payments}
          leave={leave}
          attendance={attendance}
        />

        <PersonalRecentActivityFeed activity={recentActivity} />
      </div>

      <ProfileEditDialog open={isEditOpen} onOpenChange={setIsEditOpen} profile={profile} />
    </div>
  )
}
