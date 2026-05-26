"use client"

import { formatWATDate } from "@/lib/utils/date"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Printer, XCircle } from "lucide-react"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { formatName } from "@/lib/utils"
import { EmptyState } from "@/components/ui/patterns"
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

function formatDate(dateString: string | null): string {
  if (!dateString) return "Never"
  return formatWATDate(dateString, { month: "short", day: "numeric", year: "numeric" })
}

interface JobDescriptionDialogProps {
  profile: Profile | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export function JobDescriptionDialog({ profile, isOpen, onOpenChange }: JobDescriptionDialogProps) {
  const handlePrint = () => {
    window.print()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @media print {
            body { background: white !important; }
            .no-print { display: none !important; }
          }
        `,
          }}
        />
        <DialogHeader className="no-print">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl">
              {profile?.first_name} {profile?.last_name}&apos;s Job Description
            </DialogTitle>
            {profile?.job_description && (
              <Button onClick={handlePrint} variant="outline" size="sm" className="gap-2">
                <Printer className="h-4 w-4" />
                Print
              </Button>
            )}
          </div>
          <DialogDescription>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-sm">{profile?.department}</span>
              {profile?.designation && <span className="text-sm">&quot; {profile.designation}</span>}
              <Badge className={getRoleBadgeColor(profile?.role || "employee")}>
                {getRoleDisplayName(profile?.role || "employee")}
              </Badge>
              <span className="text-sm">Last updated: {formatDate(profile?.job_description_updated_at || null)}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Print Letterhead */}
        <div className="hidden print:mb-8 print:block print:border-b print:pb-4">
          <div className="flex items-start justify-between">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/acob-logo.webp" alt="ACOB Lighting" className="h-16 w-auto" />
            </div>
            <div className="text-right text-sm">
              {profile?.first_name && profile?.last_name && (
                <p className="mb-1 font-semibold">
                  {formatName(profile.first_name)} {formatName(profile.last_name)}
                </p>
              )}
              {profile?.company_email && <p className="mb-1">{profile.company_email}</p>}
              {profile?.department && <p className="mb-1">{profile.department}</p>}
              {profile?.phone_number && <p className="mb-1">{profile.phone_number}</p>}
              <p className="mt-2">{formatWATDate(new Date(), { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 print:mt-0">
          {profile?.job_description ? (
            <div className="prose dark:prose-invert max-w-none">
              <div className="bg-muted/50 rounded-lg p-6 whitespace-pre-wrap print:rounded-none print:bg-transparent print:p-0">
                <h2 className="mb-4 text-xl font-bold print:mb-2">Job Description</h2>
                <div className="whitespace-pre-wrap">{profile.job_description}</div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No job description has been added yet"
              description="This employee has not submitted a role description."
              icon={XCircle}
              className="border-0"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
