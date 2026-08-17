"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Pencil, Mail, Phone, Cake, Home, Camera, Trash2, Loader2 } from "lucide-react"
import { formatName, cn } from "@/lib/utils"
import { formatWATDate, formatBirthdayLabel, toLocalISODate } from "@/lib/utils/date"
import { getRoleBadgeColor, getRoleDisplayName } from "@/lib/permissions"
import { apiFetch } from "@/lib/api-client"
import type { UserRole } from "@/types/database"
import type { AttendanceItem } from "@/app/(app)/profile/page"

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
  avatarUrl?: string | null
  attendance: AttendanceItem[]
  onAvatarChange?: (url: string | null) => void
  onEdit: () => void
}

const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  present: "Present",
  late: "Late",
  lateness_with_permission: "Late (Excused)",
  absent: "Absent",
  absent_with_permission: "Absent (Excused)",
  on_leave: "On Leave",
  out_of_station: "Out of Station",
  incomplete: "Clocked In",
  waiver: "Waived",
}

const ATTENDANCE_DOT_COLORS: Record<string, string> = {
  present: "bg-green-500",
  late: "bg-amber-500",
  lateness_with_permission: "bg-amber-500",
  absent: "bg-red-500",
  absent_with_permission: "bg-amber-500",
  on_leave: "bg-blue-500",
  out_of_station: "bg-blue-500",
  incomplete: "bg-green-500",
  waiver: "bg-muted-foreground",
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase()
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
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

function AttendanceChip({ attendance }: { attendance: AttendanceItem[] }) {
  const todayIso = toLocalISODate()
  const today = attendance.find((record) => record.date === todayIso) || null

  const label = today ? (ATTENDANCE_STATUS_LABELS[today.status] ?? today.status) : "Not clocked in"
  const dotColor = today ? (ATTENDANCE_DOT_COLORS[today.status] ?? "bg-muted-foreground") : "bg-muted-foreground"
  const clockIn = today?.clock_in ? String(today.clock_in).slice(0, 5) : null

  return (
    <Link
      href="/attendance"
      className="bg-background/60 hover:bg-accent flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
      title="View attendance"
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotColor)} aria-hidden="true" />
      <span>{label}</span>
      {clockIn && <span className="text-muted-foreground">· in {clockIn}</span>}
    </Link>
  )
}

