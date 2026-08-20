"use client"

import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Calendar, Clock, LogOut, Mail, Phone, ShieldAlert, User } from "lucide-react"
import { format } from "date-fns"
import { useRouter } from "next/navigation"
import { QUERY_KEYS } from "@/lib/query-keys"

const REASON_LABELS: Record<string, string> = {
  temporary_access_hold: "Temporary Access Hold",
  policy_review: "Policy Review",
  security_investigation: "Security Investigation",
  compliance_breach: "Compliance Breach",
  administrative_hold: "Administrative Hold",
  disciplinary_action: "Disciplinary Action",
  disciplinary_dismissal: "Disciplinary Dismissal",
}

function formatSuspensionReason(reason: string): string {
  if (!reason) return "Temporary Access Hold"
  if (REASON_LABELS[reason]) return REASON_LABELS[reason]
  return reason
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

interface SuspensionData {
  reason: string
  start_date: string
  created_at?: string | null
  end_date: string | null
  suspended_by_name: string
  userName: string
}

async function fetchSuspensionData(supabase: ReturnType<typeof createClient>): Promise<SuspensionData | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("unauthenticated")

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, employment_status")
    .eq("id", user.id)
    .single()

  const userName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : ""

  if (!profile || profile.employment_status !== "suspended") {
    return null
  }

  const { data: suspensionData } = await supabase
    .from("employee_suspensions")
    .select(`reason, start_date, end_date, suspended_by, created_at`)
    .eq("employee_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!suspensionData) {
    return {
      userName,
      reason: "Temporary Access Hold",
      start_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      end_date: null,
      suspended_by_name: "Administrator",
    }
  }

  return {
    userName,
    reason: formatSuspensionReason(suspensionData.reason),
    start_date: suspensionData.start_date,
    created_at: suspensionData.created_at,
    end_date: suspensionData.end_date,
    suspended_by_name: "Administrator",
  }
}

export default function SuspendedPage() {
  const router = useRouter()
  const supabase = createClient()

  const { data: suspensionData, isLoading: loading } = useQuery({
    queryKey: QUERY_KEYS.suspension("me"),
    queryFn: () => fetchSuspensionData(supabase),
    retry: false,
  })

  // Handle unauthenticated or not-suspended redirects
  if (!loading && suspensionData === null) {
    router.push("/profile")
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  const suspension = suspensionData ?? null
  const userName = suspensionData?.userName ?? ""

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="animate-pulse">
          <AlertTriangle className="h-12 w-12 text-amber-500" />
        </div>
      </div>
    )
  }

  const startTimestamp = suspension?.created_at || suspension?.start_date
  const startDateObj = startTimestamp ? new Date(startTimestamp) : new Date()

  return (
    <div className="bg-muted/40 flex min-h-screen w-full items-center justify-center p-4 sm:p-6">
      <Card className="bg-card w-full max-w-lg border-amber-300/40 shadow-2xl dark:border-amber-900/50">
        <CardHeader className="pb-3 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 ring-8 ring-amber-500/10">
            <ShieldAlert className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle className="text-foreground text-2xl font-bold tracking-tight">Account Suspended</CardTitle>
          <CardDescription className="text-muted-foreground mt-1 text-sm">
            {userName && <span className="text-foreground font-semibold">Hello {userName.split(" ")[0]}, </span>}
            Your access to the ERP system has been temporarily suspended.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {suspension && (
            <>
              {/* Suspension Reason */}
              <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
                <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold tracking-wider text-amber-900 uppercase dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Reason for Suspension
                </h3>
                <p className="text-base font-semibold text-amber-950 dark:text-amber-100">{suspension.reason}</p>
              </div>

              {/* Suspension Details */}
              <div className="bg-muted/20 space-y-2.5 rounded-lg border p-3.5 text-xs sm:text-sm">
                <div className="flex items-center justify-between">
                  <div className="text-muted-foreground flex items-center gap-2">
                    <Calendar className="text-primary h-4 w-4" />
                    <span>Effective Date:</span>
                  </div>
                  <span className="text-foreground font-medium">{format(startDateObj, "MMMM d, yyyy")}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-muted-foreground flex items-center gap-2">
                    <Clock className="text-primary h-4 w-4" />
                    <span>Expected Duration:</span>
                  </div>
                  {suspension.end_date ? (
                    <span className="text-foreground font-medium">
                      Until {format(new Date(suspension.end_date), "MMMM d, yyyy")}
                    </span>
                  ) : (
                    <Badge variant="destructive" className="text-[10px] font-bold uppercase">
                      Indefinite Hold
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between border-t pt-2">
                  <div className="text-muted-foreground flex items-center gap-2">
                    <User className="text-primary h-4 w-4" />
                    <span>Suspended by:</span>
                  </div>
                  <span className="text-foreground font-semibold">
                    {suspension.suspended_by_name || "Administrator"}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Contact Support Information */}
          <div className="bg-muted/40 space-y-2.5 rounded-lg border p-4">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Need Assistance?</h3>
            <p className="text-muted-foreground text-xs leading-relaxed">
              If you have questions regarding your account status or resolution timeline, please reach out directly:
            </p>
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:gap-4">
              <a
                href="mailto:ict@acoblighting.com"
                className="text-primary flex items-center gap-2 font-mono text-xs font-medium hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                ict@acoblighting.com
              </a>
              <a
                href="tel:+2347049202634"
                className="text-primary flex items-center gap-2 font-mono text-xs font-medium hover:underline"
              >
                <Phone className="h-3.5 w-3.5" />
                +234 704 920 2634
              </a>
            </div>
          </div>

          {/* Logout Button */}
          <Button variant="outline" className="w-full" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
