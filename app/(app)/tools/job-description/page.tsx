"use client"

import { useState, useEffect } from "react"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Briefcase, Save, Edit2, Clock, Printer } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatName } from "@/lib/utils"
import { writeAuditLogClient } from "@/lib/audit/client"
import { PageHeader } from "@/components/layout"
import { EmptyState } from "@/components/ui/patterns"
import { QUERY_KEYS } from "@/lib/query-keys"
import { PageLoader } from "@/components/ui/query-states"
import Image from "next/image"

import { logger } from "@/lib/logger"

const log = logger("tools-job-description")

interface JobDescriptionData {
  job_description: string
  job_description_updated_at: string | null
  first_name: string | null
  last_name: string | null
  company_email: string | null
  department: string | null
  phone_number: string | null
  userId: string
}

type AuditClient = Parameters<typeof writeAuditLogClient>[0]

async function fetchJobDescription(supabase: ReturnType<typeof createClient>): Promise<JobDescriptionData> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const { data: profileData, error } = await supabase
    .from("profiles")
    .select(
      "first_name, last_name, company_email, department, phone_number, job_description, job_description_updated_at"
    )
    .eq("id", user.id)
    .single()

  if (error) throw new Error(error.message)

  return {
    job_description: profileData.job_description || "",
    job_description_updated_at: profileData.job_description_updated_at,
    first_name: profileData.first_name,
    last_name: profileData.last_name,
    company_email: profileData.company_email,
    department: profileData.department,
    phone_number: profileData.phone_number,
    userId: user.id,
  }
}

export default function JobDescriptionPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  const { data: profileData, isLoading } = useQuery({
    queryKey: QUERY_KEYS.jobDescription("me"),
    queryFn: () => fetchJobDescription(supabase),
  })

  const [jobDescription, setJobDescription] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Sync local state when data loads
  useEffect(() => {
    if (profileData) {
      setJobDescription(profileData.job_description)
      setIsEditing(!profileData.job_description) // Auto-edit if empty
    }
  }, [profileData])

  if (isLoading) return <PageLoader />

  const lastUpdated = profileData?.job_description_updated_at ?? null
  const profile = profileData
    ? {
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        company_email: profileData.company_email,
        department: profileData.department,
        phone_number: profileData.phone_number,
      }
    : null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const { error } = await supabase
        .from("profiles")
        .update({
          job_description: jobDescription,
          job_description_updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      if (error) throw error

      await writeAuditLogClient(
        supabase as AuditClient,
        {
          action: "update",
          entityType: "job_description",
          entityId: user.id,
          newValues: { job_description: jobDescription },
          context: {
            source: "ui",
            route: "/tools/job-description",
            department: profile?.department || null,
            actorId: user.id,
          },
        },
        { failOpen: true }
      )

      toast.success("Job description saved successfully")
      setIsEditing(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobDescription("me") })
    } catch (error) {
      log.error("Error saving job description:", error)
      toast.error("Failed to save job description")
    } finally {
      setIsSaving(false)
    }
  }

  const formatDate = (dateString: string) => {
    return formatWATDateTime(dateString, { month: "short", day: "numeric", year: "numeric" })
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `,
        }}
      />
      <div className="from-background via-background to-muted/20 min-h-screen bg-gradient-to-br p-4 md:p-8 print:p-4">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Header */}
          <div className="no-print space-y-4">
            <PageHeader
              title="My Job Description"
              description="Define and manage your role responsibilities"
              icon={Briefcase}
              backLink={{ href: "/tools", label: "Back to Tools" }}
              actions={
                !isEditing && jobDescription ? (
                  <div className="flex gap-2">
                    <Button onClick={handlePrint} variant="outline" className="gap-2">
                      <Printer className="h-4 w-4" />
                      Print
                    </Button>
                    <Button onClick={() => setIsEditing(true)} variant="outline" className="gap-2">
                      <Edit2 className="h-4 w-4" />
                      Edit
                    </Button>
                  </div>
                ) : null
              }
            />
          </div>

          {/* Last Updated Info */}
          {lastUpdated && !isEditing && (
            <div className="text-muted-foreground no-print flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4" />
              <span>Last updated: {formatDate(lastUpdated)}</span>
            </div>
          )}

          {/* Print Letterhead - Hidden on screen, visible when printing */}
          <div className="hidden print:mb-8 print:block print:border-b print:pb-4">
            <div className="flex items-start justify-between">
              <div>
                <Image src="/acob-logo.webp" alt="ACOB Lighting" width={180} height={64} className="h-16 w-auto" />
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

          {/* Main Card */}
          <Card className="border-2 shadow-lg print:border-0 print:shadow-none">
            <CardHeader className="bg-muted/30 border-b print:border-0 print:pb-2">
              <CardTitle className="flex items-center justify-between print:text-xl">
                <span className="print:hidden">Job Description</span>
                <span className="hidden print:block">Job Description</span>
                {!jobDescription && (
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 print:hidden">
                    Not Set
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="print:hidden">
                Describe your key responsibilities, duties, and objectives in your current role
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 print:p-0 print:pt-4">
              {isEditing ? (
                <div className="space-y-4">
                  <Textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Enter your job description here...&#10;&#10;Example:&#10;• Manage daily operations of the department&#10;• Coordinate with team members on project deliverables&#10;• Review and approve departmental reports&#10;• Ensure compliance with company policies"
                    className="min-h-[400px] text-base"
                  />
                  <p className="text-muted-foreground text-sm">
                    Tip: Use bullet points or paragraphs to clearly outline your responsibilities
                  </p>
                  <div className="flex gap-3">
                    <Button onClick={handleSave} disabled={isSaving} className="gap-2">
                      <Save className="h-4 w-4" />
                      {isSaving ? "Saving..." : "Save"}
                    </Button>
                    {jobDescription && (
                      <Button
                        onClick={() => {
                          setIsEditing(false)
                          setJobDescription(profileData?.job_description ?? "")
                        }}
                        variant="outline"
                        disabled={isSaving}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {jobDescription ? (
                    <div className="text-foreground whitespace-pre-wrap">{jobDescription}</div>
                  ) : (
                    <EmptyState
                      title="No job description yet"
                      description="Add your job description to help others understand your role."
                      icon={Briefcase}
                      action={
                        <Button onClick={() => setIsEditing(true)} className="gap-2">
                          <Edit2 className="h-4 w-4" />
                          Add Job Description
                        </Button>
                      }
                      className="border-0"
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="no-print border bg-blue-50 dark:bg-blue-950/20">
            <CardContent className="p-4">
              <div className="flex gap-3">
                <div className="mt-0.5 text-blue-600 dark:text-blue-400">
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="text-sm text-blue-900 dark:text-blue-100">
                  <p className="mb-1 font-medium">Why add a job description?</p>
                  <p>
                    Your job description helps your managers and HR understand your role better, ensuring you get the
                    right support and resources. It&apos;s also useful during performance reviews and role transitions.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