export function ProfileHero({ profile, avatarUrl, attendance, onAvatarChange, onEdit }: ProfileHeroProps) {
  const fullName = [formatName(profile.first_name), formatName(profile.other_names), formatName(profile.last_name)]
    .filter(Boolean)
    .join(" ")

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isLightboxOpen, setIsLightboxOpen] = useState(false)
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false)

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const response = await apiFetch("/api/profile/avatar", { method: "POST", body: formData })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to upload photo")
      }
      onAvatarChange?.(payload?.data?.avatarUrl ?? null)
      toast.success("Profile photo updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload photo")
    } finally {
      setIsUploading(false)
    }
  }

  async function handleRemovePhoto() {
    setIsUploading(true)
    try {
      const response = await apiFetch("/api/profile/avatar", { method: "DELETE" })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Failed to remove photo")
      }
      onAvatarChange?.(null)
      toast.success("Profile photo removed")
      setIsRemoveConfirmOpen(false)
      setIsLightboxOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove photo")
    } finally {
      setIsUploading(false)
    }
  }

  function handleAvatarClick() {
    if (avatarUrl) {
      setIsLightboxOpen(true)
    } else {
      fileInputRef.current?.click()
    }
  }

  const tenure = getTenureLabel(profile.employment_date)
  const joinedDate = profile.employment_date
    ? formatWATDate(new Date(profile.employment_date), { day: "numeric", month: "short", year: "numeric" })
    : null

  const birthdayLabel = formatBirthdayLabel(profile.birthday)

  const desigAndDept = [profile.designation, profile.department].filter(Boolean).join(" · ")
  const joinedInfo = joinedDate ? `Joined ${joinedDate}${tenure ? ` · ${tenure}` : ""}` : null

  const identityLine = [profile.designation, profile.department, joinedInfo].filter(Boolean)

  const renderAvatar = (sizeClass: string) => (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={handleAvatarClick}
        disabled={isUploading}
        aria-label={avatarUrl ? "View profile photo" : "Add profile photo"}
        className="block rounded-full"
      >
        <Avatar
          className={cn("border-background border-2 shadow-md transition-transform group-hover:scale-105", sizeClass)}
        >
          {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName || "Profile photo"} />}
          <AvatarFallback className="bg-primary text-primary-foreground text-lg font-bold sm:text-2xl">
            {getInitials(profile.first_name, profile.last_name)}
          </AvatarFallback>
        </Avatar>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div
        className={cn(
          "border-border/50 bg-background/80 pointer-events-none absolute inset-0 flex items-center justify-center rounded-full border opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100",
          isUploading && "opacity-100"
        )}
      >
        {isUploading ? (
          <Loader2 className="h-4 w-4 animate-spin sm:h-5 sm:w-5" />
        ) : (
          <Camera className="h-4 w-4 sm:h-5 sm:w-5" />
        )}
      </div>
    </div>
  )

  return (
    <Card className="overflow-hidden border shadow-sm">
      <CardContent className="p-4 sm:p-7 lg:p-8">
        {/* Mobile Layout (< sm) */}
        <div className="space-y-3 sm:hidden">
          {/* Top header row: Avatar + Name & Badges */}
          <div className="flex items-center gap-3.5">
            {renderAvatar("h-16 w-16")}

            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-xs">
                {getGreeting()}
                {profile.first_name ? `, ${formatName(profile.first_name)}` : ""}
              </p>
              <h1 className="text-foreground mt-0.5 text-lg leading-tight font-bold tracking-tight">
                {fullName || "—"}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={`px-2 py-0.5 text-[11px] font-medium ${getRoleBadgeColor(profile.role as UserRole)}`}
                >
                  {getRoleDisplayName(profile.role as UserRole)}
                </Badge>
                {profile.is_department_lead && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                  >
                    Dept Lead
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Full-width identity details */}
          {(desigAndDept || joinedInfo) && (
            <div className="space-y-0.5 pt-0.5 text-xs">
              {desigAndDept && <p className="text-foreground/90 text-sm font-medium">{desigAndDept}</p>}
              {joinedInfo && <p className="text-muted-foreground">{joinedInfo}</p>}
            </div>
          )}

          {/* Bottom actions & status bar */}
          <div className="border-border/40 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
            <AttendanceChip attendance={attendance} />
            <Button onClick={onEdit} variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Pencil className="h-3 w-3" />
              Edit Profile
            </Button>
          </div>
        </div>

        {/* Desktop Layout (>= sm) */}
        <div className="hidden sm:flex sm:items-start sm:justify-between sm:gap-6">
          <div className="flex items-start gap-5">
            {renderAvatar("h-24 w-24 lg:h-28 lg:w-28")}

            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-muted-foreground text-sm">
                {getGreeting()}
                {profile.first_name ? `, ${formatName(profile.first_name)}` : ""}
                <span> · {formatWATDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</span>
              </p>
              <h1 className="text-foreground mt-1 text-2xl leading-tight font-bold tracking-tight lg:text-3xl">
                {fullName || "—"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={`text-xs font-medium ${getRoleBadgeColor(profile.role as UserRole)}`}
                >
                  {getRoleDisplayName(profile.role as UserRole)}
                </Badge>
                {profile.is_department_lead && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-xs font-medium text-amber-600 dark:text-amber-400"
                  >
                    Dept Lead
                  </Badge>
                )}
              </div>
              {identityLine.length > 0 && (
                <p className="text-muted-foreground mt-2 flex flex-wrap gap-x-1.5 text-sm">
                  {identityLine.map((part, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className="opacity-30">·</span>}
                      {part}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <AttendanceChip attendance={attendance} />
            <Button onClick={onEdit} variant="outline" size="sm" className="gap-1.5">
              <Pencil className="h-3 w-3" />
              Edit Profile
            </Button>
          </div>
        </div>

        {/* Contact strip */}
        <div className="text-muted-foreground mt-5 grid grid-cols-1 gap-x-6 gap-y-2.5 border-t pt-4 text-sm sm:mt-6 sm:grid-cols-2 sm:pt-5 lg:flex lg:flex-wrap lg:items-center">
          {profile.company_email && (
            <a
              href={`mailto:${profile.company_email}`}
              className="hover:text-foreground flex min-w-0 items-center gap-1.5 transition-colors"
              title={profile.company_email}
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{profile.company_email}</span>
            </a>
          )}
          {profile.phone_number && (
            <a
              href={`tel:${profile.phone_number}`}
              className="hover:text-foreground flex items-center gap-1.5 transition-colors"
            >
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {profile.phone_number}
            </a>
          )}
          {birthdayLabel && (
            <span className="flex items-center gap-1.5">
              <Cake className="h-3.5 w-3.5 shrink-0" />
              {birthdayLabel}
            </span>
          )}
          {profile.residential_address && (
            <span className="flex min-w-0 items-center gap-1.5" title={profile.residential_address}>
              <Home className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{profile.residential_address}</span>
            </span>
          )}
        </div>
      </CardContent>

      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent className="max-w-md gap-4 p-4 sm:p-4">
          <DialogTitle className="sr-only">Profile photo</DialogTitle>
          <div className="bg-muted overflow-hidden rounded-lg">
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL, not an optimizable static asset
              <img src={avatarUrl} alt={fullName || "Profile photo"} className="aspect-square w-full object-cover" />
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-1.5"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Pencil className="h-3.5 w-3.5" />
              Change Photo
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive flex-1 gap-1.5"
              disabled={isUploading}
              onClick={() => setIsRemoveConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isRemoveConfirmOpen} onOpenChange={setIsRemoveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove profile photo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your profile photo. You can upload a new one at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUploading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleRemovePhoto()
              }}
              disabled={isUploading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
