"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { toast } from "sonner"
import { ProfileHero } from "@/components/profile/profile-hero"
import { ProfileEditDialog } from "@/components/profile/profile-edit-dialog"
import { NeedsAttention } from "@/components/profile/needs-attention"
import { MyTasksCard, OpenItemsCard, AssetsCard } from "@/components/profile/work-lists"
import {
  PersonalRecentActivityFeed,
  type PersonalRecentActivityItem,
} from "@/components/profile/personal-recent-activity-feed"
import type {
  UserProfile,
  Task,
  Asset,
  CorrespondenceItem,
  HelpDeskItem,
  PaymentItem,
  LeaveItem,
  AttendanceItem,
} from "./page"

const MAX_ACTIVITY_ENTRIES = 12

interface ProfileContentProps {
  profile: UserProfile | null
  avatarUrl: string | null
  tasks: Task[]
  assets: Asset[]
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
  avatarUrl: initialAvatarUrl,
  tasks,
  assets,
  correspondence,
  helpDesk,
  payments,
  leave,
  attendance,
  recentActivity,
  initialError,
}: ProfileContentProps) {
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl)

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
    <div className="container mx-auto max-w-7xl space-y-6 p-4 md:p-6 lg:p-8">
      <ProfileHero
        profile={profile}
        avatarUrl={avatarUrl}
        attendance={attendance}
        onAvatarChange={setAvatarUrl}
        onEdit={() => setIsEditOpen(true)}
      />

      <NeedsAttention
        tasks={tasks}
        leave={leave}
        helpDesk={helpDesk}
        correspondence={correspondence}
        payments={payments}
      />

      {/* Work first (2/3), secondary context in the rail (1/3) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <MyTasksCard tasks={tasks} />
          <OpenItemsCard helpDesk={helpDesk} correspondence={correspondence} leave={leave} />
        </div>

        <div className="space-y-6">
          <AssetsCard assets={assets} />
          <PersonalRecentActivityFeed activity={recentActivity.slice(0, MAX_ACTIVITY_ENTRIES)} className="h-[400px]" />
        </div>
      </div>

      <ProfileEditDialog open={isEditOpen} onOpenChange={setIsEditOpen} profile={profile} />
    </div>
  )
}
