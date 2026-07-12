"use client"

import { useRef, useState } from "react"
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
import { formatWATDate, formatBirthdayLabel } from "@/lib/utils/date"
import { getRoleBadgeColor, getRoleDisplayName } from "@/lib/permissions"
import { apiFetch } from "@/lib/api-client"
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
  avatarUrl?: string | null
  onAvatarChange?: (url: string | null) => void
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

function ContactField({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </div>
      <div className="text-foreground min-w-0 text-sm font-medium">{children}</div>
    </div>
  )
}

export function ProfileHero({ profile, avatarUrl, onAvatarChange, onEdit }: ProfileHeroProps) {
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

  const metaParts = [
    profile.department,
    profile.office_location && profile.office_location !== profile.department ? profile.office_location : null,
    joinedDate ? `Joined ${joinedDate}${tenure ? ` · ${tenure}` : ""}` : null,
  ].filter(Boolean)

  return (
    <Card className="overflow-hidden border shadow-sm">
      {/* Banner */}
      <div className="from-primary/20 relative h-24 bg-gradient-to-r to-transparent sm:h-28">
        <div className="absolute top-4 right-4 z-10">
          <Button
            onClick={onEdit}
            variant="outline"
            size="sm"
            className="bg-background/80 border-border/50 gap-1.5 shadow-sm backdrop-blur-sm"
          >
            <Pencil className="h-3 w-3" />
            Edit Profile
          </Button>
        </div>
      </div>

      <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
        {/* Identity — avatar bleeds over banner */}
        <div className="-mt-10 flex items-end gap-4 sm:-mt-12">
          <div className="group relative shrink-0">
            <button
              type="button"
              onClick={handleAvatarClick}
              disabled={isUploading}
              aria-label={avatarUrl ? "View profile photo" : "Add profile photo"}
              className="block rounded-full"
            >
              <Avatar className="border-background h-20 w-20 border-4 shadow-md transition-transform group-hover:scale-105 sm:h-24 sm:w-24">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName || "Profile photo"} />}
                <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold sm:text-2xl">
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
                "bg-background/80 border-border/50 pointer-events-none absolute inset-0 flex items-center justify-center rounded-full border opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100",
                isUploading && "opacity-100"
              )}
            >
              {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-end pb-0.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">{fullName || "—"}</h1>
                {profile.designation && <p className="text-muted-foreground mt-0.5 text-sm">{profile.designation}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5 pt-1">
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
            </div>

            {/* Dept · Location · Joined — inline under name */}
            {metaParts.length > 0 && (
              <p className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-1.5 text-xs">
                {metaParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="opacity-30">·</span>}
                    {part}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>

        {/* Contact details */}
        <div className="mt-5 border-t pt-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {profile.company_email && (
              <ContactField icon={Mail} label="Email">
                <a
                  href={`mailto:${profile.company_email}`}
                  className="hover:text-primary block truncate transition-colors"
                  title={profile.company_email}
                >
                  {profile.company_email}
                </a>
                {profile.additional_email && (
                  <a
                    href={`mailto:${profile.additional_email}`}
                    className="text-muted-foreground hover:text-primary block truncate text-xs font-normal transition-colors"
                    title={profile.additional_email}
                  >
                    {profile.additional_email}
                  </a>
                )}
              </ContactField>
            )}

            {(profile.phone_number || profile.additional_phone) && (
              <ContactField icon={Phone} label="Phone">
                {profile.phone_number ? (
                  <a href={`tel:${profile.phone_number}`} className="hover:text-primary transition-colors">
                    {profile.phone_number}
                  </a>
                ) : (
                  "—"
                )}
                {profile.additional_phone && (
                  <a
                    href={`tel:${profile.additional_phone}`}
                    className="text-muted-foreground hover:text-primary block text-xs font-normal transition-colors"
                  >
                    {profile.additional_phone}
                  </a>
                )}
              </ContactField>
            )}

            {birthdayLabel && (
              <ContactField icon={Cake} label="Birthday">
                {birthdayLabel}
              </ContactField>
            )}

            {profile.residential_address && (
              <ContactField icon={Home} label="Address">
                <span className="leading-snug">{profile.residential_address}</span>
              </ContactField>
            )}
          </div>
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
